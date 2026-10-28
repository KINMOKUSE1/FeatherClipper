<div align="center">
  <img src="./extension/shared/icons/icon128.png" width="72" alt="FeatherClipper">


# FeatherClipper


**Collect technical tutorials and online course materials, then turn them into study notes tailored to your preferences with AI.**<br>
**收集技术教程、网课素材，借助 AI 按个人偏好整理成学习笔记.**


简体中文 | [English](README.md)


<img src="./docs/images/workbench-youtube.png" width="100%" alt="课程工作台：选择课时、核对字幕并批量导入">
<br>
<br>
<a href="https://github.com/KINMOKUSE1/FeatherClipper/releases">
  <img src="https://img.shields.io/github/v/release/KINMOKUSE1/FeatherClipper?style=flat-square&label=Release" alt="最新版本">
</a>
<a href="./LICENSE">
  <img src="https://img.shields.io/github/license/KINMOKUSE1/FeatherClipper?style=flat-square" alt="MIT License">
</a>
<img src="https://img.shields.io/badge/Chrome%20%7C%20Edge-supported-526f63?style=flat-square" alt="支持 Chrome 和 Edge">



<a href="https://github.com/KINMOKUSE1/FeatherClipper/releases">下载扩展</a> ·
<a href="#开始使用">开始使用</a> ·
<a href="./使用说明.md">使用说明</a> ·
<a href="./docs/开发指南.md">开发指南</a>

</div>

> **English readers: see [README.md](README.md) for the full English guide.**<br>
> 中文用户：往下看就是完整的中文说明。




## 这是什么

FeatherClipper 是一款面向技术教程和在线课程的 Chrome / Edge 浏览器扩展，支持 Bilibili 与 YouTube 字幕提取、分 P 和播放列表批量导入 Obsidian，以及无字幕视频的音频转写。你可以按个人偏好配置笔记结构与写作规则，生成供本地 AI agent 或网页 AI 使用的 skill、提示词与任务材料，将课程素材整理为 Markdown 学习笔记。
- **字幕采集**：识别当前视频和分 P，预览字幕；B站支持切换字幕语言
- **批量导入**：支持 B站分 P 和 YouTube 播放列表，勾选课时后批量导入 Obsidian
- **复制与导出**：复制完整的 Markdown 字幕，或保存为 `.md` 文件
- **导入记录**：按课程系列归并，展示封面、最近导入时间和已导入数量；可从记录返回课程素材，继续导入剩余视频
- **个性化笔记**：配置学习目标、语言、笔记结构和 YAML 属性，生成适用于本地 agent 或网页 AI 的整理规则与任务指令
- **音频转写**：为无字幕视频选择本地模型、Groq 或硅基流动，转写后导入笔记库

## 开始使用

1. 下载源码，在 Chrome / Edge 的扩展管理页开启开发者模式，加载 `extension/` 文件夹
2. 在 Obsidian 中安装并启用 Local REST API，在扩展中填写连接信息
3. 打开视频，选择课时并导入素材；进入“整理笔记”，配置规则后，将材料和指令交给 AI

> 仅复制或导出字幕时，无需连接 Obsidian。本地转写组件按需安装，推荐使用在线服务。

**手动安装：**
<div align="center">

https://github.com/user-attachments/assets/dac5f572-6b64-4e94-835a-c1d2c3461975

详细操作见[使用说明](./使用说明.md)。
</div>

**连接 Obsidian:**
<div align="center">

https://github.com/user-attachments/assets/bfcf0862-cf3f-4f90-88b8-fd87255233e9

详细操作见[使用说明](./使用说明.md)。
</div>

## 为什么做

你可能偶然发现一段感兴趣的教程，暂时没有时间观看，希望先保存素材；也可能只想借助 AI 提取重点，判断是否值得深入学习；还可能连续看完多节课程，需要整理、复习并留档，作为下次学习的起点；~~亦或是 token 太富裕，用不完手痒痒 (≖ᴗ≖)✧~~

收集与整理并不总在同一时刻发生。现有的 Bilibili、YouTube MCP 工具已经能够获取字幕，并配合 AI 完成笔记整理。FeatherClipper 进一步关注这些操作之间的衔接：**集中收集和保存视频素材，让用户在需要时再进行整理。**

每次重新编写提示词，都会增加重复操作，也容易让不同批次的笔记在结构和详略上产生差异。因此，**FeatherClipper 提供可自定义、保存的 skill 与提示词，将笔记结构、写作要求和个人偏好固定为可复用的规则。**

同时，FeatherClipper 希望降低 AI 辅助学习的使用门槛，让不熟悉 AI 工具的自学者也能轻松上手。项目既支持本地 agent，也为网页 AI 用户准备材料与指令，让个人整理规则能够持续复用，并随学习需要调整。

项目选择 Obsidian 作为素材与笔记的存储中心。它兼具 Markdown 编辑与知识库管理能力，并拥有丰富的第三方插件，可接入 AI agent，让素材收纳、笔记整理、阅读与复习在同一个软件中衔接，形成完整的学习闭环。

## 开发

使用 HTML、CSS 和 JavaScript，开发预览与正式扩展共用一份实现，无需编译。

目录职责、预览与测试方法见[开发指南](./docs/开发指南.md)。

## 致谢与许可

基于 [Bilibili-Obsidian-Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper) 二次开发，保留原项目署名。

YouTube 字幕请求流程参考 [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api)，Obsidian 连接使用 [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)。

[MIT License](./LICENSE)
