# Course Cove 本地转写组件

此目录包含可选的本地转写服务与独立安装向导。基础浏览器扩展不附带模型。

可处理 B站音轨，也可尝试处理 YouTube 播放器直接提供的音轨地址。已有安装若要转写 YouTube 视频，请用新版安装包更新原目录并重启服务。

下载 `course-cove-asr-installer.zip` 后完整解压，双击 `install.cmd`，输入安装目录。向导将 Python、运行环境、模型和下载缓存放在选定目录。安装后双击该目录里的 `启动本地转写.cmd`，把安装时显示的连接码填入扩展工作台。本机服务仅监听 `127.0.0.1:27347`；连接码和音频不会发给 Course Cove 的服务器。

组件使用 [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 的 small 模型，模型文件约 461 MiB，Python 与依赖另外占用空间。安装器检测到 NVIDIA 显卡后会询问是否补装 GPU 运行库；基础安装仍可单独使用 CPU。已有本地组件时，从新安装包运行 `enable-gpu.cmd`，选择**原来的安装目录**即可，连接码和模型会保留。GPU 运行库需额外下载约 1.3 GiB，下载和解压缓存都放在所选目录。完成后关闭旧服务窗口，重新运行 `启动本地转写.cmd`。

首次转写会实际试跑 GPU。成功时使用 CUDA；缺少 CUDA 12 cuBLAS、cuDNN 9 或运行失败时，工作台会说明原因并自动改用 CPU。关闭启动窗口即可停止服务。
