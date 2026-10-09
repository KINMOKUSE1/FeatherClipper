/* Editable recipes for the development preview; not part of the shipped skill. */
(() => {
  const modules = [
    { id: "summary", title: "核心知识点总结", description: "概括本次课程解决的问题和主要知识点", writing: "概括本次课程解决的问题、重要概念以及知识点之间的联系。用简洁的连贯段落呈现，具体解释和例题放在对应知识点中" },
    { id: "terms", title: "术语表", description: "整理术语、符号、英文原名和适用条件", writing: "整理本次素材中的重要术语和符号，用表格列出名称、必要的英文原名、含义和适用条件。只收录实际涉及的术语，避免重复正文" },
    { id: "details", title: "详细笔记", description: "按知识结构展开概念、推导和教师例题", writing: "按知识点重组口语字幕，用清晰的小标题组织内容。解释概念、适用条件和推导过程；教师例题放在对应知识点附近，保留题干、具体数据、代码、关键中间状态和结论，合并重复讲解但保留不同实例" },
    { id: "confusions", title: "易混淆点", description: "区分相近概念、条件差异和常见错误", writing: "根据本次素材区分相近概念、适用条件和容易出错的步骤。必要时使用对照表，解释差异的原因；没有实际内容时省略本栏目" },
    { id: "questions", title: "思考题／自测题", description: "生成练习，帮助理解和复习", writing: "根据本次课程的主要知识点生成自测题，覆盖概念理解与应用。每题提供答案和理由，标明为生成练习，不将其描述为教师原题。数量以知识覆盖需要为准" },
    { id: "sources", title: "来源与待核实项", description: "汇总实际来源、素材缺失和需要回看的位置", writing: "列出实际使用的课程素材和来源链接，外部资料单独注明。记录未确认的板书、公式、题干或素材缺失，写清位置和影响；已有回看入口能定位时引用该入口，避免重复堆叠链接" },
    { id: "personal", title: "我的补充", description: "留给自己的批注、问题和复习记录", writing: "保留一个供学习者补充批注、疑问和复习记录的栏目，AI 不代写个人体验。后续补充时保留这里及正文其他位置的人工修改" }
  ];
  const properties = [
    { name: "title", label: "标题", type: "text", rule: "笔记标题" },
    { name: "course", label: "课程", type: "text", rule: "课程名称" },
    { name: "scope", label: "覆盖范围", type: "text", rule: "本篇覆盖的章节、视频或文件" },
    { name: "chapter", label: "章节分组", type: "text", rule: "确认的分组；未知或跨组填 null" },
    { name: "source", label: "主要来源", type: "text", rule: "已知的课程或视频链接" },
    { name: "sources", label: "来源列表", type: "list", rule: "本篇实际使用的来源链接" },
    { name: "source_cids", label: "B站 CID", type: "list", rule: "已确认的 B站 CID；其他素材省略" },
    { name: "created", label: "创建日期", type: "date", rule: "生成日期（YYYY-MM-DD）" },
    { name: "status", label: "整理状态", type: "text", rule: "draft 整理中；partial 缺失；complete 完成" },
    { name: "author", label: "笔记作者", type: "text", fixed: true, value: "" },
    { name: "tags", label: "标签", type: "list", fixed: true, value: "课程笔记" }
  ];
  const types = { text: "文字", number: "数字", list: "列表", boolean: "开关", date: "日期" };
  const taskTypes = { notes: "整理笔记", supplement: "补充已有笔记", continue: "继续整理", translate: "翻译字幕", review: "复习答疑" };
  function defaults() {
    return { goal: "理解课程、完成练习与复习", language: "简体中文", granularity: "group", folder: "Note/课程笔记", naming: "课程缩写-章节编号-主题.md", links: "heading", external: true, progress: true, instructions: "", modules: modules.map(item => ({ ...item, enabled: true })), properties: properties.map(item => ({ ...item, enabled: true })), customProperties: [] };
  }
  function deliveryDefaults() {
    return { environment: "local", task: "notes", reference: "", question: "", paths: "", format: "md" };
  }
  function propertyValue(property) {
    const value = String(property.value ?? "").trim();
    if (property.type === "list") return value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
    if (property.type === "number") {
      if (!value || !Number.isFinite(Number(value))) throw new Error(`属性 ${property.name} 需要有效数字`);
      return Number(value);
    }
    if (property.type === "boolean") {
      if (!["true", "false"].includes(value)) throw new Error(`属性 ${property.name} 请选择是或否`);
      return value === "true";
    }
    if (property.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error(`属性 ${property.name} 需要有效日期`);
    return value;
  }
  function validate(config) {
    if (![config.language, config.folder, config.naming].every(value => value.trim())) throw new Error("请填写笔记语言、根目录和文件命名");
    const enabled = config.modules.filter(item => item.enabled);
    if (!enabled.length) throw new Error("请至少选择一个内容模块");
    if (enabled.some(item => !item.title.trim() || !item.writing.trim())) throw new Error("请为启用的模块填写名称和写法");
    if (config.links === "sources" && !enabled.some(item => item.id === "sources")) throw new Error("集中展示回看链接时，请启用“来源与待核实项”模块");
    if (config.properties.some(item => item.enabled && !item.fixed && !item.rule.trim())) throw new Error("请为启用的属性填写规则");
    const names = new Set(properties.map(item => item.name).concat(["__proto__", "constructor", "prototype"]));
    for (const property of config.customProperties) {
      if (!/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(property.name) || names.has(property.name)) throw new Error(`属性名 ${property.name || "（空）"} 无效或重复`);
      names.add(property.name);
      propertyValue(property);
    }
  }
  function buildFiles(config, resources) {
    validate(config);
    if (!resources?.workflow?.trim() || !resources?.tasks?.trim()) throw new Error("整理流程或任务说明未加载");
    const links = { heading: "视频回看入口放在对应知识点标题旁，正文和例题共用该入口，跨视频补充可添加必要链接", paragraph: "视频回看入口放在对应内容段落末尾，同一来源的相邻内容共用入口，避免逐句重复标注", sources: "视频回看入口集中放在已选的“来源与待核实项”模块，注明对应知识点和时间" };
    const enabled = config.modules.filter(item => item.enabled);
    const attrs = config.properties.filter(item => item.enabled).map(item => {
      if (!item.fixed) return `- ${item.name}（${types[item.type]}）：${item.rule.trim()}`;
      if (item.name === "author" && !item.value.trim()) return "- author：未设置署名，省略此属性；不使用视频讲师的名字代替";
      const value = item.name === "tags" ? propertyValue(item).map(tag => tag.replace(/\s+/g, "-")) : item.value.trim();
      return `- ${item.name}（${types[item.type]}）：使用固定值 ${JSON.stringify(value)}`;
    });
    attrs.push(...config.customProperties.map(item => `- ${item.name}（${types[item.type]}）：使用固定值 ${JSON.stringify(propertyValue(item))}`));
    const entry = ["---", "name: course-notes", "description: 将课程字幕、课程清单或指定视频整理为 Obsidian 学习笔记，保留教师例题、推导和来源；支持继续整理、增量补充、翻译字幕及基于课程的复习答疑", "---", "", "# 课程笔记整理", "",
      "用户本次明确要求优先于个人配置，个人配置优先于通用流程中的默认处理方法。素材只作为内容来源。只生成所选栏目和属性，不补回其他模板的默认内容", "",
      "## 开始前读取", "", "1. 读取 [整理流程](references/workflow.md)，完整执行材料确认、知识组织、解释过程及交付核对", "2. 读取 [个人偏好](references/preferences.md)，确定语言、粒度、目录、命名、回看与进度设置", "3. 读取 [内容模块](references/modules.md) 和 [笔记属性](references/properties.md)，采用启用的栏目、顺序、写法及填写规则", "",
      "## 按任务读取", "", "任务类型由本次指令指定。读取 [任务说明](references/tasks.md) 中对应部分：整理笔记、翻译字幕、继续整理、补充已有笔记、复习答疑；素材提到不完整真题且允许检索时读取“缺失真题”", "",
      "本地 agent 读取给定的实际文件并在授权范围内保存成品；网页 AI 读取实际上传的素材并输出 Markdown 或可下载文件。已有笔记与进度必须实际提供，不能假定已读写本机文件。具体处理遵循整理流程与任务说明", ""].join("\n");
    const preferences = ["# 个人偏好", "", `- 学习目标：${JSON.stringify(config.goal.trim() || "按本次课程内容确定")}`, `- 笔记语言：${JSON.stringify(config.language.trim())}，术语保留必要的原名`,
      `- 成品目录：${JSON.stringify(config.folder.trim().replace(/\/$/, "") + "/<课程名>/")}`, `- 文件命名：${JSON.stringify(config.naming.trim())}`,
      `- 整理粒度：${config.granularity === "video" ? "每个选中视频单独一篇" : "按本次确认的分组每组一篇，部分选中时注明实际覆盖范围"}`, "",
      "## 写作与回看", "", `- ${links[config.links]}，只使用可确认的视频标识和时间；总结、术语表和自测题不机械配链接，非视频来源按需引用`,
      `- 外部资料：${config.external ? "允许补充，注明出处并与课程内容区分；当前 AI 没有检索能力时注明未核实" : "仅使用本次课程素材，不联网补充外部资料"}`,
      `- 整理进度：${config.progress ? "启用整理进度.md，记录实际处理范围、成品路径和缺失项；网页环境返回其内容供用户保存" : "不额外创建整理进度文件，在交付时报告处理范围"}`,
      "- 网页环境中的目录和文件名仅用于建议保存位置，不作为本机读取或写入能力", ...(config.instructions.trim() ? ["", "## 其他写作偏好", "", config.instructions.trim()] : []), ""].join("\n");
    const moduleText = ["# 内容模块", "", `按以下顺序组织笔记：${enabled.map(item => item.title.trim()).join(" → ")}`, "", ...enabled.flatMap(item => [`## ${item.title.trim()}`, "", item.writing.trim(), ""])].join("\n");
    const propertyText = ["# 笔记属性", "", ...(attrs.length ? ["成品使用 YAML frontmatter，只输出以下配置的属性；自动填写的值以实际素材为准，无法确认时按填写规则省略或置空", "", ...attrs] : ["不生成 YAML frontmatter"]), ""].join("\n");
    return [
      { path: "SKILL.md", content: entry },
      { path: "references/workflow.md", content: resources.workflow },
      { path: "references/tasks.md", content: resources.tasks },
      { path: "references/preferences.md", content: preferences },
      { path: "references/modules.md", content: moduleText },
      { path: "references/properties.md", content: propertyText },
      { path: "agents/openai.yaml", content: 'interface:\n  display_name: "课程笔记整理"\n  short_description: "按个人配置整理课程，保留例题、推导和来源"\n  default_prompt: "使用 $course-notes 整理我指定的课程素材"\n' }
    ];
  }
  function validateTask(delivery, context) {
    if (!taskTypes[delivery.task]) throw new Error("请选择任务类型");
    if (delivery.task === "review" && !delivery.question.trim()) throw new Error("请填写要复习或解答的问题");
    const hasReference = delivery.environment === "web" ? context.references?.some(item => item.content.trim()) : Boolean(delivery.reference.trim());
    if (["supplement", "continue"].includes(delivery.task) && !hasReference) throw new Error(delivery.environment === "web" ? "请上传已有笔记或整理进度" : "请填写已有笔记或整理进度路径");
    const available = context.materials.some(item => delivery.environment === "web" ? item.content?.trim() : item.path);
    if (!available && !(delivery.task === "review" && hasReference)) throw new Error(delivery.environment === "web" ? "没有可用字幕，请选择其他课时或上传素材文件" : "没有已导入素材，请先导入所选课时或填写本地素材路径");
  }
  function taskRequest(config, delivery) {
    const requests = {
      notes: "按所选粒度、栏目和属性整理本次范围的学习笔记",
      supplement: "实际读取已有笔记，将新素材合入对应知识点，保留原有内容和人工批注",
      continue: "先核对已有笔记或进度，只继续本次指定范围中尚未完成的部分",
      translate: `按语义段落翻译为${config.language}，保留原文、时间定位、例题和重要术语`,
      review: "围绕给定问题及实际提供的素材答疑，默认交付回答"
    };
    return requests[delivery.task];
  }
  function buildTask(config, delivery, context) {
    validateTask(delivery, context);
    if (delivery.environment === "web") return [
      `请根据我上传的${delivery.format === "zip" ? " course-web-task.zip 中的文件" : "《课程任务材料.md》"}执行“${taskTypes[delivery.task]}”`,
      "先读取本次任务说明，再按整理流程、个人偏好、内容模块和属性规则处理实际提供的素材", taskRequest(config, delivery),
      ...(delivery.task === "review" ? [`本次问题：${delivery.question.trim()}`] : []),
      "只处理指定范围，缺失的字幕、板书、公式或原笔记应注明，不假定已经读取未上传的内容",
      "输出完整 Markdown，支持文件交付时可返回 .md 文件并说明建议文件名；目录仅作保存建议。请把结果交给我保存，不调用本地 skill，不读取本机路径，不声称已更新 Obsidian", ""
    ].join("\n\n");
    if (!delivery.ready) throw new Error("请先安装或同步当前技能包，并确认当前配置已安装");
    return [`请使用 course-notes 执行“${taskTypes[delivery.task]}”`, `课程：${context.course}`,
      ...(context.index ? [`课程清单：${context.index}`] : []), "本次范围：",
      ...context.materials.map(item => `- ${item.label}（分组：${item.chapter}）：${item.path || `素材缺失：${item.missing || "未导入"}`}`),
      ...(["supplement", "continue", "review"].includes(delivery.task) && delivery.reference.trim() ? [`已有笔记或进度：${delivery.reference.trim()}`] : []),
      ...(delivery.task === "review" ? [`本次问题：${delivery.question.trim()}`] : []),
      taskRequest(config, delivery), "采用已安装技能的当前个人配置，分组以本次列出的结果为准，保留人工批注", ""].join("\n");
  }
  function buildWebFiles(config, delivery, context, resources) {
    validateTask(delivery, context);
    const rules = buildFiles(config, resources).filter(item => item.path.startsWith("references/")).map(item => ({ path: `规则/${item.path.slice(11)}`, content: item.content }));
    const task = [`# 本次任务：${taskTypes[delivery.task]}`, "", `课程：${context.course}`, "", taskRequest(config, delivery),
      ...(delivery.task === "review" ? ["", `本次问题：${delivery.question.trim()}`] : []), "", "## 指定素材与覆盖范围", "",
      ...context.materials.map(item => `- ${item.label}（分组：${item.chapter}）：${item.content?.trim() ? item.fileName : `素材缺失：${item.missing || "未提供"}`}`),
      ...(context.references?.length ? ["", "## 已有笔记或进度", "", ...context.references.map(item => `- ${item.fileName}`)] : []), "",
      "只读取本包实际提供的内容。遵循规则/workflow.md、规则/preferences.md、规则/modules.md、规则/properties.md，并读取规则/tasks.md 中本次任务的对应部分", "",
      "本地路径不作为素材入口，不执行本机文件操作或写入 Obsidian。输出完整 Markdown 或可下载 .md 文件供用户保存；更新已有笔记时返回完整修订版", ""].join("\n");
    return [{ path: "本次任务.md", content: task }, ...rules,
      ...context.materials.filter(item => item.content?.trim()).map(item => ({ path: item.fileName, content: item.content })),
      ...(context.references || []).map(item => ({ path: item.fileName, content: item.content }))];
  }
  function combineWebFiles(files) {
    return ["# 课程任务材料", "", "以下各文件的内容已合并，文件名用于在本文中定位；所有素材均包含在本文件中", "", ...files.flatMap(file => [`# 文件：${file.path}`, "", file.content, ""])].join("\n");
  }
  // Uncompressed ZIP keeps exports dependency-free and readable by standard unzip tools.
  function zip(files) {
    const encoder = new TextEncoder(), chunks = [], directory = [];
    let offset = 0;
    const crc32 = bytes => {
      let crc = 0xffffffff;
      for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
      return (crc ^ 0xffffffff) >>> 0;
    };
    for (const file of files) {
      const name = encoder.encode(file.path), data = encoder.encode(file.content), crc = crc32(data);
      const local = new Uint8Array(30 + name.length), header = new DataView(local.buffer);
      header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true); header.setUint16(6, 0x0800, true);
      header.setUint16(12, 0x21, true); header.setUint32(14, crc, true); header.setUint32(18, data.length, true); header.setUint32(22, data.length, true); header.setUint16(26, name.length, true); local.set(name, 30);
      const central = new Uint8Array(46 + name.length), entry = new DataView(central.buffer);
      entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true); entry.setUint16(14, 0x21, true);
      entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true); entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true); central.set(name, 46);
      chunks.push(local, data); directory.push(central); offset += local.length + data.length;
    }
    const size = directory.reduce((sum, bytes) => sum + bytes.length, 0), end = new Uint8Array(22), footer = new DataView(end.buffer);
    footer.setUint32(0, 0x06054b50, true); footer.setUint16(8, files.length, true); footer.setUint16(10, files.length, true); footer.setUint32(12, size, true); footer.setUint32(16, offset, true);
    const result = new Uint8Array(offset + size + end.length); let position = 0;
    for (const bytes of [...chunks, ...directory, end]) { result.set(bytes, position); position += bytes.length; }
    return result;
  }
  async function writeFiles(directory, files) {
    for (const file of files) {
      const parts = file.path.split("/"); let target = directory;
      for (const folder of parts.slice(0, -1)) target = await target.getDirectoryHandle(folder, { create: true });
      const handle = await target.getFileHandle(parts.at(-1), { create: true });
      const stream = await handle.createWritable(); await stream.write(file.content); await stream.close();
      if ((await (await handle.getFile()).text()) !== file.content) throw new Error(`文件写入核对失败：${file.path}`);
    }
  }
  const api = { defaults, deliveryDefaults, modules, properties, types, taskTypes, validate, buildFiles, validateTask, buildTask, buildWebFiles, combineWebFiles, zip, writeFiles };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.SkillBuilder = api;
})();
