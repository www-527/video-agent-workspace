# 第2章《钱能生钱吗？》交付说明

本目录是全新重制版本，不沿用已删除的旧版成片或项目。视频采用“钱币夜班工坊”独立故事主题，无配音。

## 正式视频

- `video/02-钱能生钱吗（无配音）.mp4`
- H.264 High / 1920×1080 / 30fps / yuv420p
- 时长：362.266667秒
- 音轨：0
- SHA-256：`C9D3CC7FE4B26F8A4C2859E01569131678C03C3E157E1195F96BFA9CB4E577D3`

## 内容文件

- `article.md`：根据PDF第11—13页整理的准确内容底稿。
- `script.md`：五段式视频内容稿。
- `outline.md`：11幕内容大纲、主题样式、素材方案与表述边界。
- `assets/prompts/night-workshop-keyart.md`：GPT Image 2主视觉提示词。
- `assets/generated/money-night-workshop-keyart.png`：生成并归档的主视觉原图。

## 可编辑项目

- `presentation/`：Vite + React + TypeScript网页动画项目。
- `presentation/src/chapters/02-money-night-workshop/`：本章独立组件、CSS动画和11段内容源。
- `presentation/scripts/qa-capture.cjs`：11幕逐屏截图与安全区诊断。
- `presentation/scripts/record-video.cjs`：无配音自动时间线录制。

## 质检结果

- TypeScript与Vite构建通过。
- 11/11幕1920×1080截图通过；安全区越界0，浏览器控制台错误0。
- 正式MP4全片10868帧解码通过，退出码0。
- 开头、中段、游戏入口和片尾抽帧均正常。
- 100.0秒与100.5秒相邻画面哈希不同，SSIM为0.997322，确认存在真实连续动态。
- 固定结束语完整显示：“知识已经拿到了，现在去闯关吧。”

详细证据见`qa-report.md`、`delivery-manifest.json`和`qa/`目录。
