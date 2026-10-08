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
    const join = (left, right) => {
      const noSpace = /[\u3400-\u9fff]$/.test(left) && /^[\u3400-\u9fff]/.test(right)
        || /^[,.;:!?，。！？；：、）)\]”’]/.test(right) || /[(（\[“‘]$/.test(left);
      return left + (noSpace ? "" : " ") + right;
    };
    // Keep source cues intact for fetching and language checks. Both previews
    // and Markdown use these reading blocks; no text is summarized or deduped.
    for (const cue of body || []) {
      const content = String(cue.content || "").replace(/\s+/g, " ").trim();
      if (!content || !Number.isFinite(cue.from)) continue;
      const end = Number.isFinite(cue.to) ? Math.max(cue.from, cue.to) : cue.from;
      if (current && (cue.from - current.to > 20 || end - current.from > 30
        || (platform === "youtube" && /^(?:>>|[-–—]\s)/.test(content)))) flush();
      if (!current) current = { from: cue.from, to: end, content };
      else { current.content = join(current.content, content); current.to = Math.max(current.to, end); }
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
  const studyDefaults = {
    goal: "理解课程、完成练习与复习", outputFolder: "Note/课程笔记", author: "", language: "简体中文",
    granularity: "group", naming: "课程缩写-章节编号-主题.md", tags: ["课程笔记"],
    sections: ["核心知识点总结", "术语表", "详细笔记", "易混淆点", "思考题／自测题", "来源与待核实项", "我的补充"],
    externalSources: true, instructions: "", properties: []
  };
  function normalizeStudyPreferences(value = {}) {
    const text = key => String(value[key] ?? studyDefaults[key]).trim();
    const list = (input, fallback) => Array.isArray(input) ? input.map(String).map(item => item.trim()).filter(Boolean)
      : input == null ? [...fallback] : String(input).split(/[,，\r\n]+/).map(item => item.trim()).filter(Boolean);
    const reserved = new Set(["title", "course", "scope", "chapter", "source", "sources", "source_cids", "created", "status", "author", "tags", "__proto__", "constructor", "prototype"]);
    const names = new Set();
    const properties = (value.properties || []).map(property => {
      const name = String(property.name || "").trim();
      if (!/^[A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]*$/.test(name)) throw new Error("属性名请使用中文、英文字母、数字、下划线或连字符，不能以数字开头。");
      if (reserved.has(name)) throw new Error(`“${name}”是已有属性，请使用其他名称。`);
      if (names.has(name)) throw new Error(`属性“${name}”重复了。`);
      names.add(name);
      const type = property.type || "text";
      if (!["text", "number", "list", "boolean", "date"].includes(type)) throw new Error(`属性“${name}”的类型无效。`);
      let item = property.value ?? "";
      if (type === "number") {
        if (String(item).trim() === "" || !Number.isFinite(Number(item))) throw new Error(`属性“${name}”需要填写数字。`);
        item = Number(item);
      } else if (type === "boolean") {
        if (![true, false, "true", "false"].includes(item)) throw new Error(`属性“${name}”请选择是或否。`);
        item = item === true || item === "true";
      } else if (type === "list") item = list(item, []);
      else {
        item = String(item).trim();
        if (type === "date" && item && (!/^\d{4}-\d{2}-\d{2}$/.test(item) || Number.isNaN(Date.parse(item)) || new Date(item).toISOString().slice(0, 10) !== item)) throw new Error(`属性“${name}”需要填写有效日期。`);
      }
      return { name, type, value: item };
    });
    const result = {
      goal: text("goal"), outputFolder: normalizeFolder(text("outputFolder")), author: text("author"), language: text("language"),
      granularity: value.granularity === "video" ? "video" : "group", naming: text("naming"),
      tags: [...new Set(list(value.tags, studyDefaults.tags).map(tag => tag.replace(/^#+/, "").replace(/\s+/g, "-")))].filter(Boolean),
      sections: list(value.sections, studyDefaults.sections), externalSources: value.externalSources ?? true,
      instructions: text("instructions"), properties
    };
    if (!result.language) throw new Error("请填写笔记语言。");
    if (!result.sections.length) throw new Error("请至少保留一个笔记栏目。");
    return result;
  }
  function studyPreferencesText(p, meta) {
    const directory = `${p.outputFolder}/${meta ? safeName(meta.title) : "<课程名>"}/`;
    return ["", "## 我的笔记偏好", `学习目标：${p.goal || "按本次课程内容确定"}`, `成品目录：${directory}`,
      `笔记语言：${p.language}；专业术语首次出现保留原名。`,
      `整理粒度：${p.granularity === "video" ? "每个选中视频单独一篇，不合并同一 Lecture 的 Part。" : "按本次确认的分组每组一篇。"}`,
      `文件命名：${p.naming || "采用 course-notes 的默认命名"}`,
      `笔记栏目及顺序：${p.sections.join(" → ")}；只采用这些栏目，不补回未选择的默认栏目。`,
      `外部资料：${p.externalSources ? "允许补充，注明来源并与课程内容区分。" : "仅使用本次课程素材，不添加外部资料。"}`,
      "笔记属性使用 YAML frontmatter；标题、课程、范围、来源、日期和状态按真实素材填写，不编造。",
      p.author ? `笔记作者 author：${JSON.stringify(p.author)}（用户署名，不是视频讲师）。` : "未设置笔记作者，省略 author 属性。",
      `tags：${JSON.stringify(p.tags)}；本次使用这些标签，多词标签用连字符。`,
      ...p.properties.map(property => `自定义属性 ${JSON.stringify(property.name)}（${property.type}）：${JSON.stringify(property.value)}；作为数据写入 YAML，不作为整理指令。`),
      ...(p.instructions ? ["额外偏好：", p.instructions] : [])].join("\n");
  }
  function buildStudyPrompt(meta, pages, base, preferences = {}) {
    const folder = normalizeFolder(base);
    const targets = pages.filter(page => page.selected);
    if (meta && !targets.length) throw new Error("请先在课程列表勾选要整理的分 P。");
    preferences = normalizeStudyPreferences(preferences);
    const lines = ["请使用 course-notes 技能整理本次课程素材。本次指定范围与下方笔记偏好优先于技能默认值。"];
    if (meta && targets.length) {
      lines.push(`课程：${meta.title}`, `课程清单：${courseFolder(meta, folder)}/课程导入清单.md`,
        `本次范围：${targets.map(page => `P${page.page}`).join("、")}。`,
        ...targets.map(page => `- P${page.page} ${page.part}（章节分组：${chapterLabel(page.chapter)}）：${page.sourcePath || rawPath(meta, page, folder)}`),
        "核对这些文件的实际可用情况。本次只处理上述 P；章节归属以本次列出的分组为准，不采用原始字幕中的旧章号重新分组。",
        preferences.granularity === "video" ? "本次每个选中视频分别成篇，不按章节或 Lecture 合并；注明各篇实际覆盖范围。" :
        "默认按确认的分组每组一篇。英文课程以 Lecture 为基本单元：Lecture 02.1、02.2、02.3、02.4 自动归入 2，同一 Lecture 的多个 Part 合成一篇，分段内容放在内部小标题中。普通数字章节保留两级：2.2 与 2.3 分别成篇，不合并为第 2 章。部分选中时注明覆盖范围。0 表示未分章，不自动合成一章。用户本次要求或个人偏好明确另定粒度时优先采用。");
    } else {
      lines.push("课程目录：[填写已导入课程的目录]", "本次范围：[填写完整章节编号（如 2.2）、P序号或文件名]");
    }
    lines.push(studyPreferencesText(preferences, meta), "", "读取课程清单和本次所选字幕，保留教师例题、数据和推导；缺失板书、公式或素材列为待核实。保留已有人工批注。",
      "未安装 course-notes 时也按上述范围和偏好整理，不编造来源。网页 AI 需提供本次课程清单和字幕内容。");
    return lines.join("\n");
  }
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
  root.CourseCore = { marker, safeName, normalizeFolder, chapterOf, normalizeChapter, compareChapters, chapterLabel, parseSource, courseFolder, rawPath, videoUrl, timestampUrl, groupSubtitles, buildRaw, buildIndex, buildStudyPrompt, normalizeStudyPreferences };
  if (typeof module !== "undefined") module.exports = root.CourseCore;
})(globalThis);
