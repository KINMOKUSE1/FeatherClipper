"""Optional loopback service for Vid2Notes's local subtitle transcription."""

import argparse
import hmac
import json
import os
import re
import socket
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from online import PROVIDERS, transcribe_online


PORT = 27347
MAX_AUDIO_BYTES = 1024 * 1024 * 1024
CHUNK_SECONDS = 120
JOBS = {}
JOBS_LOCK = threading.Lock()
MODEL_LOCK = threading.Lock()
MODEL = None
MODEL_DEVICE = "cpu"
GPU_NOTICE = ""
DLL_DIRECTORIES = []


class ExclusiveLocalServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def allowed_audio_url(value):
    try:
        parsed = urllib.parse.urlparse(value)
        host = (parsed.hostname or "").lower()
        return (parsed.scheme == "https" and not parsed.username and not parsed.password
                and any(host == domain or host.endswith("." + domain)
                        for domain in ("bilivideo.com", "hdslb.com", "bilibili.com", "googlevideo.com")))
    except (TypeError, ValueError):
        return False


class MediaRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        if not allowed_audio_url(newurl):
            raise ValueError("音频服务跳转到了不受支持的媒体地址，已停止下载。")
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def download_audio(urls, target, bvid, canceled, cid=None):
    opener = urllib.request.build_opener(MediaRedirects())
    last_error = None
    for url in urls:
        if not allowed_audio_url(url):
            raise ValueError("音频地址不属于支持的媒体服务。")
        referer = (f"https://www.youtube.com/watch?v={cid or bvid[3:]}" if bvid.startswith(("YT_", "YTPL_"))
                   else f"https://www.bilibili.com/video/{bvid}/")
        request = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": referer,
        })
        try:
            count = 0
            with opener.open(request, timeout=45) as response, target.open("wb") as output:
                while True:
                    if canceled.is_set():
                        raise InterruptedError("已停止转写。")
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    count += len(block)
                    if count > MAX_AUDIO_BYTES:
                        raise OverflowError("音频超过 1 GiB；请分段处理这门课程。")
                    output.write(block)
            if not count:
                raise ValueError("媒体服务没有返回音频数据。")
            return
        except (OSError, urllib.error.URLError, ValueError) as error:
            if canceled.is_set():
                raise InterruptedError("已停止转写。") from error
            last_error = error
    raise ValueError(f"音轨下载失败（已尝试 {len(urls)} 个地址）：{last_error}")


def gpu_requested(home):
    config = json.loads((home / "config.json").read_text(encoding="utf-8"))
    return config.get("gpu_enabled") is True


def prepare_gpu_libraries(home):
    if os.name != "nt":
        return
    root = home / ".venv" / "Lib" / "site-packages" / "nvidia"
    directories = {file.parent for file in root.rglob("*.dll")} if root.is_dir() else set()
    for directory in sorted(directories):
        DLL_DIRECTORIES.append(os.add_dll_directory(str(directory)))
    if directories:
        os.environ["PATH"] = os.pathsep.join(map(str, directories)) + os.pathsep + os.environ.get("PATH", "")


def gpu_failure_message(error):
    detail = str(error).strip()
    lowered = detail.lower()
    if "cublas" in lowered:
        reason = "缺少 CUDA 12 cuBLAS 运行库"
    elif "cudnn" in lowered:
        reason = "缺少 CUDA 12 cuDNN 9 运行库"
    else:
        reason = detail[:100] or "GPU 无法运行"
    remedy = "可重新运行安装程序，选择原安装目录和 NVIDIA GPU 补装运行库。" if "cublas" in lowered or "cudnn" in lowered else ""
    return f"GPU 不可用（{reason}），已改用 CPU。{remedy}"


def use_cpu_model(home, error=None):
    global MODEL, MODEL_DEVICE, GPU_NOTICE
    from faster_whisper import WhisperModel

    MODEL = WhisperModel(str(home / "model"), device="cpu", compute_type="int8")
    MODEL_DEVICE = "cpu"
    GPU_NOTICE = gpu_failure_message(error) if error else ""
    return MODEL


def get_model(home):
    global MODEL, MODEL_DEVICE, GPU_NOTICE
    with MODEL_LOCK:
        if MODEL is None:
            if gpu_requested(home):
                try:
                    import numpy as np

                    prepare_gpu_libraries(home)
                    from faster_whisper import WhisperModel
                    gpu_model = WhisperModel(str(home / "model"), device="cuda", compute_type="float16")
                    segments, _ = gpu_model.transcribe(np.zeros(16000, dtype=np.float32),
                                                       language="en", beam_size=1, vad_filter=False)
                    list(segments)
                    MODEL = gpu_model
                    MODEL_DEVICE = "cuda"
                    GPU_NOTICE = ""
                except Exception as error:
                    use_cpu_model(home, error)
            else:
                use_cpu_model(home)
        return MODEL


