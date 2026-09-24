const $ = id => document.getElementById(id);
const statusLabels = { pending: "待导入", running: "处理中", saved: "已导入", exists: "已存在", missing: "无字幕", failed: "失败" };
let meta = null, pages = [], running = false, loading = false, stopping = false;
let previewId = "", previewRun = 0, previewLoading = false, savedSettings = null;
let workflowFile = "WORKFLOW.md", workflowRun = 0;
let chapterFilter = "all";
let asrConnected = false, activeAsrJob = "", activeAsrPage = null, pendingAsrPages = [];
const workflowDocuments = new Map();
let currentPage = Number(new URLSearchParams(location.search).get("p")) || 1;

function status(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
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
  return send({ type: "course-request", action, meta, base: $("folder").value, language: SubtitleLanguage.current(), ...extra });
}
function applyRawSources(sources) {
  for (const page of pages) page.sourcePath = sources?.[page.cid] || "";
}
async function updateIndex() {
  const result = await request("index", { pages });
  applyRawSources(result.sources);
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
  for (const id of ["load", "url", "folder", "settings", "workflow", "filter", "select", "clear", "current"]) $(id).disabled = locked;
  $("start").disabled = locked || previewLoading || !meta || !pages.some(p => p.selected);
  $("retry").disabled = locked || previewLoading || !pages.some(p => p.selected && ["failed", "missing"].includes(p.status));
  $("stop").disabled = !running || stopping;
  $("current").disabled = locked || !meta;
  $("asr-current").disabled = locked || previewLoading || !meta || !activeAsrPage;
  $("asr-selected").disabled = locked || previewLoading;
  $("language-trigger").disabled = locked || previewLoading;
}
function visiblePages() {
  return pages.filter(p => chapterFilter === "all" || p.chapter === chapterFilter);
}
function render() {
  syncControls();
  if (!meta) return;
  $("title").textContent = meta.title;
  $("course-meta").textContent = `${meta.author || "课程作者"} · ${pages.length} 个分 P`;
  const selected = pages.filter(p => p.selected).length;
  const missingSelected = pages.filter(p => p.selected && p.status === "missing").length;
  $("asr-selected").hidden = missingSelected === 0;
  $("asr-selected").textContent = `本地转写并导入 ${missingSelected} 个无字幕视频`;
  $("count").textContent = `已选择 ${selected} / ${pages.length}`;
  $("start").textContent = selected ? `导入 ${selected} 个视频` : "导入 Obsidian";
  $("import-summary").textContent = selected ? `已选 ${selected} 个视频，已有文件会自动跳过。` : "请先勾选要导入的视频。";
  const group = chapterFilter;
  $("current").textContent = `仅选当前 P${currentPage}`;
  $("current").title = `只勾选课程链接指向的第 ${currentPage} 个视频，取消其他视频的勾选`;
  $("select").textContent = group === "all" ? "全选视频" : group === "0" ? "全选未分章" : "全选本章";
  $("clear").textContent = group === "all" ? "取消全选" : group === "0" ? "取消该组选择" : "取消本章选择";
  $("select").title = group === "all" ? "勾选课程中的所有视频" : "仅勾选当前分组，其他分组将取消选择";
  try { $("destination").textContent = CourseCore.courseFolder(meta, $("folder").value); }
  catch (error) { $("destination").textContent = error.message; }
  $("parts").replaceChildren();
  for (const page of visiblePages()) {
    const row = document.createElement("tr");
    row.classList.toggle("is-previewing", page.cid === previewId);
    const cells = Array.from({ length: 5 }, () => row.appendChild(document.createElement("td")));
    const check = document.createElement("input");
    check.type = "checkbox"; check.checked = page.selected; check.disabled = running || loading;
    check.setAttribute("aria-label", `选择 P${page.page}`);
    check.addEventListener("change", () => { page.selected = check.checked; render(); }); cells[0].append(check);
    cells[1].textContent = String(page.page).padStart(2, "0"); cells[1].className = "part-number";
    const button = document.createElement("button");
    button.className = "part-title"; button.textContent = page.part; button.disabled = running || loading;
    button.setAttribute("aria-label", `预览 P${page.page} ${page.part}`);
    button.addEventListener("click", () => preview(page)); cells[2].append(button);
    const previewButton = document.createElement("button");
    previewButton.className = "secondary preview-trigger";
    previewButton.textContent = "预览字幕";
    previewButton.disabled = running || loading;
    previewButton.setAttribute("aria-label", `预览 P${page.page} 字幕`);
    previewButton.addEventListener("click", () => preview(page)); cells[2].append(previewButton);
    const chapter = document.createElement("input");
    chapter.type = "number"; chapter.min = "0"; chapter.max = "999"; chapter.value = page.chapter;
    chapter.disabled = running || loading; chapter.setAttribute("aria-label", `P${page.page} 章节号`);
    chapter.addEventListener("change", () => {
      page.chapter = String(Math.min(999, Math.max(0, Math.floor(Number(chapter.value) || 0))));
      renderFilters(); render();
    }); cells[3].append(chapter);
    const badge = document.createElement("span"); badge.className = `badge ${page.status}`;
    badge.textContent = statusLabels[page.status] || "待导入"; cells[4].append(badge);
    if (page.error) { const reason = document.createElement("small"); reason.textContent = page.error; cells[4].append(reason); }
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
  const chapters = [...new Set(pages.map(p => p.chapter))].sort((a, b) => Number(a) - Number(b));
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
  const source = $("url").value.trim();
  const bvid = source.match(/BV[0-9A-Za-z]+/)?.[0];
  if (!bvid) { status("请输入包含 BV 号的 B站视频链接。", true); return; }
  currentPage = 1;
  if (source.startsWith("http")) {
    try { currentPage = Math.max(1, Number(new URL(source).searchParams.get("p")) || 1); } catch { currentPage = 1; }
  }
  loading = true; previewLoading = false; previewRun++; previewId = "";
  activeAsrPage = null; $("asr-panel").hidden = true;
  previewMessage("点击左侧的“预览字幕”查看内容。"); $("preview-caption").textContent = "预览前 100 条，导入时保存完整字幕与时间戳。";
  $("preview-title").textContent = "字幕预览"; $("source-link").hidden = true;
  render(); syncControls(); status("正在读取课程目录…");
  try {
    const result = await request("meta", { bvid }); meta = result.meta;
    if (!meta.pages.length) throw new Error("该视频没有可读取的分 P 目录。");
    const baseKey = `boc-course-base:${meta.bvid}`;
    $("folder").value = (await chrome.storage.local.get(baseKey))[baseKey] || result.folder;
    const cached = (await chrome.storage.local.get(snapshotKey()))[snapshotKey()];
    pages = meta.pages.map(page => {
      const old = cached?.pages?.find(p => p.cid === page.cid);
      const emptySubtitle = old?.status === "failed" && old?.error === "字幕文件为空。";
      return { ...page, chapter: old?.chapter ?? CourseCore.chapterOf(page.part), selected: false, status: emptySubtitle ? "missing" : old?.status === "running" ? "pending" : old?.status || "pending", error: emptySubtitle ? "" : old?.error || "", sourcePath: old?.sourcePath || "" };
    });
    renderFilters(); $("course").hidden = false; $("empty").hidden = true;
    status("");
  } catch (error) {
    meta = null; pages = []; $("course").hidden = true; $("empty").hidden = false; status(error.message, true);
  } finally { loading = false; render(); syncControls(); }
}
async function preview(page) {
  const run = ++previewRun;
  previewId = page.cid; previewLoading = true; render();
  activeAsrPage = null; $("asr-panel").hidden = true;
  $("preview-title").textContent = `P${page.page} · ${page.part}`;
  $("preview-caption").textContent = "正在读取这一节的字幕。"; previewMessage("正在获取字幕，请稍候…");
  $("source-link").href = CourseCore.videoUrl(meta, page); $("source-link").hidden = false;
  try {
    const result = await request("preview", { page });
    if (run !== previewRun) return;
    if (result.missing) {
      if (!["saved", "exists"].includes(page.status)) page.status = "missing";
      activeAsrPage = page;
      $("preview-caption").textContent = "未找到字幕";
      previewMessage("B站未提供可用字幕。可以使用可选的本地组件转写音频。");
      $("asr-panel").hidden = false;
      try { await refreshAsrStatus(); } catch { /* Setup button remains available. */ }
      render(); return;
    }
    $("preview-body").replaceChildren();
    $("preview-caption").textContent = `${result.track.lanDoc || result.track.lan} · ${result.body.length} 条字幕 · 预览前 100 条`;
    for (const item of result.body.slice(0, 100)) {
      const paragraph = document.createElement("p"), time = document.createElement("a");
      time.textContent = new Date(Math.floor(item.from) * 1000).toISOString().slice(11, 19);
      time.href = `${CourseCore.videoUrl(meta, page)}&t=${Math.floor(item.from)}`; time.target = "_blank"; time.rel = "noopener";
      paragraph.append(time, document.createTextNode(item.content)); $("preview-body").append(paragraph);
    }
  } catch (error) { if (run === previewRun) { $("preview-caption").textContent = "字幕预览失败"; previewMessage(error.message, true); } }
  finally { if (run === previewRun) { previewLoading = false; syncControls(); } }
}
async function refreshAsrStatus() {
  const result = await send({ type: "asr-status" });
  asrConnected = result.connected;
  $("asr-current").textContent = asrConnected ? "本地转写并导入此 P" : result.paired ? "检查本地转写连接" : "安装／连接本地转写";
  $("asr-panel-text").textContent = asrConnected
    ? "B站没有可用字幕，点击后由本机转写这段视频。"
    : result.paired ? "连接码已保存；检查本地组件状态即可继续。" : "本地转写是可选扩展，需单独安装并连接。";
  return result;
}
async function openAsrSetup(result = null) {
  result ||= await refreshAsrStatus();
  $("asr-pair-fields").hidden = !result.needsPairing;
  $("asr-settings-status").textContent = result.error || (result.connected
    ? result.gpuNotice || (result.device === "cuda" ? "本地转写已连接，将使用 GPU。" : result.gpuEnabled ? "本地转写已连接，首次转写时检测 GPU。" : "本地转写已连接，将使用 CPU。")
    : result.needsPairing ? "首次使用，请填写连接码。" : "请先启动本地转写服务，再点击“重新检测”。");
  if (!$("asr-dialog").open) $("asr-dialog").showModal();
  return result;
}
async function continuePendingAsr() {
  const selected = pendingAsrPages;
  pendingAsrPages = [];
  if ($("asr-dialog").open) $("asr-dialog").close();
  if (selected.length) await runAsrQueue(selected);
}
async function runAsrQueue(selected) {
  if (running || loading || previewLoading || !meta || !selected.length) return;
  const connection = await refreshAsrStatus();
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
    $("progress").max = selected.length; $("progress").value = 0; $("progress").hidden = false;
    const counts = {}; let done = 0, runtimeNote = "";
    try {
      await persist(); await updateIndex();
      for (const page of selected) {
        if (stopping) break;
        page.status = "running"; page.error = ""; render();
        status(`正在准备本地转写 ${done + 1}/${selected.length}：P${page.page} ${page.part}`);
        try {
          const started = await request("asr-start", { page });
          if (started.status === "exists") { page.status = "exists"; page.sourcePath = started.path; }
          else if (started.status === "subtitle-available") {
            const result = await request("import", { page });
            page.status = result.status; page.sourcePath = result.path || "";
          }
          else {
            activeAsrJob = started.id;
            while (!stopping) {
              const job = await request("asr-poll", { page, jobId: activeAsrJob });
              if (job.status === "done") {
                runtimeNote = job.gpu_notice || (job.device === "cuda" ? "本次使用 GPU 转写。" : "本次使用 CPU 转写。");
                const result = await request("asr-finish", { page, jobId: activeAsrJob });
                page.status = result.status; page.sourcePath = result.path || ""; break;
              }
              if (job.status === "failed" || job.status === "canceled") throw new Error(job.detail || "转写已停止。");
              status(`本地转写 ${done + 1}/${selected.length}：P${page.page} · ${job.detail || "处理中"}${job.gpu_notice ? `\n${job.gpu_notice}` : ""}`);
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
        counts[page.status] = (counts[page.status] || 0) + 1; done++; $("progress").value = done;
        await persist(); render(); await updateIndex();
      }
      status(`${stopping ? "已停止" : "本地转写完成"} · 新导入 ${counts.saved || 0} · 已存在 ${counts.exists || 0} · 失败 ${counts.failed || 0} · 未处理 ${selected.length - done}\n课程导入清单已更新。${runtimeNote ? `\n${runtimeNote}` : ""}`);
    } catch (error) { status(`转写已中断：${error.message}`, true); }
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
    $("progress").max = selected.length; $("progress").value = 0; $("progress").hidden = false;
    let done = 0, fatalError = null;
    const counts = {};
    try {
      await persist(); await updateIndex();
      for (const page of selected) {
        if (stopping) break;
        page.status = "running"; page.error = ""; render();
        status(`正在处理 ${done + 1}/${selected.length}：P${page.page} ${page.part}`);
        try { const result = await request("import", { page }); page.status = result.status; page.sourcePath = result.path || ""; }
        catch (error) { page.status = "failed"; page.error = error.message; if (error.fatal) fatalError = error; }
        counts[page.status] = (counts[page.status] || 0) + 1; done++; $("progress").value = done;
        await persist(); render(); await updateIndex();
        if (fatalError) break;
        if (!stopping && done < selected.length) await new Promise(resolve => setTimeout(resolve, 1200));
      }
      status(`${fatalError ? "已暂停" : stopping ? "已停止" : "本次导入完成"} · 新导入 ${counts.saved || 0} · 已存在 ${counts.exists || 0} · 无字幕 ${counts.missing || 0} · 失败 ${counts.failed || 0} · 未处理 ${selected.length - done}\n课程导入清单已更新。下一步点击“开始整理笔记”，使用自己的 AI 整理。${fatalError ? `\n${fatalError.message}` : ""}`, Boolean(fatalError));
    } catch (error) { status(`已停止：${error.message}\n已写入的字幕会保留，重新导入时会跳过已有文件。`, true); }
    finally { running = false; render(); }
  });
}
async function refreshSettings() {
  savedSettings = (await send({ type: "settings-get" })).settings;
  $("connection-label").textContent = savedSettings.hasApiKey ? "连接已配置" : "配置 Obsidian";
  if (!meta) $("folder").value = savedSettings.noteFolder;
}
async function openSettings() {
  try {
    await refreshSettings();
    $("api-url").value = savedSettings.obsidianApiBaseUrl; $("api-key").value = "";
    $("api-key").placeholder = savedSettings.hasApiKey ? "已保存，留空保持原 Key" : "从 Local REST API 设置复制";
    $("default-folder").value = savedSettings.noteFolder; $("settings-status").textContent = "";
    $("settings-dialog").showModal();
  } catch (error) { status(error.message, true); }
}
async function updateSettings(testOnly) {
  const ids = ["save-settings", "test-settings", "api-url", "api-key", "default-folder"];
  ids.forEach(id => $(id).disabled = true);
  $("settings-status").textContent = testOnly ? "正在验证连接…" : "正在保存…";
  try {
    const result = await send({ type: testOnly ? "settings-test" : "settings-save", settings: { obsidianApiBaseUrl: $("api-url").value, obsidianApiKey: $("api-key").value, noteFolder: $("default-folder").value } });
    if (testOnly) $("settings-status").textContent = "连接成功，身份验证已通过。尚未保存的设置请点击保存。";
    else {
      savedSettings = result.settings; $("api-key").value = "";
      $("api-key").placeholder = savedSettings.hasApiKey ? "已保存，留空保持原 Key" : "从 Local REST API 设置复制";
      await refreshSettings(); $("settings-status").textContent = "设置已保存，可以关闭此面板继续导入。";
    }
  } catch (error) { $("settings-status").textContent = error.message; }
  finally { ids.forEach(id => $(id).disabled = false); }
}
async function readWorkflowDocument(file) {
  if (workflowDocuments.has(file)) return workflowDocuments.get(file);
  const response = await fetch(`workflow/${file}`);
  if (!response.ok) throw new Error("文档读取失败，请重新打开页面。");
  const text = await response.text();
  workflowDocuments.set(file, text);
  return text;
}
async function showWorkflow(file = workflowFile) {
  const run = ++workflowRun;
  workflowFile = file;
  for (const tab of document.querySelectorAll("[data-workflow-file]")) {
    const active = tab.dataset.workflowFile === file;
    tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1;
    if (active) $("workflow-content").setAttribute("aria-labelledby", tab.id);
  }
  try {
    const text = workflowDocuments.get(file) ?? await readWorkflowDocument(file);
    if (run !== workflowRun) return;
    $("workflow-content").textContent = text; $("workflow-content").scrollTop = 0;
  } catch (error) { if (run === workflowRun) $("workflow-content").textContent = error.message; }
}
$("load").addEventListener("click", loadCourse);
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
$("folder").addEventListener("change", () => { pages.forEach(p => { p.status = "pending"; p.error = ""; p.sourcePath = ""; }); render(); });
$("select").addEventListener("click", () => { const visible = new Set(visiblePages()); pages.forEach(p => p.selected = visible.has(p)); render(); });
$("clear").addEventListener("click", () => { visiblePages().forEach(p => p.selected = false); render(); });
$("current").addEventListener("click", () => { pages.forEach(p => p.selected = p.page === currentPage); render(); });
$("start").addEventListener("click", () => runQueue(false).catch(error => status(error.message, true)));
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
  } catch (error) { $("asr-settings-status").textContent = error.message; }
  finally { $("asr-connect").disabled = false; }
});
$("asr-refresh").addEventListener("click", async () => {
  $("asr-refresh").disabled = true;
  try {
    if ((await openAsrSetup()).connected) await continuePendingAsr();
  } catch (error) { $("asr-settings-status").textContent = error.message; }
  finally { $("asr-refresh").disabled = false; }
});
$("retry").addEventListener("click", () => runQueue(true).catch(error => status(error.message, true)));
$("stop").addEventListener("click", () => { stopping = true; syncControls(); status(activeAsrJob ? "正在停止本地转写…" : "正在停止，等待当前 P 保存完毕…"); });
$("workflow").addEventListener("click", async () => {
  $("workflow-status").textContent = "";
  try {
    await Promise.all(workflowTabs.map(tab => readWorkflowDocument(tab.dataset.workflowFile)));
    if (meta) applyRawSources((await request("raw-paths", { pages })).sources);
    await showWorkflow(); $("workflow-dialog").showModal();
  } catch (error) { status(error.message, true); }
});
const workflowTabs = [...document.querySelectorAll("[data-workflow-file]")];
for (const [index, tab] of workflowTabs.entries()) {
  tab.addEventListener("click", () => showWorkflow(tab.dataset.workflowFile));
  tab.addEventListener("keydown", event => {
    const target = { ArrowRight: (index + 1) % workflowTabs.length, ArrowLeft: (index + workflowTabs.length - 1) % workflowTabs.length, Home: 0, End: workflowTabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault(); workflowTabs[target].focus(); showWorkflow(workflowTabs[target].dataset.workflowFile);
  });
}
$("copy-workflow").addEventListener("click", async () => {
  if (meta && !pages.some(page => page.selected)) {
    $("workflow-status").textContent = "请先关闭此窗口，在课程列表勾选要整理的分 P，再复制任务指令。";
    return;
  }
  try {
    const prompt = CourseCore.buildStudyPrompt(meta, pages, $("folder").value);
    await navigator.clipboard.writeText(prompt);
    $("workflow-status").textContent = "任务指令已复制。本地 AI 可按路径读取；网页 AI 还需上传学习规则、笔记模板、课程清单和对应字幕。";
  } catch (error) { $("workflow-status").textContent = `复制失败：${error.message}。可展开“查看学习文档”，参考“指令示例”手动填写。`; }
});
$("install-workflow").addEventListener("click", async () => {
  $("install-workflow").disabled = true;
  try {
    const { results } = await request("workflow");
    $("workflow-status").textContent = `已写入 ${results.filter(r => r.status === "saved").length} 份，已存在跳过 ${results.filter(r => r.status === "exists").length} 份。位置：${$("folder").value}/学习工作流/`;
  } catch (error) { $("workflow-status").textContent = error.message; }
  finally { $("install-workflow").disabled = false; }
});
for (const button of document.querySelectorAll("[data-close]")) button.addEventListener("click", () => $(button.dataset.close).close());
window.addEventListener("beforeunload", event => { if (running) { event.preventDefault(); event.returnValue = ""; } });
async function init() {
  await SubtitleLanguage.init(() => {
    const page = pages.find(item => item.cid === previewId);
    if (page) preview(page);
  });
  syncControls(); await refreshSettings();
  const bvid = new URLSearchParams(location.search).get("bvid");
  if (bvid) {
    $("url").value = `https://www.bilibili.com/video/${bvid}/?p=${currentPage}`; await loadCourse();
    if (meta && new URLSearchParams(location.search).get("asr") === "1") {
      const page = pages.find(item => item.page === currentPage);
      if (page) { await preview(page); if (activeAsrPage) await runAsrQueue([page]); }
    }
  }
}
init().catch(error => status(error.message, true));
