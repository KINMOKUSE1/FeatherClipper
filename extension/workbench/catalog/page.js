/* 课程目录状态、课时选择、字幕读取和字幕导入队列。 */
window.createCatalogPage = function ({ send, feedback, previewView, importAction, connection, transcription }) {
  const ui = UiText.catalog, format = UiText.format;
  const { status } = feedback;
  function reportImportResult(label, counts, remaining, error = null, detail = "") {
    return importAction.result(label, counts, remaining, error, detail, stopping);
  }
  const $ = id => document.getElementById(id);
  $("preview-body").addEventListener("click", async event => {
    const link = event.target.closest("a");
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    try { await send({ type: "video-seek", url: link.href }); }
    catch (error) { status(error.message, true); }
  });
  const statusLabels = { pending: ui.pending, running: ui.running, saved: ui.saved, exists: ui.exists, missing: ui.missing, failed: ui.failed };
  let meta = null, pages = [], running = false, loading = false, stopping = false;
  let previewId = "", previewRun = 0, previewLoading = false;
  let chapterFilter = "all";
  let activeAsrPage = null, subtitleLanguage = "";
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
  function request(action, extra = {}) {
    return send({ type: "course-request", action, meta, base: $("folder").value,
      ...(meta?.platform !== "youtube" && subtitleLanguage && ["preview", "import"].includes(action) ? { subtitleLanguage } : {}), ...extra });
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
    for (const id of ["load", "url", "folder", "settings", "notes-nav", "history-nav", "filter", "select", "clear", "current"]) $(id).disabled = locked;
    $("start").disabled = locked || previewLoading || !meta || !pages.some(p => p.selected);
    $("retry").disabled = locked || previewLoading || !pages.some(p => p.selected && ["failed", "missing"].includes(p.status));
    $("current").disabled = locked || !meta;
    $("asr-current").disabled = locked || previewLoading || !meta || !activeAsrPage;
    $("asr-selected").disabled = locked || previewLoading;
    if (running) $("start").disabled = stopping;
    for (const id of ["source-open", "empty-load", "folder-edit", "local-asr-settings"]) $(id).disabled = locked;
    $("retry").hidden = !pages.some(page => page.selected && ["failed", "missing"].includes(page.status));
    importAction.render({ stopping });
  }
  function visiblePages() {
    return pages.filter(p => chapterFilter === "all" || p.chapter === chapterFilter);
  }
  function render() {
    syncControls();
    if (!meta) return;
    $("title").textContent = meta.title;
    $("course-meta").textContent = meta.platform === "youtube" ? format(ui.youtubeMeta, { author: meta.author || ui.videoAuthor, count: pages.length }) : format(ui.bilibiliMeta, { author: meta.author || ui.courseAuthor, count: pages.length });
    const selected = pages.filter(p => p.selected).length;
    const missingSelected = pages.filter(p => p.selected && p.status === "missing").length;
    $("asr-selected").hidden = missingSelected === 0;
    $("asr-selected-label").textContent = format(ui.transcribeSelected, { count: missingSelected });
    $("asr-selected").setAttribute("aria-label", format(ui.transcribeSelectedLabel, { count: missingSelected }));
    $("count").textContent = format(ui.selectionCount, { selected, total: pages.length });
    $("import-summary").textContent = selected ? format(ui.selectionSummary, { count: selected }) : ui.selectHint;
    const group = chapterFilter;
    $("current").textContent = ui.current;
    $("current").title = format(ui.currentHint, { number: currentPage });
    $("select").textContent = group === "all" ? ui.selectAll : group === "0" ? ui.selectUngrouped : ui.selectChapter;
    $("clear").textContent = group === "all" ? ui.clear : group === "0" ? ui.clearGroup : ui.clearChapter;
    $("select").title = group === "all" ? ui.selectAllHint : ui.selectChapterHint;
    try { $("destination").textContent = CourseCore.courseFolder(meta, $("folder").value); }
    catch (error) { $("destination").textContent = error.message; }
    $("destination").title = $("destination").textContent;
    $("parts").replaceChildren();
    for (const page of visiblePages()) {
      const row = document.createElement("tr");
      const isPreviewing = previewView.isOpen() && page.cid === previewId;
      row.classList.toggle("is-previewing", isPreviewing);
      row.classList.toggle("is-selected", page.selected);
      const cells = Array.from({ length: 5 }, () => row.appendChild(document.createElement("td")));
      const check = document.createElement("input");
      check.type = "checkbox"; check.checked = page.selected; check.disabled = running || loading;
      check.setAttribute("aria-label", meta.platform === "youtube" ? ui.selectYoutube : format(ui.selectPage, { number: page.page }));
      check.addEventListener("change", () => { page.selected = check.checked; render(); }); cells[0].append(check);
      cells[1].textContent = String(page.page).padStart(2, "0"); cells[1].className = "part-number";
      cells[1].setAttribute("aria-label", format(ui.pageNumber, { number: page.page }));
      const button = document.createElement("button");
      button.className = "part-title"; button.textContent = partTitle(page); button.disabled = running || loading;
      button.setAttribute("aria-label", format(ui.previewPage, { number: page.page, title: page.part }));
      button.title = isPreviewing ? ui.closePreview : ui.openPreview;
      button.setAttribute("aria-controls", "preview-panel");
      button.setAttribute("aria-expanded", String(isPreviewing));
      button.addEventListener("click", () => preview(page)); cells[2].append(button);
      const chapter = document.createElement("input");
      chapter.type = "text"; chapter.className = "chapter-number"; chapter.inputMode = "decimal"; chapter.value = page.chapter;
      chapter.title = ui.chapterHint;
      chapter.disabled = running || loading; chapter.setAttribute("aria-label", format(ui.chapterLabel, { number: page.page }));
      chapter.addEventListener("change", async () => {
        const value = CourseCore.normalizeChapter(chapter.value);
        if (value === null) { chapter.value = page.chapter; status(ui.invalidChapter, true); return; }
        page.chapter = value;
        renderFilters(); render();
        try { await persist(); } catch (error) { status(error.message, true); }
      });
      const chapterLabel = document.createElement("label");
      chapterLabel.className = "chapter-edit"; chapterLabel.append(chapter); cells[3].append(chapterLabel);
      const badge = document.createElement("span"); badge.className = `badge ${page.status}`;
      badge.textContent = statusLabels[page.status] || ui.pending; cells[4].append(badge);
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
    const label = chapterFilter === "all" ? ui.allChapters : CourseCore.chapterLabel(chapterFilter);
    $("filter-label").textContent = label;
    $("filter").setAttribute("aria-label", format(ui.filterLabel, { label }));
    $("filter-options").replaceChildren();
    for (const value of ["all", ...chapters]) {
      const option = document.createElement("button");
      option.type = "button"; option.tabIndex = -1;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(value === chapterFilter));
      option.textContent = value === "all" ? ui.allChapters : CourseCore.chapterLabel(value);
      option.addEventListener("click", () => {
        chapterFilter = value; renderFilters(); render(); closeFilter(true);
      });
      $("filter-options").append(option);
    }
  }
  async function loadCourse(options = {}) {
    if (running || loading) return;
    if (options.source) $("url").value = options.source;
    importAction.reset(); previewView.open(false);
    const source = $("url").value.trim();
    const parsed = CourseCore.parseSource(source);
    if (!parsed) { status(ui.invalidSource, true); return; }
    currentPage = parsed.page;
    subtitleLanguage = parsed.platform === "bilibili" ? options.subtitleLanguage ?? (meta?.bvid === parsed.id ? subtitleLanguage : "") : "";
    loading = true; previewLoading = false; previewRun++; previewId = "";
    activeAsrPage = null; $("asr-panel").hidden = true;
    render(); syncControls(); status(ui.loading);
    try {
      const result = await request("meta", parsed.platform === "youtube" ? { youtubeId: parsed.id, playlistId: parsed.playlistId } : { bvid: parsed.id }); meta = result.meta;
      if (!meta.pages.length) throw new Error(ui.emptyCourse);
      if (meta.platform === "youtube") currentPage = meta.pages.find(item => item.cid === parsed.id)?.page || 1;
      const baseKey = `boc-course-base:${meta.bvid}`;
      $("folder").value = options.base ? CourseCore.normalizeFolder(options.base) : (await chrome.storage.local.get(baseKey))[baseKey] || result.folder;
      const cached = (await chrome.storage.local.get(snapshotKey()))[snapshotKey()];
      pages = meta.pages.map(page => {
        const old = cached?.pages?.find(p => p.cid === page.cid);
        // 旧记录识别值固定保留，不能随界面文案一起修改。
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
      const inherited = options.subtitlePreview;
      const matching = inherited?.bvid === meta.bvid && String(inherited.cid) === String(page?.cid) && ["missing", "failed"].includes(inherited.status);
      if (page && options.preview !== false) await preview(page, matching ? inherited : null);
    }
  }
  async function preview(page, inherited = null) {
    if (previewView.isOpen() && page.cid === previewId) { previewView.close(); return; }
    previewView.open(true);
    if (window.matchMedia("(max-width: 1100px)").matches) $("preview-close").focus();
    const run = ++previewRun;
    previewId = page.cid; previewLoading = true; render();
    activeAsrPage = null; $("asr-panel").hidden = true;
    $("preview-title").textContent = partTitle(page);
    previewView.message(ui.previewLoading);
    try {
      if (inherited?.status === "failed") throw new Error(inherited.error || UiText.popup.subtitleFailed);
      const result = inherited?.status === "missing" ? { missing: true } : await request("preview", { page });
      if (run !== previewRun) return;
      if (result.missing) {
        if (!["saved", "exists"].includes(page.status)) page.status = "missing";
        activeAsrPage = page;
        previewView.message(ui.transcriptionHint);
        $("asr-panel").hidden = false;
        try { await transcription.refresh(); } catch { /* Setup button remains available. */ }
        render(); return;
      }
      if (["failed", "missing"].includes(page.status)) {
        page.status = "pending"; page.error = "";
        await persist();
        if (run !== previewRun) return;
        render();
      }
      previewView.transcript(meta, page, result.body);
    } catch (error) {
      if (run !== previewRun) return;
      if (!["saved", "exists"].includes(page.status)) { page.status = "failed"; page.error = error.message; }
      previewView.message(error.message, true);
      render();
      if (meta.platform === "youtube") {
        activeAsrPage = page; $("asr-panel").hidden = false;
        try { await transcription.refresh(); } catch { /* The user can open transcription settings. */ }
        if (run !== previewRun) return;
        $("asr-current").textContent = ui.tryTranscription;
        render();
      }
    }
    finally { if (run === previewRun) { previewLoading = false; syncControls(); } }
  }
  async function runQueue(retryOnly) {
    if (running || loading || previewLoading || !meta) return;
    try { CourseCore.normalizeFolder($("folder").value); } catch (error) { status(error.message, true); return; }
    const selected = pages.filter(p => p.selected && (!retryOnly || ["failed", "missing"].includes(p.status)));
    if (!selected.length) { status(ui.nothingSelected); return; }
    await navigator.locks.request(`boc-course:${meta.bvid}`, { ifAvailable: true }, async lock => {
      if (!lock) { status(ui.locked, true); return; }
      stopping = false; running = true; render();
      importAction.progress(0, selected.length);
      let done = 0, fatalError = null;
      const counts = {};
      try {
        await persist(); await updateIndex();
        for (const page of selected) {
          if (stopping) break;
          page.status = "running"; page.error = ""; render();
          try { const result = await request("import", { page, activateVideo: meta.platform === "youtube" }); page.status = result.status; }
          catch (error) { page.status = "failed"; page.error = error.message; if (error.fatal) fatalError = error; }
          counts[page.status] = (counts[page.status] || 0) + 1; done++; importAction.progress(done, selected.length);
          await persist(); render(); await updateIndex();
          if (fatalError) break;
          if (!stopping && done < selected.length) await new Promise(resolve => setTimeout(resolve, 1200));
        }
        reportImportResult(fatalError ? ui.paused : stopping ? ui.stopped : ui.complete, counts, selected.length - done, fatalError);
      } catch (error) { reportImportResult(ui.interrupted, counts, selected.length - done, error); }
      finally { running = false; render(); }
    });
  }
  $("load").addEventListener("click", () => loadCourse().catch(error => status(error.message, true)));
  $("url").addEventListener("keydown", event => { if (event.key === "Enter") loadCourse(); });
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
  $("retry").addEventListener("click", () => runQueue(true).catch(error => status(error.message, true)));
  for (const button of document.querySelectorAll("[data-close]")) button.addEventListener("click", () => $(button.dataset.close).close());
  window.addEventListener("beforeunload", event => { if (running) { event.preventDefault(); event.returnValue = ""; } });
  async function init() {
    syncControls(); await connection.refresh();
    const params = new URLSearchParams(location.search);
    const bvid = params.get("bvid"), youtubeId = params.get("youtubeId"), playlistId = params.get("playlistId");
    let subtitlePreview = null;
    if (params.has("subtitlePreview")) {
      try { subtitlePreview = JSON.parse(params.get("subtitlePreview")); } catch { /* Invalid handoffs use a fresh read. */ }
      params.delete("subtitlePreview");
      history.replaceState(history.state, "", `?${params}`);
    }
    if (bvid || youtubeId) {
      $("url").value = youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}${playlistId ? `&list=${playlistId}` : ""}` : `https://www.bilibili.com/video/${bvid}/?p=${currentPage}`; await loadCourse({ subtitleLanguage: params.get("subtitleLanguage") || "", subtitlePreview });
      if (meta && params.get("scope") === "all") {
        pages.forEach(page => page.selected = true); render();
      }
      if (meta && new URLSearchParams(location.search).get("asr") === "1") {
        const page = pages.find(item => item.page === currentPage);
        if (page) { if (previewId !== page.cid) await preview(page); if (activeAsrPage) await transcription.run([page]); }
      }
    }
  }
  function openSource(focusFolder = false) {
    document.getElementById("source-status").textContent = "";
    document.getElementById("source-dialog").showModal();
    document.getElementById(focusFolder ? "folder" : "url").focus();
  }
  document.getElementById("source-open").addEventListener("click", () => openSource());
  document.getElementById("empty-load").addEventListener("click", () => openSource());
  document.getElementById("folder-edit").addEventListener("click", () => openSource(true));
  function getState() { return { meta, pages, running, loading, stopping, previewLoading, previewId, activeAsrPage, currentPage, folder: $("folder").value }; }
  function setImporting(value) { running = value; if (value) stopping = false; render(); }
  return { init, loadCourse, runQueue, stopImport, getState, request, persist, updateIndex, render, setImporting };
};
