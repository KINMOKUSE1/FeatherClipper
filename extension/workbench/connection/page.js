/* Obsidian 连接配置：读取配置、测试连接和保存。 */
window.createConnectionPage = function ({ send, feedback, navigate, getCatalog }) {
  const ui = UiText.connection;
  const $ = id => document.getElementById(id);
  let savedSettings;
  const { status, settings: showSettingsFeedback } = feedback;
  async function refreshSettings() {
    savedSettings = (await send({ type: "settings-get" })).settings;
    $("connection-state").textContent = savedSettings.hasApiKey ? ui.configured : ui.unconfigured;
    $("connection-state").classList.toggle("is-ready", savedSettings.hasApiKey);
    if (!getCatalog().getState().meta) $("folder").value = savedSettings.noteFolder;
  }
  async function openSettings() {
    try {
      await refreshSettings();
      $("api-url").value = savedSettings.obsidianApiBaseUrl; $("api-key").value = "";
      $("api-key").placeholder = savedSettings.hasApiKey ? ui.savedKey : ui.keyPlaceholder;
      $("default-folder").value = savedSettings.noteFolder; showSettingsFeedback("settings-status", "");
      navigate("connection-page");
    } catch (error) { status(error.message, true); }
  }
  async function updateSettings(testOnly) {
    const ids = ["save-settings", "test-settings", "api-url", "api-key", "default-folder"];
    ids.forEach(id => $(id).disabled = true);
    showSettingsFeedback("settings-status", testOnly ? ui.testing : ui.saving);
    try {
      const result = await send({ type: testOnly ? "settings-test" : "settings-save", settings: { obsidianApiBaseUrl: $("api-url").value, obsidianApiKey: $("api-key").value, noteFolder: $("default-folder").value } });
      if (testOnly) showSettingsFeedback("settings-status", ui.connected);
      else {
        savedSettings = result.settings; $("api-key").value = "";
        $("api-key").placeholder = savedSettings.hasApiKey ? ui.savedKey : ui.keyPlaceholder;
        await refreshSettings(); showSettingsFeedback("settings-status", ui.saved);
      }
    } catch (error) { showSettingsFeedback("settings-status", error.message); }
    finally { ids.forEach(id => $(id).disabled = false); }
  }
  $("settings").addEventListener("click", openSettings);
  $("save-settings").addEventListener("click", () => updateSettings(false));
  $("test-settings").addEventListener("click", () => updateSettings(true));
  UiText.i18n.subscribe(() => {
    if (savedSettings) $("connection-state").textContent = savedSettings.hasApiKey ? ui.configured : ui.unconfigured;
  });
  return { refresh: refreshSettings, open: openSettings };
};
