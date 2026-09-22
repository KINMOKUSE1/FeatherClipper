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
async function courseLocalRequest(filepath, method = "GET", content) {
  const settings = await getMergedSettings();
  if (!settings.obsidianApiBaseUrl || !settings.obsidianApiKey) {
    const error = new Error("请先在设置中填写 Obsidian Local REST API 地址和 Key。");
    error.fatal = true;
    throw error;
  }
  const endpoint = `${settings.obsidianApiBaseUrl.replace(/\/+$/, "")}/vault/${filepath.split("/").map(encodeURIComponent).join("/")}`;
  let response;
  try {
    response = await fetch(endpoint, { method, headers: { Authorization: `Bearer ${settings.obsidianApiKey}`, Accept: "text/markdown", "Content-Type": "text/markdown; charset=utf-8" }, body: content, signal: AbortSignal.timeout(15000) });
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
  return method === "GET" ? response.text() : true;
}
async function courseSubtitle(meta, page) {
  const requests = buildSubtitleInfoRequests({ bvid: meta.bvid, aid: meta.aid, cid: page.cid });
  let lastError;
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
    if (!tracks.length) return null;
    for (const track of tracks) {
      try {
        const url = new URL(track.subtitleUrl);
        if (url.protocol !== "https:" || !(url.hostname === "hdslb.com" || url.hostname.endsWith(".hdslb.com") || url.hostname.endsWith(".bilibili.com"))) throw new Error("字幕地址不属于 B站字幕服务。");
        const subtitle = await courseBiliJson(url.href);
        const body = (Array.isArray(subtitle.body) ? subtitle.body : []).filter(item => Number.isFinite(item.from) && item.from >= 0 && typeof item.content === "string" && item.content.trim());
        if (!body.length) throw new Error("字幕文件为空。");
        if (page.duration > 0 && body.some(item => Number(item.to || item.from) > page.duration + 15)) throw new Error("字幕超出该 P 的时长，已停止保存，请核对字幕轨。");
        return { track, body };
      } catch (error) { if (error.fatal) throw error; lastError = error; }
    }
    throw lastError || new Error("字幕文件获取失败。");
  }
  throw lastError || new Error("无法获取字幕列表。");
}
async function handleCourseMessage(message) {
  const { action, meta, page, base } = message;
  if (action === "meta") {
    if (!/^BV[0-9A-Za-z]+$/.test(message.bvid || "")) throw new Error("请输入有效的 BV 视频链接。");
    const payload = await courseBiliJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(message.bvid)}`);
    const data = payload.data;
    const settings = await getMergedSettings();
    const folder = String(settings.noteFolder || "Clippings/Bilibili").replace(/\{\{created\}\}/g, formatLocalDate()).replace(/\{\{upload_date\}\}/g, formatLocalDate(data.pubdate * 1000)).replace(/\{\{author\}\}/g, CourseCore.safeName(data.owner?.name)).replace(/\{\{bvid\}\}/g, message.bvid);
    return { meta: { bvid: data.bvid, aid: String(data.aid), title: data.title, author: data.owner?.name || "", pages: (data.pages || []).map(p => ({ cid: String(p.cid), page: p.page, part: p.part, duration: p.duration })) }, folder };
  }
  if (!meta || !/^BV[0-9A-Za-z]+$/.test(meta.bvid || "")) throw new Error("课程信息无效，请重新读取目录。");
  const folder = CourseCore.courseFolder(meta, base);
  if (action === "index") {
    const path = `${folder}/课程导入清单.md`;
    const existing = await courseLocalRequest(path);
    if (existing !== null && !existing.startsWith(CourseCore.marker)) {
      const error = new Error("课程导入清单.md 已存在且不是本工具生成，已停止，避免覆盖。");
      error.fatal = true;
      throw error;
    }
    await courseLocalRequest(path, "PUT", CourseCore.buildIndex(meta, message.pages, base));
    return { path };
  }
  if (action === "import") {
    if (!/^\d+$/.test(page?.cid || "")) throw new Error("分 P 信息无效。");
    const path = CourseCore.rawPath(meta, page, base);
    if (await courseLocalRequest(path) !== null) return { status: "exists", path };
    const subtitle = await courseSubtitle(meta, page);
    if (!subtitle) return { status: "missing" };
    // Recheck after network work in case a note appeared while fetching subtitles.
    if (await courseLocalRequest(path) !== null) return { status: "exists", path };
    await courseLocalRequest(path, "PUT", CourseCore.buildRaw(meta, page, subtitle.track, subtitle.body));
    return { status: "saved", path };
  }
  throw new Error("未知的课程操作。");
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "course-request") return false;
  if (sender.id !== chrome.runtime.id || !String(sender.url || "").startsWith(chrome.runtime.getURL("course.html"))) {
    sendResponse({ ok: false, error: "请从扩展的课程导入页面操作。" });
    return false;
  }
  handleCourseMessage(message).then(data => sendResponse({ ok: true, ...data })).catch(error => sendResponse({ ok: false, error: error.message, fatal: Boolean(error.fatal) }));
  return true;
});
