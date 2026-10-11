/* 技能包下载、目录同步、安装确认与本次任务交付。 */
window.createNotesDelivery = function ({ model, catalog, feedback, element, read, save, ready, skillSnapshot, webSnapshot, updateDelivery, refreshPreview, previewTask }) {
  const ui = UiText.notes, format = UiText.format;
  const get = id => document.getElementById(id);
  const core = window.NoteGenerator;
  const { settings: showSettingsFeedback } = feedback;
  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type })), link = element("a");
    link.href = url; link.download = name; document.body.append(link); link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 30000);
  }
  async function downloadSkill() {
    try {
      await save();
      const files = core.buildFiles(model.config, model.resources);
      download(window.NoteFiles.zip(files.map(file => ({ ...file, path: `course-notes/${file.path}` }))), "course-notes.zip", "application/zip");
      updateDelivery();
      showSettingsFeedback("note-status", ui.downloaded);
    } catch (error) { showSettingsFeedback("note-status", error.message); }
  }
  get("builder-download").addEventListener("click", downloadSkill);
  get("builder-confirm-installed").addEventListener("click", () => {
    try {
      read(); model.installedSnapshot = skillSnapshot();
      localStorage.setItem(model.installationKey, model.installedSnapshot);
      updateDelivery();
    } catch (error) { showSettingsFeedback("note-status", error.message); }
  });
  async function syncSkill() {
    const button = get("builder-sync");
    try {
      const files = core.buildFiles(read(), model.resources), snapshot = JSON.stringify(files);
      const selected = model.directory || await window.parent.showDirectoryPicker({ mode: "readwrite", id: "course-cove-skills" });
      model.directory = selected.name === "course-notes" ? selected : await selected.getDirectoryHandle("course-notes", { create: true });
      model.installedSnapshot = null; localStorage.removeItem(model.installationKey); button.disabled = true;
      await window.NoteFiles.writeFiles(model.directory, files);
      model.installedSnapshot = snapshot; localStorage.setItem(model.installationKey, snapshot); await save(); updateDelivery();
      showSettingsFeedback("note-status", ui.synced);
    } catch (error) { if (error.name !== "AbortError") showSettingsFeedback("note-status", format(ui.syncFailed, { error: error.message })); }
    finally { updateDelivery(); }
  }
  get("builder-sync").addEventListener("click", syncSkill);
  get("builder-install-prompt").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ui.installPrompt);
      showSettingsFeedback("note-status", ui.installPromptCopied);
    } catch (error) { showSettingsFeedback("note-status", error.message); }
  });
  for (const [id, reference] of [["builder-web-materials", false], ["builder-web-reference", true]]) {
    get(id).addEventListener("change", async event => {
      const input = event.target, selected = [...input.files];
      try {
        const files = await Promise.all(selected.map(async (file, index) => ({ fileName: `${reference ? "已有笔记" : "素材"}/${index + 1}-${CourseCore.safeName(file.name)}`, content: await file.text() })));
        if (reference) model.uploadedReferences = files; else model.uploadedMaterials = files;
        if (!reference) get(`${id}-help`).textContent = files.length ? format(ui.filesRead, { count: files.length }) : ui.materialsHelp;
        refreshPreview();
      } catch (error) { showSettingsFeedback("note-status", format(ui.readFailed, { error: error.message })); }
    });
  }
  async function prepareTask() {
    await save();
    const currentConfig = structuredClone(model.config), currentDelivery = { ...model.delivery, ready: ready() };
    if (currentDelivery.environment === "local" && !currentDelivery.ready) throw new Error(ui.installationRequired);
    const context = await window.collectNoteMaterials({ catalog, core: CourseCore, delivery: currentDelivery, uploadedMaterials: model.uploadedMaterials, uploadedReferences: model.uploadedReferences });
    return { text: core.buildTask(currentConfig, currentDelivery, context), config: currentConfig, delivery: currentDelivery, context };
  }
  get("builder-preview-task").addEventListener("click", async () => {
    if (!get("builder-task-source").hidden) {
      get("builder-task-source").hidden = true; get("builder-preview-task").setAttribute("aria-expanded", "false"); return;
    }
    try {
      const task = await prepareTask();
      const files = task.delivery.environment === "web" ? core.buildWebFiles(task.config, task.delivery, task.context, model.resources) : core.buildFiles(task.config, model.resources);
      previewTask(task, files);
    } catch (error) { showSettingsFeedback("note-status", error.message); }
  });
  async function prepareWebTask() {
    read(); const snapshot = webSnapshot(), task = await prepareTask();
    if (snapshot !== webSnapshot()) throw new Error(ui.exportChanged);
    return { ...task, snapshot, files: core.buildWebFiles(task.config, task.delivery, task.context, model.resources) };
  }
  function exportWebTask(task) {
    if (task.delivery.format === "zip") download(window.NoteFiles.zip(task.files), "course-web-task.zip", "application/zip");
    else download(core.combineWebFiles(task.files), "课程任务材料.md", "text/markdown;charset=utf-8");
    model.exportedWeb = { snapshot: task.snapshot }; updateDelivery();
  }
  get("builder-export-web").addEventListener("click", async () => {
    const button = get("builder-export-web"); button.disabled = true;
    try {
      exportWebTask(await prepareWebTask());
      showSettingsFeedback("note-status", ui.exported);
    } catch (error) { showSettingsFeedback("note-status", format(ui.exportFailed, { error: error.message })); }
    finally { button.disabled = false; }
  });
  const copy = get("copy-study-prompt");
  copy.addEventListener("click", async () => {
    copy.disabled = true;
    try {
      read();
      if (model.delivery.environment === "local" && !ready()) {
        if (typeof window.parent.showDirectoryPicker === "function") await syncSkill();
        else await downloadSkill();
        return;
      }
      const task = model.delivery.environment === "web" ? await prepareWebTask() : await prepareTask();
      await navigator.clipboard.writeText(task.text);
      if (task.delivery.environment === "web") exportWebTask(task);
      showSettingsFeedback("note-status", task.delivery.environment === "web" ? ui.copiedWeb : ui.copiedLocal);
    } catch (error) { showSettingsFeedback("note-status", format(ui.copyFailed, { error: error.message })); }
    finally { copy.disabled = false; }
  });
};
