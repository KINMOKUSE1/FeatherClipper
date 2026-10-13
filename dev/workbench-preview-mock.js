/* Only the preview host injects this file. All writes stay in this frame's memory. */
(() => {
  if (window.frameElement?.id !== "workbench-preview") return;
  const scenario = window.frameElement.dataset.scenario;
  const previewAssets = new URL("covers/", document.currentScript.src);
  const store = {}, files = new Map(), jobs = new Map();
  const settings = { hasApiKey: scenario !== "unconfigured", obsidianApiBaseUrl: "http://127.0.0.1:27123", noteFolder: scenario === "youtube" ? "Clippings/YouTube" : "Clippings/Bilibili" };
  let paired = false;
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const titles = [
    "课程导览：从一个网页请求开始", "1. 网络分层与协议", "1. TCP/IP 的四层结构",
    "2. 从地址栏输入网址到页面显示：HTTP 请求与响应", "2. 请求方法与状态码", "2. 浏览器缓存的工作方式",
    "3. TCP 如何建立一条连接", "3. 可靠传输与重传机制", "3. 拥塞控制：让网络保持畅通",
    "4. DNS 如何找到服务器", "4. HTTPS 与证书验证", "4. 回顾：完整的网页访问过程"
  ];
  function transcript(page, platform) {
    const lines = platform === "youtube" ? [
      `In this lesson, we will explore ${page.part}.`,
      "A network protocol defines the rules that two endpoints follow when they communicate.",
      "The browser sends a request. The server processes it and returns a response.",
      "The request contains a method, a path, and headers that describe its context.",
      "Response codes let the client distinguish successful results from redirects and errors.",
      "Caching reduces repeated work by reusing a previous response when it is still valid.",
      "When you revisit the video, follow the timestamps to check each example."
    ] : [
      `这一节我们学习「${page.part.replace(/^\d+\.\s*/, "")}」，从一次具体的网页访问开始。`,
      "在地址栏输入网址以后，浏览器先确定服务器的位置，再建立连接，并发送请求。",
      "HTTP 请求包括请求方法、路径和请求头。它们共同告诉服务器，我们希望获取什么内容。",
      "服务器处理请求，然后返回状态码、响应头和正文。不同的状态码代表不同的处理结果。",
      "收到响应以后，浏览器开始解析 HTML。页面的结构、样式和交互分别由 HTML、CSS 和 JavaScript 决定。",
      "如果资源仍然有效，浏览器可以使用缓存，减少重复下载。是否可以复用，由缓存策略和验证结果决定。",
      "理解这个过程时，可以打开开发者工具的 Network 面板，观察请求头和响应头之间的对应关系。",
      "这一节的练习是选择一个你熟悉的网站，跟踪一次请求，并用自己的话描述浏览器和服务器各自做了什么。"
    ];
    return lines.map((content, i) => ({ from: i * 38, to: i * 38 + 18, content }));
  }
  function createMeta(message) {
    const youtube = Boolean(message.youtubeId);
    const single = scenario === "single" || (youtube && !message.playlistId);
    const pages = titles.slice(0, single ? 1 : titles.length).map((part, index) => ({
      cid: youtube ? `demoVID${String(index + 1).padStart(4, "0")}` : String(700001 + index), page: index + 1, part, duration: 900 + index * 73,
      thumbnail: new URL(youtube ? "network-en.svg" : "network.svg", previewAssets).href
    }));
    if (youtube) pages[Math.min(3, pages.length - 1)].cid = message.youtubeId;
    const meta = youtube ? { platform: "youtube", videoId: message.youtubeId, playlistId: message.playlistId, bvid: message.playlistId ? `YTPL_${message.playlistId}` : `YT_${message.youtubeId}`, title: single ? "Computer Networking · HTTP requests" : "Computer Networking · from protocols to practice", author: "示例讲师", pages }
      : { bvid: message.bvid, aid: "100001", title: single ? "从地址栏输入网址到页面显示：HTTP 请求与响应的完整过程" : "计算机网络：从原理到实践", author: "示例讲师", pages };
    meta.thumbnail = new URL(youtube ? "network-en.svg" : "network.svg", previewAssets).href;
    const base = settings.noteFolder;
    const key = `boc-course-v1:${meta.bvid}:${base}`;
    if (!store[key]) {
      const snapshot = pages.map((page, index) => {
        const current = index === Math.min(3, pages.length - 1);
        const status = scenario === "saved" ? "saved" : current && scenario === "missing" ? "missing" : current && scenario === "failed" ? "failed" : single ? "pending" : index < 3 ? "saved" : index === 6 ? "missing" : index === 8 ? "failed" : "pending";
        const item = { ...page, chapter: CourseCore.chapterOf(page.part), status, error: status === "failed" ? "字幕请求暂时失败" : "" };
        if (status === "saved") {
          item.sourcePath = CourseCore.rawPath(meta, item, base);
          files.set(item.sourcePath, CourseCore.buildRaw(meta, item, { lan: youtube ? "en" : "zh", lanDoc: youtube ? "English" : "中文" }, transcript(item, meta.platform)));
          const record = ImportHistory.create(meta, item, base, { status: "saved", path: item.sourcePath, track: { lanDoc: youtube ? "English" : "中文" } }, Date.now() - index * 86400000);
          store[record.id] = record;
        }
        return item;
      });
      store[key] = { title: meta.title, pages: snapshot };
    }
    return meta;
  }
  function sourcePaths(meta, pages, base) {
    return Object.fromEntries(pages.map(page => [page.cid, CourseCore.rawPath(meta, page, base)]).filter(([, path]) => files.has(path)));
  }
  function subtitleMissing(page, meta) {
    return page.page === 7 || (scenario === "missing" && page.page === Math.min(4, meta.pages.length));
  }
  async function sendMessage(message) {
    if (message.type === "video-seek") return { ok: false, error: "开发预览不控制视频页，请在扩展中测试时间跳转" };
    if (message.type === "settings-get") return { ok: true, settings: { ...settings } };
    if (["settings-save", "settings-test"].includes(message.type)) {
      message.settings ||= settings;
      const url = new URL(message.settings.obsidianApiBaseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return { ok: false, error: "请输入本机 Local REST API 地址。" };
      const folder = CourseCore.normalizeFolder(message.settings.noteFolder);
      if (!settings.hasApiKey && !message.settings.obsidianApiKey?.trim()) return { ok: false, error: "请填写示例 API Key。" };
      if (message.type === "settings-save") Object.assign(settings, { hasApiKey: settings.hasApiKey || Boolean(message.settings.obsidianApiKey?.trim()), obsidianApiBaseUrl: url.origin, noteFolder: folder });
      return { ok: true, settings: { ...settings }, connected: true };
    }
    if (message.type === "asr-status") return { ok: true, connected: paired, paired, installed: paired, needsPairing: !paired, device: "cpu", youtubeAudio: true };
    if (message.type === "asr-pair") {
      if (!message.token?.trim()) return { ok: false, error: "预览中可填入任意示例连接码。" };
      paired = true; return { ok: true, connected: true };
    }
    if (message.type !== "course-request") return { ok: false, error: "此操作未在开发预览中模拟。" };
    if (message.action === "meta") {
      if (scenario === "loading") return new Promise(() => {});
      await delay(180);
      return { ok: true, meta: createMeta(message), folder: settings.noteFolder };
    }
    const { meta, page, base } = message;
    if (message.action === "preview") {
      await delay(150);
      if (scenario === "failed" && page.page === Math.min(4, meta.pages.length)) return { ok: false, error: "字幕读取失败。请在视频页确认登录状态后重新读取。（示例）" };
      if (subtitleMissing(page, meta)) return { ok: true, body: [], missing: true };
      return { ok: true, track: { lan: meta.platform === "youtube" ? "en" : "zh", lanDoc: meta.platform === "youtube" ? "English" : "中文" }, body: transcript(page, meta.platform) };
    }
    if (message.action === "raw-paths") {
      if (!settings.hasApiKey) return { ok: false, error: "请先填写 Obsidian Local REST API Key" };
      return { ok: true, sources: sourcePaths(meta, message.pages, base) };
    }
    if (message.action === "index") {
      files.set(`${CourseCore.courseFolder(meta, base)}/课程导入清单.md`, CourseCore.buildIndex(meta, message.pages, base));
      return { ok: true, sources: sourcePaths(meta, message.pages, base) };
    }
    const path = page ? CourseCore.rawPath(meta, page, base) : "";
    if (message.action === "import") {
      await delay(500);
      if (files.has(path)) return { ok: true, status: "exists", path };
      if (subtitleMissing(page, meta)) return { ok: true, status: "missing" };
      files.set(path, CourseCore.buildRaw(meta, page, { lan: meta.platform === "youtube" ? "en" : "zh", lanDoc: meta.platform === "youtube" ? "English" : "中文" }, transcript(page, meta.platform)));
      return { ok: true, status: "saved", path };
    }
    if (message.action === "asr-start") {
      if (files.has(path)) return { ok: true, status: "exists", path };
      if (!subtitleMissing(page, meta)) return { ok: true, status: "subtitle-available" };
      const id = `preview-asr-${page.cid}`;
      jobs.set(id, { page, canceled: false });
      return { ok: true, id };
    }
    if (message.action === "asr-poll") {
      await delay(600);
      return { ok: true, status: jobs.get(message.jobId)?.canceled ? "canceled" : "done", device: "cpu" };
    }
    if (message.action === "asr-cancel") {
      const job = jobs.get(message.jobId);
      if (job) job.canceled = true;
      return { ok: true, status: "canceled" };
    }
    if (message.action === "asr-finish") {
      if (files.has(path)) return { ok: true, status: "exists", path };
      files.set(path, CourseCore.buildRaw(meta, page, { lan: "zh", lanDoc: "本地转写（示例）", source: "local-asr" }, transcript(page, meta.platform)));
      return { ok: true, status: "saved", path };
    }
    return { ok: false, error: "此课程操作未在开发预览中模拟。" };
  }
  window.chrome = {
    runtime: { sendMessage: async message => {
      try {
        const result = await sendMessage(message);
        if (message.type === "course-request" && ["import", "asr-start", "asr-finish"].includes(message.action) && ["saved", "exists"].includes(result.status)) {
          await ImportHistory.save(window.chrome.storage.local, message.meta, message.page, message.base, { ...result,
            track: { lanDoc: message.action.startsWith("asr-") ? "本地转写" : message.meta.platform === "youtube" ? "English" : "中文" } });
        }
        return result;
      }
      catch (error) { return { ok: false, error: error.message }; }
    } },
    storage: { local: {
      get: async keys => {
        const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter(key => key in store).map(key => [key, structuredClone(store[key])]));
      },
      set: async values => {
        Object.assign(store, structuredClone(values));
      },
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; }
    } }
  };
  window.addEventListener("DOMContentLoaded", async () => {
    await window.WorkbenchApp.ready;
    if (scenario === "empty") {
      const page = window.frameElement.dataset.page;
      if (["notes", "history"].includes(page)) document.getElementById(`${page}-nav`).click();
      return;
    }
    document.getElementById("url").value = scenario === "youtube"
      ? "https://www.youtube.com/watch?v=GWwL_pLuX-U&list=PLKq1TCpsv3Y4"
      : `https://www.bilibili.com/video/BV1ps4y1d73V/?p=${scenario === "single" ? 1 : 4}`;
    await window.WorkbenchApp.loadCourse();
    const page = window.frameElement.dataset.page;
    if (["notes", "history"].includes(page)) document.getElementById(`${page}-nav`).click();
  });
})();
