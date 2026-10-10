/* Optional local transcription stays separate from the ordinary subtitle path. */
const ASR_BASE = "http://127.0.0.1:27347";

async function asrRequest(path, method = "GET", body, token = "") {
  let response;
  try {
    response = await fetch(`${ASR_BASE}${path}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { "X-Course-Cove-Token": token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("本地转写组件未启动。请运行安装目录中的“启动本地转写.cmd”。");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `本地转写请求失败 HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function asrToken() {
  return String((await chrome.storage.local.get("asrToken")).asrToken || "");
}

async function asrStatus() {
  const token = await asrToken();
  const paired = Boolean(token);
  let health;
  try { health = await asrRequest("/health"); }
  catch { return { installed: false, connected: false, paired, error: "本地转写服务未启动。启动后点击“重新检测”。" }; }
  if (health.service !== "course-cove-asr" || health.version !== 1 || !health.model_ready) {
    return { installed: true, connected: false, paired, error: "本地转写组件或模型尚未准备好。" };
  }
  if (health.audio_backups !== true) {
    return { installed: true, connected: false, paired, error: "检测到仍在运行的旧版转写服务。请关闭所有转写窗口后只启动一次，再点击“重新检测”。" };
  }
  if (!token) return { installed: true, connected: false, paired: false, needsPairing: true };
  try {
    await asrRequest("/pair", "GET", null, token);
    return { installed: true, connected: true, paired: true,
      device: health.device, gpuEnabled: health.gpu_enabled, gpuNotice: health.gpu_notice, youtubeAudio: health.youtube_audio === true };
  }
  catch (error) {
    return error.status === 401
      ? { installed: true, connected: false, paired: true, needsPairing: true, error: "已保存的连接码与当前服务不匹配，请重新填写。" }
      : { installed: true, connected: false, paired: true, needsPairing: false, error: "连接暂时失败，请点击“重新检测”。" };
  }
}

async function asrPair(value) {
  const token = String(value || "").trim();
  if (!/^[0-9a-f]{48,128}$/i.test(token)) throw new Error("请粘贴安装向导给出的完整连接码。");
  await asrRequest("/pair", "GET", null, token);
  await chrome.storage.local.set({ asrToken: token });
  if (await asrToken() !== token) throw new Error("连接码未能保存，请检查扩展存储权限。");
  return { installed: true, connected: true };
}

async function asrAudioUrls(meta, page) {
  if (meta.platform === "youtube") return (await youtubeRead(page.cid, false, true)).audioUrls;
  const query = new URLSearchParams({ bvid: meta.bvid, cid: page.cid, qn: "16", fnval: "16", fourk: "0" });
  const payload = await courseBiliJson(`https://api.bilibili.com/x/player/playurl?${query}`);
  const dashAudio = payload.data?.dash?.audio || [];
  const entry = [...dashAudio].sort((a, b) => Number(a.bandwidth || 0) - Number(b.bandwidth || 0))[0]
    || payload.data?.durl?.[0];
  const backups = entry?.backupUrl || entry?.backup_url || [];
  const urls = [entry?.baseUrl || entry?.base_url || entry?.url, ...(Array.isArray(backups) ? backups : [])].filter(Boolean);
  if (!urls.length) throw new Error("B站没有返回可下载的音轨，无法进行本地转写。");
  return [...new Set(urls.map(value => {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !["bilivideo.com", "hdslb.com", "bilibili.com"].some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
      throw new Error("B站返回了不受支持的音频地址。");
    }
    return parsed.href;
  }))].slice(0, 4);
}

async function asrStart(meta, page) {
  const token = await asrToken();
  if (!token) throw new Error("先安装并连接本地转写组件。");
  const audioUrls = await asrAudioUrls(meta, page);
  return asrRequest("/jobs", "POST", { bvid: meta.bvid, cid: page.cid, audio_url: audioUrls[0], audio_urls: audioUrls }, token);
}

async function asrPoll(jobId) {
  if (!/^[0-9a-f]{32}$/.test(jobId || "")) throw new Error("转写任务编号无效。");
  const token = await asrToken();
  if (!token) throw new Error("先连接本地转写组件。");
  return asrRequest(`/jobs/${jobId}`, "GET", null, token);
}

async function asrCancel(jobId) {
  if (!/^[0-9a-f]{32}$/.test(jobId || "")) throw new Error("转写任务编号无效。");
  const token = await asrToken();
  if (!token) throw new Error("先连接本地转写组件。");
  return asrRequest(`/jobs/${jobId}`, "DELETE", null, token);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["asr-status", "asr-pair"].includes(message?.type)) return false;
  if (sender.id !== chrome.runtime.id || !["workbench/index.html", "popup/index.html"].some(file => String(sender.url || "").split(/[?#]/)[0] === chrome.runtime.getURL(file))) {
    sendResponse({ ok: false, error: "请从扩展页面连接本地转写组件。" });
    return false;
  }
  Promise.resolve().then(() => message.type === "asr-status" ? asrStatus() : asrPair(message.token))
    .then(data => sendResponse({ ok: true, ...data }))
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
