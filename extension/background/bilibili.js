// B站目录和字幕读取；字幕只使用带 WBI 签名且归属匹配的接口响应。
async function courseBiliJson(url, allowLoggedOut = false, signal) {
  try {
    signal?.throwIfAborted();
    const response = await fetch(url, { credentials: "include", cache: "no-store", referrer: "https://www.bilibili.com/", signal: signal || AbortSignal.timeout(20000) });
    if (!response.ok) {
      const error = new Error(`B站请求失败 HTTP ${response.status}`);
      error.fatal = [401, 403, 412, 429].includes(response.status);
      throw error;
    }
    const payload = await response.json();
    if (payload.code !== undefined && payload.code !== 0 && !(allowLoggedOut && payload.code === -101)) {
      const error = new Error(`B站接口 ${payload.code}：${payload.message || "请求失败"}`);
      error.fatal = [-101, -352, -403, -412, -799].includes(payload.code);
      throw error;
    }
    return payload;
  } catch (error) {
    if (signal?.aborted) throw new Error("字幕获取超时（5 秒），请重试");
    throw error;
  }
}
function formatLocalDate(value = Date.now()) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
async function courseBiliSubtitleTracks(meta, page, signal = AbortSignal.timeout(5000)) {
  if (!/^\d+$/.test(meta.aid || "") || !meta.pages?.some(item => String(item.cid) === String(page.cid))) throw new Error("视频信息不完整，请重新读取目录");
  // 每次刷新重新获取签名信息和登录状态，不缓存字幕列表或正文。
  const nav = await courseBiliJson("https://api.bilibili.com/x/web-interface/nav", true, signal);
  const keyOf = value => String(value || "").split("?")[0].split("/").pop().replace(/\.[^.]+$/, "");
  const query = courseWbiQuery({ bvid: meta.bvid, aid: meta.aid, cid: page.cid }, keyOf(nav.data?.wbi_img?.img_url), keyOf(nav.data?.wbi_img?.sub_url));
  const payload = await courseBiliJson(`https://api.bilibili.com/x/player/wbi/v2?${query}`, false, signal);
  const data = payload.data;
  if (!data || String(data.cid) !== String(page.cid) || (data.aid !== undefined && String(data.aid) !== String(meta.aid))
    || [data.bvid, data.bv_id].some(value => value !== undefined && value !== meta.bvid)) throw new Error("字幕信息与当前视频不一致，请重新读取");
  if (data.need_login_subtitle) throw courseBiliLoginError();
  if (!Array.isArray(data.subtitle?.subtitles)) throw new Error("B站字幕列表响应无效，请重试");
  const tracks = normalizeSubtitleTracks(mapSubtitleTracks(data.subtitle.subtitles));
  if (!tracks.length && nav.data?.isLogin !== true) throw courseBiliLoginError();
  if (!tracks.length && data.subtitle.subtitles.length) throw new Error("字幕轨暂不可用，请稍后重试");
  return tracks;
}
function courseBiliLoginError() {
  const error = new Error("请先在浏览器登录 B站，再读取字幕");
  error.fatal = true;
  return error;
}
function mapSubtitleTracks(subtitles) {
  return subtitles.map(item => ({ id: String(item.id_str || item.id || item.lan || ""), lan: item.lan || "", lanDoc: item.lan_doc || "", subtitleUrl: String(item.subtitle_url || "").replace(/^\/\//, "https://") })).filter(item => item.subtitleUrl);
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
async function courseReadBiliSubtitle(tracks, page, trackId = "", subtitleLanguage = "", signal = AbortSignal.timeout(5000)) {
  const languageOf = value => String(value || "").toLowerCase().replace(/_/g, "-").replace(/^ai-/, "");
  const language = languageOf(subtitleLanguage);
  const selected = trackId ? tracks.filter(track => track.id === trackId) : language ? tracks.filter(track => {
    const code = languageOf(track.lan);
    return code === language || ((!code.includes("-") || !language.includes("-")) && code.split("-")[0] === language.split("-")[0]);
  }) : tracks;
  if (trackId && !selected.length) throw new Error("所选字幕暂不可用，请重新读取视频或选择其他语言");
  if (language && tracks.length && !selected.length) throw new Error("当前课时没有所选语言的字幕");
  let trackError;
  for (const track of selected) {
    try {
      const url = new URL(track.subtitleUrl);
      if (url.protocol !== "https:" || !(url.hostname === "hdslb.com" || url.hostname.endsWith(".hdslb.com") || url.hostname.endsWith(".bilibili.com"))) throw new Error("字幕地址不属于 B站字幕服务");
      const subtitle = await courseBiliJson(url.href, false, signal);
      if (!Array.isArray(subtitle.body) || subtitle.body.some(item => !Number.isFinite(item.from) || item.from < 0 || typeof item.content !== "string"
        || (item.to !== undefined && (!Number.isFinite(item.to) || item.to < item.from)))) throw new Error("B站字幕内容响应无效，请重试");
      const body = subtitle.body.filter(item => item.content.trim());
      if (!body.length) continue;
      if (page.duration > 0 && body.some(item => (item.to ?? item.from) > page.duration + 15)) throw new Error("字幕超出该 P 的时长，请核对字幕轨");
      return { track, body };
    } catch (error) { if (error.fatal) throw error; trackError = error; }
  }
  if (trackError) throw trackError;
  return null;
}
async function courseSubtitle(meta, page, purpose = "read", activate = false, trackId = "", subtitleLanguage = "") {
  if (meta.platform === "youtube") {
    const result = await youtubeRead(page.cid, true, false, "", purpose, activate);
    return result.missing ? null : result;
  }
  const signal = AbortSignal.timeout(5000);
  return courseReadBiliSubtitle(await courseBiliSubtitleTracks(meta, page, signal), page, trackId, subtitleLanguage, signal);
}
