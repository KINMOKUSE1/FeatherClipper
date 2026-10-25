/* 用户数据备份协议。仅包含持久配置、课程快照和导入记录，不包含进行中的任务。 */
(function (root) {
  const preferences = typeof module !== "undefined" && module.exports ? require("./preferences.js") : root.Preferences;
  const preferenceKeys = preferences.keys;
  const settingsKeys = ["noteFolder", "obsidianApiBaseUrl", "obsidianApiKey", "asrSettings", "asrToken", "featherclipper:ui-locale", ...preferenceKeys];
  const prefixes = ["featherclipper:import-history:", "boc-course-v1:", "boc-course-base:"];
  const owns = key => settingsKeys.includes(key) || prefixes.some(prefix => key.startsWith(prefix));
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  function validate(data) {
    if (!object(data) || Object.keys(data).some(key => !owns(key))) throw new Error("备份包含无法识别的数据项");
    for (const [key, value] of Object.entries(data)) {
      if (["noteFolder", "obsidianApiBaseUrl", "obsidianApiKey", "asrToken", "featherclipper:ui-locale"].includes(key) || key.startsWith("boc-course-base:")) {
        if (typeof value !== "string") throw new Error("备份中的设置格式无效");
      } else if (preferenceKeys.includes(key)) {
        if (value !== null && typeof value !== "string") throw new Error("备份中的笔记偏好格式无效");
        if (value && !key.includes("notes-install-method")) {
          const parsed = JSON.parse(value);
          if (key.includes("skill-builder") || key.includes("notes-delivery")) {
            if (!object(parsed)) throw new Error("备份中的笔记偏好格式无效");
          } else if (!Array.isArray(parsed)) throw new Error("备份中的技能状态格式无效");
        }
      } else if (key === "asrSettings") {
        if (!object(value) || !["local", "groq", "siliconflow"].includes(value.provider) || (value.keys !== undefined && (!object(value.keys) || Object.entries(value.keys).some(([name, secret]) => !["groq", "siliconflow"].includes(name) || typeof secret !== "string")))) throw new Error("备份中的转写设置格式无效");
      } else if (key.startsWith("boc-course-v1:")) {
        if (!object(value) || !Array.isArray(value.pages)) throw new Error("备份中的课程目录格式无效");
      } else if (key.startsWith("featherclipper:import-history:")) {
        if (!object(value) || !value.courseId || value.cid === undefined || typeof value.title !== "string" || typeof value.base !== "string" || typeof value.importedAt !== "number") throw new Error("备份中的导入记录格式无效");
      }
    }
    if (data.obsidianApiBaseUrl !== undefined) {
      const url = new URL(data.obsidianApiBaseUrl);
      if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("备份中的 Obsidian 地址必须是本机地址");
    }
    return data;
  }
  function parse(text) {
    const backup = JSON.parse(text);
    if (backup?.format !== "featherclipper-backup") throw new Error("请选择 FeatherClipper 导出的备份文件");
    if (backup.version !== 1) throw new Error("当前版本无法读取此备份版本");
    validate(backup.data);
    return backup;
  }
  async function exportData({ includeSecrets = false } = {}) {
    await preferences.flush();
    const all = await root.chrome.storage.local.get(null);
    const legacy = await root.chrome.storage.sync?.get?.(["noteFolder", "obsidianApiBaseUrl", "obsidianApiKey"]) || {};
    const data = Object.fromEntries(Object.entries({ ...legacy, ...all }).filter(([key]) => owns(key)));
    if (!includeSecrets) {
      delete data.obsidianApiKey;
      delete data.asrToken;
      if (data.asrSettings) data.asrSettings = { ...data.asrSettings, keys: {} };
    }
    validate(data);
    return { format: "featherclipper-backup", version: 1, createdAt: new Date().toISOString(),
      extensionVersion: root.chrome.runtime.getManifest?.().version || "development", includeSecrets, data };
  }
  async function restore(backup) {
    // Validate before any write; merge records and preserve locally saved Keys omitted from a backup.
    const data = { ...parse(JSON.stringify(backup)).data };
    await preferences.flush();
    const current = await root.chrome.storage.local.get(Object.keys(data));
    if (data.asrSettings) {
      data.asrSettings = { ...data.asrSettings, keys: { ...current.asrSettings?.keys, ...data.asrSettings.keys } };
    }
    for (const [key, value] of Object.entries(data)) {
      const time = key.startsWith("featherclipper:import-history:") ? "importedAt" : key.startsWith("boc-course-v1:") ? "updated" : null;
      if (time && current[key]?.[time] > (value[time] || 0)) delete data[key];
    }
    if (data.obsidianApiKey) data.obsidianApiKey = data.obsidianApiKey.trim().replace(/^Bearer\s+/i, "").trim();
    await root.chrome.storage.local.set(data);
  }
  const api = { exportData, parse, restore };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.UserBackup = api;
})(globalThis);
