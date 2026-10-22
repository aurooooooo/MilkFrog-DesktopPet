# 运行素材来源与处理

- WebP：来自本项目 `assets/seven-key` 当前图层、预览图及 `assets/accessory_*.png`，缩至 960×640 后无损编码；原图保留。
- `keyboard-tap.ogg`、`click-laugh.ogg`：本项目原按键和点击音效提取 / 转码为单声道 Opus。
- 四条 MP3：按用户指定，从相邻 `naiwa-pet/naiwa/voice` 原样复制 `gagadilaxia`、`gajiaosei`、`ganbadie`、`andi`。
- `laugh.webm`：按用户指定使用 `naiwa-pet/naiwa/laugh.mp4`，配套音轨来自同一项目的 `laugh.m4a`；去绿幕、裁剪多余背景、缩至 448×576 / 24fps，VP9 alpha + 单声道 Opus。

处理命令保存在 `scripts/prepare-media.cjs`。FFmpeg 为开发时工具，运行程序不调用它。此说明记录来源与处理方式，不改变原始素材的权利归属。
