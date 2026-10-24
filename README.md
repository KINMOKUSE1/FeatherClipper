# FeatherClipper

简体中文 · [English](./README.en.md)

一个收集网课素材，并借助 AI 按个人偏好整理成学习笔记的轻量浏览器扩展。

---

FeatherClipper 面向课程学习，支持 Chrome / Edge，适用于单个视频、B站分 P 和 YouTube 播放列表。从字幕预览、批量导入，到音频转写和个性化笔记整理，在同一个工作台完成素材准备。

[安装与使用](#开始使用) · [使用说明](./使用说明.md) · [开发指南](./docs/开发指南.md)

## 动机

目前已有不少开源免费的字幕导入工具，如 [Bilibili-Obsidian-Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper) 与 [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper)。在字幕采集的基础上，本项目进一步关注：

- 多 P 课程和播放列表的批量导入
- 从素材收集到学习笔记整理的完整流程
- 无字幕视频的音频转写

因此，本项目以 Obsidian 作为课程素材与学习笔记的存储空间，围绕课程学习整合所需功能，支持在线 API 和本地模型音频转写。同时，提供可自定义的结构化 skill / prompt，方便不熟悉 MCP 的用户及网页 AI 用户准备材料，并按个人偏好生成课程笔记。

## 功能

- **界面语言**：支持简体中文、English 和繁體中文；英文与繁中模式使用英文生成说明、规则和默认路径，保留原始素材及自定义内容
- **字幕采集**：识别当前视频和分 P，预览字幕；B站支持切换字幕语言
- **复制与导出**：复制完整的 Markdown 字幕，或保存为 `.md` 文件
- **导入记录**：按课程系列归并，展示封面、最近导入时间和已导入数量；可从记录返回课程素材，继续导入剩余视频
- **个性化笔记**：配置学习目标、语言、笔记结构和 YAML 属性，生成适用于本地 agent 或网页 AI 的整理规则与任务指令
- **音频转写**：为无字幕视频选择本地模型、Groq 或硅基流动，转写后导入笔记库

## 开始使用

1. 下载源码，在 Chrome / Edge 的扩展管理页开启开发者模式，加载 `extension/` 文件夹
2. 在 Obsidian 中安装并启用 Local REST API，在扩展中填写连接信息
3. 打开视频，选择课时并导入素材；进入“整理笔记”，配置规则后，将材料和指令交给 AI

仅复制或导出字幕时，无需连接 Obsidian。本地转写组件按需安装。

详细操作见[使用说明](./使用说明.md)。

## 安装

https://github.com/user-attachments/assets/293886fa-db54-4d43-8468-c5f47a63a69a

## 开发

使用 HTML、CSS 和 JavaScript，开发预览与正式扩展共用一份实现，无需编译。

目录职责、预览与测试方法见[开发指南](./docs/开发指南.md)。

## 致谢与许可

基于 [Bilibili-Obsidian-Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper) 二次开发，保留原项目署名。

YouTube 字幕请求流程参考 [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api)，Obsidian 连接使用 [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)。

[MIT License](./LICENSE)