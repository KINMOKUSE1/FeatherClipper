/* The worker owns one-video imports so closing the popup does not cancel them. */
const quickJobs = new Map();
function quickKey(message) {
  const youtube = /^YT(?:_|PL_)/.test(String(message.bvid || ""));
  if (!(youtube ? (/^YT_[\w-]{11}$/.test(message.bvid || "") && message.cid === message.bvid.slice(3)) || (/^YTPL_[\w-]{8,60}$/.test(message.bvid || "") && /^[\w-]{11}$/.test(message.cid || "")) : /^BV[0-9A-Za-z]+$/.test(message.bvid || "") && /^\d+$/.test(message.cid || ""))) throw new Error("视频信息无效，请重新读取。");
  return `boc-quick:${message.bvid}:${message.cid}:${CourseCore.normalizeFolder(message.base)}`;
}
async function quickStatus(message) {
  const key = quickKey(message);
  let state = (await chrome.storage.local.get(key))[key] || null;
  if (state?.status === "running" && !quickJobs.has(key)) {
    state = { ...state, status: "failed", error: "上次导入中断，请重试；已保存的字幕会自动跳过。" };
    await chrome.storage.local.set({ [key]: state });
  }
  return { key, state };
}
async function runQuickImport(message, key) {
  const { meta, base } = message;
  const locale = I18n.outputLocale(message.locale || (await chrome.storage.local.get(I18n.storageKey))[I18n.storageKey] || "zh-CN");
  return navigator.locks.request(`boc-course:${meta.bvid}`, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("这门课程正在导入，请等待课程工作台中的任务完成。");
    const save = state => chrome.storage.local.set({ [key]: { ...state, updated: Date.now() } });
    await save({ status: "running" });
    // A subtitle lookup can span several requests after the popup has closed.
    const keepAlive = setInterval(() => chrome.storage.local.get(key).catch(() => {}), 20000);
    const snapshot = `boc-course-v1:${meta.bvid}:${CourseCore.normalizeFolder(base)}`;
    try {
      const cached = (await chrome.storage.local.get(snapshot))[snapshot];
      const pages = meta.pages.map(page => {
        const old = cached?.pages?.find(item => item.cid === page.cid);
        return { ...page, chapter: old?.chapter ?? CourseCore.chapterOf(page.part), selected: old?.selected ?? page.cid === message.cid, status: old?.status || "pending", error: old?.error || "", sourcePath: old?.sourcePath || "" };
      });
      const page = pages.find(item => item.cid === message.cid);
      // Validate the index before saving raw material, just like the course workspace.
      await handleCourseMessage({ locale, action: "index", meta, base, pages });
      const result = await handleCourseMessage({ locale, action: "import", meta, base, page, trackId: message.trackId });
      page.status = result.status; page.error = ""; page.sourcePath = result.path || "";
      await chrome.storage.local.set({ [snapshot]: { title: meta.title, pages, updated: Date.now() }, [`boc-course-base:${meta.bvid}`]: base });
      await handleCourseMessage({ locale, action: "index", meta, base, pages });
      const state = { status: result.status, path: result.path || "" };
      await save(state);
      return state;
    } catch (error) {
      const state = { status: "failed", error: error.message };
      await save(state);
      return state;
    } finally {
      clearInterval(keepAlive);
    }
  });
}
function startQuickImport(message) {
  const key = quickKey(message);
  if (message.meta?.bvid !== message.bvid || !message.meta.pages?.some(page => page.cid === message.cid)) throw new Error("视频信息已变化，请重新读取。");
  if (quickJobs.has(key)) return quickJobs.get(key);
  const job = runQuickImport(message, key).finally(() => quickJobs.delete(key));
  quickJobs.set(key, job);
  return job;
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["quick-status", "quick-import"].includes(message?.type)) return false;
  if (sender.id !== chrome.runtime.id || String(sender.url || "").split(/[?#]/)[0] !== chrome.runtime.getURL("popup/index.html")) {
    sendResponse({ ok: false, error: "请从扩展快捷窗口操作。" }); return false;
  }
  // Keep this message event open until the worker has saved the result.
  Promise.resolve().then(() => message.type === "quick-status" ? quickStatus(message) : startQuickImport(message))
    .then(data => sendResponse({ ok: true, ...data })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
