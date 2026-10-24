/* Selection previews immediately; only confirmation writes the shared preference. */
(() => {
  const radios = [...document.querySelectorAll("[data-setup-locale]")];
  const confirm = document.getElementById("setup-continue");
  const status = document.getElementById("setup-status");
  function render() {
    for (const radio of radios) radio.checked = radio.dataset.setupLocale === I18n.locale;
  }
  for (const radio of radios) radio.addEventListener("change", () => I18n.setLocale(radio.dataset.setupLocale, false));
  I18n.subscribe(render);
  I18n.ready.then(render);
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    radios.forEach(radio => radio.disabled = true);
    status.textContent = "";
    try {
      await I18n.setLocale(I18n.locale);
      if (window.frameElement?.id === "popup-preview") {
        window.parent.postMessage({ type: "preview-language-complete", locale: I18n.locale }, new URL(document.baseURI).origin);
      } else location.replace(chrome.runtime.getURL("popup/index.html"));
    } catch {
      status.textContent = I18n.t("语言设置保存失败，请重试");
      status.classList.add("error");
      confirm.disabled = false;
      radios.forEach(radio => radio.disabled = false);
    }
  });
})();
