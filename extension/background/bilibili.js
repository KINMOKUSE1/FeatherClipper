// B站目录和字幕读取；字幕接口选择源自 MIT 项目 Bilibili-Obsidian-Clipper。
async function courseBiliJson(url) {
  const response = await fetch(url, { credentials: "include", cache: "no-store", referrer: "https://www.bilibili.com/", signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const error = new Error(`B站请求失败 HTTP ${response.status}`);
    error.fatal = [401, 403, 412, 429].includes(response.status);
    throw error;
  }
  const payload = await response.json();
  if (payload.code !== undefined && payload.code !== 0) {
    const error = new Error(`B站接口 ${payload.code}：${payload.message || "请求失败"}`);
    error.fatal = [-101, -352, -412, -799].includes(payload.code);
    throw error;
  }
  return payload;
}
function formatLocalDate(value = Date.now()) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function buildSubtitleInfoRequests({ bvid, cid, aid }) {
  const query = new URLSearchParams({ bvid, cid, ...(aid ? { aid } : {}) }).toString();
  return [...(aid ? [{ url: `https://api.bilibili.com/x/player/wbi/v2?${query}` }] : []), { url: `https://api.bilibili.com/x/player/v2?${query}` }];
}
function mapSubtitleTracks(subtitles) {
  return subtitles.map(item => ({ id: String(item.id || item.lan || ""), lan: item.lan || "", lanDoc: item.lan_doc || "", subtitleUrl: String(item.subtitle_url || "").replace(/^\/\//, "https://") })).filter(item => item.subtitleUrl);
}
function normalizeSubtitleTracks(tracks) {
  const priority = track => {
    const lang = track.lan.toLowerCase();
    if (["zh-cn", "zh-hans"].includes(lang)) return 0;
    if (lang.includes("zh") || track.lanDoc.includes("中文")) return 1;
    if (lang.includes("en")) return 2;
    return 3;
  };
  return [...tracks].sort((a, b) => priority(a) - priority(b));
}
function courseTrackLanguage(track) {
  const code = track.lan.toLowerCase();
  if (code.includes("zh") || track.lanDoc.includes("中文")) return "zh";
  if (/^(?:ai-)?en(?:-|$)/.test(code) || /英文|英语|English/i.test(track.lanDoc)) return "en";
  return "other";
}
async function courseSubtitle(meta, page, purpose = "read", activate = false, trackId = "") {
  if (meta.platform === "youtube") {
    const result = await youtubeRead(page.cid, true, false, "", purpose, activate);
    return result.missing ? null : result;
  }
  const requests = buildSubtitleInfoRequests({ bvid: meta.bvid, aid: meta.aid, cid: page.cid });
  let lastError, trackError, fallback = null;
  const available = new Map();
  for (const request of requests) {
    let payload;
    try { payload = await courseBiliJson(request.url); }
    catch (error) { if (error.fatal) throw error; lastError = error; continue; }
    if (payload.data?.need_login_subtitle) {
      const error = new Error("字幕需要登录 B站，请在 Edge 登录后重试。");
      error.fatal = true;
      throw error;
    }
    const tracks = normalizeSubtitleTracks(mapSubtitleTracks(payload.data?.subtitle?.subtitles || []));
    if (purpose === "tracks") {
      for (const track of tracks) available.set(track.id, track);
      continue;
    }
    if (!tracks.length) continue;
    for (const track of trackId ? tracks.filter(item => item.id === trackId) : tracks) {
      try {
        const url = new URL(track.subtitleUrl);
        if (url.protocol !== "https:" || !(url.hostname === "hdslb.com" || url.hostname.endsWith(".hdslb.com") || url.hostname.endsWith(".bilibili.com"))) throw new Error("字幕地址不属于 B站字幕服务。");
        const subtitle = await courseBiliJson(url.href);
        const body = (Array.isArray(subtitle.body) ? subtitle.body : []).filter(item => Number.isFinite(item.from) && item.from >= 0 && typeof item.content === "string" && item.content.trim());
        if (!body.length) continue;
        if (page.duration > 0 && body.some(item => Number(item.to || item.from) > page.duration + 15)) throw new Error("字幕超出该 P 的时长，已停止保存，请核对字幕轨。");
        if (trackId || courseTrackLanguage(track) === "zh") return { track, body };
        if (!fallback || (courseTrackLanguage(track) === "en" && courseTrackLanguage(fallback.track) !== "en")) fallback = { track, body };
      } catch (error) { if (error.fatal) throw error; trackError = error; }
    }
  }
  if (purpose === "tracks" && available.size) return normalizeSubtitleTracks([...available.values()]).map(({ id, lan, lanDoc }) => ({ id, lan, lanDoc }));
  if (fallback) return fallback;
  if (trackError || lastError) throw trackError || lastError;
  if (purpose === "tracks") return [];
  if (trackId) throw new Error("所选字幕暂不可用，请重新读取视频或选择其他语言");
  return null;
}
