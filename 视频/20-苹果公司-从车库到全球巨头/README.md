# 第 20 章｜苹果公司：从车库到全球巨头

本文件夹是第 20 章的独立完整交付包。内容依据课程 PDF 第 70–72 页整理，网页视频与插图采用“极简产品生态图 / 设备节点与迁移成本”的独立视觉方向。本轮成片不含配音或任何音轨，旁白已保存，后续可把配音作为最后一步加入。

## 主要交付物

- `article.md`：PDF 内容整理与事实脉络。
- `script.md`：独立旁白文档，包含故事问题、今天破解、核心知识、生活例子、游戏任务和统一结束语。
- `outline.md`：内容大纲与节奏规划。
- `storyboard.md`：逐镜头分镜、画面动作和时长。
- `assets/prompts/ch20-garage-ecosystem.md`：GPT Image 2 生成提示词。
- `assets/images/ch20-garage-ecosystem.png`：GPT Image 2 生成的主题主视觉。
- `presentation/`：可编辑 React + TypeScript 网页视频项目。
- `video/第20章-苹果公司-从车库到全球巨头-无配音.mp4`：最终 1080p H.264 无配音成片。
- `qa-report.md` 与 `qa/`：内容、布局、时间线、运动、关键帧和解码质检。

## 编辑与预览

在 `presentation` 目录运行：

```powershell
npm run dev -- --host 127.0.0.1 --port 4220 --strictPort
```

浏览器打开 `http://127.0.0.1:4220/` 可手动逐镜头查看；加上 `?auto=1&capture=1` 可进入无控制条自动播放模式。

常用验证命令：

```powershell
npm run build
npm run qa:capture
node scripts/qa-auto-flow.cjs
npm run record
```

注意：`npm run record` 生成原始 WebM；最终 MP4 已完成启动层裁切、时间轴校准和 H.264 转码。本轮不要调用 TTS，未来配音应以 `script.md` 为准，并作为最后一步加入。

