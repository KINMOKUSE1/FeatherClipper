const SubtitleLanguage = (() => {
  const key = "course-cove-subtitle-language";
  async function create({ prefix = "language", batch = false, autoLabel = "自动（推荐）", onChange } = {}) {
    const root = document.getElementById(`${prefix}-picker`);
    const trigger = document.getElementById(`${prefix}-trigger`);
    const menu = document.getElementById(`${prefix}-options`);
    const label = document.getElementById(`${prefix}-label`);
    const defaults = batch ? [
      { value: "auto", label: autoLabel }, { value: "zh", label: "中文" }, { value: "en", label: "英文" }
    ] : [{ value: "auto", label: autoLabel }];
    let entries = defaults, selected = "auto", options = [], note = "";
    if (batch) {
      const stored = (await chrome.storage.local.get(key))[key];
      if (defaults.some(item => item.value === stored)) selected = stored;
    }
    const id = value => typeof value === "object" ? value.id : value;
    function close(focus = false) {
      menu.hidden = true; trigger.setAttribute("aria-expanded", "false");
      if (focus) trigger.focus();
    }
    function render() {
      label.textContent = entries.find(item => id(item.value) === id(selected))?.label
        || (typeof selected === "object" ? `${selected.lanDoc || selected.lan}（暂不可用）` : autoLabel);
      trigger.title = label.textContent;
      menu.replaceChildren();
      options = entries.map(entry => {
        const option = document.createElement("button");
        option.type = "button"; option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(id(entry.value) === id(selected)));
        option.textContent = entry.label;
        option.addEventListener("click", async () => {
          selected = entry.value; render(); close(true);
          if (batch) await chrome.storage.local.set({ [key]: selected });
          onChange?.(selected);
        });
        menu.append(option); return option;
      });
      if (note) {
        const message = document.createElement("p"); message.className = "language-note";
        message.textContent = note; message.setAttribute("role", "status"); menu.append(message);
      }
    }
    function tracks(values, choice = "auto", message = "") {
      entries = [...defaults, ...values.map(track => ({ value: track, label: track.lanDoc || track.lan }))];
      const matching = entries.find(item => id(item.value) === id(choice));
      selected = matching?.value || (choice && typeof choice === "object" ? choice : "auto");
      note = message || (!matching && typeof selected === "object" ? "所选字幕轨暂不可用，请重试或另选字幕轨。" : values.length ? "" : "平台未提供字幕轨。");
      close(); render();
    }
    render();
    trigger.addEventListener("click", () => {
      menu.hidden = !menu.hidden; trigger.setAttribute("aria-expanded", String(!menu.hidden));
      if (!menu.hidden) options.find(option => option.getAttribute("aria-selected") === "true")?.focus();
    });
    trigger.addEventListener("keydown", event => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault(); if (menu.hidden) trigger.click();
    });
    menu.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); close(true); return; }
      const index = options.indexOf(document.activeElement);
      const next = { ArrowDown: (index + 1) % options.length, ArrowUp: (index + options.length - 1) % options.length, Home: 0, End: options.length - 1 }[event.key];
      if (next !== undefined) { event.preventDefault(); options[next].focus(); }
    });
    document.addEventListener("pointerdown", event => { if (!root.contains(event.target)) close(); });
    root.addEventListener("focusout", event => { if (!root.contains(event.relatedTarget)) close(); });
    return { current: () => selected, tracks };
  }
  return { create };
})();
