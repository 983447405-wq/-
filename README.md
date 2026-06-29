# Video WebM Compressor

Version: `2.0.7`

Chrome MV3 extension plus a local native FFmpeg helper for converting videos to WebM with VP9 video and Opus audio.

## Chrome 插件安装

1. 打开 `chrome://extensions/`。
2. 开启右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本目录：`/Users/xy/Downloads/谷歌插件/浏览器插件-视频转webp`，或解压 `dist/video-webm-webp-compressor-2.0.7.zip` 后选择解压目录。
5. 执行一次本地助手自启动安装：

```bash
./install_local_helper_autostart.sh
```

Mac 用户也可以双击：

```text
install_local_helper_autostart.command
```

## 插件转换参数

- 输出格式固定为 `WebM`。
- 视频编码固定为 `libvpx-vp9`。
- 音频编码固定为 `libopus`，音频码率 `96k`。
- 输出宽度固定为 `600px`，高度按比例自适应并保持偶数。
- 帧率保持原始帧率，但最高不超过 `30fps`。
- VP9 使用 CRF 受限质量模式：`-crf 31 -b:v 1.5M -maxrate 1.5M -bufsize 3M`。
- 像素格式固定为 `yuv420p`。

插件在浏览器沙盒内运行，负责选择文件、显示进度和下载结果；真正的视频压缩由本机 `local_ffmpeg_server.py` 调用原生 FFmpeg 完成。

浏览器插件不能直接执行 macOS/Linux/Windows 的原生 `ffmpeg` 可执行文件，所以需要本地助手。自启动安装完成后，助手会在登录系统时自动运行；插件点击「开始转换」时会连接 `http://127.0.0.1:17777`。

如果助手没有运行，插件会提示安装或启动本地助手，不再回退到浏览器 `ffmpeg.wasm`，避免 VP9 wasm 内存不足。

压缩完成后，插件优先使用 `chrome.downloads` 下载到同一个文件夹。如果不是以 Chrome 插件方式打开页面，下载会退回为浏览器普通下载。

## 本地原生 FFmpeg 助手

推荐只安装一次自启动：

```bash
./install_local_helper_autostart.sh
```

安装后会立即启动，并写入：

```text
~/Library/LaunchAgents/com.video-webm-compressor.helper.plist
```

以后登录系统会自动运行，不需要每次双击。

临时手动启动仍可使用：

```bash
./start_local_ffmpeg_server.sh
```

Mac 用户也可以双击：

```text
start_local_ffmpeg_server.command
```

健康检查地址：

```text
http://127.0.0.1:17777/health
```

本地助手只绑定 `127.0.0.1:17777`，只允许本机访问。插件会把上传的视频发到这个本机端口，压缩完成后取回 WebM，再使用原来的下载逻辑保存到下载文件夹。

严格执行 VP9 + Opus、批量稳定压缩、原文件 `_back` 备份和最终验证时，以本地 `batch_compress_webm.sh` 为准。Chrome 插件无法直接改名磁盘原文件。

## 本地批处理

需要完整执行「先压缩到临时目录、全部成功后原文件改名 `_back`、再移动 WebM 回原文件夹」时，使用本地脚本：

```bash
./batch_compress_webm.sh /path/to/videos
```

也可以传入多个文件：

```bash
./batch_compress_webm.sh 118.mp4 119.mov
```

脚本会优先使用项目内置的原生工具：

```text
tools/ffmpeg/ffmpeg
tools/ffmpeg/ffprobe
```

如果这两个文件不存在，才会回退使用系统 PATH 里的 `ffmpeg` 和 `ffprobe`。执行前会检查同名 `_back` 文件和 `.webm` 输出文件是否已存在；如果存在冲突，会提示并停止，不会覆盖原文件。

核心 ffmpeg 参数：

```bash
ffmpeg -i input.mp4 \
  -map 0:v:0 -map '0:a?' \
  -vf "scale=600:-2" \
  -c:v libvpx-vp9 \
  -crf 31 -b:v 1.5M -maxrate 1.5M -bufsize 3M \
  -row-mt 1 -deadline good -cpu-used 4 \
  -pix_fmt yuv420p \
  -c:a libopus -b:a 96k \
  output.webm
```

如果源视频 FPS 超过 `30`，脚本会使用：

```bash
-vf "fps=30,scale=600:-2"
```

## 验证

本地脚本会在移动文件前验证：

- 输出文件存在且非空。
- 输出宽度为 `600`。
- 输出 FPS 不超过 `30`。
- 输出格式为 `WebM`。

移动完成后会再次验证 `_back` 原文件备份存在，并汇总每个输出文件的大小、分辨率、FPS、时长。

## 离线运行

插件和本地助手都使用项目内文件，不依赖你的电脑服务器或外部 CDN。本地助手和批处理脚本使用项目内置的原生 FFmpeg 文件，核心文件位于 `tools/ffmpeg/`。
