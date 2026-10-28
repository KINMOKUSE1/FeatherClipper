/* 导入按钮的进度和状态动画；由课程队列传入状态。 */
window.createImportButton = function ({ onActivate, clearStatus }) {
  const ui = UiText.importButton, format = UiText.format;
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
  let importState = "idle", importDone = 0, importTotal = 0, importPhase = ui.phase, importResult = "", importResultDetail = null;
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
  let stopping = false;
  function renderImportAction(state = { stopping }) {
    stopping = state.stopping;
    const buttonState = importState === "running" && stopping ? "stopping" : importState;
    const busy = buttonState === "running" || buttonState === "stopping";
    const text = busy ? stopping ? ui.stopping : format(ui.running, { phase: UiText.i18n.error(importPhase) })
      : buttonState === "idle" ? ui.idle : UiText.i18n.error(importResult);
    const stateKey = `${buttonState}:${text}`;
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
    importButton.dataset.state = buttonState;
    buttonContent.dataset.state = buttonState;
    buttonCount.hidden = !busy;
    const countText = `${importDone}/${importTotal}`;
    const countChanged = buttonCount.textContent !== countText;
    buttonCount.textContent = countText;
    buttonFill.style.transform = `scaleX(${importTotal ? importDone / importTotal : 0})`;
    buttonIcon.textContent = "";
    buttonIcon.className = buttonState === "running" ? "import-button-spinner"
      : ["stopping", "canceled"].includes(buttonState) ? "import-button-cancel"
      : buttonState === "complete" ? "import-button-check"
      : ["warning", "error"].includes(buttonState) ? "import-button-result" : "icon icon-save";
    if (["warning", "error"].includes(buttonState)) buttonIcon.textContent = "!";
    if (buttonLabel.textContent !== text) buttonLabel.textContent = text;
    const detail = resultDetail();
    importButton.setAttribute("aria-label", busy
      ? format(ui.progressLabel, { text, done: importDone, total: importTotal, cancel: stopping ? "" : ui.cancelSuffix }) : detail || text);
    importButton.setAttribute("aria-busy", String(busy));
    importButton.title = busy ? stopping ? ui.stoppingHint : ui.cancelHint : detail;
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
    if (importState === "running" && stopping) return;
    animateButtonPress();
    onActivate();
  });
  function resetImportButton() {
    clearTimeout(importResultTimer);
    importState = "idle"; importDone = 0; importTotal = 0; importResult = ""; importResultDetail = null;
    renderImportAction();
  }
  function setImportProgress(done, total, phase = ui.phase) {
    clearTimeout(importResultTimer);
    importState = "running"; importDone = done; importTotal = total; importPhase = phase;
    importResult = ""; importResultDetail = null;
    renderImportAction();
  }
  function resultDetail() {
    if (!importResultDetail) return "";
    const { label, counts, remaining, error, detail } = importResultDetail;
    const summary = [[ui.summarySaved, counts.saved], [ui.summaryExists, counts.exists], [ui.summaryMissing, counts.missing], [ui.summaryFailed, counts.failed], [ui.summaryRemaining, remaining]]
      .filter(([, count]) => count > 0).map(([name, count]) => `${name} ${count}`);
    return [[UiText.i18n.error(label), ...summary].join(" · "), UiText.i18n.error(error), UiText.i18n.error(detail)].filter(Boolean).join("\n");
  }
  function reportImportResult(label, counts, remaining, error = null, detail = "", canceled = false) {
    if (canceled && !error) label = ui.canceled;
    clearStatus();
    importState = error || counts.failed ? "error" : canceled ? "canceled" : remaining || counts.missing ? "warning" : "complete";
    importResult = error ? label : canceled ? format(ui.canceledCount, { done: importDone, total: importTotal }) : remaining ? `${label} ${importDone}/${importTotal}`
      : counts.failed ? format(ui.failedCount, { count: counts.failed }) : counts.missing ? format(ui.missingCount, { count: counts.missing })
      : counts.saved ? format(ui.savedCount, { count: counts.saved }) : counts.exists ? format(ui.existsCount, { count: counts.exists }) : label;
    importResultDetail = { label, counts: { ...counts }, remaining, error: error?.message, detail };
    renderImportAction();
    importResultTimer = setTimeout(resetImportButton, 4800);
    return resultDetail();
  }
  return { render: renderImportAction, reset: resetImportButton, progress: setImportProgress, result: reportImportResult };
};
