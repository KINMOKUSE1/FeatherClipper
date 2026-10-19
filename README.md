# Vid2Notes

把 B站和 YouTube 的课程字幕收进 Obsidian，再交给你使用的 AI 整理成学习笔记。

Vid2Notes 是面向课程学习的 Chrome / Edge 扩展，支持单个视频、B站分 P 和 YouTube 播放列表。从字幕预览、批量导入，到音频转写、个性化笔记整理，在同一个工作台完成素材准备。

源码版本：**v1.3.5**

[安装与使用](#安装) · [使用说明](./使用说明.md) · [开发指南](./docs/开发指南.md)

## 功能

- **字幕采集**：识别当前视频和分 P，预览字幕；B站支持切换字幕语言
- **复制与导出**：复制完整 Markdown 字幕，或保存为 `.md` 文件
- **课程导入**：按章节筛选、多选课时、核对字幕并批量导入 Obsidian；按钮显示进度，再次点击取消，失败项可重试
- **导入记录**：按课程系列归并，展示封面、最近导入时间和已导入数量；从记录返回课程素材，继续导入剩余视频
- **个性化笔记**：配置目标、语言、笔记结构和 YAML 属性，生成适用于本地 agent 或网页 AI 的规则与任务指令
- **音频转写**：为无字幕视频选择本地模型、Groq 或硅基流动，转写后导入笔记库

工作台包含 **课程素材、导入记录、整理笔记、音频转写、连接配置** 五个页面。

## 界面预览

| B站：当前视频字幕 | YouTube：系列课程 |
|:---:|:---:|
| <img src="./docs/images/popup-bilibili.png" alt="B站视频的字幕预览与保存入口" width="320"> | <img src="./docs/images/popup-youtube.png" alt="YouTube 播放列表的当前课时与整课入口" width="320"> |

**课程工作台：选择课时、调整章节并核对字幕**

![YouTube 课程目录与字幕核对](./docs/images/workbench-youtube.png)

## 安装

### 加载当前源码

1. 下载或克隆本仓库，将文件放在长期保留的目录
2. 打开浏览器的扩展管理页：Chrome 使用 `chrome://extensions/`，Edge 使用 `edge://extensions/`
3. 开启“开发者模式”或“开发人员模式”，点击“加载已解压的扩展程序”或“加载解压缩的扩展”
4. 选择仓库中的 **`extension/` 文件夹**，将 Vid2Notes 固定到工具栏

Chrome 最低版本为 116。更新源码后，到扩展管理页点击“重新加载”，再打开扩展页面。

下载区提供[上次发布的扩展包](./downloads/course-clipper-edge.zip)和[本地转写安装程序](./downloads/vid2notes-asr-setup.exe)。扩展包解压后加载其中的 `course-clipper` 文件夹；本页介绍当前源码，最新功能通过上述源码加载方式使用。

## 使用

### 预览、复制与保存字幕

在 B站或 YouTube 视频页点击扩展图标，自动读取当前课时。快捷窗口展示前 12 个阅读段落，复制和文件导出包含完整字幕。

- **保存字幕 / 保存当前字幕**：导入 Obsidian
- **保存按钮右侧的箭头**：复制到剪贴板，或保存 Markdown 文件
- **B站字幕语言**：点击预览标题行中的语言名称，选择自动或指定字幕轨
- **整门课程 / 选择分 P**：进入工作台，处理系列课程

B站字幕读取会校验视频归属，并分别显示无字幕、登录受限和读取失败等状态。遇到登录提示时，在当前浏览器登录 B站后重新读取。

### 连接 Obsidian

复制与文件导出可直接使用。导入笔记库时，在 **连接配置** 页面设置：

1. 在 Obsidian 安装并启用 [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 插件，启用 HTTP 服务并复制 API Key
2. 填写服务地址、API Key 和默认素材根目录；默认地址为 `http://127.0.0.1:27123`
3. 点击 **测试连接**，连接成功后 **保存配置**

API Key 支持纯密钥和 `Bearer <密钥>` 两种写法，自动处理前缀大小写与首尾空格。

### 批量导入课程

1. 在 **课程素材** 页面核对目录，勾选课时
2. 按章节筛选，使用全选、仅选当前或清空；章节号可直接修改
3. 点击课时标题展开字幕预览，再次点击收起
4. 确认保存目录，点击 **导入 Obsidian**

导入按钮显示当前进度，再次点击即可取消。已有字幕文件自动跳过，失败项可重试，无字幕课时可转写音频。

快捷窗口关闭后，当前视频的导入在后台继续。批量处理时保持工作台和 Obsidian 打开；读取 YouTube 文稿时，浏览器会使用对应的视频页面。

### 从导入记录继续学习

**导入记录** 按系列展示课程封面、名称、最近导入时间和进度，例如 `12/30`。后续导入更新原记录，同一个视频重复导入只计一次；单个视频独立显示。

点击系列记录，按课程原顺序查看已导入的视频，并打开原视频链接。详情页右上角的 **进入课程素材** 会加载完整课程目录，沿用记录中的保存目录并显示当前导入状态。单个视频的同名入口位于更多菜单中。

### 整理学习笔记

在课程素材页勾选要整理的课时，打开 **整理笔记**：

1. 选择任务：整理笔记、补充笔记、继续整理、翻译字幕或复习答疑
2. 设置学习目标、笔记语言、保存目录和整理粒度
3. 调整 **笔记结构** 中的栏目、顺序及写法，勾选 YAML 属性，填写署名和标签；设置自动保存
4. 根据使用的 AI 选择交付方式

**本地 agent**

点击 **安装技能**，下载 `course-notes.zip` 并复制安装指令。将技能包和指令交给 agent，安装完成后点击 **确认已安装**，再 **复制 skill 使用指令**。规则修改后点击 **更新技能**；更多菜单提供技能导出和安装目录同步。

**网页 AI**

每次选择一个视频，或上传字幕文件。点击 **复制任务指令** 会同时导出材料，将导出的 Markdown 文件或 ZIP 上传至网页 AI，再粘贴配套指令。补充或继续整理时，上传已有笔记或进度文件。

生成的技能包含整理流程、任务方法、个人偏好、栏目写法、属性规则，以及 Obsidian Markdown 和 Mermaid 绘图说明。AI 根据当前配置整理材料，保留教师例题、推导和来源。

分组支持每个视频一篇或按课程章节整理。普通章节保留两级编号，如 `2.2`、`2.3`；同一 Lecture 的多个 Part 归入同一讲次，分组可在课程目录中调整。

### 转写无字幕视频

在 **音频转写** 页面选择引擎并保存配置，再返回课程素材，选择无字幕课时，点击 **转写并导入**。

| 引擎 | 配置方式 | 输出 |
|---|---|---|
| 本地模型 | 安装组件，启动后填写连接码，使用 CPU 或 NVIDIA GPU | faster-whisper small，带时间戳 |
| Groq | 填写服务商 API Key | whisper-large-v3-turbo，带分段时间戳 |
| 硅基流动 | 填写服务商 API Key | SenseVoiceSmall，纯文本转录稿 |

在线引擎直接在扩展内获取、解码并按 120 秒切分音频，上传至所选服务商。YouTube 的 SABR 音频通过扩展创建的静音辅助页取得播放会话，再在扩展内下载完整音频，辅助页随后自动关闭。API Key 保存在扩展的本机存储，可在配置页清除；本地引擎由本机组件运行模型。导入结果记录转写来源与模型，带时间戳的结果提供回看链接。

本地模型安装、GPU 配置和组件构建见[本地转写组件说明](./asr/README.md)。

## 素材保存

默认根目录为 `Clippings/Bilibili/` 和 `Clippings/YouTube/`，可在连接配置或课程素材页修改。每门课程使用独立文件夹：

- **课程导入清单.md**：课时、章节、导入状态与素材链接
- **原始字幕/**：每个视频的 Markdown 字幕或转录稿，包含来源属性；B站文件名带 CID，YouTube 文件名带视频 ID

课程清单随导入更新，整理后的笔记目录由 **整理笔记** 页面设置。

## 开发

页面使用 HTML、CSS 和 JavaScript，扩展与开发预览共用一份实现。在 Chrome 或 Edge 加载 `extension/`，在项目根目录启动预览：

```sh
python -m http.server 8000 --bind 127.0.0.1
```

- [快捷窗口预览](http://127.0.0.1:8000/dev/preview.html)
- [工作台预览](http://127.0.0.1:8000/dev/workbench-preview.html)

预览通过示例数据切换课程、字幕、导入和连接状态，修改后点击“刷新预览”。真实平台读取与 Obsidian 导入在扩展中测试。

项目目录：

- `extension/popup/`：快捷窗口
- `extension/workbench/`：课程素材、导入记录、笔记配置、转写与连接页面
- `extension/background/`：平台读取、Obsidian 读写和任务路由
- `extension/transcription/`：扩展内的在线音频处理与转写
- `extension/shared/`：课程工具、动态文案、字体和图标
- `dev/`：预览入口与模拟接口
- `asr/`：本地模型服务与 Windows 安装向导
- `tests/`：JavaScript 与 Python 测试
- `scripts/`：安装包构建脚本

运行测试：

```sh
node --test tests/*.test.cjs
python -X utf8 -m unittest discover -s tests -p "test_*.py"
```

文件职责、整理规则来源和分支开发方式见[开发指南](./docs/开发指南.md)。安装 Inno Setup 6.5+ 后，可构建扩展发布包与本地转写安装程序：

```sh
python scripts/build_install_package.py
```

## 致谢与许可

本项目基于 [Bilibili-Obsidian-Clipper](https://github.com/haixiong1997/Bilibili-Obsidian-Clipper) 二次开发，保留原项目的 MIT 许可证与署名。

YouTube 字幕提取参考 [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) 和 [Defuddle](https://github.com/kepano/defuddle)。本地笔记库连接使用 [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)。

项目采用 [MIT License](./LICENSE)。
