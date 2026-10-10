# 可选绘图技能

为课程笔记补充流程图、结构图与比例时间线。

## 与课程整理技能的关系

`course-notes` 由工作台根据当前笔记设置生成，下载和同步入口在“整理笔记”页面。它的规则源码位于 `extension/workbench/notes/rules/`，本目录只维护可选绘图技能。

使用本地 agent 时，按需要安装下面的绘图技能，已有同名技能可继续使用。网页 AI 使用工作台导出的课程材料和规则。

## 包含什么

| 文件夹 | 用途 | 需要的环境 |
|---|---|---|
| `skills/obsidian-mermaid` | 流程、结构、状态和消息时序图 | 支持 Mermaid 的笔记预览 |
| `skills/obsidian-css-timeline` | 保持真实时长比例的时间线 | Python 3.9+，Obsidian CSS snippet |

## 安装到本地工具

将所需技能的整个文件夹复制到下列位置，保留其中的引用文档、模板和脚本：

| 工具 | 本项目使用 | 所有项目使用 |
|---|---|---|
| Codex | 项目根目录的 `.agents/skills/` | 用户目录的 `.agents/skills/` |
| Claude Code | 项目根目录的 `.claude/skills/` | 用户目录的 `.claude/skills/` |

安装后，在对应项目打开会话并调用技能；列表未刷新时重新打开工具。例如让 `obsidian-mermaid` 为已整理笔记补充流程图，或让 `obsidian-css-timeline` 绘制保留真实时长比例的时间线。

安装位置与调用方式参考：[Codex 官方文档](https://learn.chatgpt.com/docs/build-skills)、[Claude Code 官方文档](https://code.claude.com/docs/en/skills)。

## 时间线示例

在笔记中写入：

```css-timeline
time: 0ms..40ms
ticks: 0,8,16,24,32,40
row 任务A: [0..8:green]"处理", [8..24:yellow]"等待"
row 任务B: [8..24:blue]"处理"
```

让 `obsidian-css-timeline` 技能编译这份笔记，再在 Obsidian 外观设置中启用生成的 `css-timeline` 代码片段。编译器只用 Python 标准库。

绘图技能基于已有本地 Mermaid 与 CSS 时间线技能整理，随项目按 MIT 许可证提供。许可证见包内 `LICENSE`。
