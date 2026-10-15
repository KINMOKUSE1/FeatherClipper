/* 浏览器内音轨下载、16 kHz WAV 切分与在线转写，不依赖本机程序。 */
(() => {
  const providers = {
    groq: { name: "Groq", model: "whisper-large-v3-turbo", url: "https://api.groq.com/openai/v1/audio/transcriptions", timestamps: true },
    siliconflow: { name: "硅基流动", model: "FunAudioLLM/SenseVoiceSmall", url: "https://api.siliconflow.cn/v1/audio/transcriptions", timestamps: false }
  };
  function allowedAudioUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password
        && ["bilivideo.com", "hdslb.com", "bilibili.com", "googlevideo.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    } catch { return false; }
  }
  function wavChunk(audio, begin, end) {
    const samples = end - begin, data = new ArrayBuffer(44 + samples * 2), view = new DataView(data);
    const write = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    write(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); write(8, "WAVE"); write(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples * 2, true);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel));
    for (let i = 0; i < samples; i++) {
      const value = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[begin + i], 0) / channels.length));
      view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    return new Blob([data], { type: "audio/wav" });
  }
  function normalizeResult(provider, result, start, duration) {
    if (!result || typeof result !== "object") throw new Error("在线转写结果格式无效");
    if (!providers[provider].timestamps) {
      if (typeof result.text !== "string") throw new Error("在线转写结果缺少文本");
      return result.text.trim() ? [{ content: result.text.trim() }] : [];
    }
    if (!Array.isArray(result.segments)) throw new Error("Groq 返回的结果缺少分段时间戳");
    return result.segments.filter(segment => {
      if (!segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)
        || segment.start < 0 || segment.end < segment.start || segment.start > duration || segment.end > duration + 1
        || typeof segment.text !== "string") throw new Error("Groq 返回的分段时间戳无效");
      return segment.text.trim();
    }).map(segment => ({ from: Math.round((start + segment.start) * 100) / 100,
      to: Math.round((start + Math.min(duration, segment.end)) * 100) / 100, content: segment.text.trim() }));
  }
  function pause(milliseconds, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  async function download(urls, signal) {
    const maxBytes = 128 * 1024 * 1024;
    for (const url of urls) {
      if (!allowedAudioUrl(url)) throw new Error("音频地址不属于支持的媒体服务");
      signal.throwIfAborted();
      try {
        const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]), credentials: "omit" });
        if (!response.ok || !allowedAudioUrl(response.url)) continue;
        const reader = response.body.getReader(), blocks = [];
        let length = 0;
        try {
          if (Number(response.headers.get("content-length")) > maxBytes) throw new RangeError("音轨超过浏览器转写的 128 MiB 文件上限");
          while (true) {
            signal.throwIfAborted();
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > maxBytes) throw new RangeError("音轨超过浏览器转写的 128 MiB 文件上限");
            blocks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        if (length) return new Blob(blocks).arrayBuffer();
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof RangeError) throw error;
      }
    }
    throw new Error("音轨下载失败，请重新读取课程后重试");
  }
  async function request(provider, key, audio, signal, report) {
    const info = providers[provider];
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      const form = new FormData();
      form.append("model", info.model); form.append("file", audio, "audio.wav");
      if (provider === "groq") { form.append("response_format", "verbose_json"); form.append("temperature", "0"); }
      report({ status: "uploading", detail: "正在上传并转写音频" });
      let response;
      try {
        response = await fetch(info.url, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
          credentials: "omit", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]) });
      } catch {
        signal.throwIfAborted();
        throw new Error(`${info.name} 网络不可用或请求超时，请检查控制台后重试`);
      }
      if (response.status === 429) {
        const retry = response.headers.get("Retry-After"), wait = retry === null ? 10 * (attempt + 1) : Number(retry);
        if (attempt === 2 || !Number.isFinite(wait) || wait > 120) throw new Error(`${info.name} 调用额度或频率已达上限，请稍后重试`);
        report({ status: "waiting", detail: "服务限流，稍后重试" });
        await pause(Math.max(1, wait) * 1000, signal); continue;
      }
      if ([401, 403].includes(response.status)) throw new Error(`${info.name} API Key 无效或没有调用权限`);
      if (response.status === 402) throw new Error(`${info.name} 账户额度不足，请检查服务商控制台`);
      if (!response.ok) throw new Error(`${info.name} 请求失败（HTTP ${response.status}）`);
      report({ status: "transcribing", detail: "正在读取转写结果" });
      const result = await response.json().catch(() => { throw new Error("服务商返回了无法读取的转写结果"); });
      signal.throwIfAborted(); return result;
    }
  }
  async function transcribe({ provider, apiKey, urls }, signal, report) {
    if (!providers[provider]) throw new Error("在线转写引擎无效");
    report({ status: "downloading", detail: "正在获取音频" });
    let data = await download(urls, signal);
    report({ status: "preparing", detail: "正在解码和切分音频" });
    const context = new OfflineAudioContext(1, 1, 16000);
    let audio;
    try { audio = await context.decodeAudioData(data); }
    catch { throw new Error("浏览器无法解码该音轨，可能是格式不支持或可用内存不足"); }
    data = null;
    signal.throwIfAborted();
    const body = [], chunkSamples = 120 * audio.sampleRate;
    let language = "unknown", lastRequest = 0;
    for (let begin = 0; begin < audio.length; begin += chunkSamples) {
      signal.throwIfAborted();
      if (provider === "groq" && lastRequest) await pause(Math.max(0, 3100 - (Date.now() - lastRequest)), signal);
      const end = Math.min(begin + chunkSamples, audio.length);
      const chunk = wavChunk(audio, begin, end);
      lastRequest = Date.now();
      const result = await request(provider, apiKey, chunk, signal, report);
      body.push(...normalizeResult(provider, result, begin / audio.sampleRate, (end - begin) / audio.sampleRate));
      if (typeof result.language === "string") language = result.language;
      report({ processed_seconds: end / audio.sampleRate, progress: end / audio.length });
    }
    if (!body.length) throw new Error("在线服务没有识别到可用语音");
    return { body, language, model: providers[provider].model, timestamps: providers[provider].timestamps };
  }
  const api = { providers, allowedAudioUrl, wavChunk, normalizeResult, pause, download, request, transcribe };
  if (typeof module !== "undefined") module.exports = api;
  else globalThis.OnlineAudio = api;
})();
