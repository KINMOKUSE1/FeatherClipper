"""Online transcription adapters; keys are passed per job and never persisted."""
import io
import json
import math
import time
import urllib.error
import urllib.request
import uuid
import wave


PROVIDERS = {
    "groq": {"name": "Groq", "model": "whisper-large-v3-turbo",
             "url": "https://api.groq.com/openai/v1/audio/transcriptions", "timestamps": True},
    "siliconflow": {"name": "硅基流动", "model": "FunAudioLLM/SenseVoiceSmall",
                   "url": "https://api.siliconflow.cn/v1/audio/transcriptions", "timestamps": False},
}


def multipart(provider, audio):
    boundary = "vid2notes-" + uuid.uuid4().hex
    fields = {"model": PROVIDERS[provider]["model"]}
    if provider == "groq":
        fields.update(response_format="verbose_json", temperature="0")
    parts = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.extend([
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode(),
        audio, f'\r\n--{boundary}--\r\n'.encode(),
    ])
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def request_transcript(provider, api_key, audio, job):
    info = PROVIDERS[provider]
    payload, content_type = multipart(provider, audio)
    request = urllib.request.Request(info["url"], data=payload, headers={
        "Authorization": f"Bearer {api_key}", "Content-Type": content_type,
    })
    for attempt in range(3):
        if job["cancel"].is_set():
            raise InterruptedError("已停止转写")
        job.update(status="uploading", detail="正在上传并转写音频")
        try:
            # Upload and inference share a synchronous HTTP request. No fake upload percentage.
            with urllib.request.urlopen(request, timeout=180) as response:
                job.update(status="transcribing", detail="正在读取转写结果")
                result = json.load(response)
            if job["cancel"].is_set():
                raise InterruptedError("已停止转写")
            return result
        except urllib.error.HTTPError as error:
            if error.code == 429:
                try:
                    wait = float(error.headers.get("Retry-After", 10 * (attempt + 1)))
                except (ValueError, TypeError):
                    wait = 10 * (attempt + 1)
                if attempt == 2 or not math.isfinite(wait) or wait > 120:
                    raise ValueError(f"{info['name']} 调用额度或频率已达上限，请稍后重试") from None
                job.update(status="waiting", detail=f"服务限流，{math.ceil(max(1, wait))} 秒后重试")
                if job["cancel"].wait(max(1, wait)):
                    raise InterruptedError("已停止转写")
                continue
            if error.code in (401, 403):
                raise ValueError(f"{info['name']} API Key 无效或没有调用权限") from None
            if error.code in (402,):
                raise ValueError(f"{info['name']} 账户额度不足，请检查服务商控制台") from None
            raise ValueError(f"{info['name']} 请求失败（HTTP {error.code}），请稍后重试") from None
        except InterruptedError:
            raise
        except (OSError, urllib.error.URLError):
            # Do not automatically resubmit an uncertain, potentially billed request.
            raise ValueError(f"{info['name']} 连接超时或网络不可用，请检查控制台后重试") from None
        except (ValueError, TypeError):
            raise ValueError(f"{info['name']} 返回了无法读取的转写结果") from None


def normalize_result(provider, result, start, seconds):
    if not isinstance(result, dict):
        raise ValueError("在线转写结果格式无效")
    if not PROVIDERS[provider]["timestamps"]:
        text = result.get("text")
        if not isinstance(text, str):
            raise ValueError("在线转写结果缺少文本")
        return [{"content": text.strip()}] if text.strip() else []
    segments = result.get("segments")
    if not isinstance(segments, list):
        raise ValueError("Groq 返回的结果缺少分段时间戳")
    body = []
    for segment in segments:
        if not isinstance(segment, dict):
            raise ValueError("Groq 返回的分段格式无效")
        begin, end = segment.get("start"), segment.get("end")
        text = segment.get("text")
        if (not isinstance(begin, (int, float)) or not isinstance(end, (int, float))
                or not math.isfinite(begin) or not math.isfinite(end)
                or not 0 <= begin <= end or begin > seconds
                or end > seconds + 1 or not isinstance(text, str)):
            raise ValueError("Groq 返回的分段时间戳无效")
        if text.strip():
            body.append({"from": round(start + begin, 2), "to": round(start + min(end, seconds), 2),
                         "content": text.strip()})
    return body


def audio_chunks(path, canceled, chunk_seconds=120):
    import av

    size = chunk_seconds * 16000 * 2
    pcm = bytearray()
    processed = 0
    with av.open(str(path)) as container:
        streams = [stream for stream in container.streams if stream.type == "audio"]
        if not streams:
            raise ValueError("下载的媒体没有音轨")
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)

        def pack(data):
            output = io.BytesIO()
            with wave.open(output, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(16000)
                wav.writeframes(data)
            return output.getvalue()

        def frames():
            for frame in container.decode(streams[0]):
                yield from resampler.resample(frame)
            yield from resampler.resample(None)

        for frame in frames():
            if canceled.is_set():
                raise InterruptedError("已停止转写")
            pcm.extend(bytes(frame.planes[0])[:frame.samples * 2])
            while len(pcm) >= size:
                yield processed / 32000, pack(pcm[:size]), chunk_seconds
                del pcm[:size]
                processed += size
        if pcm:
            yield processed / 32000, pack(pcm), len(pcm) / 32000


def transcribe_online(path, provider, api_key, job):
    info = PROVIDERS[provider]
    body, language, previous_call = [], "unknown", 0
    job.update(model=info["model"], timestamps=info["timestamps"], status="preparing", detail="正在处理音频")
    for start, audio, seconds in audio_chunks(path, job["cancel"]):
        # At most 20 requests/minute for Groq's public free-plan RPM limit.
        delay = max(0, 3.1 - (time.monotonic() - previous_call)) if provider == "groq" else 0
        if job["cancel"].wait(delay):
            raise InterruptedError("已停止转写")
        previous_call = time.monotonic()
        result = request_transcript(provider, api_key, audio, job)
        body.extend(normalize_result(provider, result, start, seconds))
        if isinstance(result.get("language"), str):
            language = result["language"]
        job.update(detail=f"已转写至 {int((start + seconds) // 60)} 分钟", processed_seconds=start + seconds)
    if not body:
        raise ValueError("在线服务没有识别到可用语音")
    return body, language
