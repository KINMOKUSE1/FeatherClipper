const $ = id => document.getElementById(id);
let meta = null, page = null, base = "", settings = null, jobKey = "";
let busy = false, reading = false, previewing = false, hasSubtitle = false;
let subtitleLanguage;
let videoRun = 0;
function status(text, error = false) {
  $("status").textContent = text; $("status").classList.toggle("error", error);
}
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || "扩展连接中断，请重新打开窗口。");
  return result;
}
function controls() {
  $("read").disabled = $("url").disabled = busy || reading || previewing;
  $("import").disabled = busy || reading || previewing || !page || !hasSubtitle || !settings?.hasApiKey;
  $("import").textContent = busy ? "正在导入…" : page ? meta?.platform === "youtube" ? "导入视频" : `导入 P${page.page}` : "导入当前视频";
  $("settings").disabled = busy || reading || previewing || !settings;
  $("workspace").disabled = busy || reading;
  $("asr-open").disabled = busy || reading || previewing || !settings?.hasApiKey;
  $("language-trigger").disabled = busy || reading || previewing;
}
function showJob(state) {
  busy = state?.status === "running";
  const text = { running: "正在导入，收起窗口后会继续。", saved: "已导入 Obsidian，课程清单已更新。", exists: "字幕已存在，已跳过；课程清单已更新。", missing: "这个视频没有可用字幕。" }[state?.status];
  if (text || state?.error) status(text || state.error, state?.status === "failed");
  controls();
}
async function refreshSettings() {
  settings = (await send({ type: "settings-get" })).settings;
  $("settings").textContent = settings.hasApiKey ? "连接设置" : "配置 Obsidian";
  controls();
}
async function preview() {
  previewing = true; hasSubtitle = false; controls();
  $("asr-open").hidden = true;
  $("subtitles").textContent = "正在读取字幕…";
  $("subtitle-track").textContent = "";
  try {
    const result = await send({ type: "course-request", action: "preview", meta, page, language: subtitleLanguage.current() });
    $("subtitle-track").textContent = result.track?.lanDoc || result.track?.lan || "";
    hasSubtitle = Boolean(result.body?.length);
    $("asr-open").hidden = hasSubtitle;
    $("subtitles").textContent = hasSubtitle ? "" : "没有可用字幕，可在课程工作台尝试本地转写。";
    for (const item of CourseCore.groupSubtitles(result.body, meta.platform).slice(0, 12)) {
      const line = document.createElement("p"), time = document.createElement("a");
      time.textContent = new Date(Math.floor(item.from) * 1000).toISOString().slice(11, 19);
      time.href = CourseCore.timestampUrl(meta, page, item.from); time.target = "_blank"; time.rel = "noopener";
      line.append(time, document.createTextNode(item.content)); $("subtitles").append(line);
    }
  } catch (error) { $("subtitles").textContent = `字幕读取失败：${error.message}`; }
  finally { previewing = false; controls(); }
}
async function loadVideo() {
  if (busy || reading || previewing) return;
  const source = $("url").value.trim();
  const parsed = CourseCore.parseSource(source);
  if (!parsed) { status("请粘贴 B站或 YouTube 视频链接。", true); return; }
  const number = parsed.page;
  const run = ++videoRun;
  reading = true; page = null; jobKey = ""; hasSubtitle = false; controls();
  subtitleLanguage.tracks([], "auto", "正在读取语言选项…");
  $("video").hidden = true; status("正在识别视频…");
  try {
    const data = await send({ type: "course-request", action: "meta", ...(parsed.platform === "youtube" ? { youtubeId: parsed.id, playlistId: parsed.playlistId } : { bvid: parsed.id }) });
    meta = data.meta; page = meta.pages.find(item => parsed.platform === "youtube" ? item.cid === parsed.id : item.page === number);
    if (!page) throw new Error(`课程中没有 P${number}，请核对链接。`);
    const baseKey = `boc-course-base:${meta.bvid}`;
    base = (await chrome.storage.local.get(baseKey))[baseKey] || data.folder;
    $("course-name").textContent = meta.platform === "youtube" ? `${meta.title} · ${meta.pages.length} 个视频` : `${meta.title} · 共 ${meta.pages.length} P`;
    $("part-name").textContent = meta.platform === "youtube" ? page.part : `P${page.page} · ${page.part}`;
    $("workspace").textContent = meta.playlistId ? "批量导入播放列表" : meta.platform === "youtube" ? "打开导入工作台" : "批量导入整门课";
    $("workspace-hint").textContent = meta.platform === "youtube" ? "查看完整字幕、保存学习文档，可进入导入工作台。" : "按章整理和多选导入，请进入课程工作台。";
    $("folder").textContent = base; $("folder").title = CourseCore.courseFolder(meta, base);
    $("video").hidden = false;
    status(settings.hasApiKey ? "" : "先配置 Obsidian 连接，即可导入。");
    const job = await send({ type: "quick-status", bvid: meta.bvid, cid: page.cid, base });
    jobKey = job.key; showJob(job.state);
    reading = false;
    await preview();
    try {
      const result = await send({ type: "course-request", action: "tracks", meta, page });
      if (run === videoRun) subtitleLanguage.tracks(result.tracks);
    } catch { if (run === videoRun) subtitleLanguage.tracks([], "auto", "暂未读取到语言选项，可点击“读取”重试；仍可使用自动。"); }
  } catch (error) { if (run === videoRun) { page = null; status(error.message, true); } }
  finally { if (run === videoRun) { reading = false; controls(); } }
}
$("source-form").addEventListener("submit", event => { event.preventDefault(); loadVideo(); });
$("asr-open").addEventListener("click", async () => {
  if ($( "asr-open").disabled || !meta || !page) return;
  const target = new URL(chrome.runtime.getURL("course.html"));
  target.searchParams.set(meta.platform === "youtube" ? "youtubeId" : "bvid", meta.platform === "youtube" ? meta.videoId : meta.bvid);
  if (meta.playlistId) target.searchParams.set("playlistId", meta.playlistId);
  target.searchParams.set("p", page.page);
  target.searchParams.set("asr", "1");
  await chrome.tabs.create({ url: target.href }); window.close();
});
$("import").addEventListener("click", async () => {
  if ($("import").disabled) return;
  showJob({ status: "running" });
  try { showJob(await send({ type: "quick-import", bvid: meta.bvid, cid: page.cid, meta, base, language: subtitleLanguage.current() })); }
  catch (error) { showJob({ status: "failed", error: error.message }); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && jobKey && changes[jobKey]) showJob(changes[jobKey].newValue);
});
$("workspace").addEventListener("click", async () => {
  const target = new URL(chrome.runtime.getURL("course.html"));
  if (meta && page) { target.searchParams.set(meta.platform === "youtube" ? "youtubeId" : "bvid", meta.platform === "youtube" ? meta.videoId : meta.bvid); if (meta.playlistId) target.searchParams.set("playlistId", meta.playlistId); target.searchParams.set("p", page.page); }
  await chrome.tabs.create({ url: target.href }); window.close();
});
$("settings").addEventListener("click", () => {
  $("api-url").value = settings.obsidianApiBaseUrl; $("api-key").value = "";
  $("api-key").placeholder = settings.hasApiKey ? "已保存，留空保留原 Key" : "粘贴 Local REST API Key";
  $("note-folder").value = settings.noteFolder; $("settings-status").textContent = "";
  $("clipper").hidden = true; $("connection").hidden = false;
});
$("back").addEventListener("click", () => { $("connection").hidden = true; $("clipper").hidden = false; });
async function saveSettings(testOnly) {
  const ids = ["test", "save", "api-url", "api-key", "note-folder", "back"];
  ids.forEach(id => $(id).disabled = true);
  $("settings-status").textContent = testOnly ? "正在测试连接…" : "正在保存…";
  try {
    await send({ type: testOnly ? "settings-test" : "settings-save", settings: { obsidianApiBaseUrl: $("api-url").value, obsidianApiKey: $("api-key").value, noteFolder: $("note-folder").value } });
    if (testOnly) $("settings-status").textContent = "连接成功，请保存设置。";
    else {
      $("api-key").value = ""; await refreshSettings();
      $("connection").hidden = true; $("clipper").hidden = false;
      if (page) await loadVideo(); else status("连接设置已保存，读取视频后即可导入。");
    }
  } catch (error) { $("settings-status").textContent = error.message; }
  finally { ids.forEach(id => $(id).disabled = false); }
}
$("test").addEventListener("click", () => saveSettings(true));
$("save").addEventListener("click", () => saveSettings(false));
async function init() {
  subtitleLanguage = await SubtitleLanguage.create({ onChange: () => { if (page) preview(); } });
  await refreshSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab?.url);
    if (CourseCore.parseSource(url.href)) {
      $("url").value = url.href; await loadVideo();
    }
  } catch { /* Non-video tabs use the manual input. */ }
}
init().catch(error => status(error.message, true));
