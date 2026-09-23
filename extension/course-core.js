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
  function buildStudyPrompt(meta, pages, base) {
    const folder = normalizeFolder(base);
    const targets = pages.filter(page => page.selected);
    if (meta && !targets.length) throw new Error("请先在课程列表勾选要整理的分 P。");
    const lines = ["请按我的个人学习规则，以及学习指南和笔记模板整理课程素材。已安装 course-notes 技能时使用该技能。",
      `学习文档：${folder}/学习工作流/WORKFLOW.md 与 NOTE_TEMPLATE.md。`];
    if (meta && targets.length) {
      lines.push(`课程：${meta.title}`, `课程清单：${courseFolder(meta, folder)}/课程导入清单.md`,
        `本次范围：${targets.map(page => `P${page.page}`).join("、")}。`,
        ...targets.map(page => `- P${page.page} ${page.part}：${rawPath(meta, page, folder)}`),
        "核对这些文件的实际可用情况。按清单中的章节组织笔记，限于上述 P；部分章节注明覆盖范围，未分章视频各自整理。");
    } else {
      lines.push("课程目录：[填写已导入课程的目录]", "本次范围：[填写章号、P序号或文件名]");
    }
    lines.push("保留教师例题的具体数据、代码、推导与结论，附来源、自测题和答案。缺少的板书、公式或题干列为待核实。保留已有批注，按个人目录保存笔记并更新整理进度。",
      "使用本地工具时读取上述文件；使用聊天工具时，我会一并上传或粘贴文档与素材。");
    return lines.join("\n");
  }
  function buildIndex(meta, pages, base) {
    const lines = [marker, `# ${meta.title} · 课程导入清单`, "", "> 此文件由批量导入器更新。学习批注请写入最终章节笔记。", "",
      `课程：[${meta.bvid}](https://www.bilibili.com/video/${meta.bvid}/)`, `更新：${new Date().toISOString()}`, "",
      "原始字幕按 CID 保存，文件名不随分 P 排序变化。分章以本清单为准。", "",
      "下一步：在导入器点击“开始整理笔记”，保存学习指南与模板，或下载 course-notes 技能。将本清单与指定范围的字幕交给你选择的 AI，按章整理学习笔记。", ""];
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
  root.CourseCore = { marker, safeName, normalizeFolder, chapterOf, chapterLabel, courseFolder, rawPath, videoUrl, buildRaw, buildIndex, buildStudyPrompt };
  if (typeof module !== "undefined") module.exports = root.CourseCore;
})(globalThis);
