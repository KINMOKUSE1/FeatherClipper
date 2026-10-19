/* 仅处理已通过校验的 SABR 会话；下载后仍须核对解码时长，才可上传转写。 */
(() => {
  function validSession(input) {
    try {
      const url = new URL(input.url);
      return /^[\w-]{11}$/.test(input.videoId) && url.protocol === "https:" && !url.username && !url.password
        && url.hostname.endsWith(".googlevideo.com") && url.pathname === "/videoplayback"
        && Array.isArray(input.request) && input.request.length > 0 && input.request.length <= 128 * 1024
        && input.request.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
        && Number.isFinite(input.durationMs) && input.durationMs > 0 && Array.isArray(input.formats) && input.formats.length > 0;
    } catch { return false; }
  }
  function assertDuration(seconds, expectedMs) {
    if (!Number.isFinite(seconds) || seconds <= 0 || Math.abs(seconds - expectedMs / 1000) > 2) {
      throw new Error("YouTube 音频下载不完整，未上传转写，请重试");
    }
  }
  async function download(input, signal) {
    if (!validSession(input)) throw new Error("YouTube 音频会话无效，请重新开始转写");
    signal.throwIfAborted();
    const p = globalThis.Vid2NotesSabr, native = p.VideoPlaybackAbrRequest.decode(new Uint8Array(input.request));
    if (!native.streamerContext?.poToken?.length || !native.videoPlaybackUstreamerConfig?.length) throw new Error("YouTube 音频会话缺少播放校验");
    p.Logger.getInstance().setLogLevels(p.LogLevel.NONE);
    const formats = input.formats.map(p.buildSabrFormat), url = new URL(input.url);
    url.searchParams.set("cpn", crypto.randomUUID().replace(/-/g, "").slice(0, 16));
    const base64 = bytes => btoa(String.fromCharCode(...bytes));
    const timeout = new AbortController(), combined = AbortSignal.any([signal, timeout.signal]);
    let failure = "", pending = 0;
    const stream = new p.SabrStream({ videoId: input.videoId, serverAbrStreamingUrl: url.href, formats,
      durationMs: input.durationMs, clientInfo: native.streamerContext.clientInfo,
      poToken: base64(native.streamerContext.poToken), videoPlaybackUstreamerConfig: base64(native.videoPlaybackUstreamerConfig),
      fetchFunction: async (address, options) => {
        const outgoing = p.VideoPlaybackAbrRequest.decode(new Uint8Array(options.body)), generated = outgoing.streamerContext;
        const contexts = new Map(native.streamerContext.sabrContexts.map(item => [item.type, item]));
        for (const item of generated.sabrContexts) contexts.set(item.type, item);
        outgoing.streamerContext = { ...native.streamerContext, ...generated, sabrContexts: [...contexts.values()],
          playbackCookie: generated.playbackCookie?.length ? generated.playbackCookie : native.streamerContext.playbackCookie };
        const target = new URL(address);
        if (target.protocol !== "https:" || !target.hostname.endsWith(".googlevideo.com")) throw new Error("媒体地址无效");
        return fetch(address, { ...options, body: p.VideoPlaybackAbrRequest.encode(outgoing).finish(), credentials: "omit", signal: combined });
      }
    });
    stream.on("error", () => {});
    stream.on("streamProtectionStatusUpdate", value => {
      pending = value.status === 2 ? pending + 1 : 0;
      if (value.status === 3 || pending >= 3) {
        failure = "YouTube 播放校验已失效，请重新开始转写"; timeout.abort(); stream.abort();
      }
    });
    const abort = () => stream.abort();
    combined.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { failure = "YouTube 音频下载超时，请重试"; timeout.abort(); }, 180000);
    let reader;
    try {
      const output = stream.start({ enabledTrackTypes: p.EnabledTrackTypes.AUDIO_ONLY, maxRetries: 0, stallDetectionMs: 5000,
        audioFormat: list => list.find(item => item.itag === 140 && !item.xtags) || list.find(item => item.itag === 251 && !item.xtags) || list[0] });
      reader = output.audioStream.getReader();
      const chunks = []; let length = 0;
      while (true) {
        combined.throwIfAborted();
        const item = await reader.read(); if (item.done) break;
        length += item.value.byteLength;
        if (length > 128 * 1024 * 1024) { failure = "音轨超过浏览器转写的 128 MiB 文件上限"; throw new RangeError(failure); }
        chunks.push(item.value);
      }
      combined.throwIfAborted();
      if (!length) throw new Error("Empty audio");
      return new Blob(chunks).arrayBuffer();
    } catch (error) {
      signal.throwIfAborted();
      const status = /Server returned (\d{3})/.exec(error.message);
      throw new Error(failure || (status ? `YouTube 音频下载失败：HTTP ${status[1]}` : "YouTube 音频分段下载失败，请重试"));
    } finally {
      clearTimeout(timer); combined.removeEventListener("abort", abort); stream.abort();
      if (reader) await reader.cancel().catch(() => {});
    }
  }
  const api = { validSession, assertDuration, download };
  if (typeof module !== "undefined") module.exports = api;
  else globalThis.SabrAudio = api;
})();
