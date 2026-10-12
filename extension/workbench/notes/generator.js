/* Editable recipes and file generation for course-notes. */
(() => {
  const copy = typeof module !== "undefined" && module.exports ? require("../../shared/ui-text.js") : window.UiText;
  const ui = copy.validation, format = copy.format;
  const recipes = typeof module !== "undefined" && module.exports ? require("./rules/defaults.js") : window.NoteDefaults;
  const { modules, properties, types, taskTypes, defaults, deliveryDefaults } = recipes;
  function propertyValue(property) {
    const value = String(property.value ?? "").trim();
    if (property.type === "list") return value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
    if (property.type === "number") {
      if (!value || !Number.isFinite(Number(value))) throw new Error(format(ui.number, { name: property.name }));
      return Number(value);
    }
    if (property.type === "boolean") {
      if (!["true", "false"].includes(value)) throw new Error(format(ui.boolean, { name: property.name }));
      return value === "true";
    }
    if (property.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error(format(ui.date, { name: property.name }));
    return value;
  }
  function validate(config) {
    if (![config.language, config.folder, config.naming].every(value => value.trim())) throw new Error(ui.outputRequired);
    const enabled = config.modules.filter(item => item.enabled);
    if (!enabled.length) throw new Error(ui.moduleRequired);
    if (enabled.some(item => !item.title.trim() || !item.writing.trim())) throw new Error(ui.moduleWritingRequired);
    if (config.links === "sources" && !enabled.some(item => item.id === "sources")) throw new Error(ui.sourcesRequired);
    if (config.properties.some(item => item.enabled && !item.fixed && !item.rule.trim())) throw new Error(ui.propertyRuleRequired);
    const names = new Set(properties.map(item => item.name).concat(["__proto__", "constructor", "prototype"]));
    for (const property of config.customProperties) {
      if (!/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(property.name) || names.has(property.name)) throw new Error(format(ui.propertyName, { name: property.name || "（空）" }));
      names.add(property.name);
      propertyValue(property);
    }
  }
  function buildFiles(config, resources) {
    validate(config);
    if (!resources?.entry?.trim() || !resources?.agent?.trim() || !resources?.workflow?.trim() || !resources?.tasks?.trim() || !resources?.mermaid?.trim()) throw new Error(ui.rulesRequired);
    const links = { heading: "视频回看入口放在对应知识点标题旁，正文和例题共用该入口，跨视频补充可添加必要链接", paragraph: "视频回看入口放在对应内容段落末尾，同一来源的相邻内容共用入口，避免逐句重复标注", sources: "视频回看入口集中放在已选的“来源与待核实项”模块，注明对应知识点和时间" };
    const enabled = config.modules.filter(item => item.enabled);
    const attrs = config.properties.filter(item => item.enabled).map(item => {
      if (!item.fixed) return `- ${item.name}（${types[item.type]}）：${item.rule.trim()}`;
      if (item.name === "author" && !item.value.trim()) return "- author：未设置署名，省略此属性；不使用视频讲师的名字代替";
      const value = item.name === "tags" ? propertyValue(item).map(tag => tag.replace(/\s+/g, "-")) : item.value.trim();
      return `- ${item.name}（${types[item.type]}）：使用固定值 ${JSON.stringify(value)}`;
    });
    attrs.push(...config.customProperties.map(item => `- ${item.name}（${types[item.type]}）：使用固定值 ${JSON.stringify(propertyValue(item))}`));
    const entry = resources.entry;
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
      { path: "references/mermaid.md", content: resources.mermaid },
      { path: "references/preferences.md", content: preferences },
      { path: "references/modules.md", content: moduleText },
      { path: "references/properties.md", content: propertyText },
      { path: "agents/openai.yaml", content: resources.agent }
    ];
  }
  function validateTask(delivery, context) {
    if (!taskTypes[delivery.task]) throw new Error(ui.taskRequired);
    if (delivery.task === "review" && !delivery.question.trim()) throw new Error(ui.questionRequired);
    const hasReference = delivery.environment === "web" ? context.references?.some(item => item.content.trim()) : Boolean(delivery.reference.trim());
    if (["supplement", "continue"].includes(delivery.task) && !hasReference) throw new Error(delivery.environment === "web" ? ui.webReferenceRequired : ui.localReferenceRequired);
    const available = context.materials.some(item => delivery.environment === "web" ? item.content?.trim() : item.path);
    if (!available && !(delivery.task === "review" && hasReference)) throw new Error(delivery.environment === "web" ? ui.webMaterialRequired : ui.localMaterialRequired);
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
    if (!delivery.ready) throw new Error(ui.installationRequired);
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
  const api = { defaults, deliveryDefaults, modules, properties, types, taskTypes, validate, buildFiles, validateTask, buildTask, buildWebFiles, combineWebFiles };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.NoteGenerator = api;
})();
