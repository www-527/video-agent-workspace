# 第 1 章交付包：零花钱里的大学问

状态：首版成片已完成，等待用户审核。

## 直接查看

- 成片：`video/01-零花钱里的大学问.mp4`
- 完整口播：`script.md`
- 场景结构：`outline.md`
- PDF 原文摘录：`article.md`

## 可编辑项目

- `presentation/`：Vite + React 网页视频项目。
- `presentation/src/chapters/01-pocket-money/`：九幕 React 与 CSS 源码。
- `presentation/public/assets/`：成片视觉素材。
- `presentation/public/audio/pocket-money/`：网页自动播放使用的九段 MP3。
- `audio/raw/`：IndexTTS 生成的九段无损 WAV。
- `audio/reference/琴.mp3`：本项目内的参考声线副本。
- `audio/voice-profile.json`：声线、语速与生成方式配置。
- `audio/chapter01-narration-master.mp3`：含场景缓冲的合并主音轨。
- `garden-gpt-image-2/`：GPT Image 2 提示词和生成记录。
- `video/clips/`：九幕独立视频，方便只替换某一幕。
- `qa-final/`：成片时间点抽帧。

## 替换配音

1. 用新参考音频替换 `audio/reference/琴.mp3`，或修改 `audio/voice-profile.json` 的参考路径。
2. 按 `presentation/audio-segments.json` 的九段文本重新调用 IndexTTS。
3. 把新 MP3 放入 `presentation/public/audio/pocket-money/1.mp3` 至 `9.mp3`。
4. 只重新生成受影响的 `video/clips/NN.mp4`，再按 `video/clips.concat.txt` 合并即可。

## 验证结果

- 项目构建：通过 `npm run build`。
- 画面：1920×1080，页面和滚动边界均无溢出。
- 成片：323.62 秒，H.264 视频、AAC 单声道音频、30fps。
- 音量：平均约 -18.4 dB，峰值 -0.4 dB。
- 终帧：停留在游戏挑战页，固定结束句完整显示。
