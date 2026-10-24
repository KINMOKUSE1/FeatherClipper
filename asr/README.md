# FeatherClipper 本地转写组件

此目录只负责本地模型转写。Groq 和硅基流动的音轨下载、解码、切分和 API 调用在浏览器扩展内完成，不需要此组件。

可处理 B站音轨，也可尝试处理 YouTube 播放器直接提供的音轨地址。已有安装若要转写 YouTube 视频，请用新版安装包更新原目录并重启服务。

安装向导支持 CPU 和 NVIDIA GPU，安装 Python、音频依赖和 Whisper small 模型。

安装完成后复制连接码，在工作台“音频转写”页面选择“本地模型”并保存连接码。本机服务仅监听 `127.0.0.1:27347`，使用本机模型处理音频，不接收在线服务商 API Key。

本地模式使用 [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 的 small 模型，模型文件约 461 MiB，Python 与依赖另外占用空间。GPU 运行库需额外下载约 1.3 GiB，下载和解压缓存也放在所选目录。已有组件时先关闭旧服务，再运行安装程序并选择**原来的安装目录**，原连接码会保留。补装 GPU 时选择 NVIDIA GPU，无需单独运行补装脚本。

本地 GPU 模式首次转写会实际试跑。成功时使用 CUDA；缺少 CUDA 12 cuBLAS、cuDNN 9 或运行失败时，工作台会说明原因并自动改用 CPU。

## 测试当前源码

在线模式重新加载扩展即可测试，相关代码位于 `extension/transcription/`。本地组件源码测试时关闭服务窗口，将 `server.py` 复制到原安装目录，保留 `config.json`、运行环境和模型，再启动组件。

## 构建安装程序

安装 Inno Setup 6.5+ 后运行 `python scripts/build_asr_installer.py`，或用 `--iscc` 指定编译器路径。输出为 `downloads/featherclipper-asr-setup.exe`，并复制到扩展的下载入口。安装程序本身不附带模型和 Python。

- `installer.iss`：安装页面、进度与日志、快捷方式、完成页和卸载
- `setup-runtime.ps1`：由安装向导在后台调用的运行环境安装逻辑
- `languages/ChineseSimplified.isl`：来自 [Inno Setup 官方翻译目录](https://jrsoftware.org/files/istrans/)的中文语言文件

卸载移除安装器提供的程序、运行环境和缓存，保留 `config.json` 连接配置。
