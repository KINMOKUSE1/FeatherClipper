/* 技能包下载、目录同步、安装确认与本次任务交付。 */
window.createNotesDelivery = function ({ model, catalog, feedback, element, read, save, ready, skillSnapshot, webSnapshot, updateDelivery, refreshPreview, previewTask }) {
  const get = id => document.getElementById(id);
  const core = window.NoteGenerator;
  const { settings: showSettingsFeedback } = feedback;
  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type })), link = element("a");
    link.href = url; link.download = name; document.body.append(link); link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 30000);
  }
  get("builder-download").addEventListener("click", async () => {
    try {
      await save();
      const files = core.buildFiles(model.config, model.resources);
      download(window.NoteFiles.zip(files.map(file => ({ ...file, path: `course-notes/${file.path}` }))), "course-notes.zip", "application/zip");
      updateDelivery();
      showSettingsFeedback("note-status", "技能包已生成，安装后再确认当前配置");
    } catch (error) { showSettingsFeedback("note-status", error.message); }
  });
  get("builder-confirm-installed").addEventListener("change", event => {
    try {
      read(); model.installedSnapshot = event.target.checked ? skillSnapshot() : null;
      if (model.installedSnapshot) localStorage.setItem(model.installationKey, model.installedSnapshot); else localStorage.removeItem(model.installationKey);
      updateDelivery();
    } catch (error) { event.target.checked = false; showSettingsFeedback("note-status", error.message); }
  });
  get("builder-sync").addEventListener("click", async () => {
    const button = get("builder-sync");
    try {
      const files = core.buildFiles(read(), model.resources), snapshot = JSON.stringify(files);
      const selected = model.directory || await window.parent.showDirectoryPicker({ mode: "readwrite", id: "course-cove-skills" });
      model.directory = selected.name === "course-notes" ? selected : await selected.getDirectoryHandle("course-notes", { create: true });
      model.installedSnapshot = null; localStorage.removeItem(model.installationKey); button.disabled = true;
      await window.NoteFiles.writeFiles(model.directory, files);
      model.installedSnapshot = snapshot; localStorage.setItem(model.installationKey, snapshot); await save(); updateDelivery();
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
        if (reference) model.uploadedReferences = files; else model.uploadedMaterials = files;
        get(`${id}-help`).textContent = files.length ? `已读取 ${files.length} 个文件：${selected.map(file => file.name).join("、")}` : reference ? "文件会随网页材料一起导出" : "也会读取课程素材页勾选课时的实际字幕";
        refreshPreview();
      } catch (error) { showSettingsFeedback("note-status", `文件读取失败：${error.message}`); }
    });
  }
  async function prepareTask() {
    await save();
    const currentConfig = structuredClone(model.config), currentDelivery = { ...model.delivery, ready: ready() };
    if (currentDelivery.environment === "local" && !currentDelivery.ready) throw new Error("请先安装或同步当前技能包，并确认当前配置");
    const context = await window.collectNoteMaterials({ catalog, core: CourseCore, delivery: currentDelivery, uploadedMaterials: model.uploadedMaterials, uploadedReferences: model.uploadedReferences });
    return { text: core.buildTask(currentConfig, currentDelivery, context), config: currentConfig, delivery: currentDelivery, context };
  }
  get("builder-preview-task").addEventListener("click", async () => {
    try {
      const task = await prepareTask();
      const files = task.delivery.environment === "web" ? core.buildWebFiles(task.config, task.delivery, task.context, model.resources) : core.buildFiles(task.config, model.resources);
      previewTask(task, files);
    } catch (error) { showSettingsFeedback("note-status", error.message); }
  });
  get("builder-export-web").addEventListener("click", async () => {
    const button = get("builder-export-web"); button.disabled = true;
    try {
      read(); const snapshot = webSnapshot(), task = await prepareTask();
      if (snapshot !== webSnapshot()) throw new Error("设置或所选课时已改动，请重新导出");
      const files = core.buildWebFiles(task.config, task.delivery, task.context, model.resources);
      if (task.delivery.format === "zip") download(window.NoteFiles.zip(files), "course-web-task.zip", "application/zip");
      else download(core.combineWebFiles(files), "课程任务材料.md", "text/markdown;charset=utf-8");
      model.exportedWeb = { snapshot, task }; previewTask(task, files); updateDelivery();
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
      if (model.delivery.environment === "web") {
        if (model.exportedWeb?.snapshot !== webSnapshot()) throw new Error("请先按当前设置导出网页材料，再复制配套指令");
        task = model.exportedWeb.task;
      } else task = await prepareTask();
      await navigator.clipboard.writeText(task.text);
      showSettingsFeedback("note-status", model.delivery.environment === "web" ? "网页任务指令已复制，请同时上传刚导出的材料" : "简短任务指令已复制，将调用已安装的当前技能");
    } catch (error) { showSettingsFeedback("note-status", `复制失败：${error.message}`); }
    finally { copy.disabled = false; }
  });
};
