# Video WebM/WebP Compressor

Version: `1.8.0`

Chrome MV3 extension for batch converting uploaded videos into compressed WebM files by default. Animated WebP output is still available as an option.

## 安装

1. 打开 `chrome://extensions/`。
2. 开启右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本目录：`/Users/xy/Downloads/谷歌插件/浏览器插件-视频转webp`，或解压 `dist/video-webm-webp-compressor-1.8.0.zip` 后选择解压目录。

## 使用

1. 点击扩展图标，打开浏览器右侧的转换面板。
2. 选择或拖入多个视频。
3. 默认输出 `WebM`，也可以切换为 `WebP`。最大宽度和帧率默认保持原始视频。
4. 点击「开始转换」。
5. 点击「下载全部 WebM」，文件会进入 Chrome 默认下载目录下的同一个子文件夹，例如 `VideoWebM-20260529-150000/`。

## 说明

- 转换在本机浏览器内完成，不上传视频。
- 默认输出为 `.webm`，压缩等级默认是「轻微压缩」；轻微压缩使用 VP9 保真优先编码并去除音频，适合画质优先的批量处理。
- 可选输出为 `.webp`，适合短视频动图和网页素材。
- 小于 3MB 的视频会使用阶梯小文件保清晰策略：`<1MB`、`1-2MB`、`2-3MB` 分别按目标输出体积反推码率；「轻微压缩」允许小文件适度变大来保画质，例如 600KB 文件可进入约 700-900KB 区间，超过上限才会轻度降码率重试。
- 3-6MB 的视频会使用中等文件阶梯策略；其中 3-4MB 默认轻微压缩会使用更高码率和更保真的 VP9 编码参数，允许输出接近或略大于源文件来优先保清晰。
- 大于 6MB 的视频会使用上一版大文件快速压缩策略，轻微压缩约按 42% 源码率作为目标，并使用 `realtime` 编码以提升速度。
- 大体积或超长视频会消耗较多内存；批量转换时每个文件会独立释放 FFmpeg 引擎，降低卡住概率。
- 本扩展使用本地打包的 `ffmpeg.wasm` 文件，核心文件位于 `vendor/ffmpeg/`，不依赖你的电脑服务器或外部 CDN。
