# Vid2Notes 本地转写组件

此目录包含可选的本地转写服务与独立安装向导。基础浏览器扩展不附带模型。

可处理 B站音轨，也可尝试处理 YouTube 播放器直接提供的音轨地址。已有安装若要转写 YouTube 视频，请用新版安装包更新原目录并重启服务。

下载并运行 `vid2notes-asr-setup.exe`，在中文安装向导中选择安装目录与 CPU / NVIDIA GPU。向导将 Python、运行环境、模型和下载缓存放在选定目录，显示当前步骤与可展开的详细日志；失败时可以重试。无需提前安装 Python。

安装完成后点击“复制连接码”，在工作台“本地转写”页面填写并连接。完成页可直接启动组件，以后也可从开始菜单的“Vid2Notes → 启动本地转写”启动。关闭服务窗口即可停止。本机服务仅监听 `127.0.0.1:27347`；连接码和音频不会发给 Vid2Notes 的服务器。

组件使用 [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 的 small 模型，模型文件约 461 MiB，Python 与依赖另外占用空间。GPU 运行库需额外下载约 1.3 GiB，下载和解压缓存也放在所选目录。已有组件时先关闭旧服务，再运行安装程序并选择**原来的安装目录**，原连接码会保留。补装 GPU 时选择 NVIDIA GPU，无需单独运行补装脚本。

首次转写会实际试跑 GPU。成功时使用 CUDA；缺少 CUDA 12 cuBLAS、cuDNN 9 或运行失败时，工作台会说明原因并自动改用 CPU。

## 构建安装程序

安装 Inno Setup 6.5+ 后运行 `python scripts/build_asr_installer.py`，或用 `--iscc` 指定编译器路径。输出为 `downloads/vid2notes-asr-setup.exe`，并复制到扩展的下载入口。安装程序本身不附带模型和 Python。

- `installer.iss`：安装页面、进度与日志、快捷方式、完成页和卸载
- `setup-runtime.ps1`：由安装向导在后台调用的运行环境安装逻辑
- `languages/ChineseSimplified.isl`：来自 [Inno Setup 官方翻译目录](https://jrsoftware.org/files/istrans/)的中文语言文件

卸载移除安装器提供的程序、运行环境和缓存，保留 `config.json` 连接配置。
