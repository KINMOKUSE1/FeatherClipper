/* Only the first popup visit asks for a language. Preview scenarios stay explicit. */
(() => {
  if (window.frameElement?.id === "popup-preview") {
    document.documentElement.classList.remove("popup-routing");
    window.PopupLanguageReady = Promise.resolve(true);
    return;
  }
  const showSetup = () => {
    location.replace(new URL("first-run.html", document.baseURI).href);
    return false;
  };
  window.PopupLanguageReady = chrome.storage.local.get("featherclipper:ui-locale").then(stored => {
    if (!["zh-CN", "en", "zh-TW"].includes(stored["featherclipper:ui-locale"])) return showSetup();
    document.documentElement.classList.remove("popup-routing");
    return true;
  }, showSetup);
})();
