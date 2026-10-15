/* 连接配置的存储、校验和测试；凭据仅在后台读取。 */
const SETTING_DEFAULTS = { noteFolder: "Clippings/Bilibili", obsidianApiBaseUrl: "http://127.0.0.1:27123", obsidianApiKey: "" };

async function getMergedSettings() {
  const keys = Object.keys(SETTING_DEFAULTS);
  const [local, sync] = await Promise.all([chrome.storage.local.get(keys), chrome.storage.sync.get(keys)]);
  return { ...SETTING_DEFAULTS, ...sync, ...local };
}
function normalizeConnection(settings) {
  const url = new URL(String(settings.obsidianApiBaseUrl || "").trim());
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("请输入本机 Local REST API 地址，例如 http://127.0.0.1:27123。");
  }
  return { noteFolder: CourseCore.normalizeFolder(settings.noteFolder), obsidianApiBaseUrl: url.origin, obsidianApiKey: String(settings.obsidianApiKey || "").trim().replace(/^Bearer\s+/i, "").trim() };
}
async function connectionFromDraft(draft) {
  const saved = await getMergedSettings();
  return normalizeConnection({ ...saved, ...draft, obsidianApiKey: String(draft?.obsidianApiKey || "").trim() || saved.obsidianApiKey });
}
function publicSettings(settings) {
  return { noteFolder: settings.noteFolder, obsidianApiBaseUrl: settings.obsidianApiBaseUrl, hasApiKey: Boolean(settings.obsidianApiKey) };
}
async function handleSettingsMessage(message) {
  if (message.type === "settings-get") return { settings: publicSettings(await getMergedSettings()) };
  const settings = await connectionFromDraft(message.settings);
  if (message.type === "settings-save") {
    await chrome.storage.local.set(settings);
    return { settings: publicSettings(settings) };
  }
  if (!settings.obsidianApiKey) throw new Error("请先填写 Obsidian Local REST API Key。");
  let response;
  try {
    response = await fetch(`${settings.obsidianApiBaseUrl}/`, { headers: { Authorization: `Bearer ${settings.obsidianApiKey}` }, signal: AbortSignal.timeout(10000) });
  } catch { throw new Error("无法连接。请打开 Obsidian，核对插件端口；使用 HTTPS 时需先完成证书信任配置。"); }
  if (!response.ok) throw new Error(response.status === 401 ? "Key 无效，请从 Obsidian Local REST API 设置重新复制。" : `连接失败 HTTP ${response.status}`);
  const info = await response.json().catch(() => ({}));
  if (info.authenticated !== true) throw new Error("服务已连接，但身份验证未通过。请核对 Local REST API 地址和 Key。");
  return { connected: true };
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["settings-get", "settings-save", "settings-test"].includes(message?.type)) return false;
  if (sender.id !== chrome.runtime.id || !["workbench/index.html", "popup/index.html"].some(file => String(sender.url || "").split(/[?#]/)[0] === chrome.runtime.getURL(file))) {
    sendResponse({ ok: false, error: "请从导入页面设置连接。" }); return false;
  }
  handleSettingsMessage(message).then(data => sendResponse({ ok: true, ...data })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
