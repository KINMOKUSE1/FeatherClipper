/* Navigation, feedback and animations for the workbench. */
const workspace = document.querySelector(".workspace");
const previewPanel = document.getElementById("preview-panel");
let previewOpen = !previewPanel.hidden;
let panelAnimation = null;
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
  }
  const finish = () => {
    panelAnimation = null;
    if (!previewOpen) {
      previewPanel.hidden = true;
      workspace.classList.remove("preview-open");
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
function renderImportAction() {
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
}
importButton.addEventListener("click", () => {
  if (stopping) return;
  animateButtonPress();
  if (running) stopImport();
  else runQueue(false).catch(error => status(error.message, true));
});
function resetImportButton() {
  clearTimeout(importResultTimer);
  importState = "idle"; importDone = 0; importTotal = 0; importResult = ""; importResultDetail = "";
  renderImportAction();
}
function setImportProgress(done, total, phase = "导入") {
  clearTimeout(importResultTimer);
  importState = "running"; importDone = done; importTotal = total; importPhase = phase;
  importResult = ""; importResultDetail = "";
  renderImportAction();
}
function status(text, error = false) {
  const sourceOpen = document.getElementById("source-dialog").open;
  document.getElementById("source-status").textContent = sourceOpen ? text : "";
  document.getElementById("source-status").classList.toggle("error", error);
  if (text && !sourceOpen && !running && !loading) showToast(text, error);
}
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
function reportImportResult(label, counts, remaining, error = null, detail = "") {
  if (stopping && !error) label = "已取消";
  const summary = [["新导入", counts.saved], ["已存在", counts.exists], ["无字幕", counts.missing], ["失败", counts.failed], ["未处理", remaining]]
    .filter(([, count]) => count > 0).map(([name, count]) => `${name} ${count}`);
  const text = [[label, ...summary].join(" · "), error?.message, detail].filter(Boolean).join("\n");
  status("");
  importState = error || counts.failed ? "error" : stopping ? "canceled" : remaining || counts.missing ? "warning" : "complete";
  importResult = error ? label : stopping ? `已取消 ${importDone}/${importTotal}` : remaining ? `${label} ${importDone}/${importTotal}`
    : counts.failed ? `${counts.failed} 个课时失败` : counts.missing ? `${counts.missing} 个课时无字幕`
    : counts.saved ? `已导入 ${counts.saved} 个课时` : counts.exists ? `已存在 ${counts.exists} 个课时` : label;
  importResultDetail = text;
  renderImportAction();
  importResultTimer = setTimeout(resetImportButton, 4800);
  return text;
}
function openSource(focusFolder = false) {
  document.getElementById("source-status").textContent = "";
  document.getElementById("source-dialog").showModal();
  document.getElementById(focusFolder ? "folder" : "url").focus();
}
document.getElementById("source-open").addEventListener("click", () => openSource());
document.getElementById("empty-load").addEventListener("click", () => openSource());
document.getElementById("folder-edit").addEventListener("click", () => openSource(true));
const workbenchPages = [
  ["catalog-page", "catalog-nav"], ["note-preferences-page", "notes-nav"],
  ["asr-page", "local-asr-settings"], ["connection-page", "settings"]
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
const settingsFeedbackTimers = new Map();
function dismissSettingsFeedback(message) {
  clearTimeout(settingsFeedbackTimers.get(message.id));
  settingsFeedbackTimers.delete(message.id);
  message.closest(".settings-feedback").hidden = true;
}
function showSettingsFeedback(id, text) {
  const message = document.getElementById(id);
  dismissSettingsFeedback(message);
  message.textContent = text.replace(/。/g, "");
  if (!message.textContent.trim()) return;
  message.closest(".settings-feedback").hidden = false;
  settingsFeedbackTimers.set(id, setTimeout(() => dismissSettingsFeedback(message), 4000));
}
for (const feedback of document.querySelectorAll(".settings-feedback")) {
  const message = feedback.querySelector('[role="status"]');
  feedback.querySelector(".settings-feedback-close").addEventListener("click", () => dismissSettingsFeedback(message));
}
document.getElementById("catalog-nav").addEventListener("click", () => showWorkbenchPage("catalog-page"));
document.getElementById("local-asr-settings").addEventListener("click", () => openAsrSetup().catch(error => status(error.message, true)));
const workbenchReady = init().catch(error => status(error.message, true));
