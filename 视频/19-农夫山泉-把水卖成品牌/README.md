# 第 19 章｜农夫山泉：把水卖成品牌

本文件夹是第 19 章的独立完整交付包。内容依据课程 PDF 第 67–69 页整理，网页视频与插图采用“森林水源纪录片 / 分销网络与货架选择”的独立视觉方向。本轮成片不含配音或任何音轨，旁白已保存，后续可把配音作为最后一步加入。

## 主要交付物

- `article.md`：PDF 内容整理与事实脉络。
- `script.md`：独立旁白文档，包含故事问题、今天破解、核心知识、生活例子、游戏任务和统一结束语。
- `outline.md`：内容大纲与节奏规划。
- `storyboard.md`：逐镜头分镜、画面动作和时长。
- `assets/prompts/ch19-water-network.md`：GPT Image 2 生成提示词。
- `assets/images/ch19-water-network.png`：GPT Image 2 生成的主题主视觉。
- `presentation/`：可编辑 React + TypeScript 网页视频项目。
- `video/第19章-农夫山泉-把水卖成品牌-无配音.mp4`：最终 1080p H.264 无配音成片。
- `qa-report.md` 与 `qa/`：内容、布局、时间线、运动、关键帧和解码质检。

## 编辑与预览

在 `presentation` 目录运行：

```powershell
npm run dev -- --host 127.0.0.1 --port 4219 --strictPort
```

浏览器打开 `http://127.0.0.1:4219/` 可手动逐镜头查看；加上 `?auto=1&capture=1` 可进入无控制条自动播放模式。

常用验证命令：

```powershell
npm run build
npm run qa:capture
node scripts/qa-auto-flow.cjs
npm run record
```

注意：`npm run record` 生成原始 WebM；最终 MP4 已完成启动层裁切、时间轴校准和 H.264 转码。本轮不要调用 TTS，未来配音应以 `script.md` 为准，并作为最后一步加入。

