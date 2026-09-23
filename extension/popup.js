const $ = id => document.getElementById(id);
let meta = null, page = null, base = "", settings = null, jobKey = "";
let busy = false, reading = false, previewing = false, hasSubtitle = false;
function status(text, error = false) {
  $("status").textContent = text; $("status").classList.toggle("error", error);
}
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || "扩展连接中断，请重新打开窗口。");
  return result;
}
function controls() {
  $("read").disabled = $("url").disabled = busy || reading || previewing;
  $("import").disabled = busy || reading || previewing || !page || !hasSubtitle || !settings?.hasApiKey;
  $("import").textContent = busy ? "正在导入…" : page ? `导入 P${page.page}` : "导入当前视频";
  $("refresh-preview").disabled = busy || reading || previewing;
  $("settings").disabled = busy || reading || previewing || !settings;
  $("workspace").disabled = busy || reading;
}
function showJob(state) {
  busy = state?.status === "running";
  const text = { running: "正在导入，收起窗口后会继续。", saved: "已导入 Obsidian，课程清单已更新。", exists: "字幕已存在，已跳过；课程清单已更新。", missing: "这个视频没有可用字幕。" }[state?.status];
  if (text || state?.error) status(text || state.error, state?.status === "failed");
  controls();
}
async function refreshSettings() {
  settings = (await send({ type: "settings-get" })).settings;
  $("settings").textContent = settings.hasApiKey ? "连接设置" : "配置 Obsidian";
  controls();
}
async function preview() {
  previewing = true; hasSubtitle = false; controls();
  $("subtitle-info").textContent = "正在读取字幕…"; $("subtitles").textContent = "";
  try {
    const result = await send({ type: "course-request", action: "preview", meta, page });
    hasSubtitle = Boolean(result.body?.length);
    $("subtitle-info").textContent = hasSubtitle ? `${result.track.lanDoc || result.track.lan} · 预览前 ${Math.min(12, result.body.length)} 条，导入时保存完整字幕` : "未找到可用字幕";
    if (!hasSubtitle) $("subtitles").textContent = "可先在 B站确认这个视频是否提供字幕。";
    for (const item of (result.body || []).slice(0, 12)) {
      const line = document.createElement("p"), time = document.createElement("time");
      time.textContent = new Date(Math.floor(item.from) * 1000).toISOString().slice(11, 19);
      line.append(time, document.createTextNode(item.content)); $("subtitles").append(line);
    }
  } catch (error) { $("subtitle-info").textContent = "字幕读取失败"; $("subtitles").textContent = error.message; }
  finally { previewing = false; controls(); }
}
async function loadVideo() {
  if (busy || reading || previewing) return;
  const source = $("url").value.trim();
  const bvid = source.match(/BV[0-9A-Za-z]+/)?.[0];
  if (!bvid) { status("请粘贴 B站视频链接或 BV 号。", true); return; }
  let number = 1;
  if (source.startsWith("http")) {
    try { number = Math.max(1, Number(new URL(source).searchParams.get("p")) || 1); } catch { /* A BV alone also works. */ }
  }
  reading = true; page = null; jobKey = ""; hasSubtitle = false; controls();
  $("video").hidden = true; status("正在识别视频…");
  try {
    const data = await send({ type: "course-request", action: "meta", bvid });
    meta = data.meta; page = meta.pages.find(item => item.page === number);
    if (!page) throw new Error(`课程中没有 P${number}，请核对链接。`);
    const baseKey = `boc-course-base:${meta.bvid}`;
    base = (await chrome.storage.local.get(baseKey))[baseKey] || data.folder;
    $("course-name").textContent = `${meta.title} · 共 ${meta.pages.length} P`;
    $("part-name").textContent = `P${page.page} · ${page.part}`;
    $("folder").textContent = base; $("folder").title = CourseCore.courseFolder(meta, base);
    $("video").hidden = false;
    status(settings.hasApiKey ? "" : "先配置 Obsidian 连接，即可导入。");
    const job = await send({ type: "quick-status", bvid: meta.bvid, cid: page.cid, base });
    jobKey = job.key; showJob(job.state);
    await preview();
  } catch (error) { page = null; status(error.message, true); }
  finally { reading = false; controls(); }
}
$("source-form").addEventListener("submit", event => { event.preventDefault(); loadVideo(); });
$("refresh-preview").addEventListener("click", preview);
$("import").addEventListener("click", async () => {
  if ($("import").disabled) return;
  showJob({ status: "running" });
  try { showJob(await send({ type: "quick-import", bvid: meta.bvid, cid: page.cid, meta, base })); }
  catch (error) { showJob({ status: "failed", error: error.message }); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && jobKey && changes[jobKey]) showJob(changes[jobKey].newValue);
});
$("workspace").addEventListener("click", async () => {
  const target = new URL(chrome.runtime.getURL("course.html"));
  if (meta && page) { target.searchParams.set("bvid", meta.bvid); target.searchParams.set("p", page.page); }
  await chrome.tabs.create({ url: target.href }); window.close();
});
$("settings").addEventListener("click", () => {
  $("api-url").value = settings.obsidianApiBaseUrl; $("api-key").value = "";
  $("api-key").placeholder = settings.hasApiKey ? "已保存，留空保留原 Key" : "粘贴 Local REST API Key";
  $("note-folder").value = settings.noteFolder; $("settings-status").textContent = "";
  $("clipper").hidden = true; $("connection").hidden = false;
});
$("back").addEventListener("click", () => { $("connection").hidden = true; $("clipper").hidden = false; });
async function saveSettings(testOnly) {
  const ids = ["test", "save", "api-url", "api-key", "note-folder", "back"];
  ids.forEach(id => $(id).disabled = true);
  $("settings-status").textContent = testOnly ? "正在测试连接…" : "正在保存…";
  try {
    await send({ type: testOnly ? "settings-test" : "settings-save", settings: { obsidianApiBaseUrl: $("api-url").value, obsidianApiKey: $("api-key").value, noteFolder: $("note-folder").value } });
    if (testOnly) $("settings-status").textContent = "连接成功，请保存设置。";
    else {
      $("api-key").value = ""; await refreshSettings();
      $("connection").hidden = true; $("clipper").hidden = false;
      if (page) await loadVideo(); else status("连接设置已保存，读取视频后即可导入。");
    }
  } catch (error) { $("settings-status").textContent = error.message; }
  finally { ids.forEach(id => $(id).disabled = false); }
}
$("test").addEventListener("click", () => saveSettings(true));
$("save").addEventListener("click", () => saveSettings(false));
async function init() {
  await refreshSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab?.url);
    if (url.hostname === "www.bilibili.com" && /^\/video\/BV[0-9A-Za-z]+/.test(url.pathname)) {
      $("url").value = url.href; await loadVideo();
    }
  } catch { /* Non-video tabs use the manual input. */ }
}
init().catch(error => status(error.message, true));
