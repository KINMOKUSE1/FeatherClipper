const SubtitleLanguage = (() => {
  const names = { auto: "自动 · 中文优先", zh: "中文", en: "英文" };
  const key = "course-cove-subtitle-language";
  let selected = "auto";
  function current() { return selected; }
  async function init(onChange) {
    const root = document.getElementById("language-picker");
    const trigger = document.getElementById("language-trigger");
    const menu = document.getElementById("language-options");
    const label = document.getElementById("language-label");
    const options = [...menu.querySelectorAll("[data-language]")];
    function close(focus = false) {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (focus) trigger.focus();
    }
    function render() {
      label.textContent = names[selected];
      for (const option of options) option.setAttribute("aria-selected", String(option.dataset.language === selected));
    }
    const stored = (await chrome.storage.local.get(key))[key];
    if (names[stored]) selected = stored;
    render();
    trigger.addEventListener("click", () => {
      menu.hidden = !menu.hidden;
      trigger.setAttribute("aria-expanded", String(!menu.hidden));
      if (!menu.hidden) options.find(option => option.dataset.language === selected)?.focus();
    });
    trigger.addEventListener("keydown", event => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault(); trigger.click();
    });
    for (const option of options) option.addEventListener("click", async () => {
      selected = option.dataset.language; render(); close(true);
      await chrome.storage.local.set({ [key]: selected });
      onChange?.();
    });
    menu.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); close(true); return; }
      const index = options.indexOf(document.activeElement);
      const next = { ArrowDown: (index + 1) % options.length, ArrowUp: (index + options.length - 1) % options.length, Home: 0, End: options.length - 1 }[event.key];
      if (next !== undefined) { event.preventDefault(); options[next].focus(); }
    });
    document.addEventListener("pointerdown", event => { if (!root.contains(event.target)) close(); });
    root.addEventListener("focusout", event => { if (!root.contains(event.relatedTarget)) close(); });
  }
  return { current, init };
})();
