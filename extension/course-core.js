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
    const match = String(title).match(/^\s*(\d{1,3})[.．]/);
    return match ? String(Number(match[1])) : "0";
  }
  function chapterLabel(chapter) {
    return Number(chapter) > 0 ? `第${String(Number(chapter)).padStart(2, "0")}章` : "未分章";
  }
  function courseFolder(meta, base) {
    return `${normalizeFolder(base)}/${safeName(meta.title)} [${meta.bvid}]`;
  }
  function rawPath(meta, page, base) {
    // CID keeps identity stable when the publisher reorders or renames parts.
    return `${courseFolder(meta, base)}/原始字幕/CID-${page.cid}.md`;
  }
  function videoUrl(meta, page) {
    return `https://www.bilibili.com/video/${meta.bvid}/?p=${page.page}`;
  }
  function timestamp(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    return [Math.floor(n / 3600), Math.floor(n % 3600 / 60), n % 60].map(x => String(x).padStart(2, "0")).join(":");
  }
  function buildRaw(meta, page, track, body) {
    const q = JSON.stringify;
    return ["---", `title: ${q(`P${page.page} ${page.part}`)}`, `course: ${q(meta.title)}`,
      `url: ${q(videoUrl(meta, page))}`, `bvid: ${q(meta.bvid)}`, `cid: ${q(page.cid)}`,
      `page: ${page.page}`, `chapter: ${q(page.chapter)}`, `author: ${q(meta.author)}`,
      `subtitle_lang: ${q(track.lanDoc || track.lan)}`, `created: ${q(new Date().toISOString())}`,
      "tags: [clippings, bilibili, course-source]", "---", "", `# P${page.page} ${page.part}`, "",
      "> 原始字幕素材。章节归属以课程导入清单为准；字幕不能完整替代视频中的板书、图表和公式。", "", "## 字幕", "",
      ...body.map(item => `[${timestamp(item.from)}](${videoUrl(meta, page)}&t=${Math.floor(item.from)}) ${String(item.content).replace(/\r?\n/g, " ")}`), ""].join("\n");
  }
  function tableText(value) { return String(value || "").replace(/\|/g, "\\|").replace(/[\r\n]/g, " "); }
  function buildIndex(meta, pages, base) {
    const lines = [marker, `# ${meta.title} · 课程导入清单`, "", "> 此文件由批量导入器更新。学习批注请写入最终章节笔记。", "",
      `课程：[${meta.bvid}](https://www.bilibili.com/video/${meta.bvid}/)`, `更新：${new Date().toISOString()}`, "",
      "原始字幕按 CID 保存，文件名不随分 P 排序变化。分章以本清单为准。", "",
      "在 Obsidian 中交给 AI：请先阅读 Clippings/CLAUDE.md，再按这份清单整理指定章节，每章一篇笔记；列明缺失素材。", ""];
    const chapters = [...new Set(pages.map(p => p.chapter))].sort((a, b) => Number(a) - Number(b));
    for (const chapter of chapters) {
      lines.push(`## ${chapterLabel(chapter)}`, "", "| P | 标题 | 状态 | 原始素材 |", "|---|---|---|---|");
      for (const page of pages.filter(p => p.chapter === chapter)) {
        const available = ["saved", "exists"].includes(page.status);
        const labels = { saved: "已导入", exists: "已存在，跳过", missing: "无可用字幕", failed: "失败", pending: "待导入", running: "待核实" };
        const status = `${labels[page.status] || "待导入"}${page.error ? `：${page.error}` : ""}`;
        const link = available ? `[字幕](原始字幕/CID-${page.cid}.md)` : "—";
        lines.push(`| [P${page.page}](${videoUrl(meta, page)}) | ${tableText(page.part)} | ${tableText(status)} | ${link} |`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }
  root.CourseCore = { marker, safeName, normalizeFolder, chapterOf, chapterLabel, courseFolder, rawPath, videoUrl, buildRaw, buildIndex };
  if (typeof module !== "undefined") module.exports = root.CourseCore;
})(globalThis);
