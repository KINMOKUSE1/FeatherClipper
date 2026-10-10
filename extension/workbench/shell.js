/* 页面切换和侧栏选中状态。 */
window.createWorkbenchShell = function () {
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
  document.getElementById("catalog-nav").addEventListener("click", () => showWorkbenchPage("catalog-page"));
  return { navigate: showWorkbenchPage };
};
