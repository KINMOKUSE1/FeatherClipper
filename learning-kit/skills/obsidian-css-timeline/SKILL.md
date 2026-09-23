---
name: obsidian-css-timeline
description: 把时间区间、并行事件或 css-timeline 代码块编译成 Obsidian 中按真实时长比例显示的时间线。适用于协议时序、进程调度、甘特式安排及定量时序笔记。
---

# Obsidian 比例时间线

使用附带的 Python 编译器，把时间描述转换为 HTML 和 CSS。所需环境：Python 3.9+、本地笔记文件、Obsidian CSS snippet。

1. 读取笔记和时间数据，按[时间描述语法](references/dsl.md)编写 `css-timeline` 代码块，统一单位。
2. 确认笔记位于 Obsidian 笔记库中，编译器会向上查找 `.obsidian`；也可用 `--snippet` 指定 CSS 文件。
3. 先预览编译结果：`python scripts/compile_timeline.py NOTE.md --dry-run`。
4. 用户要求写入时，运行 `python scripts/compile_timeline.py NOTE.md --write`，更新笔记和 CSS。
5. 首次使用时，在 Obsidian“设置 → 外观 → CSS 代码片段”启用 `css-timeline`。
6. 检查刻度与区间比例、窄事件、行标签和已有笔记内容；同一领域的颜色含义保持一致。

以上命令中的脚本路径相对于本技能目录；执行时使用它的实际路径。

## 数据与输出

- 保留来源的起止值、事件顺序和单位。跨度不足 3% 的窄条保持真实宽度，说明放到图下。
- `time` 与 `ticks` 至少提供一个；颜色使用语法文档中的关键词。
- 编译器按领域管理配色，已有自定义 CSS 保留。超出时间范围或未知颜色会给出提示，按来源核对后处理。
- `--write` 将代码块替换为可在笔记中显示的 HTML；后续调整时使用原始时间数据重新生成。
