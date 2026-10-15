# Vid2Notes 音频处理组件

此目录包含本地任务服务与独立安装向导。本地模型、Groq 和硅基流动共用音轨下载、切分和导入流程。

可处理 B站音轨，也可尝试处理 YouTube 播放器直接提供的音轨地址。已有安装若要转写 YouTube 视频，请用新版安装包更新原目录并重启服务。

安装向导支持 CPU、NVIDIA GPU 和“仅在线转写”。在线模式只安装 Python 与 PyAV，不下载或加载 Whisper 模型。当前源码的在线能力需要重新构建安装程序后才会包含在发布包中。

安装完成后复制连接码，在工作台“音频转写”页面填写并保存配置。本机服务仅监听 `127.0.0.1:27347`。本地模式在本机转写；在线模式将切分后的音频上传至用户选择的服务商，不经过 Vid2Notes 服务器。

在线 Key 保存在扩展的本机存储，每个任务仅将所选服务的 Key 传给本机组件。组件不保存 Key，不在查询结果或日志中返回 Key。保存配置不调用转写 API，实际调用时验证权限与额度。

- Groq：`whisper-large-v3-turbo`，带分段时间戳
- 硅基流动：`FunAudioLLM/SenseVoiceSmall`，纯文本转录稿，不生成时间链接
- 音频按 120 秒切分，依次提交；只对明确的 429 限流重试，不自动重发超时请求
- 取消停止后续分段，已提交给服务商的请求可能继续处理

本地模式使用 [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 的 small 模型，模型文件约 461 MiB，Python 与依赖另外占用空间。GPU 运行库需额外下载约 1.3 GiB，下载和解压缓存也放在所选目录。已有组件时先关闭旧服务，再运行安装程序并选择**原来的安装目录**，原连接码会保留。补装 GPU 时选择 NVIDIA GPU，无需单独运行补装脚本。

本地 GPU 模式首次转写会实际试跑。成功时使用 CUDA；缺少 CUDA 12 cuBLAS、cuDNN 9 或运行失败时，工作台会说明原因并自动改用 CPU。

## 测试当前源码

已有组件时关闭服务窗口，将本目录的 `server.py` 和 `online.py` 复制到组件安装目录，保留原 `config.json`、运行环境和模型，再启动组件。重新加载扩展后，在“音频转写”页选择引擎并保存自己的 API Key，即可从课程素材页发起在线转写。

## 构建安装程序

安装 Inno Setup 6.5+ 后运行 `python scripts/build_asr_installer.py`，或用 `--iscc` 指定编译器路径。输出为 `downloads/vid2notes-asr-setup.exe`，并复制到扩展的下载入口。安装程序本身不附带模型和 Python。

- `installer.iss`：安装页面、进度与日志、快捷方式、完成页和卸载
- `setup-runtime.ps1`：由安装向导在后台调用的运行环境安装逻辑
- `online.py`：在线接口、音频切分、结果归一化和限流处理
- `languages/ChineseSimplified.isl`：来自 [Inno Setup 官方翻译目录](https://jrsoftware.org/files/istrans/)的中文语言文件

卸载移除安装器提供的程序、运行环境和缓存，保留 `config.json` 连接配置。
