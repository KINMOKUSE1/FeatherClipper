/* Configurable course-notes editor and task delivery. */
(() => {
  const core = window.SkillBuilder;
  const storageKey = "course-cove:skill-builder:v1";
  const deliveryKey = "course-cove:notes-delivery:v1";
  const installationKey = "course-cove:notes-installed:v1";
  const get = id => document.getElementById(id);
  const form = get("skill-builder-form");
  const resourceBase = new URL(".", document.currentScript.src);
  let resources;
  let config = core.defaults(), delivery = core.deliveryDefaults(), loaded = false;
  let installedSnapshot = localStorage.getItem(installationKey), directory = null, exportedWeb = null;
  let previewFiles = [], previewPath = "SKILL.md";
  let uploadedMaterials = [], uploadedReferences = [];
  const fields = ["goal", "language", "granularity", "folder", "naming", "links", "instructions"];
  const deliveryFields = ["environment", "task", "reference", "question", "paths", "format"];
  const toggles = ["external", "progress"];
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
  function read() {
    for (const name of fields) config[name] = get(`builder-${name}`).value;
    for (const name of toggles) config[name] = get(`builder-${name}`).checked;
    for (const name of deliveryFields) delivery[name] = get(`builder-${name}`).value;
    return config;
  }
  function skillSnapshot() { return JSON.stringify(core.buildFiles(config, resources)); }
  function webSnapshot() {
    return JSON.stringify({ files: core.buildFiles(config, resources), delivery, course: meta?.bvid || null,
      selected: pages.filter(page => page.selected).map(page => [page.cid, page.chapter, page.part]), uploadedMaterials, uploadedReferences });
  }
  function ready() { try { return installedSnapshot === skillSnapshot(); } catch { return false; } }
  function updateDelivery() {
    const web = delivery.environment === "web", reference = ["supplement", "continue", "review"].includes(delivery.task);
    const requiredReference = ["supplement", "continue"].includes(delivery.task);
    get("builder-install").hidden = web;
    get("builder-export-web").hidden = !web;
    for (const id of ["paths"]) {
      get(`builder-${id}-row`).hidden = web; get(`builder-${id}`).disabled = web;
    }
    get("builder-reference-row").hidden = web || !reference;
    get("builder-reference").disabled = web || !reference; get("builder-reference").required = !web && requiredReference;
    get("builder-question-row").hidden = delivery.task !== "review";
    get("builder-question").disabled = delivery.task !== "review"; get("builder-question").required = delivery.task === "review";
    for (const id of ["web-materials", "format"]) {
      get(`builder-${id}-row`).hidden = !web; get(`builder-${id}`).disabled = !web;
    }
    get("builder-web-reference-row").hidden = !web || !reference;
    get("builder-web-reference").disabled = !web || !reference;
    get("builder-web-reference").required = web && requiredReference && !uploadedReferences.length;
    get("builder-environment-help").textContent = web ? "导出实际素材和规则，上传给网页 AI 后执行" : "agent 读取本地素材，已安装技能时使用简短任务指令";
    const hints = { notes: "整理所选课时或提供的文件", supplement: "把新增内容合入实际提供的原笔记", continue: "核对已有记录，只继续本次范围的未完成部分", translate: "按笔记语言翻译字幕，保留原文与时间定位", review: "结合课程或已有笔记回答本次问题" };
    get("builder-task-help").textContent = hints[delivery.task];
    const state = get("builder-install-state"), isReady = ready();
    state.dataset.state = isReady ? "ready" : installedSnapshot ? "dirty" : "missing";
    state.textContent = isReady ? "✓ 已安装" : installedSnapshot ? "待同步" : "未安装";
    get("builder-install-title").textContent = isReady ? "技能已就绪" : installedSnapshot ? "配置有更新" : "先安装技能";
    get("builder-install-next").textContent = isReady ? "下一步：复制任务指令，交给本地 agent" : installedSnapshot ? "同步当前配置后，再复制任务指令" : "安装一次，之后用简短指令调用 course-notes";
    get("builder-confirm-installed").checked = isReady;
    const supported = typeof window.parent.showDirectoryPicker === "function";
    const main = get("builder-install-actions"), utility = get("builder-install-utility"), manual = get("builder-manual-install");
    const sync = get("builder-sync"), downloadButton = get("builder-download"), installPrompt = get("builder-install-prompt");
    const copyButton = get("copy-study-prompt"), previewButton = get("builder-preview-task");
    // Keep one real control for each action while placing it at the relevant step.
    const place = (button, container, className) => {
      if (button.parentElement !== container) container.append(button);
      button.className = className;
    };
    sync.hidden = !supported;
    sync.disabled = !supported;
    sync.textContent = isReady ? directory ? "同步到已选目录" : "同步到目录" : installedSnapshot ? "同步当前配置" : "选择目录并同步";
    sync.title = "选择 agent 的 skills 目录或 course-notes 文件夹，写入并核对当前 7 个文件";
    downloadButton.textContent = !isReady && installedSnapshot ? "下载更新包" : "下载技能包";
    place(sync, isReady ? utility : main, isReady ? "text-button" : "builder-install-primary");
    place(downloadButton, isReady ? utility : main, isReady ? "text-button" : supported ? "builder-install-secondary" : "builder-install-primary");
    place(installPrompt, isReady ? utility : manual, "text-button");
    place(copyButton, web ? get("note-preferences-page").querySelector(".configuration-actions") : main, web ? "text-button" : "builder-install-primary");
    place(previewButton, web ? get("builder-web-preview") : main, web ? "text-button" : "builder-install-secondary");
    copyButton.hidden = previewButton.hidden = !web && !isReady;
    copyButton.textContent = web ? "复制任务指令" : "复制任务指令 ↗";
    previewButton.textContent = web ? "预览本次任务指令" : "预览指令";
    utility.hidden = !isReady; manual.hidden = isReady;
    get("builder-install-caption").textContent = isReady ? "修改整理规则后，先同步技能，再复制指令" : supported ? "下载技能包后，完成安装再勾选确认" : "当前浏览器不支持目录写入，下载技能包并安装后勾选确认";
    get("builder-delivery-guide").hidden = get("builder-web-preview").hidden = !web;
    let webReady = false;
    try { webReady = exportedWeb?.snapshot === webSnapshot(); } catch {}
    get("builder-delivery-guide").textContent = webReady ? "材料已按当前设置导出，上传后粘贴配套任务指令" : "先导出网页材料，再上传文件并复制配套指令；不需要连接 Obsidian";
  }
  function renderFileList(files, selected = previewPath) {
    previewFiles = files; previewPath = files.some(file => file.path === selected) ? selected : files[0].path;
    get("builder-file-list").replaceChildren(...files.map(file => {
      const button = action(file.path, `查看 ${file.path}`, () => renderFileList(previewFiles, file.path));
      button.setAttribute("aria-current", String(file.path === previewPath)); return button;
    }));
    get("builder-file-name").textContent = previewPath;
    get("builder-source").textContent = files.find(file => file.path === previewPath).content;
  }
  function refreshPreview() {
    read(); updateDelivery();
    const enabled = config.modules.filter(item => item.enabled).length;
    get("builder-module-count").textContent = `${enabled} / ${config.modules.length} 已启用`;
    form.querySelectorAll("select").forEach(decorateSelect);
    resizeTextareas();
    try { renderFileList(core.buildFiles(config, resources)); }
    catch (error) { get("builder-source").textContent = error.message; }
  }
  let draggedModule = null;
  function moveModule(item, next) {
    const index = config.modules.indexOf(item);
    if (index < 0 || next < 0 || next >= config.modules.length || index === next) return;
    config.modules.splice(index, 1); config.modules.splice(next, 0, item);
    renderModules(next); refreshPreview();
  }
  function renderModules(focusIndex) {
    const container = get("builder-modules");
    container.replaceChildren();
    config.modules.forEach((item, index) => {
      const row = element("div", `builder-module${item.enabled ? "" : " is-disabled"}`);
      const top = element("div", "builder-module-top");
      const grip = action("⠿", `拖动${item.title || "自定义模块"}调整顺序`, () => openMenu());
      grip.classList.add("builder-module-grip"); grip.draggable = true;
      grip.addEventListener("dragstart", event => {
        draggedModule = item; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id);
      });
      grip.addEventListener("dragend", () => {
        draggedModule = null; container.querySelectorAll(".is-drop-target").forEach(node => node.classList.remove("is-drop-target"));
      });
      row.addEventListener("dragover", event => {
        if (draggedModule && draggedModule !== item) { event.preventDefault(); row.classList.add("is-drop-target"); }
      });
      row.addEventListener("dragleave", event => { if (!row.contains(event.relatedTarget)) row.classList.remove("is-drop-target"); });
      row.addEventListener("drop", event => {
        if (!draggedModule) return;
        event.preventDefault(); const source = draggedModule; draggedModule = null;
        moveModule(source, config.modules.indexOf(item));
      });
      const label = element("label", "builder-check");
      const check = element("input"); check.type = "checkbox"; check.checked = item.enabled;
      check.setAttribute("aria-label", `启用${item.title || "自定义模块"}`);
      const title = item.custom ? element("input", "builder-module-name") : element("h3", "builder-module-title", item.title);
      if (item.custom) {
        title.value = item.title; title.placeholder = "模块名称"; title.required = item.enabled;
        title.setAttribute("aria-label", "自定义模块名称");
        title.addEventListener("input", () => { item.title = title.value; refreshPreview(); });
      }
      label.append(check);
      const off = element("span", "builder-module-off", "未启用"); off.hidden = item.enabled;
      const trigger = action("⋯", `${item.title || "自定义模块"}的操作`, () => controls.matches(":popover-open") ? controls.hidePopover() : openMenu());
      trigger.classList.add("builder-module-menu-trigger");
      const controls = element("div", "builder-module-actions");
      controls.id = `builder-module-actions-${index}`; controls.setAttribute("popover", "auto"); controls.setAttribute("role", "menu");
      controls.setAttribute("aria-label", `${item.title || "自定义模块"}的操作`);
      trigger.setAttribute("aria-haspopup", "menu"); trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-controls", controls.id);
      function openMenu() {
        controls.showPopover(); positionSelectMenu(trigger, controls);
        controls.querySelector("button:not(:disabled)").focus({ preventScroll: true });
      }
      const move = direction => { controls.hidePopover(); moveModule(item, config.modules.indexOf(item) + direction); };
      const up = action("上移", `上移${item.title}`, () => move(-1)); up.disabled = index === 0;
      const down = action("下移", `下移${item.title}`, () => move(1)); down.disabled = index === config.modules.length - 1;
      controls.append(up, down);
      if (item.custom) controls.append(action("删除", "删除自定义模块", () => { controls.hidePopover(); config.modules.splice(index, 1); renderModules(); refreshPreview(); get("builder-add-module").focus(); }));
      else controls.append(action("恢复默认", `恢复${item.title}默认写法`, () => {
        controls.hidePopover(); trigger.focus({ preventScroll: true });
        item.writing = core.modules.find(module => module.id === item.id).writing;
        textarea.value = item.writing; refreshPreview();
        showSettingsFeedback("note-status", `已恢复“${item.title}”的默认写法`);
      }));
      controls.querySelectorAll("button").forEach(button => button.setAttribute("role", "menuitem"));
      controls.addEventListener("toggle", event => trigger.setAttribute("aria-expanded", String(event.newState === "open")));
      controls.addEventListener("keydown", event => {
        const buttons = [...controls.querySelectorAll("button:not(:disabled)")], active = buttons.indexOf(document.activeElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (active + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus({ preventScroll: true });
        } else if (event.key === "Escape") { event.preventDefault(); controls.hidePopover(); trigger.focus({ preventScroll: true }); }
        else if (event.key === "Tab") controls.hidePopover();
      });
      top.append(grip, title, off, label, trigger, controls);
      const textarea = element("textarea"); textarea.rows = 1; textarea.value = item.writing; textarea.required = item.enabled;
      textarea.setAttribute("aria-label", `${item.title || "自定义模块"}写法`);
      textarea.addEventListener("input", () => { item.writing = textarea.value; refreshPreview(); });
      check.addEventListener("change", () => {
        item.enabled = check.checked; row.classList.toggle("is-disabled", !item.enabled);
        textarea.required = item.enabled; off.hidden = item.enabled;
        if (item.custom) title.required = item.enabled;
        refreshPreview();
      });
      row.append(top, textarea); container.append(row);
      if (focusIndex === index) check.focus();
    });
  }
  function renderProperties() {
    const container = get("builder-properties"); container.replaceChildren();
    config.properties.forEach(item => {
      const row = element("div", `builder-property${item.enabled ? "" : " is-disabled"}`);
      row.dataset.type = item.type;
      const check = element("input", "builder-enable"); check.type = "checkbox"; check.checked = item.enabled;
      check.id = `builder-property-${item.name}`; check.setAttribute("aria-label", `输出 ${item.name} 属性`);
      const label = element("label", "builder-property-name", item.name); label.htmlFor = check.id;
      const hint = item.fixed ? item.name === "author" ? "你的署名 · 留空省略" : "固定标签 · 逗号分隔" : "自动填写";
      const icon = element("span", "icon property-type-icon"); icon.setAttribute("aria-hidden", "true"); icon.title = `${core.types[item.type]} · ${hint}`;
      const value = element("input");
      value.value = item.fixed ? item.value : item.rule; value.disabled = !item.enabled;
      value.required = item.enabled && !item.fixed;
      value.setAttribute("aria-label", `${item.name}${item.fixed ? "属性值" : "填写规则"}`);
      value.title = `${core.types[item.type]} · ${hint}`;
      if (item.name === "author") value.placeholder = "你的署名 · 留空省略";
      value.addEventListener("input", () => { item[item.fixed ? "value" : "rule"] = value.value; refreshPreview(); });
      check.addEventListener("change", () => {
        item.enabled = check.checked; value.disabled = !item.enabled; value.required = item.enabled && !item.fixed;
        row.classList.toggle("is-disabled", !item.enabled); refreshPreview();
      });
      row.append(check, icon, label, value); container.append(row);
    });
  }
  function renderCustomProperties() {
    const container = get("builder-custom-properties");
    container.hidden = !config.customProperties.length; container.replaceChildren();
    config.customProperties.forEach((item, index) => {
      const row = element("div", "builder-property builder-custom-property");
      const name = element("input"); name.value = item.name; name.placeholder = "属性名"; name.required = true;
      name.setAttribute("aria-label", "自定义属性名称");
      name.addEventListener("input", () => { item.name = name.value.trim(); refreshPreview(); });
      const type = element("select"); type.setAttribute("aria-label", "自定义属性类型");
      for (const [key, label] of Object.entries(core.types)) type.add(new Option(label, key));
      type.value = item.type;
      const value = element(item.type === "boolean" ? "select" : "input", "builder-custom-value");
      value.setAttribute("aria-label", "自定义属性值");
      if (item.type === "boolean") { value.add(new Option("否", "false")); value.add(new Option("是", "true")); }
      else { value.type = item.type === "date" ? "date" : item.type === "number" ? "number" : "text"; if (item.type === "number") value.step = "any"; }
      value.value = item.value; value.placeholder = item.type === "list" ? "逗号分隔" : "属性值";
      value.required = ["number", "date"].includes(item.type);
      value.addEventListener("input", () => { item.value = value.value; refreshPreview(); });
      type.addEventListener("change", () => { item.type = type.value; item.value = item.type === "boolean" ? "false" : ""; renderCustomProperties(); refreshPreview(); });
      const remove = action("×", "删除自定义属性", () => { config.customProperties.splice(index, 1); renderCustomProperties(); refreshPreview(); get("builder-add-property").focus(); });
      row.append(name, type, value, remove); container.append(row);
    });
  }
  async function load() {
    if (loaded) return;
    if (!resources) {
      const responses = await Promise.all(["skill-builder-workflow.md", "skill-builder-tasks.md"].map(file => fetch(new URL(file, resourceBase))));
      if (responses.some(response => !response.ok)) throw new Error("整理规则读取失败，请重新打开工作台");
      const [workflow, tasks] = await Promise.all(responses.map(response => response.text()));
      resources = { workflow, tasks };
    }
    const saved = localStorage.getItem(storageKey);
    if (saved) config = { ...core.defaults(), ...JSON.parse(saved) };
    const savedDelivery = localStorage.getItem(deliveryKey);
    if (savedDelivery) delivery = { ...core.deliveryDefaults(), ...JSON.parse(savedDelivery) };
    for (const name of fields) get(`builder-${name}`).value = config[name];
    for (const name of toggles) get(`builder-${name}`).checked = config[name];
    for (const name of deliveryFields) get(`builder-${name}`).value = delivery[name];
    renderModules(); renderProperties(); renderCustomProperties(); refreshPreview();
    loaded = true;
    document.fonts.ready.then(resizeTextareas);
  }
  async function save() {
    core.validate(read());
    localStorage.setItem(storageKey, JSON.stringify(config));
    localStorage.setItem(deliveryKey, JSON.stringify(delivery));
    return config;
  }
  let formWidth = 0;
  new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (width !== formWidth) { formWidth = width; resizeTextareas(); }
  }).observe(form);
  get("note-preferences-page").querySelector(".settings-scroll").addEventListener("scroll", () => {
    for (const menu of form.querySelectorAll(".builder-select-menu:popover-open, .builder-module-actions:popover-open")) positionSelectMenu(menu.previousElementSibling, menu);
  });
  for (const eventName of ["input", "change"]) form.addEventListener(eventName, event => {
    if (event.target.id !== "builder-confirm-installed") refreshPreview();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    try { await save(); updateDelivery(); showSettingsFeedback("note-status", delivery.environment === "web" ? "设置已保存，导出网页材料后使用" : "设置已保存，请按当前安装状态同步技能"); }
    catch (error) { showSettingsFeedback("note-status", error.message); }
  });
  get("builder-add-module").addEventListener("click", () => {
    config.modules.push({ id: `custom-${crypto.randomUUID()}`, custom: true, title: "", writing: "", enabled: true });
    renderModules(); refreshPreview(); get("builder-modules").lastElementChild.querySelector(".builder-module-name").focus();
  });
  get("builder-add-property").addEventListener("click", () => {
    config.customProperties.push({ name: "", type: "text", value: "" });
    renderCustomProperties(); refreshPreview(); get("builder-custom-properties").lastElementChild.querySelector("input").focus();
  });
  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type })), link = element("a");
    link.href = url; link.download = name; document.body.append(link); link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 30000);
  }
  get("builder-download").addEventListener("click", async () => {
    try {
      await save();
      const files = core.buildFiles(config, resources);
      download(core.zip(files.map(file => ({ ...file, path: `course-notes/${file.path}` }))), "course-notes.zip", "application/zip");
      updateDelivery();
      showSettingsFeedback("note-status", "技能包已生成，安装后再确认当前配置");
    } catch (error) { showSettingsFeedback("note-status", error.message); }
  });
  get("builder-confirm-installed").addEventListener("change", event => {
    try {
      read(); installedSnapshot = event.target.checked ? skillSnapshot() : null;
      if (installedSnapshot) localStorage.setItem(installationKey, installedSnapshot); else localStorage.removeItem(installationKey);
      updateDelivery();
    } catch (error) { event.target.checked = false; showSettingsFeedback("note-status", error.message); }
  });
  get("builder-sync").addEventListener("click", async () => {
    const button = get("builder-sync");
    try {
      const files = core.buildFiles(read(), resources), snapshot = JSON.stringify(files);
      const selected = directory || await window.parent.showDirectoryPicker({ mode: "readwrite", id: "course-cove-skills" });
      directory = selected.name === "course-notes" ? selected : await selected.getDirectoryHandle("course-notes", { create: true });
      installedSnapshot = null; localStorage.removeItem(installationKey); button.disabled = true;
      await core.writeFiles(directory, files);
      installedSnapshot = snapshot; localStorage.setItem(installationKey, snapshot); await save(); updateDelivery();
      showSettingsFeedback("note-status", "7 个技能文件已写入并核对，可以在 agent 中调用 course-notes");
    } catch (error) { if (error.name !== "AbortError") showSettingsFeedback("note-status", `同步失败：${error.message}`); }
    finally { updateDelivery(); }
  });
  get("builder-install-prompt").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText("请安装我提供的 course-notes.zip，将其中完整的 course-notes 文件夹放入当前工具支持的项目技能目录。Codex 使用项目根目录下的 .agents/skills/course-notes。已有同名技能时更新本包生成的文件，保留其他文件；不要修改其他技能。安装后检查 SKILL.md 中的所有引用文件均存在，再确认技能可调用");
      showSettingsFeedback("note-status", "安装指令已复制，请同时向 agent 提供下载的 course-notes.zip");
    } catch (error) { showSettingsFeedback("note-status", error.message); }
  });
  for (const [id, reference] of [["builder-web-materials", false], ["builder-web-reference", true]]) {
    get(id).addEventListener("change", async event => {
      const input = event.target, selected = [...input.files];
      try {
        const files = await Promise.all(selected.map(async (file, index) => ({ fileName: `${reference ? "已有笔记" : "素材"}/${index + 1}-${CourseCore.safeName(file.name)}`, content: await file.text() })));
        if (reference) uploadedReferences = files; else uploadedMaterials = files;
        get(`${id}-help`).textContent = files.length ? `已读取 ${files.length} 个文件：${selected.map(file => file.name).join("、")}` : reference ? "文件会随网页材料一起导出" : "也会读取课程素材页勾选课时的实际字幕";
        refreshPreview();
      } catch (error) { showSettingsFeedback("note-status", `文件读取失败：${error.message}`); }
    });
  }
  async function collectContext(currentDelivery) {
    const selected = pages.filter(page => page.selected), materials = [];
    let index = "";
    if (currentDelivery.environment === "web") {
      const results = await Promise.all(selected.map(async page => {
        const item = { label: `P${page.page} ${page.part}`, chapter: CourseCore.chapterLabel(page.chapter), fileName: `素材/P${String(page.page).padStart(2, "0")}-${CourseCore.safeName(page.part)}.md` };
        try {
          const result = await request("preview", { page });
          if (!result.body?.length) return { ...item, missing: "没有可用字幕" };
          return { ...item, content: CourseCore.buildRaw(meta, page, result.track || {}, result.body) };
        } catch (error) { return { ...item, missing: error.message }; }
      }));
      materials.push(...results, ...uploadedMaterials.map(item => ({ ...item, label: item.fileName, chapter: "用户提供文件" })));
    } else {
      let sources = {}, lookupError = "";
      const paths = currentDelivery.paths.split(/\r?\n/).map(path => path.trim()).filter(Boolean);
      if (meta && selected.length) {
        try { ({ sources } = await request("raw-paths", { pages: selected })); }
        catch (error) {
          if (!paths.length && !(currentDelivery.task === "review" && currentDelivery.reference.trim())) throw error;
          lookupError = error.message;
        }
        if (Object.keys(sources).length) index = `${CourseCore.courseFolder(meta, get("folder").value)}/课程导入清单.md`;
      }
      materials.push(...selected.map(page => ({ label: `P${page.page} ${page.part}`, chapter: CourseCore.chapterLabel(page.chapter), path: sources[page.cid], missing: lookupError || (page.status === "missing" ? "没有可用字幕" : "尚未找到已导入文件") })),
        ...paths.map(path => ({ label: path.split(/[\\/]/).at(-1), chapter: "用户指定文件", path })));
    }
    return { course: meta?.title || "用户提供的课程素材", index, materials,
      references: ["supplement", "continue", "review"].includes(currentDelivery.task) ? uploadedReferences : [] };
  }
  async function prepareTask() {
    await save();
    const currentConfig = structuredClone(config), currentDelivery = { ...delivery, ready: ready() };
    if (currentDelivery.environment === "local" && !currentDelivery.ready) throw new Error("请先安装或同步当前技能包，并确认当前配置");
    const context = await collectContext(currentDelivery);
    return { text: core.buildTask(currentConfig, currentDelivery, context), config: currentConfig, delivery: currentDelivery, context };
  }
  function previewTask(task, files = []) {
    renderFileList([{ path: "任务指令.txt", content: task.text }, ...files], "任务指令.txt");
    get("builder-preview").scrollIntoView({ block: "start", behavior: "smooth" });
  }
  get("builder-preview-task").addEventListener("click", async () => {
    try {
      const task = await prepareTask();
      const files = task.delivery.environment === "web" ? core.buildWebFiles(task.config, task.delivery, task.context, resources) : core.buildFiles(task.config, resources);
      previewTask(task, files);
    } catch (error) { showSettingsFeedback("note-status", error.message); }
  });
  get("builder-export-web").addEventListener("click", async () => {
    const button = get("builder-export-web"); button.disabled = true;
    try {
      read(); const snapshot = webSnapshot(), task = await prepareTask();
      if (snapshot !== webSnapshot()) throw new Error("设置或所选课时已改动，请重新导出");
      const files = core.buildWebFiles(task.config, task.delivery, task.context, resources);
      if (task.delivery.format === "zip") download(core.zip(files), "course-web-task.zip", "application/zip");
      else download(core.combineWebFiles(files), "课程任务材料.md", "text/markdown;charset=utf-8");
      exportedWeb = { snapshot, task }; previewTask(task, files); updateDelivery();
      showSettingsFeedback("note-status", "网页材料已生成，包含实际字幕和规则；上传文件后使用配套任务指令");
    } catch (error) { showSettingsFeedback("note-status", `导出失败：${error.message}`); }
    finally { button.disabled = false; }
  });
  const copy = get("copy-study-prompt");
  copy.addEventListener("click", async () => {
    copy.disabled = true;
    try {
      await save();
      let task;
      if (delivery.environment === "web") {
        if (exportedWeb?.snapshot !== webSnapshot()) throw new Error("请先按当前设置导出网页材料，再复制配套指令");
        task = exportedWeb.task;
      } else task = await prepareTask();
      await navigator.clipboard.writeText(task.text);
      showSettingsFeedback("note-status", delivery.environment === "web" ? "网页任务指令已复制，请同时上传刚导出的材料" : "简短任务指令已复制，将调用已安装的当前技能");
    } catch (error) { showSettingsFeedback("note-status", `复制失败：${error.message}`); }
    finally { copy.disabled = false; }
  });
  window.NotePreferences = { load, save };
})();
