# Video WebM Compressor

Version: `2.0.4`

Chrome MV3 extension and local ffmpeg batch script for converting videos to WebM with VP9 video and Opus audio.

## Chrome 插件安装

1. 打开 `chrome://extensions/`。
2. 开启右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本目录：`/Users/xy/Downloads/谷歌插件/浏览器插件-视频转webp`，或解压 `dist/video-webm-webp-compressor-2.0.4.zip` 后选择解压目录。

## 插件转换参数

- 输出格式固定为 `WebM`。
- 视频编码固定为 `libvpx-vp9`。
- 音频编码固定为 `libopus`，音频码率 `96k`。
- 输出宽度固定为 `600px`，高度按比例自适应并保持偶数。
- 帧率保持原始帧率，但最高不超过 `30fps`。
- VP9 使用 CRF 受限质量模式：`-crf 31 -b:v 1.5M -maxrate 1.5M -bufsize 3M`。
- 像素格式固定为 `yuv420p`。

插件在浏览器沙盒内运行，只能处理上传文件并下载转换结果；浏览器插件不能直接重命名你磁盘上的原文件。

浏览器内的 `ffmpeg.wasm` 对内存更敏感。插件会优先使用 `VP9 + Opus`，如果遇到 `memory access out of bounds` 这类 wasm 内存崩溃，会自动重试为 `VP9` 视频兼容模式。如果兼容模式仍然内存越界，说明该文件不适合在浏览器插件内转码，需要使用下面的本地批处理脚本。如果 `ffmpeg.exec()` 在结束阶段误报 `startsWith` 这类包装层错误，插件会读取已生成的 WebM 并用浏览器元数据验证输出。

插件转换失败不是因为没有带 FFmpeg。插件已经内置 `vendor/ffmpeg/` 下的 `ffmpeg.wasm`。失败的主要原因是浏览器 wasm 环境的内存限制，尤其是 VP9 批量编码时更容易触发。Chrome 插件不能直接执行 macOS/Linux/Windows 的原生 `ffmpeg` 可执行文件，所以把原生二进制放进插件目录也不能让插件绕过浏览器沙盒。

严格执行 VP9 + Opus、批量稳定压缩、原文件 `_back` 备份和最终验证时，以本地 `batch_compress_webm.sh` 为准。Chrome 插件无法直接改名磁盘原文件，也无法保证浏览器 wasm 对所有视频稳定完成 VP9 编码。

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

插件使用本地打包的 `ffmpeg.wasm` 文件，核心文件位于 `vendor/ffmpeg/`，不依赖你的电脑服务器或外部 CDN。

本地批处理脚本使用项目内置的原生 FFmpeg 文件，核心文件位于 `tools/ffmpeg/`。把整个项目目录发给其他 macOS 用户后，对方可以直接运行 `./batch_compress_webm.sh /path/to/videos`。如果要上架 Chrome 插件商店，建议上架包只保留插件运行需要的 `vendor/ffmpeg/`，原生 `tools/ffmpeg/` 作为 GitHub Release 或本地脚本包提供，因为 Chrome 插件无法执行这些原生二进制。
