/* 笔记页的下拉菜单、按钮和自适应文本框。 */
window.createNoteControls = function (form) {
  const selects = new WeakMap();
  let selectId = 0;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function action(label, ariaLabel, handler) {
    const button = element("button", "text-button", label);
    button.type = "button"; button.setAttribute("aria-label", ariaLabel);
    button.addEventListener("click", handler);
    return button;
  }
  function positionSelectMenu(button, menu) {
    const anchor = button.getBoundingClientRect(), bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${anchor.bottom + bounds.height + 6 <= innerHeight - 8 ? anchor.bottom + 6 : Math.max(8, anchor.top - bounds.height - 6)}px`;
  }
  function decorateSelect(select) {
    if (selects.has(select)) { selects.get(select)(); return; }
    const control = element("div", "builder-select");
    if (select.classList.contains("builder-custom-value")) control.classList.add("builder-custom-value");
    const button = element("button", "builder-select-trigger");
    const label = select.id && form.querySelector(`label[for="${select.id}"]`);
    button.type = "button"; button.id = `${select.id || `builder-select-${++selectId}`}-trigger`;
    button.setAttribute("role", "combobox"); button.setAttribute("aria-haspopup", "listbox"); button.setAttribute("aria-expanded", "false");
    if (label) label.htmlFor = button.id;
    else button.setAttribute("aria-label", select.getAttribute("aria-label"));
    const text = element("span", "builder-select-value"), chevron = element("span", "icon icon-chevron");
    chevron.setAttribute("aria-hidden", "true"); button.append(text, chevron);
    const menu = element("div", "builder-select-menu");
    menu.id = `${button.id}-menu`; menu.setAttribute("popover", "auto"); menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", label?.textContent || select.getAttribute("aria-label")); button.setAttribute("aria-controls", menu.id);
    const options = [...select.options].map(option => {
      const item = element("button", "builder-select-option", option.textContent);
      item.type = "button"; item.setAttribute("role", "option"); item.disabled = option.disabled;
      item.setAttribute("aria-label", option.textContent);
      item.addEventListener("click", () => {
        menu.hidePopover(); select.value = option.value; select.dispatchEvent(new Event("change", { bubbles: true }));
        if (button.isConnected) button.focus({ preventScroll: true });
      });
      menu.append(item); return item;
    });
    const sync = () => {
      text.textContent = select.selectedOptions[0]?.textContent || "请选择"; button.disabled = select.disabled;
      options.forEach((item, index) => item.setAttribute("aria-selected", String(select.options[index].selected)));
    };
    function open() {
      menu.showPopover();
      positionSelectMenu(button, menu);
      (options.find(item => item.getAttribute("aria-selected") === "true") || options[0]).focus({ preventScroll: true });
    }
    button.addEventListener("click", () => menu.matches(":popover-open") ? menu.hidePopover() : open());
    button.addEventListener("keydown", event => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); open(); }
    });
    menu.addEventListener("toggle", event => button.setAttribute("aria-expanded", String(event.newState === "open")));
    menu.addEventListener("keydown", event => {
      const enabled = options.filter(item => !item.disabled), index = enabled.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        enabled[event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length].focus({ preventScroll: true });
      } else if (event.key === "Escape") { event.preventDefault(); menu.hidePopover(); button.focus({ preventScroll: true }); }
      else if (event.key === "Tab") menu.hidePopover();
    });
    select.before(control); select.hidden = true; control.append(select, button, menu);
    selects.set(select, sync); sync();
  }
  function resizeTextareas() {
    for (const textarea of form.querySelectorAll("textarea")) {
      if (!textarea.getClientRects().length) continue;
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight}px`;
    }
  }
  return { element, action, decorateSelect, positionSelectMenu, resizeTextareas };
};
