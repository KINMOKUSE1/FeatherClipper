/* 笔记配置界面：编辑栏目和属性、保存偏好及预览生成文件。 */
window.createNotesPage = function ({ catalog, feedback, navigate, assetBase }) {
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
    get("builder-install").hidden = web;
    get("builder-export-web").hidden = !web;
    for (const id of ["paths"]) {
      get(`builder-${id}-row`).hidden = web; get(`builder-${id}`).disabled = web;
    }
    get("builder-reference-row").hidden = web || !reference;
    get("builder-reference").disabled = web || !reference; get("builder-reference").required = !web && requiredReference;
    get("builder-question-row").hidden = model.delivery.task !== "review";
    get("builder-question").disabled = model.delivery.task !== "review"; get("builder-question").required = model.delivery.task === "review";
    for (const id of ["web-materials", "format"]) {
      get(`builder-${id}-row`).hidden = !web; get(`builder-${id}`).disabled = !web;
    }
    get("builder-web-reference-row").hidden = !web || !reference;
    get("builder-web-reference").disabled = !web || !reference;
    get("builder-web-reference").required = web && requiredReference && !model.uploadedReferences.length;
    get("builder-environment-help").textContent = web ? "导出实际素材和规则，上传给网页 AI 后执行" : "agent 读取本地素材，已安装技能时使用简短任务指令";
    const hints = { notes: "整理所选课时或提供的文件", supplement: "把新增内容合入实际提供的原笔记", continue: "核对已有记录，只继续本次范围的未完成部分", translate: "按笔记语言翻译字幕，保留原文与时间定位", review: "结合课程或已有笔记回答本次问题" };
    get("builder-task-help").textContent = hints[model.delivery.task];
    const state = get("builder-install-state"), isReady = ready();
    state.dataset.state = isReady ? "ready" : model.installedSnapshot ? "dirty" : "missing";
    state.textContent = isReady ? "✓ 已安装" : model.installedSnapshot ? "待同步" : "未安装";
    get("builder-install-title").textContent = isReady ? "技能已就绪" : model.installedSnapshot ? "配置有更新" : "先安装技能";
    get("builder-install-next").textContent = isReady ? "下一步：复制任务指令，交给本地 agent" : model.installedSnapshot ? "同步当前配置后，再复制任务指令" : "安装一次，之后用简短指令调用 course-notes";
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
    sync.textContent = isReady ? model.directory ? "同步到已选目录" : "同步到目录" : model.installedSnapshot ? "同步当前配置" : "选择目录并同步";
    sync.title = "选择 agent 的 skills 目录或 course-notes 文件夹，写入并核对当前 7 个文件";
    downloadButton.textContent = !isReady && model.installedSnapshot ? "下载更新包" : "下载技能包";
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
    try { webReady = model.exportedWeb?.snapshot === webSnapshot(); } catch {}
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
    const enabled = model.config.modules.filter(item => item.enabled).length;
    get("builder-module-count").textContent = `${enabled} / ${model.config.modules.length} 已启用`;
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
        moveModule(source, model.config.modules.indexOf(item));
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
      const move = direction => { controls.hidePopover(); moveModule(item, model.config.modules.indexOf(item) + direction); };
      const up = action("上移", `上移${item.title}`, () => move(-1)); up.disabled = index === 0;
      const down = action("下移", `下移${item.title}`, () => move(1)); down.disabled = index === model.config.modules.length - 1;
      controls.append(up, down);
      if (item.custom) controls.append(action("删除", "删除自定义模块", () => { controls.hidePopover(); model.config.modules.splice(index, 1); renderModules(); refreshPreview(); get("builder-add-module").focus(); }));
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
    model.config.properties.forEach(item => {
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
    container.hidden = !model.config.customProperties.length; container.replaceChildren();
    model.config.customProperties.forEach((item, index) => {
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
      const remove = action("×", "删除自定义属性", () => { model.config.customProperties.splice(index, 1); renderCustomProperties(); refreshPreview(); get("builder-add-property").focus(); });
      row.append(name, type, value, remove); container.append(row);
    });
  }
  async function load() {
    if (model.loaded) return;
    if (!model.resources) {
      const responses = await Promise.all(["SKILL.md", "openai.yaml", "workflow.md", "tasks.md"].map(file => fetch(new URL(file, resourceBase), { cache: "no-store" })));
      if (responses.some(response => !response.ok)) throw new Error("整理规则读取失败，请重新打开工作台");
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
    for (const menu of form.querySelectorAll(".builder-select-menu:popover-open, .builder-module-actions:popover-open")) positionSelectMenu(menu.previousElementSibling, menu);
  });
  for (const eventName of ["input", "change"]) form.addEventListener(eventName, event => {
    if (event.target.id !== "builder-confirm-installed") refreshPreview();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    try { await save(); updateDelivery(); showSettingsFeedback("note-status", model.delivery.environment === "web" ? "设置已保存，导出网页材料后使用" : "设置已保存，请按当前安装状态同步技能"); }
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
    get("builder-preview").scrollIntoView({ block: "start", behavior: "smooth" });
  }

  createNotesDelivery({ model, catalog, feedback, element, read, save, ready, skillSnapshot, webSnapshot, updateDelivery, refreshPreview, previewTask });
  document.getElementById("notes-nav").addEventListener("click", async () => {
    showSettingsFeedback("note-status", "");
    try { await load(); navigate("note-preferences-page"); }
    catch (error) { feedback.status(error.message, true); }
  });
  return { load, save };
};
