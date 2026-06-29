# Video WebM Compressor

Version: `2.0.1`

Chrome MV3 extension and local ffmpeg batch script for converting videos to WebM with VP9 video and Opus audio.

## Chrome 插件安装

1. 打开 `chrome://extensions/`。
2. 开启右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本目录：`/Users/xy/Downloads/谷歌插件/浏览器插件-视频转webp`，或解压 `dist/video-webm-webp-compressor-2.0.1.zip` 后选择解压目录。

## 插件转换参数

- 输出格式固定为 `WebM`。
- 视频编码固定为 `libvpx-vp9`。
- 音频编码固定为 `libopus`，音频码率 `96k`。
- 输出宽度固定为 `600px`，高度按比例自适应并保持偶数。
- 帧率保持原始帧率，但最高不超过 `30fps`。
- VP9 使用 CRF 受限质量模式：`-crf 31 -b:v 1.5M -maxrate 1.5M -bufsize 3M`。
- 像素格式固定为 `yuv420p`。

插件在浏览器沙盒内运行，只能处理上传文件并下载转换结果；浏览器插件不能直接重命名你磁盘上的原文件。

浏览器内的 `ffmpeg.wasm` 对内存更敏感。插件会优先使用 `VP9 + Opus`，如果遇到 `memory access out of bounds` 这类 wasm 内存崩溃，会自动重试为 `VP9` 视频兼容模式以保证转换完成。需要严格保留 Opus 音频和原文件 `_back` 备份流程时，使用下面的本地批处理脚本。

## 本地批处理

需要完整执行「先压缩到临时目录、全部成功后原文件改名 `_back`、再移动 WebM 回原文件夹」时，使用本地脚本：

```bash
./batch_compress_webm.sh /path/to/videos
```

也可以传入多个文件：

```bash
./batch_compress_webm.sh 118.mp4 119.mov
```

脚本依赖本机安装的 `ffmpeg` 和 `ffprobe`。执行前会检查同名 `_back` 文件和 `.webm` 输出文件是否已存在；如果存在冲突，会提示并停止，不会覆盖原文件。

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

插件使用本地打包的 `ffmpeg.wasm` 文件，核心文件位于 `vendor/ffmpeg/`，不依赖你的电脑服务器或外部 CDN。
