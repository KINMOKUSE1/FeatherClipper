/* 在线任务放在扩展内部的 offscreen 页面，后台只负责鉴权与路由。 */
const ONLINE_ASR_PAGE = "transcription/worker.html";
let onlineAsrMessages = Promise.resolve();

function onlineAsrRequest(action, data = {}) {
  // Serialize document creation/cleanup so importing one job cannot close a new job's page.
  const pending = onlineAsrMessages.then(() => sendOnlineAsr(action, data));
  onlineAsrMessages = pending.catch(() => {});
  return pending;
}

async function sendOnlineAsr(action, data) {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL(ONLINE_ASR_PAGE)] });
  if (!contexts.length) {
    if (action !== "start") throw new Error("在线转写任务已结束，请重新开始");
    await chrome.offscreen.createDocument({ url: ONLINE_ASR_PAGE, reasons: ["BLOBS"],
      justification: "下载课程音轨，使用 Web Audio 解码并切分 WAV，调用用户选择的转写服务" });
  }
  const result = await chrome.runtime.sendMessage({ target: "online-asr", action, ...data });
  if (!result?.ok) throw new Error(result?.error || "在线音频处理页面未响应");
  if (action === "forget" && result.empty) await chrome.offscreen.closeDocument();
  return result;
}

async function onlineAsrStart(meta, page, provider, apiKey, urls) {
  // Only this extension's CDN requests receive the Bilibili media Referer.
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [7001], addRules: [{ id: 7001, priority: 1,
    action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: "https://www.bilibili.com/" }] },
    condition: { initiatorDomains: [chrome.runtime.id], requestDomains: ["bilivideo.com", "hdslb.com"], resourceTypes: ["xmlhttprequest"] }
  }] });
  return onlineAsrRequest("start", { id: `online-${crypto.randomUUID().replace(/-/g, "")}`, bvid: meta.bvid, cid: page.cid, provider, apiKey, urls });
}
