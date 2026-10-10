/* 笔记默认栏目、属性和偏好；界面与生成器共用此处的定义。 */
(() => {
  const modules = [
    {
      "id": "summary",
      "title": "核心知识点总结",
      "description": "概括本次课程解决的问题和主要知识点",
      "writing": "概括本次课程解决的问题、重要概念以及知识点之间的联系。用简洁的连贯段落呈现，具体解释和例题放在对应知识点中"
    },
    {
      "id": "terms",
      "title": "术语表",
      "description": "整理术语、符号、英文原名和适用条件",
      "writing": "整理本次素材中的重要术语和符号，用表格列出名称、必要的英文原名、含义和适用条件。只收录实际涉及的术语，避免重复正文"
    },
    {
      "id": "details",
      "title": "详细笔记",
      "description": "按知识结构展开概念、推导和教师例题",
      "writing": "按知识点重组口语字幕，用清晰的小标题组织内容。解释概念、适用条件和推导过程；教师例题放在对应知识点附近，保留题干、具体数据、代码、关键中间状态和结论，合并重复讲解但保留不同实例"
    },
    {
      "id": "confusions",
      "title": "易混淆点",
      "description": "区分相近概念、条件差异和常见错误",
      "writing": "根据本次素材区分相近概念、适用条件和容易出错的步骤。必要时使用对照表，解释差异的原因；没有实际内容时省略本栏目"
    },
    {
      "id": "questions",
      "title": "思考题／自测题",
      "description": "生成练习，帮助理解和复习",
      "writing": "根据本次课程的主要知识点生成自测题，覆盖概念理解与应用。每题提供答案和理由，标明为生成练习，不将其描述为教师原题。数量以知识覆盖需要为准"
    },
    {
      "id": "sources",
      "title": "来源与待核实项",
      "description": "汇总实际来源、素材缺失和需要回看的位置",
      "writing": "列出实际使用的课程素材和来源链接，外部资料单独注明。记录未确认的板书、公式、题干或素材缺失，写清位置和影响；已有回看入口能定位时引用该入口，避免重复堆叠链接"
    },
    {
      "id": "personal",
      "title": "我的补充",
      "description": "留给自己的批注、问题和复习记录",
      "writing": "保留一个供学习者补充批注、疑问和复习记录的栏目，AI 不代写个人体验。后续补充时保留这里及正文其他位置的人工修改"
    }
  ];
  const properties = [
    {
      "name": "title",
      "label": "标题",
      "type": "text",
      "rule": "笔记标题"
    },
    {
      "name": "course",
      "label": "课程",
      "type": "text",
      "rule": "课程名称"
    },
    {
      "name": "scope",
      "label": "覆盖范围",
      "type": "text",
      "rule": "本篇覆盖的章节、视频或文件"
    },
    {
      "name": "chapter",
      "label": "章节分组",
      "type": "text",
      "rule": "确认的分组；未知或跨组填 null"
    },
    {
      "name": "source",
      "label": "主要来源",
      "type": "text",
      "rule": "已知的课程或视频链接"
    },
    {
      "name": "sources",
      "label": "来源列表",
      "type": "list",
      "rule": "本篇实际使用的来源链接"
    },
    {
      "name": "source_cids",
      "label": "B站 CID",
      "type": "list",
      "rule": "已确认的 B站 CID；其他素材省略"
    },
    {
      "name": "created",
      "label": "创建日期",
      "type": "date",
      "rule": "生成日期（YYYY-MM-DD）"
    },
    {
      "name": "status",
      "label": "整理状态",
      "type": "text",
      "rule": "draft 整理中；partial 缺失；complete 完成"
    },
    {
      "name": "author",
      "label": "笔记作者",
      "type": "text",
      "fixed": true,
      "value": ""
    },
    {
      "name": "tags",
      "label": "标签",
      "type": "list",
      "fixed": true,
      "value": "课程笔记"
    }
  ];
  const types = {
    "text": "文字",
    "number": "数字",
    "list": "列表",
    "boolean": "开关",
    "date": "日期"
  };
  const taskTypes = {
    "notes": "整理笔记",
    "supplement": "补充已有笔记",
    "continue": "继续整理",
    "translate": "翻译字幕",
    "review": "复习答疑"
  };
  const preferences = {
    "goal": "理解课程、完成练习与复习",
    "language": "简体中文",
    "granularity": "group",
    "folder": "Note/课程笔记",
    "naming": "课程缩写-章节编号-主题.md",
    "links": "heading",
    "external": true,
    "progress": true,
    "instructions": "",
    "customProperties": []
  };
  function defaults() {
    return { ...preferences, modules: modules.map(item => ({ ...item, enabled: true })), properties: properties.map(item => ({ ...item, enabled: true })), customProperties: [] };
  }
  function deliveryDefaults() { return {"environment": "local", "task": "notes", "reference": "", "question": "", "paths": "", "format": "md"}; }
  const api = { modules, properties, types, taskTypes, defaults, deliveryDefaults };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.NoteDefaults = api;
})();
