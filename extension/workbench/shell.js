/* 页面切换和侧栏选中状态。 */
window.createWorkbenchShell = function () {
  const workbenchPages = [
    ["catalog-page", "catalog-nav"], ["history-page", "history-nav"], ["note-preferences-page", "notes-nav"],
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
  document.getElementById("catalog-nav").addEventListener("click", () => showWorkbenchPage("catalog-page"));
  const footer = document.querySelector(".sidebar-footer");
  const controls = createNoteControls(footer);
  const select = document.getElementById("interface-language");
  const syncLanguage = () => {
    controls.decorateSelect(select);
    const trigger = footer.querySelector(".builder-select-trigger");
    if (!trigger.querySelector(".sidebar-language-icon")) {
      const icon = document.createElement("span");
      icon.className = "sidebar-language-icon"; icon.setAttribute("aria-hidden", "true");
      trigger.prepend(icon);
    }
    footer.querySelector(".builder-select-menu").style.minWidth = `${trigger.getBoundingClientRect().width}px`;
  };
  syncLanguage();
  UiText.i18n.subscribe(syncLanguage);
  function closeLanguageMenu() {
    const menu = select.parentElement.querySelector(":popover-open");
    if (menu) menu.hidePopover();
  }
  document.querySelector(".sidebar").addEventListener("scroll", closeLanguageMenu);
  window.addEventListener("resize", () => { closeLanguageMenu(); syncLanguage(); });
  return { navigate: showWorkbenchPage };
};
