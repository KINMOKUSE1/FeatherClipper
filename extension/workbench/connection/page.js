/* Obsidian 连接配置：读取配置、测试连接和保存。 */
window.createConnectionPage = function ({ send, feedback, navigate, getCatalog }) {
  const $ = id => document.getElementById(id);
  let savedSettings;
  const { status, settings: showSettingsFeedback } = feedback;
  async function refreshSettings() {
    savedSettings = (await send({ type: "settings-get" })).settings;
    $("connection-state").textContent = savedSettings.hasApiKey ? "已配置" : "未配置";
    $("connection-state").classList.toggle("is-ready", savedSettings.hasApiKey);
    if (!getCatalog().getState().meta) $("folder").value = savedSettings.noteFolder;
  }
  async function openSettings() {
    try {
      await refreshSettings();
      $("api-url").value = savedSettings.obsidianApiBaseUrl; $("api-key").value = "";
      $("api-key").placeholder = savedSettings.hasApiKey ? "已保存，留空保持原 Key" : "从 Local REST API 设置复制";
      $("default-folder").value = savedSettings.noteFolder; showSettingsFeedback("settings-status", "");
      navigate("connection-page");
    } catch (error) { status(error.message, true); }
  }
  async function updateSettings(testOnly) {
    const ids = ["save-settings", "test-settings", "api-url", "api-key", "default-folder"];
    ids.forEach(id => $(id).disabled = true);
    showSettingsFeedback("settings-status", testOnly ? "正在验证连接…" : "正在保存…");
    try {
      const result = await send({ type: testOnly ? "settings-test" : "settings-save", settings: { obsidianApiBaseUrl: $("api-url").value, obsidianApiKey: $("api-key").value, noteFolder: $("default-folder").value } });
      if (testOnly) showSettingsFeedback("settings-status", "连接成功");
      else {
        savedSettings = result.settings; $("api-key").value = "";
        $("api-key").placeholder = savedSettings.hasApiKey ? "已保存，留空保持原 Key" : "从 Local REST API 设置复制";
        await refreshSettings(); showSettingsFeedback("settings-status", "配置已保存");
      }
    } catch (error) { showSettingsFeedback("settings-status", error.message); }
    finally { ids.forEach(id => $(id).disabled = false); }
  }
  $("settings").addEventListener("click", openSettings);
  $("save-settings").addEventListener("click", () => updateSettings(false));
  $("test-settings").addEventListener("click", () => updateSettings(true));
  return { refresh: refreshSettings, open: openSettings };
};
