/* Layout bridge for the new preview; the course operations remain in course.js. */
(() => {
  if (!window.WorkbenchPreview) {
    const toast = document.getElementById("import-toast");
    toast.textContent = "请打开 workbench-preview.html 使用开发预览。";
    toast.hidden = false;
    return;
  }
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
    for (const id of ["source-open", "empty-load", "folder-edit", "local-asr-settings"]) document.getElementById(id).disabled = running || loading;
    document.getElementById("retry").hidden = !pages.some(page => page.selected && ["failed", "missing"].includes(page.status));
  };
  const oldRender = render;
  render = function () {
    oldRender();
    if (!meta) return;
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
    const icon = document.createElement("span");
    icon.className = "icon icon-save";
    icon.setAttribute("aria-hidden", "true");
    document.getElementById("start").replaceChildren(icon, document.createTextNode("导入 Obsidian"));
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
      const aboveBar = document.getElementById("course").hidden ? 24 : window.innerHeight - bar.getBoundingClientRect().top + 12;
      importToast.style.bottom = `${Math.max(24, aboveBar)}px`;
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        importToast.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 180, easing: "ease-out" });
      }
    });
    toastTimer = setTimeout(() => { importToast.hidden = true; importToast.textContent = ""; }, 5000);
  }
  const oldImportResult = reportImportResult;
  reportImportResult = function (label, counts, remaining, error = null, detail = "") {
    const text = oldImportResult(label, counts, remaining, error, detail);
    status("");
    document.getElementById("progress").hidden = true;
    showToast(text, Boolean(error) || Boolean(counts.failed));
  };
  const oldLoad = loadCourse;
  loadCourse = async function () {
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
  document.getElementById("catalog-nav").addEventListener("click", () => window.NotePreferences.show(false));
  document.getElementById("local-asr-settings").addEventListener("click", () => openAsrSetup().catch(error => status(error.message, true)));
  // The original listener captures the existing function. Start the redesigned
  // read flow here so successful reads close the dialog and select the current P.
  document.getElementById("load").removeEventListener("click", oldLoad);
  document.getElementById("load").addEventListener("click", () => loadCourse().catch(error => status(error.message, true)));
  const start = async () => {
    await refreshSettings();
    if (window.WorkbenchPreview.scenario === "empty") return;
    document.getElementById("url").value = window.WorkbenchPreview.source;
    await loadCourse();
  };
  start().catch(error => status(error.message, true));
})();
