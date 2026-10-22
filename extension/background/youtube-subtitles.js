/* 后台 HTTP 字幕：watch HTML → Android player → timedtext；不创建视频页。
 * Request flow: youtube-transcript-api (https://github.com/jdepoix/youtube-transcript-api). */
let youtubeSubtitleHeadersReady = null;
function youtubePrepareSubtitleHeaders() {
  if (!youtubeSubtitleHeadersReady) {
    // Extension Origin triggers a player 403. Limit removal to our player API requests.
    youtubeSubtitleHeadersReady = chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [7002],
      addRules: [{ id: 7002, priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
        condition: { initiatorDomains: [chrome.runtime.id], requestDomains: ["youtube.com"],
          regexFilter: "^https://www[.]youtube[.]com/youtubei/v1/player([?]|$)", resourceTypes: ["xmlhttprequest"] }
      }]
    }).catch(() => { youtubeSubtitleHeadersReady = null; throw new Error("无法准备 YouTube 字幕请求，请重新加载扩展"); });
  }
  return youtubeSubtitleHeadersReady;
}

function youtubePickSubtitle(player) {
  const renderer = player.captions?.playerCaptionsTracklistRenderer;
  const tracks = renderer?.captionTracks;
  if (tracks !== undefined && !Array.isArray(tracks)) throw new Error("YouTube 字幕列表响应无效，请重试");
  if (!tracks?.length) return null;
  const family = track => String(track.languageCode || "").replace(/_/g, "-").toLowerCase().split("-")[0];
  const chinese = tracks.filter(track => family(track) === "zh");
  if (chinese.length) return chinese.find(track => track.kind !== "asr") || chinese[0];
  const audio = renderer.audioTracks?.[renderer.defaultAudioTrackIndex || 0] || renderer.audioTracks?.[0];
  const defaultTrack = tracks[audio?.defaultCaptionTrackIndex ?? renderer.defaultCaptionTrackIndex];
  const spoken = tracks.find(track => track.kind === "asr");
  const original = spoken && tracks.find(track => track.kind !== "asr" && family(track) === family(spoken));
  const manual = tracks.filter(track => track.kind !== "asr");
  const remaining = manual.length ? manual : tracks;
  return defaultTrack || original || spoken || remaining.find(track => family(track) === "en") || remaining[0];
}

function youtubeParseSubtitle(xml) {
  const invalid = () => new Error("YouTube 字幕文件内容无效，请重试");
  const document = String(xml).trim().replace(/^<\?xml[^>]*>\s*/i, "");
  const transcript = document.match(/^<transcript\b[^>]*>([\s\S]*)<\/transcript>$/);
  if (!transcript) throw invalid();
  const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== "#") return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[entity.toLowerCase()];
    const point = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "�";
  });
  const body = [];
  const remainder = transcript[1].replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/g, (_, attributes, text) => {
    const attribute = name => attributes.match(new RegExp('(?:^|\\s)' + name + '=(["\'])(.*?)\\1'))?.[2];
    const start = attribute("start"), duration = attribute("dur");
    const from = start?.trim() ? Number(start) : NaN;
    const length = duration === undefined ? 0 : duration.trim() ? Number(duration) : NaN;
    if (!Number.isFinite(from) || from < 0 || !Number.isFinite(length) || length < 0 || !Number.isFinite(from + length)) throw invalid();
    const content = decode(decode(text.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, ""))).replace(/\s+/g, " ").trim();
    if (content) body.push({ from, to: from + length, content });
    return "";
  });
  if (remainder.trim()) throw invalid();
  if (!body.length) throw new Error("YouTube 字幕文件为空，请重试");
  return body;
}

async function youtubeSubtitleRead(videoId, signal) {
  let stage = "页面信息";
  const request = async (url, options = {}) => {
    signal.throwIfAborted();
    const response = await fetch(url, { ...options, credentials: "omit", cache: "no-store", signal });
    if (!response.ok) throw new Error(`YouTube ${stage}请求失败（HTTP ${response.status}）`);
    return response;
  };
  try {
    await youtubePrepareSubtitleHeaders();
    const html = await (await request(`https://www.youtube.com/watch?v=${videoId}`, { headers: { "Accept-Language": "en-US" } })).text();
    // Public client configuration supplied by YouTube, not a user API credential.
    const key = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/)?.[1];
    if (!key) throw new Error("未取得 YouTube 播放器配置，请重试");
    stage = "字幕列表";
    const player = await (await request(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } }, videoId })
    })).json();
    const status = player?.playabilityStatus?.status;
    if (status === "LOGIN_REQUIRED") throw new Error("YouTube 字幕需要登录验证，暂时无法在后台读取");
    if (status !== "OK") throw new Error("YouTube 当前未提供可读取的视频信息，请重试");
    const details = player.videoDetails;
    if (details?.videoId !== videoId || !details.title?.trim()) throw new Error("YouTube 字幕信息与当前视频不一致，请重新读取");
    const meta = { platform: "youtube", videoId, bvid: `YT_${videoId}`, title: details.title, author: details.author || "",
      pages: [{ cid: videoId, page: 1, part: details.title, duration: Number(details.lengthSeconds) || 0 }] };
    const track = youtubePickSubtitle(player);
    if (!track) return { meta, missing: true, body: [] };
    let url;
    try { url = new URL(track.baseUrl); } catch { throw new Error("YouTube 字幕地址无效，请重试"); }
    if (url.protocol !== "https:" || url.hostname !== "www.youtube.com" || url.pathname !== "/api/timedtext") throw new Error("YouTube 字幕地址无效，请重试");
    // The Android track defaults to srv3. Request the original transcript XML instead.
    url.searchParams.delete("fmt");
    stage = "字幕文件";
    const body = youtubeParseSubtitle(await (await request(url.href)).text());
    return { meta, track: { lan: track.languageCode || "", lanDoc: track.name?.simpleText || track.name?.runs?.map(run => run.text || "").join("") || track.languageCode || "字幕",
      source: track.kind === "asr" ? "youtube-auto-caption" : "youtube-caption" }, body };
  } catch (error) {
    if (signal.aborted) throw new Error("字幕获取超时（5 秒），请重试");
    // Native fetch/JSON errors can contain signed URLs or response fragments.
    if (error.name === "TypeError" || error.name === "SyntaxError") throw new Error(`YouTube ${stage}读取失败，请重试`);
    throw error;
  }
}
