/* Offscreen 页面拥有长任务；后台 worker 重启不会丢失正在转写的音频。 */
const jobs = new Map(), controllers = new Map();
let queue = Promise.resolve();

async function run(job, input, controller) {
  try {
    controller.signal.throwIfAborted();
    const result = await OnlineAudio.transcribe(input, controller.signal, update => {
      if (!controller.signal.aborted) Object.assign(job, update);
    });
    controller.signal.throwIfAborted();
    Object.assign(job, result, { status: "done", detail: "转写完成", progress: 1 });
  } catch (error) {
    Object.assign(job, { status: controller.signal.aborted ? "canceled" : "failed",
      detail: controller.signal.aborted ? "已停止转写" : error.message });
  } finally { controllers.delete(job.id); }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== "online-asr" || sender.id !== chrome.runtime.id
    || (sender.url && sender.url !== chrome.runtime.getURL("background/index.js"))) return false;
  try {
    if (message.action === "start") {
      const { id, bvid, cid, provider, urls, apiKey } = message;
      if (!OnlineAudio.providers[provider] || !Array.isArray(urls) || !urls.length || !urls.every(OnlineAudio.allowedAudioUrl)
        || !/^online-[0-9a-f]{32}$/.test(id) || typeof apiKey !== "string" || !apiKey) throw new Error("在线转写任务参数无效");
      let job = [...jobs.values()].find(item => item.bvid === bvid && item.cid === cid && item.provider === provider && !["failed", "canceled"].includes(item.status));
      if (!job) {
        job = { id, bvid, cid, provider, status: "queued", progress: 0, detail: "等待转写" };
        jobs.set(id, job);
        const controller = new AbortController(); controllers.set(id, controller);
        queue = queue.then(() => run(job, { provider, urls, apiKey }, controller));
      }
      respond({ ok: true, id: job.id, status: job.status });
    } else {
      const job = jobs.get(message.id);
      if (!job) throw new Error("在线转写任务不存在，请重新开始");
      if (message.action === "cancel") {
        controllers.get(job.id)?.abort();
        job.status = "canceled"; job.detail = "已停止转写";
      } else if (message.action === "forget") {
        if (controllers.has(job.id)) throw new Error("转写尚未结束");
        jobs.delete(job.id);
      } else if (message.action !== "poll") throw new Error("未知的在线转写操作");
      respond({ ok: true, ...job, empty: jobs.size === 0 });
    }
  } catch (error) { respond({ ok: false, error: error.message }); }
  return false;
});
