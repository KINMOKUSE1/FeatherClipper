<div align="center">
  <img src="./extension/shared/icons/icon128.png" width="72" alt="FeatherClipper">


# FeatherClipper


**Collect technical tutorials and online course materials, then turn them into study notes tailored to your preferences with AI.**<br>
**收集技术教程、网课素材，借助 AI 按个人偏好整理成学习笔记.**


[简体中文](./README.zh-CN.md) | English


<img src="./docs/images/workbench-youtube.png" width="100%" alt="Course workbench: select lessons, review subtitles, and batch import">
<br>
<br>
<a href="https://github.com/KINMOKUSE1/FeatherClipper/releases">
  <img src="https://img.shields.io/github/v/release/KINMOKUSE1/FeatherClipper?style=flat-square&label=Release" alt="Latest release">
</a>
<a href="./LICENSE">
  <img src="https://img.shields.io/github/license/KINMOKUSE1/FeatherClipper?style=flat-square" alt="MIT License">
</a>
<img src="https://img.shields.io/badge/Chrome%20%7C%20Edge-supported-526f63?style=flat-square" alt="Supports Chrome and Edge">



<a href="https://github.com/KINMOKUSE1/FeatherClipper/releases">Download extension</a> ·
<a href="#getting-started">Getting started</a> ·
<a href="./USER_GUIDE.md">User guide</a> ·
<a href="./docs/DEVELOPMENT.md">Development guide</a>

</div>

> **中文用户请阅读 [README.zh-CN.md](./README.zh-CN.md)，查看完整中文说明。**<br>
> English readers: the full guide is below.




## What is FeatherClipper?

FeatherClipper is a Chrome / Edge browser extension for technical tutorials and online courses. It supports Bilibili and YouTube subtitle extraction, batch imports of multi-part videos and playlists into Obsidian, and audio transcription for videos without subtitles. Configure note structure and writing rules to suit your preferences, then generate skills, prompts, and task materials for local AI agents or web AI to turn course materials into Markdown study notes.

- **Subtitle collection**: identify the current video and its parts and preview subtitles; Bilibili supports subtitle language selection
- **Batch import**: select lessons from multi-part Bilibili videos or YouTube playlists and import them into Obsidian
- **Copy and export**: copy full Markdown subtitles or save them as `.md` files
- **Import history**: group records by course series, showing covers, the latest import time, and imported counts; return to course materials to import remaining videos
- **Personalized notes**: configure learning goals, language, note structure, and YAML properties to generate rules and task instructions for local agents or web AI
- **Audio transcription**: choose a local model, Groq, or SiliconFlow for videos without subtitles and import the transcript into your vault

## Getting started

1. Download the source, enable developer mode in Chrome / Edge's extension manager, and load the `extension/` directory
2. Install and enable Local REST API in Obsidian, then enter the connection details in the extension
3. Open a video, select lessons, and import the materials; open “Study notes”, configure the rules, and give the materials and instructions to your AI

> Copying or exporting subtitles does not require Obsidian. Install the local transcription component when needed; online services are recommended.

<div align="center">
Installation demo:

https://github.com/user-attachments/assets/293886fa-db54-4d43-8468-c5f47a63a69a

See the [user guide](./USER_GUIDE.md) for detailed steps.
</div>

## Why FeatherClipper?

You might come across an interesting tutorial without time to watch it and want to save the material for later. You might ask AI to extract the main points before deciding whether to study it in depth. Or you might finish several lessons and need to organize, review, and keep your notes as a starting point for the next study session; ~~or perhaps you have more tokens than you know what to do with and just can't resist spending them (≖ᴗ≖)✧~~

Collecting and organizing materials do not always happen at the same time. Existing Bilibili and YouTube MCP tools can already retrieve subtitles and work with AI to produce notes. FeatherClipper focuses on connecting these steps: **collect and save video materials in one place, then organize them when needed.**

Rewriting prompts for every session adds repetitive work and can lead to inconsistent note structure and levels of detail. **FeatherClipper therefore provides skills and prompts you can customize and save, preserving note structure, writing requirements, and personal preferences as reusable rules.**

FeatherClipper also aims to lower the barrier to AI-assisted learning, so self-directed learners unfamiliar with AI tools can get started easily. The project supports local agents and prepares materials and instructions for web AI users, allowing personal rules to be reused and adjusted as learning needs change.

The project uses Obsidian as the home for materials and study notes. It combines Markdown editing with knowledge management and offers a rich plugin ecosystem that supports AI agent integration. This connects material collection, note organization, reading, and review within one application, completing the learning workflow.

## Development

Built with HTML, CSS, and JavaScript. Development previews share the extension's implementation and require no build step.

See the [development guide](./docs/DEVELOPMENT.md) for directory responsibilities, previews, and tests.

## Credits and license

Based on [Bilibili-Obsidian-Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper), with the original attribution retained.

YouTube subtitle requests reference [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api). Obsidian connectivity uses [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api).

[MIT License](./LICENSE)
