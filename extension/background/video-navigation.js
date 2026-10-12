/* 字幕时间戳跳转：优先复用视频标签页，并保留已有播放器的播放状态。 */
async function seekVideoInPage(source, seconds, paused = null) {
  const deadline = Date.now() + 10000;
  do {
    const url = new URL(location.href);
    const matches = source.platform === "youtube"
      ? url.searchParams.get("v") === source.id
      : url.pathname.match(/^\/video\/(BV[0-9A-Za-z]+)/)?.[1] === source.id
        && (Number(url.searchParams.get("p")) || 1) === source.page;
    const video = document.querySelector(source.platform === "youtube" ? "#movie_player video" : "video");
    if (seconds === null) return matches && video ? video.paused : null;
    if (matches && video?.readyState >= 1) {
      if (source.platform === "youtube" && document.querySelector("#movie_player.ad-showing")) {
        throw new Error("请等广告结束后再跳转");
      }
      const wasPaused = paused ?? video.paused;
      video.currentTime = Math.min(seconds, Number.isFinite(video.duration) ? video.duration : seconds);
      if (wasPaused) video.pause();
      else if (video.paused) await video.play();
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error("视频播放器尚未就绪，请加载视频后重试");
}

async function navigateToVideoTime(value) {
  const source = CourseCore.parseSource(value);
  const target = new URL(value);
  const time = target.searchParams.get("t");
  const seconds = Number(time);
  if (!source || time === null || !time.trim() || !Number.isFinite(seconds) || seconds < 0) {
    throw new Error("视频时间链接无效");
  }
  const url = CourseCore.timestampUrl(source.platform === "youtube" ? { platform: "youtube" } : { bvid: source.id },
    { cid: source.id, page: source.page }, seconds);
  const tabs = await chrome.tabs.query({ url: source.platform === "youtube"
    ? ["https://www.youtube.com/watch*", "https://m.youtube.com/watch*"]
    : ["https://www.bilibili.com/video/*"] });
  const candidates = tabs.map(tab => ({ tab, source: CourseCore.parseSource(tab.url) }))
    .filter(item => item.source?.platform === source.platform && item.source.id === source.id)
    .sort((a, b) => Number(b.tab.active) - Number(a.tab.active) || (b.tab.lastAccessed || 0) - (a.tab.lastAccessed || 0));
  const exact = candidates.find(item => source.platform === "youtube" || item.source.page === source.page);
  let tab = exact?.tab || candidates[0]?.tab;
  let paused = null;
  if (tab && !exact) {
    const snapshot = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: seekVideoInPage, args: [candidates[0].source, null] });
    paused = snapshot[0]?.result ?? null;
  }
  const navigating = !exact;
  if (tab) tab = await chrome.tabs.update(tab.id, { active: true, ...(navigating ? { url } : {}) });
  else tab = await chrome.tabs.create({ url, active: true });
  if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true });
  if (navigating) {
    const deadline = Date.now() + 15000;
    let ready = false;
    do {
      const current = await chrome.tabs.get(tab.id);
      const loaded = CourseCore.parseSource(current.url);
      if (current.status === "complete" && loaded?.platform === source.platform && loaded.id === source.id
        && (source.platform === "youtube" || loaded.page === source.page)) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    if (!ready) throw new Error("视频页面尚未加载完成，请稍后重试");
  }
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: seekVideoInPage, args: [source, seconds, paused] });
  if (results[0]?.result !== true) throw new Error("未能定位视频时间，请重试");
  return { tabId: tab.id };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "video-seek") return false;
  if (sender.id !== chrome.runtime.id || !["workbench/index.html", "popup/index.html"].some(file => String(sender.url || "").split(/[?#]/)[0] === chrome.runtime.getURL(file))) {
    sendResponse({ ok: false, error: "请从扩展的字幕预览跳转" }); return false;
  }
  navigateToVideoTime(message.url).then(data => sendResponse({ ok: true, ...data })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
