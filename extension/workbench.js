/* Layout bridge for the workbench; the course operations remain in course.js. */
(() => {
  const workspace = document.querySelector(".workspace");
  const previewPanel = document.getElementById("preview-panel");
  let previewOpen = !previewPanel.hidden;
  let panelAnimation = null;
  function partTitle(page) {
    const match = page.part.match(/^(\d+(?:\.\d+)*)\.\s+(.+)$/);
    return match && match[1] === String(page.chapter) ? match[2] : page.part;
  }
  function setPreviewOpen(open) {
    if (previewOpen === open) return;
    const current = panelAnimation ? getComputedStyle(previewPanel) : null;
    const from = current ? { opacity: current.opacity, transform: current.transform }
      : { opacity: open ? 0 : 1, transform: open ? "translateX(24px)" : "translateX(0)" };
    if (panelAnimation) panelAnimation.cancel();
    previewOpen = open;
    previewPanel.inert = !open;
    if (open) {
      previewPanel.hidden = false;
      workspace.classList.add("preview-open");
      document.getElementById("course").classList.add("preview-open");
    }
    const finish = () => {
      panelAnimation = null;
      if (!previewOpen) {
        previewPanel.hidden = true;
        workspace.classList.remove("preview-open");
        document.getElementById("course").classList.remove("preview-open");
      }
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else {
      panelAnimation = previewPanel.animate([from,
        { opacity: open ? 1 : 0, transform: open ? "translateX(0)" : "translateX(24px)" }
      ], { duration: open ? 240 : 180, easing: "cubic-bezier(.2,.7,.2,1)" });
      panelAnimation.onfinish = finish;
    }
    if (!open) {
      for (const row of document.querySelectorAll("#parts tr")) {
        row.classList.remove("is-previewing");
        row.querySelector(".part-title").setAttribute("aria-expanded", "false");
        row.querySelector(".part-title").title = "点击核对字幕";
      }
    }
  }
  function closePreview() {
    const title = document.querySelector("#parts .is-previewing .part-title");
    setPreviewOpen(false);
    (title || document.getElementById("filter")).focus();
  }
  document.getElementById("preview-close").addEventListener("click", closePreview);
  previewPanel.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closePreview();
  });
  const importButton = document.getElementById("start");
  const buttonFill = document.createElement("span");
  buttonFill.className = "import-button-fill";
  buttonFill.setAttribute("aria-hidden", "true");
  const buttonIcon = document.createElement("span");
  buttonIcon.setAttribute("aria-hidden", "true");
  const buttonLabel = document.createElement("span");
  buttonLabel.className = "import-button-label";
  buttonLabel.setAttribute("role", "status");
  buttonLabel.setAttribute("aria-live", "polite");
  const buttonCount = document.createElement("span");
  buttonCount.className = "import-button-count";
  buttonCount.setAttribute("aria-hidden", "true");
  const buttonWash = document.createElement("span");
  buttonWash.className = "import-button-wash";
  buttonWash.setAttribute("aria-hidden", "true");
  const buttonContent = document.createElement("span");
  buttonContent.className = "import-button-content";
  buttonContent.append(buttonIcon, buttonLabel, buttonCount);
  importButton.replaceChildren(buttonFill, buttonWash, buttonContent);
  let importState = "idle", importDone = 0, importTotal = 0, importPhase = "导入", importResult = "", importResultDetail = "";
  let importResultTimer;
  let renderedButtonState = "", contentAnimation = null, outgoingContent = null, washAnimation = null, countAnimation = null;
  const reducedButtonMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  function animateButtonPress() {
    if (reducedButtonMotion.matches) return;
    if (washAnimation) washAnimation.cancel();
    washAnimation = buttonWash.animate([
      { transform: "scaleY(0)", opacity: .2 },
      { transform: "scaleY(1)", opacity: .12, offset: .7 },
      { transform: "scaleY(1)", opacity: 0 }
    ], { duration: 1100, easing: "cubic-bezier(.22,1,.36,1)" });
  }
  renderImportAction = function () {
    const state = importState === "running" && stopping ? "stopping" : importState;
    const busy = state === "running" || state === "stopping";
    const text = busy ? stopping ? "正在取消" : `${importPhase}中`
      : state === "idle" ? "导入 Obsidian" : importResult;
    const stateKey = `${state}:${text}`;
    const changed = renderedButtonState && renderedButtonState !== stateKey;
    let outgoing = null, from = null;
    if (changed) {
      if (!reducedButtonMotion.matches) {
        const style = getComputedStyle(buttonContent);
        from = { opacity: style.opacity, transform: style.transform, filter: style.filter };
        outgoing = buttonContent.cloneNode(true);
        outgoing.classList.add("import-button-outgoing");
        outgoing.setAttribute("aria-hidden", "true");
      }
      if (contentAnimation) contentAnimation.cancel();
      if (outgoingContent) outgoingContent.remove();
    }
    importButton.dataset.state = state;
    buttonContent.dataset.state = state;
    buttonCount.hidden = !busy;
    const countText = `${importDone}/${importTotal}`;
    const countChanged = buttonCount.textContent !== countText;
    buttonCount.textContent = countText;
    buttonFill.style.transform = `scaleX(${importTotal ? importDone / importTotal : 0})`;
    buttonIcon.textContent = "";
    buttonIcon.className = state === "running" ? "import-button-spinner"
      : ["stopping", "canceled"].includes(state) ? "import-button-cancel"
      : state === "complete" ? "import-button-check"
      : ["warning", "error"].includes(state) ? "import-button-result" : "icon icon-save";
    if (["warning", "error"].includes(state)) buttonIcon.textContent = "!";
    if (buttonLabel.textContent !== text) buttonLabel.textContent = text;
    importButton.setAttribute("aria-label", busy
      ? `${text}，已处理 ${importDone} 个，共 ${importTotal} 个课时${stopping ? "" : "，再次点击取消"}` : importResultDetail || text);
    importButton.setAttribute("aria-busy", String(busy));
    importButton.title = busy ? stopping ? "正在取消，等待当前课时处理结束" : "再次点击取消" : importResultDetail;
    if (outgoing) {
      outgoingContent = outgoing;
      importButton.append(outgoing);
      outgoing.animate([from, { opacity: 0, transform: "translateY(18px)", filter: "blur(3px)" }],
        { duration: 750, easing: "cubic-bezier(.22,1,.36,1)" }).onfinish = () => outgoing.remove();
      contentAnimation = buttonContent.animate([
        { opacity: 0, transform: "translateY(-14px)", filter: "blur(3px)" },
        { opacity: 1, transform: "translateY(0)", filter: "blur(0)" }
      ], { duration: 750, easing: "cubic-bezier(.22,1,.36,1)" });
    } else if (busy && countChanged && !reducedButtonMotion.matches) {
      if (countAnimation) countAnimation.cancel();
      countAnimation = buttonCount.animate([
        { opacity: .35, transform: "translateY(-5px)" },
        { opacity: 1, transform: "translateY(0)" }
      ], { duration: 650, easing: "ease-out" });
    }
    renderedButtonState = stateKey;
  };
  importButton.addEventListener("click", event => {
    if (running) {
      event.stopImmediatePropagation();
      if (!stopping) { animateButtonPress(); stopImport(); }
    } else animateButtonPress();
  }, true);
  function resetImportButton() {
    clearTimeout(importResultTimer);
    importState = "idle"; importDone = 0; importTotal = 0; importResult = ""; importResultDetail = "";
    renderImportAction();
  }
  setImportProgress = function (done, total, phase = "导入") {
    clearTimeout(importResultTimer);
    importState = "running"; importDone = done; importTotal = total; importPhase = phase;
    importResult = ""; importResultDetail = "";
    renderImportAction();
  };
  const oldPreview = preview;
  preview = async function (page) {
    if (previewOpen && page.cid === previewId) {
      closePreview();
      return;
    }
    setPreviewOpen(true);
    if (window.matchMedia("(max-width: 1100px)").matches) document.getElementById("preview-close").focus();
    const pending = oldPreview(page);
    document.getElementById("preview-title").textContent = partTitle(page);
    await pending;
    if (previewId === page.cid && !document.getElementById("asr-panel").hidden) {
      previewMessage("没有可用字幕。可以尝试用本地组件转写音频。本地转写是可选扩展，需单独安装并连接。");
    }
  };
  const oldControls = syncControls;
  syncControls = function () {
    oldControls();
    if (running) importButton.disabled = stopping;
    for (const id of ["source-open", "empty-load", "folder-edit", "local-asr-settings"]) document.getElementById(id).disabled = running || loading;
    document.getElementById("retry").hidden = !pages.some(page => page.selected && ["failed", "missing"].includes(page.status));
    renderImportAction();
  };
  const oldRender = render;
  const asrSelectedButton = document.getElementById("asr-selected");
  const asrSelectedIcon = asrSelectedButton.querySelector(".icon");
  const asrSelectedLabel = document.getElementById("asr-selected-label");
  render = function () {
    oldRender();
    if (!meta) return;
    const missingSelected = pages.filter(page => page.selected && page.status === "missing").length;
    asrSelectedLabel.textContent = `本地转写 · ${missingSelected}`;
    asrSelectedButton.replaceChildren(asrSelectedIcon, asrSelectedLabel);
    asrSelectedButton.setAttribute("aria-label", `本地转写并导入 ${missingSelected} 个无字幕视频`);
    const visible = visiblePages();
    [...document.querySelectorAll("#parts tr")].forEach((row, index) => {
      const page = visible[index];
      const isPreviewing = previewOpen && page.cid === previewId;
      row.classList.toggle("is-selected", page.selected);
      row.classList.toggle("is-previewing", isPreviewing);
      const title = row.querySelector(".part-title");
      title.textContent = partTitle(page);
      title.title = isPreviewing ? "点击收起字幕" : "点击核对字幕";
      title.setAttribute("aria-controls", "preview-panel");
      title.setAttribute("aria-expanded", String(isPreviewing));
      const reason = row.querySelector("small");
      if (reason) {
        row.querySelector(".badge").title = reason.textContent;
        reason.remove();
      }
      row.cells[1].setAttribute("aria-label", `序号 ${page.page}`);
      const chapter = row.querySelector(".chapter-number");
      const chapterLabel = document.createElement("label");
      chapterLabel.className = "chapter-edit";
      chapter.replaceWith(chapterLabel);
      chapterLabel.append(chapter);
    });
    const selected = pages.filter(page => page.selected).length;
    document.getElementById("import-summary").textContent = selected ? `已选择 ${selected} 个课时` : "请先勾选要导入的课时";
    document.getElementById("destination").title = document.getElementById("destination").textContent;
    document.getElementById("current").textContent = "仅选当前";
    if (chapterFilter === "all") {
      document.getElementById("select").textContent = "全选";
      document.getElementById("clear").textContent = "清空";
    }
  };
  status = function (text, error = false) {
    const sourceOpen = document.getElementById("source-dialog").open;
    document.getElementById("source-status").textContent = sourceOpen ? text : "";
    document.getElementById("source-status").classList.toggle("error", error);
    if (text && !sourceOpen && !running && !loading) showToast(text, error);
  };
  const importToast = document.getElementById("import-toast");
  let toastTimer;
  function showToast(text, error = false) {
    clearTimeout(toastTimer);
    importToast.textContent = text;
    importToast.classList.toggle("error", error);
    importToast.hidden = false;
    requestAnimationFrame(() => {
      const bar = document.querySelector(".import-bar");
      const barRect = bar.getBoundingClientRect();
      const courseHidden = document.getElementById("course").hidden;
      const aboveBar = courseHidden ? 24 : window.innerHeight - barRect.top + 12;
      importToast.style.left = `${courseHidden ? 24 : barRect.left}px`;
      importToast.style.bottom = `${Math.max(24, aboveBar)}px`;
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        importToast.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 180, easing: "ease-out" });
      }
    });
    toastTimer = setTimeout(() => { importToast.hidden = true; importToast.textContent = ""; }, 5000);
  }
  const oldImportResult = reportImportResult;
  reportImportResult = function (label, counts, remaining, error = null, detail = "") {
    const text = oldImportResult(stopping && !error ? "已取消" : label, counts, remaining, error, detail);
    status("");
    importState = error || counts.failed ? "error" : stopping ? "canceled" : remaining || counts.missing ? "warning" : "complete";
    importResult = error ? label : stopping ? `已取消 ${importDone}/${importTotal}` : remaining ? `${label} ${importDone}/${importTotal}`
      : counts.failed ? `${counts.failed} 个课时失败` : counts.missing ? `${counts.missing} 个课时无字幕`
      : counts.saved ? `已导入 ${counts.saved} 个课时` : counts.exists ? `已存在 ${counts.exists} 个课时` : label;
    importResultDetail = text;
    renderImportAction();
    importResultTimer = setTimeout(resetImportButton, 4800);
    return text;
  };
  const oldLoad = loadCourse;
  loadCourse = async function () {
    resetImportButton();
    setPreviewOpen(false);
    await oldLoad();
    if (!meta) return;
    const dialog = document.getElementById("source-dialog");
    if (dialog.open) dialog.close();
    pages.forEach(page => { page.selected = page.page === currentPage; });
    render();
    const page = pages.find(item => item.page === currentPage);
    if (page) await preview(page);
  };
  function openSource(focusFolder = false) {
    document.getElementById("source-status").textContent = "";
    document.getElementById("source-dialog").showModal();
    document.getElementById(focusFolder ? "folder" : "url").focus();
  }
  document.getElementById("source-open").addEventListener("click", () => openSource());
  document.getElementById("empty-load").addEventListener("click", () => openSource());
  document.getElementById("folder-edit").addEventListener("click", () => openSource(true));
  const workbenchPages = [
    ["catalog-page", "catalog-nav"], ["note-preferences-page", "workflow"],
    ["asr-dialog", "local-asr-settings"], ["settings-dialog", "settings"]
  ];
  function showWorkbenchPage(pageId) {
    for (const [id, navId] of workbenchPages) {
      document.getElementById(id).hidden = id !== pageId;
      const nav = document.getElementById(navId);
      nav.classList.toggle("active", id === pageId);
      if (id === pageId) nav.setAttribute("aria-current", "page");
      else nav.removeAttribute("aria-current");
    }
    document.getElementById("source-open").hidden = pageId !== "catalog-page";
  }
  window.WorkbenchPages = { show: showWorkbenchPage };
  window.NotePreferences.show = visible => showWorkbenchPage(visible === false ? "catalog-page" : "note-preferences-page");
  for (const feedback of document.querySelectorAll(".settings-feedback")) {
    const message = feedback.querySelector('[role="status"]');
    let feedbackTimer;
    const dismiss = () => { clearTimeout(feedbackTimer); feedback.hidden = true; };
    feedback.querySelector(".settings-feedback-close").addEventListener("click", dismiss);
    new MutationObserver(() => {
      clearTimeout(feedbackTimer);
      const text = message.textContent.replace(/。/g, "");
      if (message.textContent !== text) { message.textContent = text; return; }
      feedback.hidden = !message.textContent.trim();
      if (!feedback.hidden) feedbackTimer = setTimeout(dismiss, 4000);
    }).observe(message, { childList: true, characterData: true, subtree: true });
  }
  const oldRefreshSettings = refreshSettings;
  refreshSettings = async function () {
    await oldRefreshSettings();
    document.getElementById("connection-label").textContent = "连接配置";
    const state = document.getElementById("connection-state");
    state.textContent = savedSettings.hasApiKey ? "已配置" : "未配置";
    state.classList.toggle("is-ready", savedSettings.hasApiKey);
  };
  const oldAsrSetup = openAsrSetup;
  openAsrSetup = async function (result = null) {
    const connection = await oldAsrSetup(result);
    const state = document.getElementById("asr-state");
    state.textContent = connection.connected ? "已连接" : "未连接";
    state.classList.toggle("is-ready", connection.connected);
    document.getElementById("asr-connect").hidden = !connection.needsPairing;
    if (connection.needsPairing && !connection.error) document.getElementById("asr-settings-status").textContent = "";
    return connection;
  };
  document.getElementById("catalog-nav").addEventListener("click", () => window.NotePreferences.show(false));
  document.getElementById("local-asr-settings").addEventListener("click", () => openAsrSetup().catch(error => status(error.message, true)));
  // The original listener captures the existing function. Start the redesigned
  // read flow here so successful reads close the dialog and select the current P.
  document.getElementById("load").removeEventListener("click", oldLoad);
  document.getElementById("load").addEventListener("click", () => loadCourse().catch(error => status(error.message, true)));
  const start = async () => {
    if (!window.WorkbenchPreview) { await init(); return; }
    syncControls();
    await refreshSettings();
    if (window.WorkbenchPreview.scenario === "empty") return;
    document.getElementById("url").value = window.WorkbenchPreview.source;
    await loadCourse();
  };
  start().catch(error => status(error.message, true));
})();
