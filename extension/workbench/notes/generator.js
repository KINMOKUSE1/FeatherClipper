/* Editable recipes and file generation for course-notes. */
(() => {
  const copy = typeof module !== "undefined" && module.exports ? require("../../shared/ui-text.js") : window.UiText;
  const tr = (text, values) => copy.i18n.t(text, values, copy.i18n.outputLocale());
  const ui = copy.validation, format = copy.format;
  const recipes = typeof module !== "undefined" && module.exports ? require("./rules/defaults.js") : window.NoteDefaults;
  const defaults = (...args) => recipes.defaults(...args), deliveryDefaults = (...args) => recipes.deliveryDefaults(...args);
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
    const names = new Set(recipes.properties.map(item => item.name).concat(["__proto__", "constructor", "prototype"]));
    for (const property of config.customProperties) {
      if (!/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(property.name) || names.has(property.name)) throw new Error(format(ui.propertyName, { name: property.name || tr("（空）") }));
      names.add(property.name);
      propertyValue(property);
    }
  }
  function buildFiles(config, resources) {
    const lang = config.outputLocale || copy.i18n.outputLocale();
    const tr = (text, values) => copy.i18n.t(text, values, lang);
    const types = recipes.forLocale(lang).types;
    validate(config);
    if (!resources?.entry?.trim() || !resources?.agent?.trim() || !resources?.workflow?.trim() || !resources?.tasks?.trim() || !resources?.mermaid?.trim() || !resources?.markdown?.trim()) throw new Error(ui.rulesRequired);
    const links = { heading: tr("视频回看入口放在对应知识点标题旁，正文和例题共用该入口，跨视频补充可添加必要链接"), paragraph: tr("视频回看入口放在对应内容段落末尾，同一来源的相邻内容共用入口，避免逐句重复标注"), sources: tr("视频回看入口集中放在已选的“来源与待核实项”模块，注明对应知识点和时间") };
    const enabled = config.modules.filter(item => item.enabled);
    const attrs = config.properties.filter(item => item.enabled).map(item => {
      if (!item.fixed) return tr("- {0}（{1}）：{2}", { 0: item.name, 1: types[item.type], 2: item.rule.trim() });
      if (item.name === "author" && !item.value.trim()) return tr("- author：未设置署名，省略此属性；不使用视频讲师的名字代替");
      const value = item.name === "tags" ? propertyValue(item).map(tag => tag.replace(/\s+/g, "-")) : item.value.trim();
      return tr("- {0}（{1}）：使用固定值 {2}", { "0": (item.name), "1": (types[item.type]), "2": (JSON.stringify(value)) });
    });
    attrs.push(...config.customProperties.map(item => tr("- {0}（{1}）：使用固定值 {2}", { "0": (item.name), "1": (types[item.type]), "2": (JSON.stringify(propertyValue(item))) })));
    const entry = resources.entry;
    const preferences = [tr("# 个人偏好"), "", tr("- 学习目标：{0}", { "0": (JSON.stringify(config.goal.trim() || tr("按本次课程内容确定"))) }), tr("- 笔记语言：{0}，术语保留必要的原名", { "0": (JSON.stringify(config.language.trim())) }),
      tr("- 成品目录：{0}", { "0": (JSON.stringify(config.folder.trim().replace(/\/$/, "") + tr("/<课程名>/"))) }), tr("- 文件命名：{0}", { "0": (JSON.stringify(config.naming.trim())) }),
      tr("- 整理粒度：{0}", { "0": (config.granularity === "video" ? tr("每个选中视频单独一篇") : tr("按本次确认的分组每组一篇，部分选中时注明实际覆盖范围")) }), "",
      tr("## 写作与回看"), "", tr("- {0}，只使用可确认的视频标识和时间；总结、术语表和自测题不机械配链接，非视频来源按需引用", { "0": (links[config.links]) }),
      tr("- 外部资料：{0}", { "0": (config.external ? tr("允许补充，注明出处并与课程内容区分；当前 AI 没有检索能力时注明未核实") : tr("仅使用本次课程素材，不联网补充外部资料")) }),
      tr("- 整理进度：{0}", { "0": (config.progress ? tr("启用整理进度.md，记录实际处理范围、成品路径和缺失项；网页环境返回其内容供用户保存") : tr("不额外创建整理进度文件，在交付时报告处理范围")) }),
      tr("- 网页环境中的目录和文件名仅用于建议保存位置，不作为本机读取或写入能力"), ...(config.instructions.trim() ? ["", tr("## 其他写作偏好"), "", config.instructions.trim()] : []), ""].join("\n");
    const moduleText = [tr("# 内容模块"), "", tr("按以下顺序组织笔记：{0}", { "0": (enabled.map(item => item.title.trim()).join(" → ")) }), "", ...enabled.flatMap(item => [`## ${item.title.trim()}`, "", item.writing.trim(), ""])].join("\n");
    const propertyText = [tr("# 笔记属性"), "", ...(attrs.length ? [tr("成品使用 YAML frontmatter，只输出以下配置的属性；自动填写的值以实际素材为准，无法确认时按填写规则省略或置空"), "", ...attrs] : [tr("不生成 YAML frontmatter")]), ""].join("\n");
    return [
      { path: "SKILL.md", content: entry },
      { path: "references/workflow.md", content: resources.workflow },
      { path: "references/tasks.md", content: resources.tasks },
      { path: "references/mermaid.md", content: resources.mermaid },
      { path: "references/markdown.md", content: resources.markdown },
      { path: "references/preferences.md", content: preferences },
      { path: "references/modules.md", content: moduleText },
      { path: "references/properties.md", content: propertyText },
      { path: "agents/openai.yaml", content: resources.agent }
    ];
  }
  function validateTask(delivery, context) {
    if (!recipes.taskTypes[delivery.task]) throw new Error(ui.taskRequired);
    if (delivery.environment === "web" && context.materials.length > 1) throw new Error(ui.webSingleSource);
    if (delivery.task === "review" && !delivery.question.trim()) throw new Error(ui.questionRequired);
    const hasReference = delivery.environment === "web" ? context.references?.some(item => item.content.trim()) : Boolean(delivery.reference.trim());
    if (["supplement", "continue"].includes(delivery.task) && !hasReference) throw new Error(delivery.environment === "web" ? ui.webReferenceRequired : ui.localReferenceRequired);
    const available = context.materials.some(item => delivery.environment === "web" ? item.content?.trim() : item.path);
    if (!available && !(delivery.task === "review" && hasReference)) throw new Error(delivery.environment === "web" ? ui.webMaterialRequired : ui.localMaterialRequired);
  }
  function taskRequest(config, delivery) {
    const lang = config.outputLocale || copy.i18n.outputLocale();
    const tr = (text, values) => copy.i18n.t(text, values, lang);
    const taskTypes = recipes.forLocale(lang).taskTypes;
    const web = delivery.environment === "web";
    const requests = {
      notes: web ? tr("本轮只根据当前视频或单个素材文件整理一篇学习笔记，采用所选栏目和属性") : tr("按所选粒度、栏目和属性整理本次范围的学习笔记"),
      supplement: tr("实际读取已有笔记，将新素材合入对应知识点，保留原有内容和人工批注"),
      continue: tr("先核对已有笔记或进度，只继续本次指定范围中尚未完成的部分"),
      translate: tr("按语义段落翻译为{0}，保留原文、时间定位、例题和重要术语", { "0": (config.language) }),
      review: tr("围绕给定问题及实际提供的素材答疑，默认交付回答")
    };
    if (delivery.task === "review") return requests.review;
    if (delivery.task === "translate") return requests.translate;
    return [requests[delivery.task], ...(web ? [tr("本轮处理当前来源对应的笔记，已有笔记和进度用于补充或接续")] : [])].join("\n");
  }
  function buildTask(config, delivery, context) {
    const lang = config.outputLocale || copy.i18n.outputLocale();
    const tr = (text, values) => copy.i18n.t(text, values, lang);
    const taskTypes = recipes.forLocale(lang).taskTypes;
    validateTask(delivery, context);
    if (delivery.environment === "web") return [
      tr("请根据我上传的{0}执行“{1}”", { "0": (delivery.format === "zip" ? tr(" course-web-task.zip 中的文件") : tr("《课程任务材料.md》")), "1": (taskTypes[delivery.task]) }),
      tr("先读取本次任务说明，再按整理流程、个人偏好、内容模块、属性和 Markdown 写作规则处理实际提供的素材"), taskRequest(config, delivery),
      ...(delivery.task === "review" ? [tr("本次问题：{0}", { "0": (delivery.question.trim()) })] : []),
      tr("处理指定范围，注明缺失的字幕、板书、公式或原笔记"),
      tr("以上传材料为本轮输入，用 Markdown 或可下载 .md 文件交付实际完成的内容，由我保存到建议位置；长篇按整理流程分轮继续，并报告已完成范围和剩余内容"), ""
    ].join("\n\n");
    if (!delivery.ready) throw new Error(ui.installationRequired);
    return [tr("请使用 course-notes 执行“{0}”", { "0": (taskTypes[delivery.task]) }), tr("课程：{0}", { "0": (context.course) }),
      ...(context.index ? [tr("课程清单：{0}", { "0": (context.index) })] : []), tr("本次范围："),
      ...context.materials.map(item => tr("- {0}（分组：{1}）：{2}", { "0": (item.label), "1": (item.chapter), "2": (item.path || tr("素材缺失：{0}", { "0": (item.missing || tr("未导入")) })) })),
      ...(["supplement", "continue", "review"].includes(delivery.task) && delivery.reference.trim() ? [tr("已有笔记或进度：{0}", { "0": (delivery.reference.trim()) })] : []),
      ...(delivery.task === "review" ? [tr("本次问题：{0}", { "0": (delivery.question.trim()) })] : []),
      taskRequest(config, delivery), tr("采用已安装技能的当前个人配置，分组以本次列出的结果为准，保留人工批注"), ""].join("\n");
  }
  function buildWebFiles(config, delivery, context, resources) {
    const lang = config.outputLocale || copy.i18n.outputLocale();
    const tr = (text, values) => copy.i18n.t(text, values, lang);
    const taskTypes = recipes.forLocale(lang).taskTypes;
    validateTask(delivery, context);
    const rules = buildFiles({ ...config, granularity: "video" }, resources).filter(item => item.path.startsWith("references/")).map(item => ({ path: tr("规则/{0}", { "0": (item.path.slice(11)) }), content: item.content }));
    const task = [tr("# 本次任务：{0}", { "0": (taskTypes[delivery.task]) }), "", tr("课程：{0}", { "0": (context.course) }), "", taskRequest(config, delivery),
      ...(delivery.task === "review" ? ["", tr("本次问题：{0}", { "0": (delivery.question.trim()) })] : []), "", tr("## 指定素材与覆盖范围"), "",
      ...context.materials.map(item => tr("- {0}（分组：{1}）：{2}", { "0": (item.label), "1": (item.chapter), "2": (item.content?.trim() ? item.fileName : tr("素材缺失：{0}", { "0": (item.missing || tr("未提供")) })) })),
      ...(context.references?.length ? ["", tr("## 已有笔记或进度"), "", ...context.references.map(item => `- ${item.fileName}`)] : []), "",
      tr("以本包实际提供的内容为材料。遵循规则/workflow.md、规则/preferences.md、规则/modules.md、规则/properties.md、规则/markdown.md，并读取规则/tasks.md 中本次任务的对应部分"), "",
      tr("按整理流程用 Markdown 或可下载 .md 文件交付本轮实际完成的内容，由用户保存到建议位置；更新已有笔记时保留原有内容，全部完成后返回完整修订版"), ""].join("\n");
    return [{ path: tr("本次任务.md"), content: task }, ...rules,
      ...context.materials.filter(item => item.content?.trim()).map(item => ({ path: item.fileName, content: item.content })),
      ...(context.references || []).map(item => ({ path: item.fileName, content: item.content }))];
  }
  function combineWebFiles(files, locale = copy.i18n.outputLocale()) {
    const tr = (text, values) => copy.i18n.t(text, values, locale);
    return [tr("# 课程任务材料"), "", tr("以下各文件的内容已合并，文件名用于在本文中定位；所有素材均包含在本文件中"), "", ...files.flatMap(file => [tr("# 文件：{0}", { "0": (file.path) }), "", file.content, ""])].join("\n");
  }
  const api = { defaults, deliveryDefaults, validate, buildFiles, validateTask, buildTask, buildWebFiles, combineWebFiles };
  for (const key of ["modules", "properties", "types", "taskTypes"]) Object.defineProperty(api, key, { get: () => recipes[key] });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.NoteGenerator = api;
})();
