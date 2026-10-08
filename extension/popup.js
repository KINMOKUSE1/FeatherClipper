const $ = id => document.getElementById(id);
let meta = null, page = null, base = "", settings = null, jobKey = "";
let busy = false, reading = false, previewing = false, hasSubtitle = false;
let videoRun = 0;
let saveScope = "current";
let subtitleMissing = false;
let subtitle = null, exporting = false;
function status(text, error = false) {
  $("status").textContent = text; $("status").classList.toggle("error", error);
}
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || "扩展连接中断，请重新打开窗口。");
  return result;
}
function setSourceOpen(open) {
  $("source-panel").hidden = !open;
  $("source-label").setAttribute("aria-expanded", String(open));
}

$("source-label").addEventListener("click", () => {
  const open = $("source-panel").hidden;
  setSourceOpen(open);

  if (open) $("url").focus();
});
function controls() {
  const locked = busy || reading || previewing || exporting;
  $("read").disabled = $("url").disabled = locked;
  const all = saveScope === "all" && meta?.pages.length > 1;
  const showAsr =
    subtitleMissing &&
    !all &&
    !busy &&
    !reading &&
    !previewing &&
    !exporting;

  $("asr-open").hidden = !showAsr;
  $("save-actions").hidden = showAsr;
  $("import").disabled = locked || !page || (!all && !hasSubtitle) || !settings?.hasApiKey;
  $("save-menu-toggle").hidden = all;
  $("save-menu-toggle").disabled = $("copy-subtitle").disabled = $("download-subtitle").disabled = locked || !page || !hasSubtitle || all;
  if ($("save-menu-toggle").disabled) closeSaveMenu();
  $("import-label").textContent = busy ? "正在保存…" : all ? `前往保存整门课程 · ${meta.pages.length} ${meta.platform === "youtube" ? "个视频" : "P"}` : meta?.pages.length > 1 ? "保存当前字幕" : "保存字幕";
  $("scope-current").disabled = $("scope-all").disabled = locked;
  $("scope-current").setAttribute("aria-pressed", String(!all));
  $("scope-all").setAttribute("aria-pressed", String(all));
  $("settings").disabled = locked || !settings;
  $("workspace").disabled = busy || reading || exporting;
  $("asr-open").disabled = locked || !settings?.hasApiKey;
}
function closeSaveMenu(restoreFocus = false) {
  $("save-menu").hidden = true;
  $("save-menu-toggle").setAttribute("aria-expanded", "false");
  if (restoreFocus) $("save-menu-toggle").focus();
}
function openSaveMenu(last = false) {
  if ($("save-menu-toggle").disabled) return;
  $("save-menu").hidden = false;
  $("save-menu-toggle").setAttribute("aria-expanded", "true");
  $(last ? "download-subtitle" : "copy-subtitle").focus();
}
$("save-menu-toggle").addEventListener("click", () => {
  if ($("save-menu").hidden) openSaveMenu(); else closeSaveMenu();
});
$("save-menu-toggle").addEventListener("keydown", event => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault(); openSaveMenu(event.key === "ArrowUp");
});
$("save-actions").addEventListener("keydown", event => {
  if (event.key === "Escape") { event.preventDefault(); closeSaveMenu(true); }
  else if (!$("save-menu").hidden && ["ArrowDown", "ArrowUp"].includes(event.key) && event.target !== $("save-menu-toggle")) {
    event.preventDefault();
    $(event.target === $("copy-subtitle") ? "download-subtitle" : "copy-subtitle").focus();
  }
});
$("save-actions").addEventListener("focusout", event => {
  if (!event.currentTarget.contains(event.relatedTarget)) closeSaveMenu();
});
document.addEventListener("click", event => {
  if (!$("save-actions").contains(event.target)) closeSaveMenu();
});
async function exportSubtitle(download = false) {
  if ($(download ? "download-subtitle" : "copy-subtitle").disabled) return;
  closeSaveMenu(true);
  exporting = true; controls();
  try {
    const markdown = CourseCore.buildRaw(meta, { ...page, chapter: CourseCore.chapterOf(page.part) }, subtitle.track || {}, subtitle.body);
    if (download) {
      await chrome.downloads.download({ url: `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`, filename: CourseCore.rawPath(meta, page, base).split("/").pop(), saveAs: true });
      status("已提交文件保存请求");
    } else {
      await navigator.clipboard.writeText(markdown);
      status("完整字幕已复制到剪贴板");
    }
  } catch (error) { status(`${download ? "保存" : "复制"}失败：${error.message}`, true); }
  finally { exporting = false; controls(); }
}
$("copy-subtitle").addEventListener("click", () => exportSubtitle());
$("download-subtitle").addEventListener("click", () => exportSubtitle(true));
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
  previewing = true;
  hasSubtitle = false;
  subtitle = null;
  subtitleMissing = false;
  controls();
  $("asr-open").hidden = true;
  $("subtitles").textContent = "正在读取字幕…";
  $("subtitle-track").textContent = "";
  $("preview-label").textContent = "正在读取字幕…";
  try {
    const result = await send({ type: "course-request", action: "preview", meta, page });
    $("subtitle-track").textContent = result.track?.lanDoc || result.track?.lan || "";
    hasSubtitle = Boolean(result.body?.length);
    if (hasSubtitle) subtitle = result;
    $("preview-label").textContent = hasSubtitle ? "字幕预览" : "暂无可用字幕";
    subtitleMissing = result.missing === true && !hasSubtitle;
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
  if (busy || reading || previewing || exporting) return;
  const source = $("url").value.trim();
  const parsed = CourseCore.parseSource(source);
  if (!parsed) { status("请粘贴 B站或 YouTube 视频链接。", true); return; }
  const number = parsed.page;
  const run = ++videoRun;
  reading = true; page = null; meta = null; jobKey = ""; hasSubtitle = false; saveScope = "current"; controls();
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
    $("workspace").hidden = false;
    $("workspace-label").textContent = series ? "选择分 P" : "进入工作台";
    $("video").hidden = false;
    setSourceOpen(false);
    status(settings.hasApiKey ? "" : "先配置 Obsidian 连接，即可导入。");
    const job = await send({ type: "quick-status", bvid: meta.bvid, cid: page.cid, base });
    if (run !== videoRun) return;
    jobKey = job.key; showJob(job.state);
    reading = false;
    await preview();
    if (run !== videoRun) return;
  } catch (error) {
    if (run === videoRun) {
      page = null; meta = null; $("video").hidden = true; $("empty").hidden = false; $("workspace").hidden = true;
      setSourceOpen(true); status(error.message, true);
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
  try { showJob(await send({ type: "quick-import", bvid: meta.bvid, cid: page.cid, meta, base })); }
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
