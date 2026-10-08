# 课程学习技能包

把课程字幕整理成详细笔记，再按需要补充流程图与比例时间线。

## 先选一种用法

- **聊天工具**：在工作台填写笔记偏好，复制任务指令，再将课程清单和对应字幕交给 AI。
- **支持 skill 的本地工具**：安装 `course-notes`，提供工作台生成的任务指令及课程素材。绘图技能可按需要安装。

## 包含什么

| 文件夹 | 用途 | 需要的环境 |
|---|---|---|
| `skills/course-notes` | 整章、单 P 整理，增量补充，翻译及复习 | 能读取素材的 AI |
| `skills/obsidian-mermaid` | 流程、结构、状态和消息时序图 | 支持 Mermaid 的笔记预览 |
| `skills/obsidian-css-timeline` | 保持真实时长比例的时间线 | Python 3.9+，Obsidian CSS snippet |

## 安装到本地工具

将所需技能的整个文件夹复制到下列位置，保留其中的引用文档、模板和脚本：

| 工具 | 本项目使用 | 所有项目使用 |
|---|---|---|
| Codex | 项目根目录的 `.agents/skills/` | 用户目录的 `.agents/skills/` |
| Claude Code | 项目根目录的 `.claude/skills/` | 用户目录的 `.claude/skills/` |

安装后，在对应项目打开会话并调用技能；列表未刷新时重新打开工具。已有同名绘图技能时可继续使用，只补装核心整理技能。

- Codex 示例：`$course-notes 请按本次笔记偏好整理课程清单中 2.2 分组的素材。`
- Claude Code 示例：`/course-notes 请按本次笔记偏好整理课程清单中 2.2 分组的素材。`

使用插件时，在工作台的“整理笔记”页面修改个人偏好，并复制任务指令；指令直接包含这些偏好。技能的内置模板用于未明确指定栏目和属性的任务。

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

课程整理规则来自本项目的 course-notes 技能；绘图技能基于已有本地 Mermaid 与 CSS 时间线技能整理，随项目按 MIT 许可证提供。许可证见包内 `LICENSE`。
