/* 备份按钮独立于后台消息，首次切换固定 ID 前也能在仍打开的旧版工作台导出。 */
window.createBackupPage = function ({ feedback, getCatalog, navigate }) {
  const get = id => document.getElementById(id), ui = UiText.backup;
  const ids = ["export-backup", "restore-backup", "backup-secrets"];
  let busy = false;
  async function run(action) {
    if (busy) return;
    busy = true;
    ids.forEach(id => get(id).disabled = true);
    try { await action(); }
    catch (error) { feedback.settings("backup-status", I18n.error(error.message)); }
    finally { busy = false; ids.forEach(id => get(id).disabled = false); }
  }
  get("export-backup").addEventListener("click", () => run(async () => {
    const data = await UserBackup.exportData({ includeSecrets: get("backup-secrets").checked });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `featherclipper-backup-${data.createdAt.slice(0, 10)}.json`;
    document.body.append(link); link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 30000);
    feedback.settings("backup-status", ui.exported);
  }));
  get("restore-backup").addEventListener("click", () => get("backup-file").click());
  get("backup-file").addEventListener("change", event => run(async () => {
    const file = event.target.files[0]; event.target.value = "";
    if (!file) return;
    const state = getCatalog().getState();
    if (state.running || state.loading) throw new Error(ui.wait);
    const backup = UserBackup.parse(await file.text());
    const current = getCatalog().getState();
    if (current.running || current.loading) throw new Error(ui.wait);
    await UserBackup.restore(backup);
    location.reload();
  }));
  get("backup-nav").addEventListener("click", () => {
    feedback.settings("backup-status", "");
    navigate("backup-page");
  });
};