def fallback_to_cpu(home, error):
    with MODEL_LOCK:
        return use_cpu_model(home, error)


def transcribe_file(path, home, job):
    import av
    import numpy as np

    model = get_model(home)
    job["device"] = MODEL_DEVICE
    if GPU_NOTICE:
        job["gpu_notice"] = GPU_NOTICE
    result = []
    with av.open(str(path)) as container:
        streams = [stream for stream in container.streams if stream.type == "audio"]
        if not streams:
            raise ValueError("下载的媒体没有音轨。")
        stream = streams[0]
        duration = float(container.duration / av.time_base) if container.duration else 0
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        pieces = []
        sample_count = 0
        processed_samples = 0
        language = None

        def process_chunk():
            nonlocal pieces, sample_count, processed_samples, language, model
            if not sample_count:
                return
            if job["cancel"].is_set():
                raise InterruptedError("已停止转写。")
            audio = np.concatenate(pieces)
            start = processed_samples / 16000
            job.update(status="transcribing", detail=f"正在用 {'GPU' if job['device'] == 'cuda' else 'CPU'} 转写 {int(start // 60)} 分钟后的音频")
            try:
                segments, info = model.transcribe(audio, language=language, beam_size=5, vad_filter=True)
                segments = list(segments)
            except Exception as error:
                if job["device"] != "cuda":
                    raise
                model = fallback_to_cpu(home, error)
                job.update(device="cpu", gpu_notice=GPU_NOTICE,
                           detail="GPU 转写失败，已切换 CPU 继续处理")
                segments, info = model.transcribe(audio, language=language, beam_size=5, vad_filter=True)
                segments = list(segments)
            if language is None:
                language = info.language
            for segment in segments:
                if job["cancel"].is_set():
                    raise InterruptedError("已停止转写。")
                content = segment.text.strip()
                if content:
                    result.append({"from": round(start + segment.start, 2),
                                   "to": round(start + segment.end, 2), "content": content})
            processed_samples += sample_count
            job["progress"] = min(1.0, processed_samples / (duration * 16000)) if duration else 0
            pieces, sample_count = [], 0

        for frame in container.decode(stream):
            for converted in resampler.resample(frame):
                pcm = np.frombuffer(converted.planes[0], dtype=np.int16)[:converted.samples].astype(np.float32) / 32768.0
                position = 0
                while position < len(pcm):
                    take = min(CHUNK_SECONDS * 16000 - sample_count, len(pcm) - position)
                    pieces.append(pcm[position:position + take])
                    sample_count += take
                    position += take
                    if sample_count == CHUNK_SECONDS * 16000:
                        process_chunk()
        for converted in resampler.resample(None):
            pcm = np.frombuffer(converted.planes[0], dtype=np.int16)[:converted.samples].astype(np.float32) / 32768.0
            pieces.append(pcm)
            sample_count += len(pcm)
        process_chunk()
    if not result:
        raise ValueError("本地模型没有识别到可用语音。")
    return result, language or "unknown"


def run_job(home, job, api_key=""):
    # The model runs one course part at a time to avoid competing jobs.
    with MODEL_RUN_LOCK:
        if job["cancel"].is_set():
            job.update(status="canceled", detail="已停止")
            return
        target = home / "tmp" / (job["id"] + ".m4a")
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            job.update(status="downloading", detail="正在获取音频")
            download_audio(job["audio_urls"], target, job["bvid"], job["cancel"], job["cid"])
            if job["provider"] == "local":
                job.update(status="transcribing", detail="正在加载模型", model="faster-whisper-small", timestamps=True)
                body, language = transcribe_file(target, home, job)
            else:
                body, language = transcribe_online(target, job["provider"], api_key, job)
            if job["cancel"].is_set():
                raise InterruptedError("已停止转写")
            job.update(status="done", detail="转写完成",
                       progress=1.0, body=body, language=language)
        except InterruptedError:
            job.update(status="canceled", detail="已停止")
        except Exception as error:
            job.update(status="failed", detail=str(error)[:240])
        finally:
            target.unlink(missing_ok=True)


MODEL_RUN_LOCK = threading.Lock()


