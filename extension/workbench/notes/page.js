/* 笔记配置界面：编辑栏目和属性、保存偏好及预览生成文件。 */
window.createNotesPage = function ({ catalog, feedback, navigate, assetBase }) {
  const ui = UiText.notes, format = UiText.format;
  const core = window.NoteGenerator;
  const storageKey = "course-cove:skill-builder:v1", deliveryKey = "course-cove:notes-delivery:v1";
  const installationKey = "course-cove:notes-installed:v1";
  const get = id => document.getElementById(id);
  const form = get("skill-builder-form");
  const resourceBase = new URL("notes/rules/", assetBase);
  const model = { config: core.defaults(), delivery: core.deliveryDefaults(), resources: null, loaded: false, installationKey, installedSnapshot: localStorage.getItem(installationKey), directory: null, exportedWeb: null, uploadedMaterials: [], uploadedReferences: [] };
  let previewFiles = [], previewPath = "SKILL.md";
  const fields = ["goal", "language", "granularity", "folder", "naming", "links", "instructions"];
  const deliveryFields = ["environment", "task", "reference", "question", "paths", "format"];
  const toggles = ["external", "progress"];
  const { element, action, decorateSelect, positionSelectMenu, resizeTextareas } = createNoteControls(form);
  const { settings: showSettingsFeedback } = feedback;
  function read() {
    for (const name of fields) model.config[name] = get(`builder-${name}`).value;
    for (const name of toggles) model.config[name] = get(`builder-${name}`).checked;
    for (const name of deliveryFields) model.delivery[name] = get(`builder-${name}`).value;
    return model.config;
  }
  function skillSnapshot() { return JSON.stringify(core.buildFiles(model.config, model.resources)); }
  function webSnapshot() {
    return JSON.stringify({ files: core.buildFiles(model.config, model.resources), delivery: model.delivery, course: catalog.getState().meta?.bvid || null,
      selected: catalog.getState().pages.filter(page => page.selected).map(page => [page.cid, page.chapter, page.part]), uploadedMaterials: model.uploadedMaterials, uploadedReferences: model.uploadedReferences });
  }
  function ready() { try { return model.installedSnapshot === skillSnapshot(); } catch { return false; } }
  function updateDelivery() {
    const web = model.delivery.environment === "web", reference = ["supplement", "continue", "review"].includes(model.delivery.task);
    const requiredReference = ["supplement", "continue"].includes(model.delivery.task);
    for (const id of ["paths"]) {
      get(`builder-${id}-row`).hidden = web; get(`builder-${id}`).disabled = web;
    }
    get("builder-reference-row").hidden = web || !reference;
    get("builder-reference").disabled = web || !reference; get("builder-reference").required = !web && requiredReference;
    get("builder-question-row").hidden = model.delivery.task !== "review";
    get("builder-question").disabled = model.delivery.task !== "review"; get("builder-question").required = model.delivery.task === "review";
    get("builder-web-materials-row").hidden = !web; get("builder-web-materials").disabled = !web;
    get("builder-format").disabled = !web;
    get("builder-web-reference-row").hidden = !web || !reference;
    get("builder-web-reference").disabled = !web || !reference;
    get("builder-web-reference").required = web && requiredReference && !model.uploadedReferences.length;
    form.querySelectorAll(".builder-reference-requirement").forEach(label => label.textContent = requiredReference ? ui.required : ui.optional);
    const referenceHelp = model.delivery.task === "supplement" ? ui.referenceSupplement : model.delivery.task === "continue" ? ui.referenceContinue : ui.referenceReview;
    get("builder-reference-help").textContent = referenceHelp;
    get("builder-web-reference-help").textContent = model.uploadedReferences.length ? format(ui.filesRead, { count: model.uploadedReferences.length }) : referenceHelp;
    const hints = { notes: ui.taskNotes, supplement: ui.taskSupplement, continue: ui.taskContinue, translate: ui.taskTranslate, review: ui.taskReview };
    get("builder-task-help").textContent = hints[model.delivery.task];
    const state = get("builder-install-state"), isReady = ready();
    const supported = typeof window.parent.showDirectoryPicker === "function";
    const sync = get("builder-sync");
    sync.hidden = !supported;
    sync.disabled = !supported;
    sync.textContent = ui.sync;
    sync.title = ui.syncHint;
    get("builder-download").textContent = ui.download;
    get("builder-local-actions").hidden = web; get("builder-web-actions").hidden = !web;
    get("builder-confirm-installed").hidden = isReady;
    get("builder-copy-label").textContent = web || isReady ? ui.copyTask : supported ? ui.sync : ui.download;
    get("builder-preview-task").textContent = ui.previewTask;
    get("builder-preview-task").disabled = !web && !isReady;
    get("builder-delivery-name").textContent = web ? ui.webMaterials : "course-notes";
    get("builder-delivery-guide").hidden = !web;
    get("builder-delivery-guide").textContent = ui.webGuide;
    let webReady = false;
    try { webReady = model.exportedWeb?.snapshot === webSnapshot(); } catch {}
    state.dataset.state = web || isReady ? "ready" : model.installedSnapshot ? "dirty" : "missing";
    state.textContent = web ? webReady ? ui.webPrepared : ui.webAutomatic : isReady ? ui.installed : model.installedSnapshot ? ui.dirty : ui.missing;
  }
  function renderFileList(files, selected = previewPath) {
    previewFiles = files; previewPath = files.some(file => file.path === selected) ? selected : files[0].path;
    get("builder-file-list").replaceChildren(...files.map(file => {
      const button = action(file.path, format(ui.fileLabel, { file: file.path }), () => renderFileList(previewFiles, file.path));
      button.setAttribute("aria-current", String(file.path === previewPath)); return button;
    }));
    get("builder-file-name").textContent = previewPath;
    get("builder-source").textContent = files.find(file => file.path === previewPath).content;
  }
  function refreshPreview() {
    read(); updateDelivery();
    get("builder-task-source").hidden = true; get("builder-preview-task").setAttribute("aria-expanded", "false");
    const enabled = model.config.modules.filter(item => item.enabled).length;
    get("builder-module-count").textContent = format(ui.moduleCount, { enabled, total: model.config.modules.length });
    form.querySelectorAll("select").forEach(decorateSelect);
    resizeTextareas();
    try { renderFileList(core.buildFiles(model.config, model.resources)); }
    catch (error) { get("builder-source").textContent = error.message; }
  }
  let draggedModule = null;
  function moveModule(item, next) {
    const index = model.config.modules.indexOf(item);
    if (index < 0 || next < 0 || next >= model.config.modules.length || index === next) return;
    model.config.modules.splice(index, 1); model.config.modules.splice(next, 0, item);
    renderModules(next); refreshPreview();
  }
  function renderModules(focusIndex) {
    const container = get("builder-modules");
    container.replaceChildren();
    model.config.modules.forEach((item, index) => {
      const row = element("div", `builder-module${item.enabled ? "" : " is-disabled"}`);
      const top = element("div", "builder-module-top");
      const grip = action("⠿", format(ui.dragModule, { title: item.title || ui.customModule }), () => openMenu());
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
        moveModule(source, model.config.modules.indexOf(item));
      });
      const label = element("label", "builder-check");
      const check = element("input"); check.type = "checkbox"; check.checked = item.enabled;
      check.setAttribute("aria-label", format(ui.enableModule, { title: item.title || ui.customModule }));
      const title = item.custom ? element("input", "builder-module-name") : element("h3", "builder-module-title", item.title);
      if (item.custom) {
        title.value = item.title; title.placeholder = ui.moduleName; title.required = item.enabled;
        title.setAttribute("aria-label", ui.customModuleName);
        title.addEventListener("input", () => { item.title = title.value; refreshPreview(); });
      }
      label.append(check);
      const off = element("span", "builder-module-off", ui.disabled); off.hidden = item.enabled;
      const trigger = action("⋯", format(ui.moduleActions, { title: item.title || ui.customModule }), () => controls.matches(":popover-open") ? controls.hidePopover() : openMenu());
      trigger.classList.add("builder-module-menu-trigger");
      const controls = element("div", "builder-module-actions");
      controls.id = `builder-module-actions-${index}`; controls.setAttribute("popover", "auto"); controls.setAttribute("role", "menu");
      controls.setAttribute("aria-label", format(ui.moduleActions, { title: item.title || ui.customModule }));
      trigger.setAttribute("aria-haspopup", "menu"); trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-controls", controls.id);
      function openMenu() {
        controls.showPopover(); positionSelectMenu(trigger, controls);
        controls.querySelector("button:not(:disabled)").focus({ preventScroll: true });
      }
      const move = direction => { controls.hidePopover(); moveModule(item, model.config.modules.indexOf(item) + direction); };
      const up = action(ui.moveUp, format(ui.upModule, { title: item.title }), () => move(-1)); up.disabled = index === 0;
      const down = action(ui.moveDown, format(ui.downModule, { title: item.title }), () => move(1)); down.disabled = index === model.config.modules.length - 1;
      controls.append(up, down);
      if (item.custom) controls.append(action(ui.remove, ui.removeModule, () => { controls.hidePopover(); model.config.modules.splice(index, 1); renderModules(); refreshPreview(); get("builder-add-module").focus(); }));
      else controls.append(action(ui.restore, format(ui.restoreModule, { title: item.title }), () => {
        controls.hidePopover(); trigger.focus({ preventScroll: true });
        item.writing = core.modules.find(module => module.id === item.id).writing;
        textarea.value = item.writing; refreshPreview();
        showSettingsFeedback("note-status", format(ui.restoredModule, { title: item.title }));
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
      textarea.setAttribute("aria-label", format(ui.moduleWriting, { title: item.title || ui.customModule }));
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
    model.config.properties.forEach(item => {
      const row = element("div", `builder-property${item.enabled ? "" : " is-disabled"}`);
      row.dataset.type = item.type;
      const check = element("input", "builder-enable"); check.type = "checkbox"; check.checked = item.enabled;
      check.id = `builder-property-${item.name}`; check.setAttribute("aria-label", format(ui.enableProperty, { name: item.name }));
      const label = element("label", "builder-property-name", item.name); label.htmlFor = check.id;
      const hint = item.fixed ? item.name === "author" ? ui.authorHint : ui.tagsHint : ui.automaticProperty;
      const icon = element("span", "icon property-type-icon"); icon.setAttribute("aria-hidden", "true"); icon.title = `${core.types[item.type]} · ${hint}`;
      const value = element("input");
      value.value = item.fixed ? item.value : item.rule; value.disabled = !item.enabled;
      value.required = item.enabled && !item.fixed;
      value.setAttribute("aria-label", format(ui.propertyInput, { name: item.name, kind: item.fixed ? ui.propertyValue : ui.propertyRule }));
      value.title = `${core.types[item.type]} · ${hint}`;
      if (item.name === "author") value.placeholder = ui.authorHint;
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
    container.hidden = !model.config.customProperties.length; container.replaceChildren();
    model.config.customProperties.forEach((item, index) => {
      const row = element("div", "builder-property builder-custom-property");
      const name = element("input"); name.value = item.name; name.placeholder = ui.propertyName; name.required = true;
      name.setAttribute("aria-label", ui.customPropertyName);
      name.addEventListener("input", () => { item.name = name.value.trim(); refreshPreview(); });
      const type = element("select"); type.setAttribute("aria-label", ui.customPropertyType);
      for (const [key, label] of Object.entries(core.types)) type.add(new Option(label, key));
      type.value = item.type;
      const value = element(item.type === "boolean" ? "select" : "input", "builder-custom-value");
      value.setAttribute("aria-label", ui.customPropertyValue);
      if (item.type === "boolean") { value.add(new Option(ui.falseLabel, "false")); value.add(new Option(ui.trueLabel, "true")); }
      else { value.type = item.type === "date" ? "date" : item.type === "number" ? "number" : "text"; if (item.type === "number") value.step = "any"; }
      value.value = item.value; value.placeholder = item.type === "list" ? ui.listValueHint : ui.propertyValue;
      value.required = ["number", "date"].includes(item.type);
      value.addEventListener("input", () => { item.value = value.value; refreshPreview(); });
      type.addEventListener("change", () => { item.type = type.value; item.value = item.type === "boolean" ? "false" : ""; renderCustomProperties(); refreshPreview(); });
      const remove = action("×", ui.removeProperty, () => { model.config.customProperties.splice(index, 1); renderCustomProperties(); refreshPreview(); get("builder-add-property").focus(); });
      row.append(name, type, value, remove); container.append(row);
    });
  }
  async function load() {
    if (model.loaded) return;
    if (!model.resources) {
      const responses = await Promise.all(["SKILL.md", "openai.yaml", "workflow.md", "tasks.md"].map(file => fetch(new URL(file, resourceBase), { cache: "no-store" })));
      if (responses.some(response => !response.ok)) throw new Error(ui.rulesFailed);
      const [entry, agent, workflow, tasks] = await Promise.all(responses.map(response => response.text()));
      model.resources = { entry, agent, workflow, tasks };
    }
    const saved = localStorage.getItem(storageKey);
    if (saved) model.config = { ...core.defaults(), ...JSON.parse(saved) };
    const savedDelivery = localStorage.getItem(deliveryKey);
    if (savedDelivery) model.delivery = { ...core.deliveryDefaults(), ...JSON.parse(savedDelivery) };
    for (const name of fields) get(`builder-${name}`).value = model.config[name];
    for (const name of toggles) get(`builder-${name}`).checked = model.config[name];
    for (const name of deliveryFields) get(`builder-${name}`).value = model.delivery[name];
    renderModules(); renderProperties(); renderCustomProperties(); refreshPreview();
    model.loaded = true;
    document.fonts.ready.then(resizeTextareas);
  }
  async function save() {
    core.validate(read());
    localStorage.setItem(storageKey, JSON.stringify(model.config));
    localStorage.setItem(deliveryKey, JSON.stringify(model.delivery));
    return model.config;
  }
  let formWidth = 0;
  new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (width !== formWidth) { formWidth = width; resizeTextareas(); }
  }).observe(form);
  get("note-preferences-page").querySelector(".settings-scroll").addEventListener("scroll", () => {
    for (const menu of form.querySelectorAll(".builder-select-menu:popover-open, .builder-module-actions:popover-open, .builder-delivery-menu:popover-open")) positionSelectMenu(menu.previousElementSibling, menu);
  });
  for (const eventName of ["input", "change"]) form.addEventListener(eventName, event => {
    refreshPreview();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    try { await save(); updateDelivery(); showSettingsFeedback("note-status", model.delivery.environment === "web" ? ui.savedWeb : ui.savedLocal); }
    catch (error) { showSettingsFeedback("note-status", error.message); }
  });
  get("builder-add-module").addEventListener("click", () => {
    model.config.modules.push({ id: `custom-${crypto.randomUUID()}`, custom: true, title: "", writing: "", enabled: true });
    renderModules(); refreshPreview(); get("builder-modules").lastElementChild.querySelector(".builder-module-name").focus();
  });
  get("builder-add-property").addEventListener("click", () => {
    model.config.customProperties.push({ name: "", type: "text", value: "" });
    renderCustomProperties(); refreshPreview(); get("builder-custom-properties").lastElementChild.querySelector("input").focus();
  });

  function previewTask(task, files = []) {
    renderFileList([{ path: "任务指令.txt", content: task.text }, ...files], "任务指令.txt");
    get("builder-task-source").textContent = task.text; get("builder-task-source").hidden = false;
    get("builder-preview-task").setAttribute("aria-expanded", "true");
  }

  const deliveryMenu = get("builder-delivery-menu"), moreButton = get("builder-delivery-more");
  moreButton.addEventListener("click", () => {
    if (deliveryMenu.matches(":popover-open")) deliveryMenu.hidePopover();
    else { deliveryMenu.showPopover(); positionSelectMenu(moreButton, deliveryMenu); deliveryMenu.querySelector("div:not([hidden]) > button:not([hidden]):not(:disabled)").focus({ preventScroll: true }); }
  });
  deliveryMenu.addEventListener("toggle", event => moreButton.setAttribute("aria-expanded", String(event.newState === "open")));
  deliveryMenu.addEventListener("click", event => { if (event.target.closest('[role="menuitem"]')) deliveryMenu.hidePopover(); });
  deliveryMenu.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.target.closest(".builder-select")) return;
    const buttons = [...deliveryMenu.querySelectorAll('button[role="menuitem"]')].filter(button => !button.hidden && !button.disabled && !button.closest("[hidden]"));
    const index = buttons.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus({ preventScroll: true });
    } else if (event.key === "Escape") { event.preventDefault(); deliveryMenu.hidePopover(); moreButton.focus({ preventScroll: true }); }
    else if (event.key === "Tab") deliveryMenu.hidePopover();
  });

  createNotesDelivery({ model, catalog, feedback, element, read, save, ready, skillSnapshot, webSnapshot, updateDelivery, refreshPreview, previewTask });
  document.getElementById("notes-nav").addEventListener("click", async () => {
    showSettingsFeedback("note-status", "");
    try { await load(); navigate("note-preferences-page"); }
    catch (error) { feedback.status(error.message, true); }
  });
  return { load, save };
};
