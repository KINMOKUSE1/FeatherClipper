/* 字幕面板的展开、收起、动画和提示。 */
window.createSubtitlePreview = function () {
  const ui = UiText.catalog;
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
        row.querySelector(".part-title").title = ui.openPreview;
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
  function previewMessage(text, error = false) {
    const message = document.createElement("p");
    message.className = `preview-message${error ? " error" : ""}`;
    message.setAttribute("role", "status");
    message.textContent = text;
    document.getElementById("preview-body").replaceChildren(message);
  }
  return { isOpen: () => previewOpen, open: setPreviewOpen, close: closePreview, message: previewMessage };
};
