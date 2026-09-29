const $ = id => document.getElementById(id);
let meta = null, page = null, base = "", settings = null, jobKey = "";
let busy = false, reading = false, previewing = false, hasSubtitle = false;
let subtitleLanguage;
let videoRun = 0;
let saveScope = "current";
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
  const all = saveScope === "all" && meta?.pages.length > 1;
  $("import").disabled = busy || reading || previewing || !page || (!all && !hasSubtitle) || !settings?.hasApiKey;
  $("import-label").textContent = busy ? "正在保存…" : all ? `前往保存整门课程 · ${meta.pages.length} ${meta.platform === "youtube" ? "个视频" : "P"}` : meta?.pages.length > 1 ? "保存当前字幕" : "保存字幕";
  $("scope-current").disabled = $("scope-all").disabled = busy || reading || previewing;
  $("scope-current").setAttribute("aria-pressed", String(!all));
  $("scope-all").setAttribute("aria-pressed", String(all));
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
  $("settings-label").hidden = settings.hasApiKey;
  controls();
}
async function preview() {
  previewing = true; hasSubtitle = false; controls();
  $("asr-open").hidden = true;
  $("subtitles").textContent = "正在读取字幕…";
  $("subtitle-track").textContent = "";
  $("preview-label").textContent = "正在读取字幕…";
  try {
    const result = await send({ type: "course-request", action: "preview", meta, page, language: subtitleLanguage.current() });
    $("subtitle-track").textContent = result.track?.lanDoc || result.track?.lan || "";
    hasSubtitle = Boolean(result.body?.length);
    $("preview-label").textContent = hasSubtitle ? "字幕预览" : "暂无可用字幕";
    $("asr-open").hidden = hasSubtitle;
    $("subtitles").textContent = hasSubtitle ? "" : "没有可用字幕，可在课程工作台尝试本地转写。";
    for (const item of CourseCore.groupSubtitles(result.body, meta.platform).slice(0, 12)) {
      const line = document.createElement("p"), time = document.createElement("a");
      time.textContent = new Date(Math.floor(item.from) * 1000).toISOString().slice(11, 19);
      time.href = CourseCore.timestampUrl(meta, page, item.from); time.target = "_blank"; time.rel = "noopener";
      line.append(time, document.createTextNode(item.content)); $("subtitles").append(line);
    }
  } catch (error) {
    $("subtitles").textContent = `字幕读取失败：${error.message}`;
    $("preview-label").textContent = "字幕读取失败";
    $("preview-panel").open = true;
  }
  finally { previewing = false; controls(); }
}
async function loadVideo() {
  if (busy || reading || previewing) return;
  const source = $("url").value.trim();
  const parsed = CourseCore.parseSource(source);
  if (!parsed) { status("请粘贴 B站或 YouTube 视频链接。", true); return; }
  const number = parsed.page;
  const run = ++videoRun;
  reading = true; page = null; meta = null; jobKey = ""; hasSubtitle = false; saveScope = "current"; controls();
  subtitleLanguage.tracks([], "auto", "正在读取语言选项…");
  $("video").hidden = true; $("empty").hidden = true; $("workspace").hidden = true;
  $("preview-panel").open = false; status("正在识别视频…");
  try {
    const data = await send({ type: "course-request", action: "meta", ...(parsed.platform === "youtube" ? { youtubeId: parsed.id, playlistId: parsed.playlistId } : { bvid: parsed.id }) });
    if (run !== videoRun) return;
    meta = data.meta; page = meta.pages.find(item => parsed.platform === "youtube" ? item.cid === parsed.id : item.page === number);
    if (!page) throw new Error(`课程中没有 P${number}，请核对链接。`);
    const baseKey = `boc-course-base:${meta.bvid}`;
    const storedBase = await chrome.storage.local.get(baseKey);
    if (run !== videoRun) return;
    base = storedBase[baseKey] || data.folder;
    const series = meta.pages.length > 1;
    const unit = meta.platform === "youtube" ? "个视频" : "P";
    $("video-meta").textContent = `${meta.platform === "youtube" ? "YouTube" : "Bilibili"} · ${series ? `系列课程 · ${meta.pages.length} ${unit}` : "单个视频"}`;
    $("course-name").textContent = meta.title;
    $("part-name").textContent = page.part;
    $("part-number").textContent = `${meta.platform === "youtube" ? "" : "P"}${page.page} / ${meta.pages.length}`;
    $("current-part").hidden = !series;
    $("save-scope").hidden = !series;
    $("scope-all").textContent = `整门课程 · ${meta.pages.length} ${unit}`;
    $("workspace").hidden = !series;
    $("folder").textContent = base; $("folder").title = CourseCore.courseFolder(meta, base);
    $("video").hidden = false;
    $("source-panel").open = false; $("source-label").textContent = "更换链接";
    status(settings.hasApiKey ? "" : "先配置 Obsidian 连接，即可导入。");
    const job = await send({ type: "quick-status", bvid: meta.bvid, cid: page.cid, base });
    if (run !== videoRun) return;
    jobKey = job.key; showJob(job.state);
    reading = false;
    await preview();
    if (run !== videoRun) return;
    try {
      const result = await send({ type: "course-request", action: "tracks", meta, page });
      if (run === videoRun) subtitleLanguage.tracks(result.tracks);
    } catch { if (run === videoRun) subtitleLanguage.tracks([], "auto", "暂未读取到语言选项，可点击“读取”重试；仍可使用自动。"); }
  } catch (error) {
    if (run === videoRun) {
      page = null; meta = null; $("video").hidden = true; $("empty").hidden = false; $("workspace").hidden = true;
      $("source-panel").open = true; status(error.message, true);
    }
  }
  finally { if (run === videoRun) { reading = false; controls(); } }
}
$("source-form").addEventListener("submit", event => { event.preventDefault(); loadVideo(); });
for (const scope of ["current", "all"]) {
  $(`scope-${scope}`).addEventListener("click", () => { saveScope = scope; controls(); });
}
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
  if (saveScope === "all" && meta.pages.length > 1) {
    try { await openWorkspace(true); } catch (error) { status(error.message, true); }
    return;
  }
  showJob({ status: "running" });
  try { showJob(await send({ type: "quick-import", bvid: meta.bvid, cid: page.cid, meta, base, language: subtitleLanguage.current() })); }
  catch (error) { showJob({ status: "failed", error: error.message }); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && jobKey && changes[jobKey]) showJob(changes[jobKey].newValue);
});
async function openWorkspace(selectAll = false) {
  const target = new URL(chrome.runtime.getURL("course.html"));
  if (meta && page) { target.searchParams.set(meta.platform === "youtube" ? "youtubeId" : "bvid", meta.platform === "youtube" ? meta.videoId : meta.bvid); if (meta.playlistId) target.searchParams.set("playlistId", meta.playlistId); target.searchParams.set("p", page.page); }
  if (selectAll) target.searchParams.set("scope", "all");
  await chrome.tabs.create({ url: target.href }); window.close();
}
$("workspace").addEventListener("click", () => openWorkspace().catch(error => status(error.message, true)));
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
