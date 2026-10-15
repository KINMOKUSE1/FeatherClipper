/* Loaded only by preview.html; never included in the extension entry pages. */
(() => {
  if (window.frameElement?.id !== "popup-preview") return;
  const scenario = window.frameElement.dataset.scenario;
  const series = ["series", "saving", "saved"].includes(scenario);
  const settings = {
    hasApiKey: scenario !== "unconfigured",
    obsidianApiBaseUrl: "http://127.0.0.1:27123",
    noteFolder: "Clippings/Bilibili"
  };
  const store = {};
  const meta = {
    bvid: "BV1ps4y1d73V", author: "示例讲师",
    title: series ? "王道计算机考研 计算机组成原理" : "从地址栏输入网址到页面显示：一次 HTTP 请求与响应的完整过程，以及浏览器如何解析与渲染网页",
    pages: Array.from({ length: series ? 92 : 1 }, (_, i) => ({
      cid: String(i + 1), page: i + 1, part: i === 0 ? "课程白嫖指南" : `第 ${i + 1} 节 · 课程内容`, duration: 1800
    }))
  };
  const chinese = [
    "这节课我们从浏览器输入网址开始，理解一次请求的完整过程。",
    "浏览器首先需要确定服务器的地址，然后建立连接，发送 HTTP 请求。",
    "服务器处理请求并返回响应，浏览器开始解析 HTML，构建页面的结构。",
    "CSS 决定内容的布局与样式，JavaScript 则可以修改页面并响应用户操作。",
    "结构、样式和行为共同决定了你最终看到的网页。"
  ];
  let jobState = scenario === "saving" ? { status: "running" } : scenario === "saved" ? { status: "saved" } : null;
  async function sendMessage(message) {
    if (message.type === "video-seek") return { ok: false, error: "开发预览不控制视频页，请在扩展中测试时间跳转" };
    if (message.type === "settings-get") return { ok: true, settings: { ...settings } };
    if (message.type === "settings-test") return { ok: true };
    if (message.type === "settings-save") {
      settings.obsidianApiBaseUrl = message.settings.obsidianApiBaseUrl;
      settings.noteFolder = message.settings.noteFolder;
      settings.hasApiKey ||= Boolean(message.settings.obsidianApiKey);
      return { ok: true, settings: { ...settings } };
    }
    if (message.type === "quick-status") return { ok: true, key: "preview-job", state: jobState };
    if (message.type === "quick-import") {
      await new Promise(resolve => setTimeout(resolve, 800));
      jobState = { status: "saved" };
      return { ok: true, ...jobState };
    }
    if (message.type === "course-request") {
      if (message.action === "meta") return { ok: true, meta, folder: settings.noteFolder };
      if (message.action === "preview") {
        if (scenario === "loading") return new Promise(() => {});
        if (scenario === "error") return { ok: false, error: "字幕读取失败，请登录视频平台后重试。（示例）" };
        if (scenario === "missing") return { ok: true, tracks: [], body: [], missing: true };
        const english = message.trackId === "en";
        const lines = english ? ["We begin with a URL entered in the browser and follow the entire request.", "The browser finds the server address, establishes a connection, and sends an HTTP request.", "The server returns a response. The browser parses HTML to build the page structure.", "CSS controls layout and appearance. JavaScript changes the page and responds to user actions.", "Structure, style, and behavior determine the page you see."] : chinese;
        return { ok: true, tracks: [{ id: "zh", lan: "zh", lanDoc: "中文" }, { id: "en", lan: "en", lanDoc: "English" }], track: { id: english ? "en" : "zh", lan: english ? "en" : "zh", lanDoc: english ? "English" : "中文" }, body: lines.map((content, i) => ({ from: i * 35, to: i * 35 + 12, content })) };
      }
    }
    return { ok: false, error: "开发预览未模拟此操作。" };
  }
  // All extension operations below remain inside this preview's memory.
  window.chrome = {
    downloads: {
      download: async ({ url, filename }) => {
        const link = document.createElement("a");
        link.href = url; link.download = filename;
        document.body.append(link); link.click(); link.remove();
        return 1;
      }
    },
    runtime: { sendMessage, getURL: name => new URL(`../${name}`, document.baseURI).href },
    storage: {
      local: {
        get: async key => key == null ? { ...store } : { [key]: store[key] },
        set: async values => { Object.assign(store, values); }
      },
      onChanged: { addListener() {} }
    },
    tabs: {
      query: async () => [{ url: scenario === "empty" ? "https://example.org/" : "https://www.bilibili.com/video/BV1ps4y1d73V/" }],
      create: async ({ url }) => {
        const target = new URL(url);
        const text = target.searchParams.get("asr") === "1" ? "预览：正式扩展会打开音频转写工作台。"
          : target.searchParams.get("scope") === "all" ? "预览：正式扩展会打开工作台并选中整门课程。"
          : "预览：正式扩展会打开工作台，供你选择章节。";
        window.parent.postMessage({ type: "preview-navigation", text }, new URL(document.baseURI).origin);
        return {};
      }
    }
  };
  window.close = () => {};
})();