def make_handler(home, token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format_string, *args):
            # Media URLs and pairing tokens must not appear in access logs.
            return

        def send_json(self, status, data):
            content = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            origin = self.headers.get("Origin", "")
            if re.fullmatch(r"chrome-extension://[a-p]{32}", origin):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def authorized(self):
            supplied = self.headers.get("X-Vid2Notes-Token", "")
            if hmac.compare_digest(supplied, token):
                return True
            self.send_json(401, {"error": "连接码不正确。"})
            return False

        def job_for_path(self):
            job_id = self.path.removeprefix("/jobs/")
            if self.path == "/jobs/" or not re.fullmatch(r"[0-9a-f]{32}", job_id):
                return None
            with JOBS_LOCK:
                return JOBS.get(job_id)

        def do_OPTIONS(self):
            origin = self.headers.get("Origin", "")
            if not re.fullmatch(r"chrome-extension://[a-p]{32}", origin):
                self.send_error(403)
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Vid2Notes-Token")
            self.end_headers()

        def do_GET(self):
            if self.path == "/health":
                self.send_json(200, {"service": "vid2notes-asr", "version": 1,
                                     "audio_backups": True, "youtube_audio": True,
                                     "providers": ["local", *PROVIDERS],
                                     "gpu_enabled": gpu_requested(home) if (home / "config.json").is_file() else False,
                                     "device": MODEL_DEVICE if MODEL else "pending",
                                     "gpu_notice": GPU_NOTICE,
                                     "model_ready": all((home / "model" / name).is_file()
                                                        for name in ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt"))})
                return
            if not self.authorized():
                return
            if self.path == "/pair":
                self.send_json(200, {"connected": True})
                return
            job = self.job_for_path()
            if not job:
                self.send_json(404, {"error": "转写任务不存在，请重新开始。"})
                return
            self.send_json(200, {key: value for key, value in job.items()
                                 if key not in ("audio_urls", "cancel")})

        def do_POST(self):
            if self.path != "/jobs":
                self.send_json(404, {"error": "未知请求。"})
                return
            if not self.authorized():
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 1 or length > 16384:
                    raise ValueError("请求内容长度无效。")
                data = json.loads(self.rfile.read(length))
                provider = data.get("provider", "local")
                if provider not in ("local", *PROVIDERS):
                    raise ValueError("转写引擎无效")
                api_key = data.get("api_key", "")
                if provider != "local" and (not isinstance(api_key, str) or not api_key.strip()
                                             or len(api_key) > 512 or any(c.isspace() for c in api_key)):
                    raise ValueError("请填写有效的服务商 API Key")
                bvid, cid = data.get("bvid"), data.get("cid")
                urls = data.get("audio_urls") or [data.get("audio_url")]
                youtube = isinstance(bvid, str) and bool(re.fullmatch(r"YT_[\w-]{11}|YTPL_[\w-]{8,60}", bvid))
                if not isinstance(bvid, str) or not (youtube or re.fullmatch(r"BV[0-9A-Za-z]+", bvid)):
                    raise ValueError("视频编号无效。")
                if not isinstance(cid, str) or not ((re.fullmatch(r"[\w-]{11}", cid) and (bvid.startswith("YTPL_") or cid == bvid[3:])) if youtube else re.fullmatch(r"\d+", cid)):
                    raise ValueError("视频分段编号无效。")
                if not isinstance(urls, list) or not 1 <= len(urls) <= 4 or not all(isinstance(url, str) and allowed_audio_url(url) for url in urls):
                    raise ValueError("音频地址不属于支持的媒体服务。")
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self.send_json(400, {"error": str(error)})
                return
            with JOBS_LOCK:
                job = next((item for item in JOBS.values() if item["bvid"] == bvid and item["cid"] == cid
                            and item.get("provider", "local") == provider
                            and not item["cancel"].is_set()
                            and item["status"] not in ("failed", "canceled")), None)
                if job is None:
                    job = {"id": uuid.uuid4().hex, "bvid": bvid, "cid": cid, "audio_urls": urls, "provider": provider,
                           "status": "queued", "progress": 0, "detail": "等待转写", "cancel": threading.Event()}
                    JOBS[job["id"]] = job
                    threading.Thread(target=run_job, args=(home, job, api_key), daemon=True).start()
            self.send_json(202, {"id": job["id"], "status": job["status"]})

        def do_DELETE(self):
            if not self.authorized():
                return
            job = self.job_for_path()
            if not job:
                self.send_json(404, {"error": "转写任务不存在。"})
                return
            job["cancel"].set()
            self.send_json(200, {"id": job["id"], "status": "stopping"})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Vid2Notes local ASR companion")
    parser.add_argument("--home", required=True, type=Path)
    options = parser.parse_args()
    home = options.home.resolve()
    config = json.loads((home / "config.json").read_text(encoding="utf-8"))
    token = config.get("token")
    if not isinstance(token, str) or len(token) < 32:
        raise SystemExit("本地转写连接码缺失，请重新运行安装向导。")
    os.environ["HF_HOME"] = str(home / "cache" / "huggingface")
    try:
        server = ExclusiveLocalServer(("127.0.0.1", PORT), make_handler(home, token))
    except OSError as error:
        raise SystemExit(f"本地转写端口 {PORT} 已被占用。请关闭其他“启动本地转写”窗口后重试。({error})") from error
    print(f"Vid2Notes 本地转写已启动：http://127.0.0.1:{PORT}", flush=True)
    print("连接码保存在安装目录的 config.json 中，请勿分享。", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
