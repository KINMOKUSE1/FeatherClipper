/* 工作台入口：挂载各页面，再将明确的依赖传给功能控制器。 */
(() => {
  const ui = UiText.workbench, format = UiText.format;
  const assetBase = new URL(".", document.currentScript.src);
  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) {
      const error = new Error(I18n.error(response?.error) || ui.connectionLost);
      error.fatal = response?.fatal;
      throw error;
    }
    return response;
  }
  async function start() {
    await I18n.ready;
    await Preferences.init();
    const hosts = [...document.querySelectorAll("[data-page]")];
    const pages = await Promise.all(hosts.map(async host => {
      const response = await fetch(new URL(`${host.dataset.page}/page.html`, assetBase), { cache: "no-store" });
      if (!response.ok) throw new Error(format(ui.pageFailed, { page: host.dataset.page }));
      return response.text();
    }));
    hosts.forEach((host, index) => {
      const template = document.createElement("template");
      template.innerHTML = pages[index];
      host.replaceWith(template.content);
    });
    I18n.apply(document);
    let catalog;
    const { navigate } = createWorkbenchShell();
    const feedback = createWorkbenchFeedback({ isBusy: () => {
      const state = catalog?.getState();
      return Boolean(state?.running || state?.loading);
    } });
    const previewView = createSubtitlePreview();
    const importAction = createImportButton({ clearStatus: () => feedback.status(""), onActivate: () => {
      if (catalog.getState().running) catalog.stopImport();
      else catalog.runQueue(false).catch(error => feedback.status(error.message, true));
    } });
    const connection = createConnectionPage({ send, feedback, navigate, getCatalog: () => catalog });
    const transcription = createTranscriptionPage({ getCatalog: () => catalog, send, feedback, navigate, importAction, previewView });
    catalog = createCatalogPage({ send, feedback, previewView, importAction, connection, transcription });
    createHistoryPage({ catalog, feedback, navigate });
    createNotesPage({ catalog, feedback, navigate, assetBase });
    window.WorkbenchApp.loadCourse = catalog.loadCourse;
    await catalog.init();
  }
  window.WorkbenchApp = { ready: start().catch(error => {
    const message = document.getElementById("import-toast");
    message.textContent = error.message;
    message.hidden = false;
    throw error;
  }) };
})();
