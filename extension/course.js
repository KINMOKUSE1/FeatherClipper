const $ = id => document.getElementById(id);
const statusLabels = { pending: "待导入", running: "处理中", saved: "已导入", exists: "已存在", missing: "无字幕", failed: "失败" };
let meta = null, pages = [], running = false, loading = false, stopping = false;
let previewId = "", previewRun = 0, previewLoading = false, savedSettings = null;
let chapterFilter = "all";
let asrConnected = false, activeAsrJob = "", activeAsrPage = null, pendingAsrPages = [];
let currentPage = Number(new URLSearchParams(location.search).get("p")) || 1;

function partTitle(page) {
  const match = page.part.match(/^(\d+(?:\.\d+)*)\.\s+(.+)$/);
  return match && match[1] === String(page.chapter) ? match[2] : page.part;
}
function stopImport() {
  if (!running || stopping) return;
  stopping = true;
  syncControls();
}
function previewMessage(text, error = false) {
  const message = document.createElement("p");
  message.className = `preview-message${error ? " error" : ""}`;
  message.setAttribute("role", "status");
  message.textContent = text;
  $("preview-body").replaceChildren(message);
}
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    const error = new Error(response?.error || "扩展连接中断，请重新打开导入页。");
    error.fatal = response?.fatal; throw error;
  }
  return response;
}
function request(action, extra = {}) {
  return send({ type: "course-request", action, meta, base: $("folder").value, ...extra });
}
async function updateIndex() {
  await request("index", { pages });
  await persist();
}
function snapshotKey() {
  return `boc-course-v1:${meta.bvid}:${CourseCore.normalizeFolder($("folder").value)}`;
}
async function persist() {
  await chrome.storage.local.set({ [snapshotKey()]: { title: meta.title, pages, updated: Date.now() }, [`boc-course-base:${meta.bvid}`]: CourseCore.normalizeFolder($("folder").value) });
}
function syncControls() {
  const locked = running || loading;
  if (locked) closeFilter();
  for (const id of ["load", "url", "folder", "settings", "notes-nav", "filter", "select", "clear", "current"]) $(id).disabled = locked;
  $("start").disabled = locked || previewLoading || !meta || !pages.some(p => p.selected);
  $("retry").disabled = locked || previewLoading || !pages.some(p => p.selected && ["failed", "missing"].includes(p.status));
  $("current").disabled = locked || !meta;
  $("asr-current").disabled = locked || previewLoading || !meta || !activeAsrPage;
  $("asr-selected").disabled = locked || previewLoading;
  if (running) $("start").disabled = stopping;
  for (const id of ["source-open", "empty-load", "folder-edit", "local-asr-settings"]) $(id).disabled = locked;
  $("retry").hidden = !pages.some(page => page.selected && ["failed", "missing"].includes(page.status));
  renderImportAction();
}
function visiblePages() {
  return pages.filter(p => chapterFilter === "all" || p.chapter === chapterFilter);
}
function render() {
  syncControls();
  if (!meta) return;
  $("title").textContent = meta.title;
  $("course-meta").textContent = meta.platform === "youtube" ? `${meta.author || "视频作者"} · ${pages.length} 个视频` : `${meta.author || "课程作者"} · ${pages.length} 个分 P`;
  const selected = pages.filter(p => p.selected).length;
  const missingSelected = pages.filter(p => p.selected && p.status === "missing").length;
  $("asr-selected").hidden = missingSelected === 0;
  $("asr-selected-label").textContent = `本地转写 · ${missingSelected}`;
  $("asr-selected").setAttribute("aria-label", `本地转写并导入 ${missingSelected} 个无字幕视频`);
  $("count").textContent = `已选择 ${selected} / ${pages.length}`;
  $("import-summary").textContent = selected ? `已选择 ${selected} 个课时` : "请先勾选要导入的课时";
  const group = chapterFilter;
  $("current").textContent = "仅选当前";
  $("current").title = `只勾选课程链接指向的第 ${currentPage} 个视频，取消其他视频的勾选`;
  $("select").textContent = group === "all" ? "全选" : group === "0" ? "全选未分章" : "全选本章";
  $("clear").textContent = group === "all" ? "清空" : group === "0" ? "取消该组选择" : "取消本章选择";
  $("select").title = group === "all" ? "勾选课程中的所有视频" : "仅勾选当前分组，其他分组将取消选择";
  try { $("destination").textContent = CourseCore.courseFolder(meta, $("folder").value); }
  catch (error) { $("destination").textContent = error.message; }
  $("destination").title = $("destination").textContent;
  $("parts").replaceChildren();
  for (const page of visiblePages()) {
    const row = document.createElement("tr");
    const isPreviewing = previewOpen && page.cid === previewId;
    row.classList.toggle("is-previewing", isPreviewing);
    row.classList.toggle("is-selected", page.selected);
    const cells = Array.from({ length: 5 }, () => row.appendChild(document.createElement("td")));
    const check = document.createElement("input");
    check.type = "checkbox"; check.checked = page.selected; check.disabled = running || loading;
    check.setAttribute("aria-label", meta.platform === "youtube" ? "选择 YouTube 视频" : `选择 P${page.page}`);
    check.addEventListener("change", () => { page.selected = check.checked; render(); }); cells[0].append(check);
    cells[1].textContent = String(page.page).padStart(2, "0"); cells[1].className = "part-number";
    cells[1].setAttribute("aria-label", `序号 ${page.page}`);
    const button = document.createElement("button");
    button.className = "part-title"; button.textContent = partTitle(page); button.disabled = running || loading;
    button.setAttribute("aria-label", `预览 P${page.page} ${page.part}`);
    button.title = isPreviewing ? "点击收起字幕" : "点击核对字幕";
    button.setAttribute("aria-controls", "preview-panel");
    button.setAttribute("aria-expanded", String(isPreviewing));
    button.addEventListener("click", () => preview(page)); cells[2].append(button);
    const chapter = document.createElement("input");
    chapter.type = "text"; chapter.className = "chapter-number"; chapter.inputMode = "decimal"; chapter.value = page.chapter;
    chapter.title = "可填写 2 或 2.3；0 表示未分章";
    chapter.disabled = running || loading; chapter.setAttribute("aria-label", `P${page.page} 章节号`);
    chapter.addEventListener("change", async () => {
      const value = CourseCore.normalizeChapter(chapter.value);
      if (value === null) { chapter.value = page.chapter; status("章节号请填写 2、2.3 这样的编号；0 表示未分章。", true); return; }
      page.chapter = value;
      renderFilters(); render();
      try { await persist(); } catch (error) { status(error.message, true); }
    });
    const chapterLabel = document.createElement("label");
    chapterLabel.className = "chapter-edit"; chapterLabel.append(chapter); cells[3].append(chapterLabel);
    const badge = document.createElement("span"); badge.className = `badge ${page.status}`;
    badge.textContent = statusLabels[page.status] || "待导入"; cells[4].append(badge);
    if (page.error) badge.title = page.error;
    $("parts").append(row);
  }
}
function closeFilter(restoreFocus = false) {
  $("filter-options").hidden = true;
  $("filter").setAttribute("aria-expanded", "false");
  if (restoreFocus) $("filter").focus();
}
function openFilter(last = false) {
  if ($("filter").disabled) return;
  $("filter-options").hidden = false;
  $("filter").setAttribute("aria-expanded", "true");
  const options = [...$("filter-options").children];
  const target = last ? options.at(-1) : options.find(option => option.getAttribute("aria-selected") === "true");
  target?.focus();
}
function renderFilters() {
  closeFilter();
  const chapters = [...new Set(pages.map(p => p.chapter))].sort(CourseCore.compareChapters);
  if (!chapters.includes(chapterFilter)) chapterFilter = "all";
  const label = chapterFilter === "all" ? "全部章节" : CourseCore.chapterLabel(chapterFilter);
  $("filter-label").textContent = label;
  $("filter").setAttribute("aria-label", `按章节筛选：${label}`);
  $("filter-options").replaceChildren();
  for (const value of ["all", ...chapters]) {
    const option = document.createElement("button");
    option.type = "button"; option.tabIndex = -1;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(value === chapterFilter));
    option.textContent = value === "all" ? "全部章节" : CourseCore.chapterLabel(value);
    option.addEventListener("click", () => {
      chapterFilter = value; renderFilters(); render(); closeFilter(true);
    });
    $("filter-options").append(option);
  }
}
async function loadCourse() {
  if (running || loading) return;
  resetImportButton(); setPreviewOpen(false);
  const source = $("url").value.trim();
  const parsed = CourseCore.parseSource(source);
  if (!parsed) { status("请输入 B站或 YouTube 视频链接。", true); return; }
  currentPage = parsed.page;
  loading = true; previewLoading = false; previewRun++; previewId = "";
  activeAsrPage = null; $("asr-panel").hidden = true;
  render(); syncControls(); status("正在读取课程目录…");
  try {
    const result = await request("meta", parsed.platform === "youtube" ? { youtubeId: parsed.id, playlistId: parsed.playlistId } : { bvid: parsed.id }); meta = result.meta;
    if (!meta.pages.length) throw new Error("该视频没有可读取的分 P 目录。");
    if (meta.platform === "youtube") currentPage = meta.pages.find(item => item.cid === parsed.id)?.page || 1;
    const baseKey = `boc-course-base:${meta.bvid}`;
    $("folder").value = (await chrome.storage.local.get(baseKey))[baseKey] || result.folder;
    const cached = (await chrome.storage.local.get(snapshotKey()))[snapshotKey()];
    pages = meta.pages.map(page => {
      const old = cached?.pages?.find(p => p.cid === page.cid);
      const emptySubtitle = old?.status === "failed" && old?.error === "字幕文件为空。";
      return { ...page, chapter: old?.chapter ?? CourseCore.chapterOf(page.part), selected: page.page === currentPage, status: emptySubtitle ? "missing" : old?.status === "running" ? "pending" : old?.status || "pending", error: emptySubtitle ? "" : old?.error || "" };
    });
    renderFilters(); $("course").hidden = false; $("empty").hidden = true;
    status("");
  } catch (error) {
    meta = null; pages = []; $("course").hidden = true; $("empty").hidden = false; status(error.message, true);
  } finally { loading = false; render(); }
  if (meta) {
    if ($("source-dialog").open) $("source-dialog").close();
    const page = pages.find(item => item.page === currentPage);
    if (page) await preview(page);
  }
}
async function preview(page) {
  if (previewOpen && page.cid === previewId) { closePreview(); return; }
  setPreviewOpen(true);
  if (window.matchMedia("(max-width: 1100px)").matches) $("preview-close").focus();
  const run = ++previewRun;
  previewId = page.cid; previewLoading = true; render();
  activeAsrPage = null; $("asr-panel").hidden = true;
  $("preview-title").textContent = partTitle(page);
  previewMessage("正在获取字幕，请稍候…");
  try {
    const result = await request("preview", { page });
    if (run !== previewRun) return;
    if (result.missing) {
      if (!["saved", "exists"].includes(page.status)) page.status = "missing";
      activeAsrPage = page;
      previewMessage("没有可用字幕。可以尝试用本地组件转写音频。本地转写是可选扩展，需单独安装并连接。");
      $("asr-panel").hidden = false;
      try { await refreshAsrStatus(); } catch { /* Setup button remains available. */ }
      render(); return;
    }
    if (["failed", "missing"].includes(page.status)) {
      page.status = "pending"; page.error = "";
      await persist();
      if (run !== previewRun) return;
      render();
    }
    $("preview-body").replaceChildren();
    const groups = CourseCore.groupSubtitles(result.body, meta.platform);
    for (const item of groups.slice(0, 100)) {
      const paragraph = document.createElement("p"), time = document.createElement("a");
      time.textContent = new Date(Math.floor(item.from) * 1000).toISOString().slice(11, 19);
      time.href = CourseCore.timestampUrl(meta, page, item.from); time.target = "_blank"; time.rel = "noopener";
      paragraph.append(time, document.createTextNode(item.content)); $("preview-body").append(paragraph);
    }
  } catch (error) { if (run === previewRun) previewMessage(error.message, true); }
  finally { if (run === previewRun) { previewLoading = false; syncControls(); } }
}
async function refreshAsrStatus() {
  const result = await send({ type: "asr-status" });
  asrConnected = result.connected;
  $("asr-current").textContent = asrConnected ? "本地转写并导入此 P" : result.paired ? "检查本地转写连接" : "安装／连接本地转写";
  return result;
}
async function openAsrSetup(result = null) {
  result ||= await refreshAsrStatus();
  $("asr-pair-fields").hidden = !result.needsPairing;
  $("asr-connect").hidden = !result.needsPairing;
  $("asr-state").textContent = result.connected ? "已连接" : "未连接";
  $("asr-state").classList.toggle("is-ready", result.connected);
  showSettingsFeedback("asr-settings-status", result.error || (result.connected
    ? result.gpuNotice || (result.device === "cuda" ? "本地转写已连接，将使用 GPU" : result.gpuEnabled ? "本地转写已连接，首次转写时检测 GPU" : "本地转写已连接，将使用 CPU")
    : result.needsPairing ? "" : "请先启动本地转写服务，再点击“重新检测”"));
  showWorkbenchPage("asr-page");
  return result;
}
async function continuePendingAsr() {
  const selected = pendingAsrPages;
  pendingAsrPages = [];
  if (selected.length) { showWorkbenchPage("catalog-page"); await runAsrQueue(selected); }
  else await openAsrSetup();
}
async function runAsrQueue(selected) {
  if (running || loading || previewLoading || !meta || !selected.length) return;
  const connection = await refreshAsrStatus();
  if (meta.platform === "youtube" && connection.connected && !connection.youtubeAudio) {
    status("本地转写组件需要更新：运行新版安装向导覆盖原目录，再重新启动服务。", true);
    return;
  }
  if (!connection.connected) {
    if (connection.installed && connection.paired && !connection.needsPairing) {
      status(connection.error || "本地转写暂时无法连接，请稍后重试。", true);
      return;
    }
    pendingAsrPages = selected; await openAsrSetup(connection); return;
  }
  pendingAsrPages = [];
  try { CourseCore.normalizeFolder($("folder").value); } catch (error) { status(error.message, true); return; }
  await navigator.locks.request(`boc-course:${meta.bvid}`, { ifAvailable: true }, async lock => {
    if (!lock) { status("这门课程正在另一个导入页处理，请回到该页面查看。", true); return; }
    running = true; stopping = false; render();
    setImportProgress(0, selected.length, "转写");
    const counts = {}; let done = 0, runtimeNote = "";
    try {
      await persist(); await updateIndex();
      for (const page of selected) {
        if (stopping) break;
        page.status = "running"; page.error = ""; render();
        try {
          const started = await request("asr-start", { page });
          if (started.status === "exists") { page.status = "exists"; }
          else if (started.status === "subtitle-available") {
            const result = await request("import", { page });
            page.status = result.status;
          }
          else {
            activeAsrJob = started.id;
            while (!stopping) {
              const job = await request("asr-poll", { page, jobId: activeAsrJob });
              if (stopping) break;
              if (job.status === "done") {
                runtimeNote = job.gpu_notice || (job.device === "cuda" ? "本次使用 GPU 转写。" : "本次使用 CPU 转写。");
                const result = await request("asr-finish", { page, jobId: activeAsrJob });
                page.status = result.status; break;
              }
              if (job.status === "failed" || job.status === "canceled") throw new Error(job.detail || "转写已停止。");
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
            if (stopping) { await request("asr-cancel", { page, jobId: activeAsrJob }).catch(() => {}); page.status = "missing"; }
          }
        } catch (error) {
          page.status = stopping ? "missing" : "failed";
          page.error = stopping ? "" : error.message;
        }
        finally { activeAsrJob = ""; }
        if (["saved", "exists"].includes(page.status) && activeAsrPage?.cid === page.cid) {
          $("asr-panel").hidden = true;
          previewMessage(page.status === "saved" ? "本地转写已导入 Obsidian；原始笔记包含完整时间戳。" : "这一 P 的原始素材已存在，已跳过。 ");
        }
        counts[page.status] = (counts[page.status] || 0) + 1; done++; setImportProgress(done, selected.length, "转写");
        await persist(); render(); await updateIndex();
      }
      reportImportResult(stopping ? "已停止" : "本地转写完成", counts, selected.length - done, null, runtimeNote);
    } catch (error) { reportImportResult("转写已中断", counts, selected.length - done, error); }
    finally { running = false; activeAsrJob = ""; render(); }
  });
}
async function runQueue(retryOnly) {
  if (running || loading || previewLoading || !meta) return;
  try { CourseCore.normalizeFolder($("folder").value); } catch (error) { status(error.message, true); return; }
  const selected = pages.filter(p => p.selected && (!retryOnly || ["failed", "missing"].includes(p.status)));
  if (!selected.length) { status("没有符合条件的已勾选分 P。"); return; }
  await navigator.locks.request(`boc-course:${meta.bvid}`, { ifAvailable: true }, async lock => {
    if (!lock) { status("这门课程正在另一个导入页处理，请回到该页面查看。", true); return; }
    stopping = false; running = true; render();
    setImportProgress(0, selected.length);
    let done = 0, fatalError = null;
    const counts = {};
    try {
      await persist(); await updateIndex();
      for (const page of selected) {
        if (stopping) break;
        page.status = "running"; page.error = ""; render();
        try { const result = await request("import", { page, activateVideo: meta.platform === "youtube" }); page.status = result.status; }
        catch (error) { page.status = "failed"; page.error = error.message; if (error.fatal) fatalError = error; }
        counts[page.status] = (counts[page.status] || 0) + 1; done++; setImportProgress(done, selected.length);
        await persist(); render(); await updateIndex();
        if (fatalError) break;
        if (!stopping && done < selected.length) await new Promise(resolve => setTimeout(resolve, 1200));
      }
      reportImportResult(fatalError ? "已暂停" : stopping ? "已停止" : "导入完成", counts, selected.length - done, fatalError);
    } catch (error) { reportImportResult("导入已中断", counts, selected.length - done, error); }
    finally { running = false; render(); }
  });
}
async function refreshSettings() {
  savedSettings = (await send({ type: "settings-get" })).settings;
  $("connection-state").textContent = savedSettings.hasApiKey ? "已配置" : "未配置";
  $("connection-state").classList.toggle("is-ready", savedSettings.hasApiKey);
  if (!meta) $("folder").value = savedSettings.noteFolder;
}
async function openSettings() {
  try {
    await refreshSettings();
    $("api-url").value = savedSettings.obsidianApiBaseUrl; $("api-key").value = "";
    $("api-key").placeholder = savedSettings.hasApiKey ? "已保存，留空保持原 Key" : "从 Local REST API 设置复制";
    $("default-folder").value = savedSettings.noteFolder; showSettingsFeedback("settings-status", "");
    showWorkbenchPage("connection-page");
  } catch (error) { status(error.message, true); }
}
async function updateSettings(testOnly) {
  const ids = ["save-settings", "test-settings", "api-url", "api-key", "default-folder"];
  ids.forEach(id => $(id).disabled = true);
  showSettingsFeedback("settings-status", testOnly ? "正在验证连接…" : "正在保存…");
  try {
    const result = await send({ type: testOnly ? "settings-test" : "settings-save", settings: { obsidianApiBaseUrl: $("api-url").value, obsidianApiKey: $("api-key").value, noteFolder: $("default-folder").value } });
    if (testOnly) showSettingsFeedback("settings-status", "连接成功");
    else {
      savedSettings = result.settings; $("api-key").value = "";
      $("api-key").placeholder = savedSettings.hasApiKey ? "已保存，留空保持原 Key" : "从 Local REST API 设置复制";
      await refreshSettings(); showSettingsFeedback("settings-status", "配置已保存");
    }
  } catch (error) { showSettingsFeedback("settings-status", error.message); }
  finally { ids.forEach(id => $(id).disabled = false); }
}
$("load").addEventListener("click", () => loadCourse().catch(error => status(error.message, true)));
$("url").addEventListener("keydown", event => { if (event.key === "Enter") loadCourse(); });
$("settings").addEventListener("click", openSettings);
$("save-settings").addEventListener("click", () => updateSettings(false));
$("test-settings").addEventListener("click", () => updateSettings(true));
$("filter").addEventListener("click", () => {
  if ($("filter-options").hidden) openFilter(); else closeFilter();
});
$("filter").addEventListener("keydown", event => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault(); openFilter(event.key === "ArrowUp");
});
$("filter-options").addEventListener("keydown", event => {
  if (event.key === "Escape") { event.preventDefault(); closeFilter(true); return; }
  const options = [...$("filter-options").children];
  const index = options.indexOf(document.activeElement);
  const target = { ArrowDown: (index + 1) % options.length, ArrowUp: (index + options.length - 1) % options.length, Home: 0, End: options.length - 1 }[event.key];
  if (target === undefined) return;
  event.preventDefault(); options[target].focus();
});
document.addEventListener("pointerdown", event => {
  if (!event.target.closest(".chapter-filter")) closeFilter();
});
document.querySelector(".chapter-filter").addEventListener("focusout", event => {
  if (!event.currentTarget.contains(event.relatedTarget)) closeFilter();
});
$("folder").addEventListener("change", () => { pages.forEach(p => { p.status = "pending"; p.error = ""; }); render(); });
$("select").addEventListener("click", () => { const visible = new Set(visiblePages()); pages.forEach(p => p.selected = visible.has(p)); render(); });
$("clear").addEventListener("click", () => { visiblePages().forEach(p => p.selected = false); render(); });
$("current").addEventListener("click", () => { pages.forEach(p => p.selected = p.page === currentPage); render(); });
$("asr-current").addEventListener("click", () => {
  if (activeAsrPage) runAsrQueue([activeAsrPage]).catch(error => status(error.message, true));
});
$("asr-selected").addEventListener("click", () => runAsrQueue(pages.filter(p => p.selected && p.status === "missing")).catch(error => status(error.message, true)));
$("asr-connect").addEventListener("click", async () => {
  $("asr-connect").disabled = true;
  try {
    await send({ type: "asr-pair", token: $("asr-token").value });
    $("asr-token").value = "";
    if ((await refreshAsrStatus()).connected) await continuePendingAsr();
    else await openAsrSetup();
  } catch (error) { showSettingsFeedback("asr-settings-status", error.message); }
  finally { $("asr-connect").disabled = false; }
});
$("asr-refresh").addEventListener("click", async () => {
  $("asr-refresh").disabled = true;
  try {
    if ((await openAsrSetup()).connected) await continuePendingAsr();
  } catch (error) { showSettingsFeedback("asr-settings-status", error.message); }
  finally { $("asr-refresh").disabled = false; }
});
$("retry").addEventListener("click", () => runQueue(true).catch(error => status(error.message, true)));
$("notes-nav").addEventListener("click", async () => {
  showSettingsFeedback("note-status", "");
  try {
    await window.NotePreferences.load();
    showWorkbenchPage("note-preferences-page");
  } catch (error) { status(error.message, true); }
});
for (const button of document.querySelectorAll("[data-close]")) button.addEventListener("click", () => $(button.dataset.close).close());
window.addEventListener("beforeunload", event => { if (running) { event.preventDefault(); event.returnValue = ""; } });
async function init() {
  syncControls(); await refreshSettings();
  const params = new URLSearchParams(location.search);
  const bvid = params.get("bvid"), youtubeId = params.get("youtubeId"), playlistId = params.get("playlistId");
  if (bvid || youtubeId) {
    $("url").value = youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}${playlistId ? `&list=${playlistId}` : ""}` : `https://www.bilibili.com/video/${bvid}/?p=${currentPage}`; await loadCourse();
    if (meta && params.get("scope") === "all") {
      pages.forEach(page => page.selected = true); render();
    }
    if (meta && new URLSearchParams(location.search).get("asr") === "1") {
      const page = pages.find(item => item.page === currentPage);
      if (page) { if (previewId !== page.cid) await preview(page); if (activeAsrPage) await runAsrQueue([page]); }
    }
  }
}
// workbench.js starts initialization after binding navigation and animations.
