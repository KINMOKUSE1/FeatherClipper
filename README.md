# Course Cove

![Course Cove 图标](./extension/icons/icon48.png)

**Bilibili subtitles to Obsidian**

把整门课的字幕，分 P 收进 Obsidian。

面向大学生和自学者的 Edge 扩展。可在视频页预览并导入当前 P，也可批量导入同一 BV 下的整门课。插件保存原始字幕与课程清单；章节笔记由你选择的 AI 按自己的规则整理。

[下载 Edge 安装包](https://github.com/KINMOKUSE1/bilibili-course-clipper/releases/download/v1.2.1/course-clipper-edge.zip) · [开始安装](#安装与首次使用) · [详细说明](./使用说明.md)

## 主要功能

- **单 P 与整课导入**：视频页预览当前 P；课程工作台可批量选择同一 BV 下的分 P。
- **字幕与回看链接**：获取 B站提供的普通字幕或 AI 字幕，优先使用中文；保存完整字幕、时间戳和视频链接。
- **课程素材管理**：按标题预分章，也可手动调整；自动生成课程清单，跳过已有字幕，支持停止和重试。
- **自己的笔记工作流**：提供学习规则、模板和可选技能包，用你选择的 AI 整理章节笔记。

导入字幕无需配置 AI 模型或模型 API Key；首次连接 Obsidian 后即可使用。

## 使用效果

<!-- 替换为真实截图或 GIF：在 B站视频页打开扩展 → 预览字幕 → 导入当前 P。 -->
> 🖼️ **演示图待补充：快捷窗口** — 在视频旁完成预览与单 P 导入。

<!-- 替换为真实截图或 GIF：章节筛选、多选、字幕预览与导入进度。 -->
> 🖼️ **演示图待补充：课程工作台** — 选择整章或整课，批量收集字幕。

<!-- 替换为真实截图：Obsidian 中的课程清单、原始字幕与按规则整理的成品笔记。 -->
> 🖼️ **演示图待补充：从素材到笔记** — 原始字幕 → 章节清单 → 你的学习笔记。

## 安装与首次使用

### 1. 装好浏览器扩展

1. [下载安装包（ZIP）](https://github.com/KINMOKUSE1/bilibili-course-clipper/releases/download/v1.2.1/course-clipper-edge.zip)，**完整解压**到一个长期保留的位置。若浏览器没有开始下载，可从[发布页](https://github.com/KINMOKUSE1/bilibili-course-clipper/releases/tag/v1.2.1)的 Assets 中选择 `course-clipper-edge.zip`。
2. 双击里面的 **`安装指南.html`**，按页面提示操作：打开 `edge://extensions/`，开启“开发人员模式”，点击“加载解压缩的扩展”。
3. 选择解压后的 **`course-clipper` 文件夹**，将“Course Cove”固定到工具栏。

安装包里已准备好扩展，**无需 Git、Node.js 或命令行**。安装后保留解压目录。熟悉开发的用户也可以直接加载本仓库的 `extension/`。

### 2. 连接 Obsidian（只需一次）

1. 打开笔记库，在 **设置 → 第三方插件 → 浏览** 中搜索 **Local REST API**，安装并启用。
2. 打开它的设置，启用 **HTTP 服务（Enable HTTP server）**，复制 API Key。默认本机地址为 `http://127.0.0.1:27123`；改过端口时使用实际地址。
3. 点击“Course Cove”图标 → **配置 Obsidian**，粘贴地址和 Key，点击 **测试连接 → 保存设置**。

需要 HTTPS 或连接遇到问题时，查看[详细说明](./使用说明.md#连接-obsidian)及 [Local REST API 文档](https://github.com/coddingtonbear/obsidian-local-rest-api)。

### 3. 导入第一段视频

在 Edge 登录 B站，打开一段有字幕的视频，点击扩展图标。确认预览内容后，点击 **“导入 P…”**，回到 Obsidian 就能找到原始字幕。

想收集整门课？点击 **“批量导入整门课”**，勾选视频、核对章节，点击 **“导入 … 个视频”** 即可。

## 从字幕到章节笔记

默认保存到 `Clippings/Bilibili/`，每门课程有一份清单和一个原始字幕文件夹：

- **课程导入清单**：查看分 P、章节归属和导入状态。
- **原始字幕**：保留每个 P 的完整可用字幕与时间链接。
- **章节笔记**：交给你的 AI 按规则整理，默认每章一篇；也可以只整理指定 P。

导入后，在工作台点击 **“开始整理笔记”**：

1. 首次点击 **“保存学习文档”**，在 Obsidian 的 `学习工作流/WORKFLOW.md` 填写学习目标和笔记目录。
2. 勾选本章已导入的分 P，点击 **“复制任务指令”**。指令列出课程清单和字幕文件的路径，**不包含文件正文**；未勾选分 P 时不会复制。
3. 本地 AI 若能读取笔记库，粘贴指令即可让它按路径读取；网页聊天 AI 还需上传 `WORKFLOW.md`、`NOTE_TEMPLATE.md`、课程导入清单和本章对应的原始字幕。`PROMPTS.md` 只是给你参考的指令示例。
4. 核对教师例题、推导与来源，再加入自己的理解。字幕没收录的板书、公式和题干会作为回看项处理。

常用本地 AI 工具的用户可以 **下载技能包**：`course-notes` 负责整理、翻译、补充与复习；`obsidian-mermaid` 绘制流程和结构图；`obsidian-css-timeline` 用于比例时间线。安装方法见[技能包说明](./learning-kit/README.md)。普通聊天工具直接使用 Markdown 文档即可。

## 常见问题

**所有视频都能导入吗？**

支持同一 BV 下的单 P、多分 P，以及平台提供的 AI 字幕。视频需要有可用字幕；跨 BV 合集和无字幕音频转录暂不支持。

**可以关闭窗口吗？**

单 P 导入在后台继续，快捷窗口可以收起。批量导入时保持课程工作台打开；导入期间也要保持 Obsidian 打开。

**重复导入会覆盖笔记吗？**

同一课程目录内按视频 CID 识别，已有原始字幕跳过，课程清单更新。学习文档也会保留已有版本。目录调整与去重细节见[文件组织说明](./使用说明.md#文件组织与重复导入)。

**如何更新？**

关闭扩展页面，用新版文件替换原安装目录中的文件，在扩展管理页点击“重新加载”。详细步骤见[使用说明](./使用说明.md#安装或升级)。

## 开发与打包

直接加载 `extension/` 开发。运行测试：

```sh
node --test tests/*.test.cjs
```

修改扩展或学习文档后，重新生成下载包：

```sh
python scripts/build_install_package.py
```

脚本会先更新学习技能包，再生成 `downloads/course-clipper-edge.zip`，仅使用 Python 标准库。

## 致谢与许可

本项目基于 [haixiong1997/Bilibili-Obsidian-Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper) 的概念与 MIT 代码二次开发，保留原许可证和署名。上游已提供字幕获取（包括 B站 AI 字幕）和 Obsidian 导入能力；本项目围绕自学场景，进一步组织了快捷导入、整课批量处理、章节清单与可自定义的学习工作流。

感谢 [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 提供本地笔记库连接。项目采用 [MIT License](./LICENSE)。
