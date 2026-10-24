/* 技能安装、目录同步与本次任务交付。 */
window.createNotesDelivery = function ({ model, catalog, feedback, element, read, save, ready, pendingInstallation, skillSnapshot, webSnapshot, updateDelivery, refreshPreview, previewTask }) {
  const ui = UiText.notes, format = UiText.format;
  const get = id => document.getElementById(id);
  const core = window.NoteGenerator;
  const { settings: showSettingsFeedback } = feedback;
  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type })), link = element("a");
    link.href = url; link.download = name; document.body.append(link); link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 30000);
  }
  async function run(action, failure = ui.exportFailed) {
    if (model.busy || model.readingFiles) return;
    model.busy = true; updateDelivery();
    try { await action(); }
    catch (error) { if (error.name !== "AbortError") showSettingsFeedback("note-status", format(failure, { error: error.message })); }
    finally { model.busy = false; updateDelivery(); }
  }
  function downloadSkill(files) {
    download(window.NoteFiles.zip(files.map(file => ({ ...file, path: `course-notes/${file.path}` }))), "course-notes.zip", "application/zip");
  }
  async function exportSkill() {
    await save();
    const files = core.buildFiles(model.config, model.resources), snapshot = JSON.stringify(files);
    await navigator.clipboard.writeText(ui.installPrompt);
    downloadSkill(files);
    model.exportedSkillSnapshot = snapshot;
    localStorage.setItem(model.exportedSkillKey, snapshot);
    showSettingsFeedback("note-status", ui.skillExported);
  }
  async function confirmInstallation() {
    await save(); model.installedSnapshot = skillSnapshot(); model.installationMethod = "confirmed";
    localStorage.setItem(model.installationKey, model.installedSnapshot);
    localStorage.setItem(model.installationMethodKey, model.installationMethod);
    model.exportedSkillSnapshot = null; localStorage.removeItem(model.exportedSkillKey);
  }
  get("builder-install").addEventListener("click", () => run(exportSkill));
  get("builder-download").addEventListener("click", () => run(async () => {
    await save(); downloadSkill(core.buildFiles(model.config, model.resources));
    showSettingsFeedback("note-status", ui.downloaded);
  }));
  get("builder-confirm-installed").addEventListener("click", () => run(confirmInstallation));
  get("builder-sync").addEventListener("click", () => run(async () => {
    await save();
    const files = core.buildFiles(model.config, model.resources), snapshot = JSON.stringify(files);
    const selected = model.directory || await window.parent.showDirectoryPicker({ mode: "readwrite", id: "featherclipper-skills" });
    model.directory = selected.name === "course-notes" ? selected : await selected.getDirectoryHandle("course-notes", { create: true });
    model.installedSnapshot = null; localStorage.removeItem(model.installationKey);
    await window.NoteFiles.writeFiles(model.directory, files);
    model.installedSnapshot = snapshot; model.installationMethod = "synced";
    localStorage.setItem(model.installationKey, snapshot); localStorage.setItem(model.installationMethodKey, model.installationMethod);
    model.exportedSkillSnapshot = null; localStorage.removeItem(model.exportedSkillKey);
    showSettingsFeedback("note-status", ui.synced);
  }, ui.syncFailed));
  for (const [id, reference] of [["builder-web-materials", false], ["builder-web-reference", true]]) {
    get(id).addEventListener("change", async event => {
      const input = event.target, selected = [...input.files];
      model.readingFiles++; input.disabled = true;
      if (reference) model.uploadedReferences = []; else model.uploadedMaterials = [];
      if (!reference) get(`${id}-help`).textContent = ui.materialsHelp;
      updateDelivery();
      try {
        if (!reference && selected.length > 1) { input.value = ""; throw new Error(UiText.validation.webSingleFile); }
        const files = await Promise.all(selected.map(async (file, index) => ({ fileName: `${reference ? "已有笔记" : "素材"}/${index + 1}-${CourseCore.safeName(file.name)}`, content: await file.text() })));
        if (reference) model.uploadedReferences = files; else model.uploadedMaterials = files;
        if (!reference) get(`${id}-help`).textContent = files.length ? format(ui.filesRead, { count: files.length }) : ui.materialsHelp;
      } catch (error) { showSettingsFeedback("note-status", format(ui.readFailed, { error: error.message })); }
      finally { model.readingFiles--; refreshPreview(); }
    });
  }
  async function prepareTask() {
    await save();
    const currentConfig = structuredClone(model.config), currentDelivery = { ...model.delivery, ready: ready() };
    if (currentDelivery.environment === "local" && !currentDelivery.ready) throw new Error(ui.installationRequired);
    const context = await window.collectNoteMaterials({ catalog, core: CourseCore, delivery: currentDelivery, uploadedMaterials: model.uploadedMaterials, uploadedReferences: model.uploadedReferences });
    return { text: core.buildTask(currentConfig, currentDelivery, context), config: currentConfig, delivery: currentDelivery, context };
  }
  get("builder-preview-task").addEventListener("click", () => run(async () => {
    await save();
    if (model.delivery.environment === "local" && !ready()) {
      previewTask({ text: ui.installPrompt, path: "安装指令.txt" }, core.buildFiles(model.config, model.resources));
      return;
    }
    const task = await prepareTask();
    const files = task.delivery.environment === "web" ? core.buildWebFiles(task.config, task.delivery, task.context, model.resources) : core.buildFiles(task.config, model.resources);
    previewTask(task, files);
  }));
  async function prepareWebTask() {
    read(); const snapshot = webSnapshot(), task = await prepareTask();
    if (snapshot !== webSnapshot()) throw new Error(ui.exportChanged);
    return { ...task, files: core.buildWebFiles(task.config, task.delivery, task.context, model.resources) };
  }
  function exportWebTask(task) {
    if (task.delivery.format === "zip") download(window.NoteFiles.zip(task.files), "course-web-task.zip", "application/zip");
    else download(core.combineWebFiles(task.files), "课程任务材料.md", "text/markdown;charset=utf-8");
  }
  get("builder-export-web").addEventListener("click", () => run(async () => {
    exportWebTask(await prepareWebTask());
    showSettingsFeedback("note-status", ui.exported);
  }));
  get("copy-study-prompt").addEventListener("click", () => run(async () => {
    read();
    if (model.delivery.environment === "local" && !ready()) {
      if (pendingInstallation()) await confirmInstallation();
      else await exportSkill();
      return;
    }
    const task = model.delivery.environment === "web" ? await prepareWebTask() : await prepareTask();
    await navigator.clipboard.writeText(task.text);
    if (task.delivery.environment === "web") exportWebTask(task);
    showSettingsFeedback("note-status", task.delivery.environment === "web" ? ui.copiedWeb : ui.copiedLocal);
  }, ui.copyFailed));
};
