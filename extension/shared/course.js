/* Shared by the course page, background worker, and tests. */
(function (root) {
  const marker = "<!-- boc-course-index:v1 -->";
  function safeName(value) {
    const name = String(value || "").normalize("NFC").replace(/[<>:"/\\|?*\x00-\x1f\[\]#^]/g, "_").replace(/[. ]+$/g, "").trim();
    return (name || "未命名").slice(0, 70);
  }
  function normalizeFolder(value) {
    const parts = String(value || "").trim().replace(/\\/g, "/").split("/");
    if (!parts.length || parts.some(p => !p || p === "." || p === ".." || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p))) {
      throw new Error("请输入笔记库内的相对目录，例如 Clippings/Bilibili。");
    }
    return parts.join("/");
  }
  function chapterOf(title) {
    const text = String(title || "").normalize("NFKC").trim();
    // Lecture numbers may follow a playlist position or a course code. Dotted
    // segments (02.1), Part numbers and LIVE recordings share one lecture.
    const lecture = text.match(/\b(?:lecture|lec)\s*[.#:-]?\s*(\d{1,3})(?!\d)/i);
    if (lecture) return normalizeChapter(lecture[1]);
    const numbered = text.match(/^(\d{1,3})\.(\d{1,3})(?=[._+\s:、-]|$)/);
    if (numbered) return normalizeChapter(`${numbered[1]}.${numbered[2]}`);
    const chapter = text.match(/^(\d{1,3})[.、](?!\d)/);
    if (chapter) return normalizeChapter(chapter[1]);
    const chinese = text.match(/(?:^|[\s:·【(])第([\d零〇一二两三四五六七八九十百]+)(章|节|讲|课)/);
    if (!chinese) return "0";
    const first = chineseNumber(chinese[1]);
    const section = chinese[2] === "章" && text.slice(chinese.index + chinese[0].length).match(/^\s*[、:.-]?\s*第([\d零〇一二两三四五六七八九十百]+)节/);
    const second = section ? chineseNumber(section[1]) : null;
    return normalizeChapter(String(first) + (second === null ? "" : `.${second}`)) || "0";
  }
  function chineseNumber(value) {
    if (/^\d+$/.test(value)) return Number(value);
    const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (!/[十百]/.test(value)) return Number([...value].map(char => digits[char]).join(""));
    let total = 0, digit = 0;
    for (const char of value) {
      if (char === "十" || char === "百") { total += (digit || 1) * (char === "十" ? 10 : 100); digit = 0; }
      else digit = digits[char];
    }
    return total + digit;
  }
  function normalizeChapter(value) {
    const text = String(value ?? "").normalize("NFKC").trim();
    return /^\d{1,3}(?:\.\d{1,3})?$/.test(text) ? text.split(".").map(Number).join(".") : null;
  }
  function compareChapters(a, b) {
    const left = String(a).split(".").map(Number), right = String(b).split(".").map(Number);
    return left[0] - right[0] || (left[1] ?? -1) - (right[1] ?? -1);
  }
  function chapterLabel(chapter) {
    const value = normalizeChapter(chapter);
    return !value || value === "0" ? "未分章" : value.includes(".") ? `第${value}节` : `第${value.padStart(2, "0")}章`;
  }
  function parseSource(source) {
    const value = String(source || "").trim();
    if (/^BV[0-9A-Za-z]+$/.test(value)) return { platform: "bilibili", id: value, page: 1 };
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== "https:") return null;
    if (url.hostname === "www.bilibili.com") {
      const id = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]+)/)?.[1];
      return id ? { platform: "bilibili", id, page: Math.max(1, Number(url.searchParams.get("p")) || 1) } : null;
    }
    const id = url.hostname === "youtu.be" ? url.pathname.replace(/^\/+|\/+$/g, "") :
      ["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname) && url.pathname === "/watch" ? url.searchParams.get("v") : null;
    if (!/^[\w-]{11}$/.test(id || "")) return null;
    const playlistId = /^[\w-]{8,60}$/.test(url.searchParams.get("list") || "") ? url.searchParams.get("list") : "";
    return { platform: "youtube", id, playlistId, page: 1 };
  }
  function courseFolder(meta, base) {
    return `${normalizeFolder(base)}/${safeName(meta.title)} [${meta.platform === "youtube" ? meta.playlistId ? `YT-PL-${meta.playlistId}` : `YT-${meta.videoId}` : meta.bvid}]`;
  }
  function rawPath(meta, page, base) {
    return `${courseFolder(meta, base)}/原始字幕/${safeName(page.part)} [${meta.platform === "youtube" ? `YT-${page.cid}` : `CID-${page.cid}`}].md`;
  }
  function videoUrl(meta, page) {
    return meta.platform === "youtube" ? `https://www.youtube.com/watch?v=${page.cid}` : `https://www.bilibili.com/video/${meta.bvid}/?p=${page.page}`;
  }
  function timestampUrl(meta, page, seconds) {
    const url = new URL(videoUrl(meta, page));
    url.searchParams.set("t", String(Math.floor(seconds)));
    return url.href;
  }
  function timestamp(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    return [Math.floor(n / 3600), Math.floor(n % 3600 / 60), n % 60].map(x => String(x).padStart(2, "0")).join(":");
  }
  function groupSubtitles(body, platform) {
    const groups = [];
    let current = null;
    const flush = () => { if (current) groups.push(current); current = null; };
    // Keep source cues intact for fetching and language checks. Both previews
    // and Markdown use these reading blocks; no text is summarized or deduped.
    for (const cue of body || []) {
      const content = String(cue.content || "").replace(/\s+/g, " ").trim();
      if (!content || !Number.isFinite(cue.from)) continue;
      const end = Number.isFinite(cue.to) ? Math.max(cue.from, cue.to) : cue.from;
      if (current && (cue.from - current.to > 20 || end - current.from > 30
        || (platform === "youtube" && /^(?:>>|[-–—]\s)/.test(content)))) flush();
      if (!current) current = { from: cue.from, to: end, content };
      else { current.content += " " + content; current.to = Math.max(current.to, end); }
      if (platform === "youtube" && /[.!?。！？][)\]"'”’）]*$/.test(content)) flush();
    }
    flush();
    return groups;
  }
  function buildRaw(meta, page, track, body) {
    const q = JSON.stringify;
    const partTitle = String(page.part || "").replace(/\r?\n/g, " ").trim() || `P${page.page}`;
    return ["---", `title: ${q(partTitle)}`, `course: ${q(meta.title)}`,
      `url: ${q(videoUrl(meta, page))}`, ...(meta.platform === "youtube" ? [`platform: youtube`, `youtube_id: ${q(page.cid)}`] : [`bvid: ${q(meta.bvid)}`, `cid: ${q(page.cid)}`]),
      `page: ${page.page}`, `chapter: ${q(page.chapter)}`, `author: ${q(meta.author)}`,
      `subtitle_lang: ${q(track.lanDoc || track.lan)}`, ...(track.source ? [`subtitle_source: ${q(track.source)}`] : []), `created: ${q(new Date().toISOString())}`,
      `tags: [clippings, ${meta.platform === "youtube" ? "youtube" : "bilibili"}, course-source]`, "---", "", `# ${partTitle}`, "",
      track.source === "local-asr" ? "> 本地模型转写的原始素材，可能有错词。请结合视频核对；板书、图表和公式仍需回看。" : "> 原始字幕素材。章节归属以课程导入清单为准；字幕不能完整替代视频中的板书、图表和公式。", "", "## 字幕", "",
      ...groupSubtitles(body, meta.platform).map(item => `[${timestamp(item.from)}](${timestampUrl(meta, page, item.from)}) ${item.content}\n`), ""].join("\n");
  }
  function tableText(value) { return String(value || "").replace(/\|/g, "\\|").replace(/[\r\n]/g, " "); }
  function buildIndex(meta, pages, base) {
    const lines = [marker, `# ${meta.title} · 课程导入清单`, "", "> 此文件由批量导入器更新。学习批注请写入最终章节笔记。", "",
      `课程：[${meta.platform === "youtube" ? meta.playlistId || meta.videoId : meta.bvid}](${meta.playlistId ? `https://www.youtube.com/playlist?list=${meta.playlistId}` : videoUrl(meta, pages[0])})`, `更新：${new Date().toISOString()}`, "",
      meta.platform === "youtube" ? "原始字幕以视频标题命名，YouTube 视频 ID 用于避免同名冲突。" : "原始字幕以分 P 名称命名，CID 用于区分同名视频；分章以本清单为准。", "",
      "下一步：在工作台的“整理笔记”页面填写偏好，复制任务指令；将本清单与指定范围的字幕交给你选择的 AI，默认按确认的分组每组整理一篇笔记。英文课程以 Lecture 为基本单元（Lecture 02.1–02.4 同属 2，合成一篇）；普通数字章节如 2.2、2.3 分别成篇。未分章项需确定整理范围。", ""];
    const chapters = [...new Set(pages.map(p => p.chapter))].sort(compareChapters);
    for (const chapter of chapters) {
      lines.push(`## ${chapterLabel(chapter)}`, "", "| P | 标题 | 状态 | 原始素材 |", "|---|---|---|---|");
      for (const page of pages.filter(p => p.chapter === chapter)) {
        const available = ["saved", "exists"].includes(page.status);
        const labels = { saved: "已导入", exists: "已存在，跳过", missing: "无可用字幕", failed: "失败", pending: "待导入", running: "待核实" };
        const status = `${labels[page.status] || "待导入"}${page.error ? `：${page.error}` : ""}`;
        const filename = (page.sourcePath || rawPath(meta, page, base)).split("/").pop();
        const link = available ? `[字幕](<原始字幕/${filename}>)` : "—";
        lines.push(`| [P${page.page}](${videoUrl(meta, page)}) | ${tableText(page.part)} | ${tableText(status)} | ${link} |`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }
  root.CourseCore = { marker, safeName, normalizeFolder, chapterOf, normalizeChapter, compareChapters, chapterLabel, parseSource, courseFolder, rawPath, videoUrl, timestampUrl, groupSubtitles, buildRaw, buildIndex };
  if (typeof module !== "undefined") module.exports = root.CourseCore;
})(globalThis);
