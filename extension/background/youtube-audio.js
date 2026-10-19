/* SABR 会话只在本次任务内存中保存；只观察扩展自己创建的静音辅助页。 */
const youtubeAudioSessions = new Map();
chrome.webRequest.onBeforeRequest.addListener(details => {
  const session = [...youtubeAudioSessions.values()].find(item => item.tabId === details.tabId && !item.canceled);
  const raw = details.requestBody?.raw;
  if (!session || !raw?.length || !raw.every(item => item.bytes)) return;
  const length = raw.reduce((sum, item) => sum + item.bytes.byteLength, 0);
  if (!length || length > 128 * 1024) return;
  const body = new Uint8Array(length); let offset = 0;
  for (const item of raw) { body.set(new Uint8Array(item.bytes), offset); offset += item.bytes.byteLength; }
  session.candidate = { url: details.url, body };
}, { urls: ["https://*.googlevideo.com/*"] }, ["requestBody"]);

async function youtubeAudioHelperState(videoId, start) {
  try {
    if (new URL(location.href).searchParams.get("v") !== videoId) return null;
    const player = document.getElementById("movie_player"), response = player?.getPlayerResponse?.();
    if (response?.videoDetails?.videoId !== videoId || !document.querySelector("video")) return null;
    if (start) {
      const video = document.querySelector("video"); video.muted = true;
      video.play().catch(() => {});
      video.currentTime = Math.min(120, Number(response.videoDetails.lengthSeconds) / 2);
    }
    const formats = response.streamingData?.adaptiveFormats || [];
    return { videoId, url: response.streamingData?.serverAbrStreamingUrl, durationMs: Number(response.videoDetails.lengthSeconds) * 1000,
      formats: formats.filter(item => String(item.mimeType || "").startsWith("audio/")).map(item => ({
        itag: item.itag, mimeType: item.mimeType, bitrate: item.bitrate, averageBitrate: item.averageBitrate,
        lastModified: item.lastModified, xtags: item.xtags, contentLength: item.contentLength,
        audioTrackId: item.audioTrack?.id, audioChannels: item.audioChannels, targetDurationSec: item.targetDurationSec,
        approxDurationMs: item.approxDurationMs, audioQuality: item.audioQuality, isDrc: item.isDrc
      })) };
  } catch { return null; }
}

async function youtubeAudioProof(candidate, signal) {
  const url = new URL(candidate.url); url.searchParams.set("rn", "500001");
  const response = await fetch(url.href, { method: "POST", body: candidate.body, credentials: "omit",
    headers: { "Content-Type": "application/x-protobuf" }, signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]) });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/vnd.yt-ump") || !response.body) return false;
  let status = 0, total = 0;
  const reader = response.body.getReader();
  const parser = new Vid2NotesSabr.UmpReader({ onPart(type, part) {
    if (type !== Vid2NotesSabr.UMPPartId.STREAM_PROTECTION_STATUS) return;
    const bytes = new Uint8Array(part.totalLength); let offset = 0;
    for (const chunk of part.chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    status = Vid2NotesSabr.StreamProtectionStatus.decode(bytes).status;
  } });
  try {
    while (!status) {
      const item = await reader.read(); if (item.done) break;
      total += item.value.length; if (total > 16 * 1024 * 1024) break;
      await parser.feed(item.value);
    }
    return status === 1;
  } finally { reader.cancel().catch(() => {}); }
}

async function youtubeAudioSource(videoId, jobId) {
  const session = { canceled: false, controller: new AbortController() };
  if (youtubeAudioSessions.has(jobId)) throw new Error("音频会话已在准备中");
  youtubeAudioSessions.set(jobId, session);
  try {
    const tab = await chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}&autoplay=0`, active: false });
    session.tabId = tab.id;
    session.controller.signal.throwIfAborted();
    await chrome.tabs.update(tab.id, { muted: true });
    const expires = Date.now() + 45000, tested = new Map();
    let state = null, started = false, sawProof = false;
    while (Date.now() < expires) {
      session.controller.signal.throwIfAborted();
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      if (!current) throw new Error("YouTube 音频辅助页已关闭，请重试");
      if (current.url?.startsWith("https://www.youtube.com/watch")) {
        const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN",
          func: youtubeAudioHelperState, args: [videoId, !started] }).catch(() => []);
        if (result[0]?.result) {
          state = result[0].result; started = true;
          if (!state.url) {
            const audio = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: youtubePageRead, args: [videoId, false, true, ""] });
            const source = audio[0]?.result;
            if (!source?.audioUrls?.length) throw new Error(source?.error || "YouTube 没有提供可用的音轨地址");
            return { urls: source.audioUrls };
          }
        }
      }
      const candidate = session.candidate;
      if (state?.url && candidate && new URL(candidate.url).searchParams.get("id") === new URL(state.url).searchParams.get("id")) {
        const native = Vid2NotesSabr.VideoPlaybackAbrRequest.decode(candidate.body);
        const token = native.streamerContext?.poToken;
        if (token?.length > 10) {
          sawProof = true;
          const tokenId = Array.from(token).join(",");
          const attempt = tested.get(tokenId) || { count: 0, at: 0 };
          if (attempt.count < 2 && Date.now() - attempt.at > 1500) {
            tested.set(tokenId, { count: attempt.count + 1, at: Date.now() });
            if (await youtubeAudioProof(candidate, session.controller.signal).catch(() => false)) {
              session.controller.signal.throwIfAborted();
              return { sabr: { videoId, url: candidate.url, request: Array.from(candidate.body), formats: state.formats, durationMs: state.durationMs } };
            }
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(sawProof ? "YouTube 播放校验未通过，请在视频页确认能连续播放后重试" : "未取得有效的 YouTube 音频会话，请确认视频能播放后重试");
  } finally {
    youtubeAudioSessions.delete(jobId);
    session.controller.abort();
    if (session.tabId !== undefined) await chrome.tabs.remove(session.tabId).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== "youtube-audio-session") return false;
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("transcription/worker.html")
    || !/^online-[0-9a-f]{32}$/.test(message.id || "")) { respond({ ok: false, error: "音频会话请求无效" }); return false; }
  if (message.action === "cancel") {
    const session = youtubeAudioSessions.get(message.id);
    if (session) { session.canceled = true; session.controller.abort(); if (session.tabId !== undefined) chrome.tabs.remove(session.tabId).catch(() => {}); }
    respond({ ok: true }); return false;
  }
  if (message.action !== "read" || !/^[\w-]{11}$/.test(message.videoId || "")) { respond({ ok: false, error: "视频编号无效" }); return false; }
  youtubeAudioSource(message.videoId, message.id).then(source => respond({ ok: true, source }))
    .catch(error => respond({ ok: false, error: /https?:|chrome-extension:/.test(error.message) ? "YouTube 音频会话准备失败，请重试" : error.message }));
  return true;
});
