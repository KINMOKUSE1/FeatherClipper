/* Course operations use existing settings and subtitle parsers; keys stay in the worker. */
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
async function courseLocalRequest(filepath, method = "GET", content, expectJson = false) {
  let settings;
  try { settings = normalizeConnection(await getMergedSettings()); }
  catch (error) { error.fatal = true; throw error; }
  if (!settings.obsidianApiBaseUrl || !settings.obsidianApiKey) {
    const error = new Error("请先在设置中填写 Obsidian Local REST API 地址和 Key。");
    error.fatal = true;
    throw error;
  }
  const endpoint = `${settings.obsidianApiBaseUrl.replace(/\/+$/, "")}/vault/${filepath.split("/").map(encodeURIComponent).join("/")}`;
  let response;
  try {
    response = await fetch(endpoint, { method, headers: { Authorization: `Bearer ${settings.obsidianApiKey}`, Accept: expectJson ? "application/json" : "text/markdown", "Content-Type": "text/markdown; charset=utf-8" }, body: content, signal: AbortSignal.timeout(15000) });
  } catch {
    const error = new Error("无法连接 Obsidian，请确认它已打开且 Local REST API 正在运行。");
    error.fatal = true;
    throw error;
  }
  if (method === "GET" && response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`Obsidian 请求失败 HTTP ${response.status}`);
    error.fatal = true;
    throw error;
  }
  return method === "GET" ? expectJson ? response.json() : response.text() : true;
}
async function courseRawFiles(meta, base) {
  const directory = `${CourseCore.courseFolder(meta, base)}/原始字幕/`;
  const listing = await courseLocalRequest(directory, "GET", undefined, true);
  if (listing === null) return [];
  if (!Array.isArray(listing.files) || !listing.files.every(name => typeof name === "string")) {
    const error = new Error("无法读取原始字幕目录，已停止以避免重复导入。");
    error.fatal = true;
    throw error;
  }
  return listing.files;
}
function existingRawPath(meta, page, base, files) {
  const currentName = CourseCore.rawPath(meta, page, base).split("/").pop();
  const suffix = meta.platform === "youtube" ? ` [YT-${page.cid}].md` : ` [CID-${page.cid}].md`;
  const name = files.includes(currentName) ? currentName
    : files.find(file => (meta.platform !== "youtube" && file === `CID-${page.cid}.md`) || file.endsWith(suffix));
  return name ? `${CourseCore.courseFolder(meta, base)}/原始字幕/${name}` : null;
}
async function courseRawSources(meta, pages, base) {
  const files = await courseRawFiles(meta, base);
  return Object.fromEntries(pages.map(page => [page.cid, existingRawPath(meta, page, base, files)]).filter(([, path]) => path));
}
function courseTrackLanguage(track) {
  const code = track.lan.toLowerCase();
  if (code.includes("zh") || track.lanDoc.includes("中文")) return "zh";
  if (/^(?:ai-)?en(?:-|$)/.test(code) || /英文|英语|English/i.test(track.lanDoc)) return "en";
  return "other";
}
async function courseSubtitle(meta, page, purpose = "read", activate = false) {
  if (meta.platform === "youtube") {
    const result = await youtubeRead(page.cid, true, false, "", purpose, activate);
    return result.missing ? null : result;
  }
  const requests = buildSubtitleInfoRequests({ bvid: meta.bvid, aid: meta.aid, cid: page.cid });
  let lastError, trackError, fallback = null;
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
    if (!tracks.length) continue;
    for (const track of tracks) {
      try {
        const url = new URL(track.subtitleUrl);
        if (url.protocol !== "https:" || !(url.hostname === "hdslb.com" || url.hostname.endsWith(".hdslb.com") || url.hostname.endsWith(".bilibili.com"))) throw new Error("字幕地址不属于 B站字幕服务。");
        const subtitle = await courseBiliJson(url.href);
        const body = (Array.isArray(subtitle.body) ? subtitle.body : []).filter(item => Number.isFinite(item.from) && item.from >= 0 && typeof item.content === "string" && item.content.trim());
        if (!body.length) continue;
        if (page.duration > 0 && body.some(item => Number(item.to || item.from) > page.duration + 15)) throw new Error("字幕超出该 P 的时长，已停止保存，请核对字幕轨。");
        if (courseTrackLanguage(track) === "zh") return { track, body };
        if (!fallback || (courseTrackLanguage(track) === "en" && courseTrackLanguage(fallback.track) !== "en")) fallback = { track, body };
      } catch (error) { if (error.fatal) throw error; trackError = error; }
    }
  }
  if (fallback) return fallback;
  if (trackError || lastError) throw trackError || lastError;
  return null;
}
async function handleCourseMessage(message) {
  const { action, meta, page, base } = message;
  if (action === "meta") {
    const parsed = CourseCore.parseSource(message.bvid);
    const youtubeId = message.youtubeId || (parsed?.platform === "youtube" ? parsed.id : "");
    const playlistId = message.playlistId || (parsed?.platform === "youtube" ? parsed.playlistId : "");
    if (youtubeId) {
      const result = await youtubeRead(youtubeId, false, false, playlistId);
      const settings = await getMergedSettings();
      const folder = String(settings.noteFolder || "Clippings/Bilibili").replace(/\{\{created\}\}/g, formatLocalDate()).replace(/\{\{upload_date\}\}/g, formatLocalDate()).replace(/\{\{author\}\}/g, CourseCore.safeName(result.meta.author)).replace(/\{\{bvid\}\}/g, result.meta.videoId);
      return { meta: result.meta, folder: folder === "Clippings/Bilibili" ? "Clippings/YouTube" : folder };
    }
    const bvid = parsed?.platform === "bilibili" ? parsed.id : message.bvid;
    if (!/^BV[0-9A-Za-z]+$/.test(bvid || "")) throw new Error("请输入有效的 B站或 YouTube 视频链接。");
    const payload = await courseBiliJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
    const data = payload.data;
    const settings = await getMergedSettings();
    const folder = String(settings.noteFolder || "Clippings/Bilibili").replace(/\{\{created\}\}/g, formatLocalDate()).replace(/\{\{upload_date\}\}/g, formatLocalDate(data.pubdate * 1000)).replace(/\{\{author\}\}/g, CourseCore.safeName(data.owner?.name)).replace(/\{\{bvid\}\}/g, bvid);
    return { meta: { bvid: data.bvid, aid: String(data.aid), title: data.title, author: data.owner?.name || "", pages: (data.pages || []).map(p => ({ cid: String(p.cid), page: p.page, part: p.part, duration: p.duration })) }, folder };
  }
  if (!meta || !(meta.platform === "youtube" ? /^[\w-]{11}$/.test(meta.videoId || "") && (meta.playlistId ? /^[\w-]{8,60}$/.test(meta.playlistId) && meta.bvid === `YTPL_${meta.playlistId}` : meta.bvid === `YT_${meta.videoId}`) : /^BV[0-9A-Za-z]+$/.test(meta.bvid || ""))) throw new Error("课程信息无效，请重新读取目录。");
  if (action === "raw-paths") return { sources: await courseRawSources(meta, message.pages || meta.pages, base) };
  if (["asr-start", "asr-poll", "asr-finish", "asr-cancel"].includes(action)) {
    if (!(meta.platform === "youtube" ? /^[\w-]{11}$/.test(page?.cid || "") : /^\d+$/.test(page?.cid || "")) || !meta.pages?.some(item => item.cid === page.cid)) throw new Error("视频信息无效。");
    if (action === "asr-poll") {
      const job = await asrPoll(message.jobId);
      return { status: job.status, detail: job.detail, progress: job.progress };
    }
    if (action === "asr-cancel") return asrCancel(message.jobId);
    const path = CourseCore.rawPath(meta, page, base);
    const existingPath = existingRawPath(meta, page, base, await courseRawFiles(meta, base));
    if (existingPath) return { status: "exists", path: existingPath };
    if (action === "asr-start") {
      const subtitle = await courseSubtitle(meta, page);
      if (subtitle) return { status: "subtitle-available" };
      return asrStart(meta, page);
    }
    const job = await asrPoll(message.jobId);
    if (job.bvid !== meta.bvid || String(job.cid) !== page.cid) throw new Error("转写结果与所选分 P 不一致，未保存到 Obsidian。");
    if (job.status !== "done") return { status: job.status, detail: job.detail, progress: job.progress };
    if (!Array.isArray(job.body) || !job.body.length || job.body.some(item => !Number.isFinite(item.from) || typeof item.content !== "string")) {
      throw new Error("本地转写结果无效，未保存到 Obsidian。");
    }
    const appearedPath = existingRawPath(meta, page, base, await courseRawFiles(meta, base));
    if (appearedPath) return { status: "exists", path: appearedPath };
    const track = { lan: job.language || "auto", lanDoc: `本地转写（faster-whisper-small · ${job.language || "自动识别"}）`, source: "local-asr" };
    await courseLocalRequest(path, "PUT", CourseCore.buildRaw(meta, page, track, job.body));
    return { status: "saved", path };
  }
  if (action === "preview") {
    if (!(meta.platform === "youtube" ? /^[\w-]{11}$/.test(page?.cid || "") && meta.pages?.some(item => item.cid === page.cid) : /^\d+$/.test(page?.cid || ""))) throw new Error("视频信息无效。");
    const subtitle = await courseSubtitle(meta, page, action);
    return subtitle ? { track: { lan: subtitle.track.lan, lanDoc: subtitle.track.lanDoc }, body: subtitle.body } : { body: [], missing: true };
  }
  const folder = CourseCore.courseFolder(meta, base);
  if (action === "index") {
    const path = `${folder}/课程导入清单.md`;
    const existing = await courseLocalRequest(path);
    if (existing !== null && !existing.startsWith(CourseCore.marker)) {
      const error = new Error("课程导入清单.md 已存在且不是本工具生成，已停止，避免覆盖。");
      error.fatal = true;
      throw error;
    }
    const sources = await courseRawSources(meta, message.pages, base);
    for (const page of message.pages) page.sourcePath = sources[page.cid] || "";
    await courseLocalRequest(path, "PUT", CourseCore.buildIndex(meta, message.pages, base));
    return { path, sources };
  }
  if (action === "import") {
    if (!(meta.platform === "youtube" ? /^[\w-]{11}$/.test(page?.cid || "") && meta.pages?.some(item => item.cid === page.cid) : /^\d+$/.test(page?.cid || ""))) throw new Error("视频信息无效。");
    const path = CourseCore.rawPath(meta, page, base);
    const existingPath = existingRawPath(meta, page, base, await courseRawFiles(meta, base));
    if (existingPath) return { status: "exists", path: existingPath };
    const subtitle = await courseSubtitle(meta, page, "import", message.activateVideo === true);
    if (!subtitle) return { status: "missing" };
    // Recheck after network work in case a note appeared while fetching subtitles.
    const appearedPath = existingRawPath(meta, page, base, await courseRawFiles(meta, base));
    if (appearedPath) return { status: "exists", path: appearedPath };
    await courseLocalRequest(path, "PUT", CourseCore.buildRaw(meta, page, subtitle.track, subtitle.body));
    return { status: "saved", path };
  }
  throw new Error("未知的课程操作。");
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "course-request") return false;
  if (sender.id !== chrome.runtime.id || !(String(sender.url || "").split(/[?#]/)[0] === chrome.runtime.getURL("course.html") || (["meta", "preview"].includes(message.action) && String(sender.url || "").split(/[?#]/)[0] === chrome.runtime.getURL("popup.html")))) {
    sendResponse({ ok: false, error: "请从扩展的课程导入页面操作。" });
    return false;
  }
  handleCourseMessage(message).then(data => sendResponse({ ok: true, ...data })).catch(error => sendResponse({ ok: false, error: error.message, fatal: Boolean(error.fatal) }));
  return true;
});
