# FeatherClipper

[简体中文](./README.md) · English

A lightweight browser extension that collects course materials and uses AI to turn them into study notes tailored to your preferences.

---

FeatherClipper supports Chrome / Edge and works with individual videos, multi-part Bilibili courses, and YouTube playlists. Prepare materials in one workbench, from subtitle previews and batch imports to audio transcription and personalized note preparation.

[Getting started](#getting-started) · [User guide (Chinese)](./使用说明.md) · [Development guide (Chinese)](./docs/开发指南.md)

## Motivation

There are already free, open-source subtitle import tools, such as [Bilibili-Obsidian-Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper) and [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper). Building on subtitle collection, this project focuses on:

- Batch imports for multi-part courses and playlists
- A complete workflow from collecting materials to organizing study notes
- Audio transcription for videos without subtitles

The project uses Obsidian to store course materials and study notes, bringing together the features needed for course-based learning, including transcription through online APIs and local models. Customizable, structured skills and prompts help users unfamiliar with MCP, as well as web AI users, prepare materials and generate notes according to their own preferences.

## Features

- **Subtitle collection**: identify the current video and its parts and preview subtitles; Bilibili supports subtitle language selection
- **Copy and export**: copy full Markdown subtitles or save them as `.md` files
- **Import history**: group records by course series, showing covers, the latest import time, and imported counts; return to course materials to import remaining videos
- **Personalized notes**: configure learning goals, language, note structure, and YAML properties to generate rules and task instructions for local agents or web AI
- **Audio transcription**: choose a local model, Groq, or SiliconFlow for videos without subtitles and import the transcript into your vault
- **Interface languages**: Simplified Chinese, English, and Traditional Chinese; English and Traditional Chinese modes generate English descriptions, rules, and default paths while preserving original materials and custom content

## Getting started

1. Download the source, enable developer mode in Chrome / Edge's extension manager, and load the `extension/` directory
2. Install and enable Local REST API in Obsidian, then enter the connection details in the extension
3. Open a video, select lessons, and import the materials; open “Study notes”, configure the rules, and give the materials and instructions to your AI

Copying or exporting subtitles does not require Obsidian. Install the local transcription component when needed.

See the [user guide (Chinese)](./使用说明.md) for detailed steps.

## Installation

https://github.com/user-attachments/assets/293886fa-db54-4d43-8468-c5f47a63a69a

## Development

Built with HTML, CSS, and JavaScript. Development previews share the extension's implementation and require no build step.

See the [development guide (Chinese)](./docs/开发指南.md) for directory responsibilities, previews, and tests.

## Credits and license

Based on [Bilibili-Obsidian-Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper), with the original attribution retained.

YouTube subtitle requests reference [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api). Obsidian connectivity uses [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api).

[MIT License](./LICENSE)
