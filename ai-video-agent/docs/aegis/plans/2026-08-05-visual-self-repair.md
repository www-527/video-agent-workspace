# 截图驱动的逐镜视觉自修复：实施计划

## Goal

实现默认关闭并记忆选择的“视觉自修复”开关。开启后，每个 HTML 分镜版本最多执行一次“35%/70%/100% 截图、当前镜代码和语义切片 → GPT 修复 → 截图及 DOM 复审”。只保存明确改善且没有确定性审计退化的候选；视觉任务从不阻断导出。

## Architecture

`PreviewPanel` 保留队列、取消和保存编排。新建 `src/lib/quality/visual-self-repair.ts` 承担截图采样、内容密度/主截图、Agent 输入、候选复审和安全摘要。复用既有 HTML 保护、AI Key 上下文、Codex Responses 图片编码、DOM 审计和 `frame-tunes/apply`；不建第二套 transport、Key 解析或保存接口。

## Tech Stack

Next.js 14、React 18、TypeScript、Zustand、Vitest、既有 Codex Responses 图片输入；只扩展既有 JSON 质量报告，不做 Prisma migration。

## Baseline / Authority Refs

- `docs/aegis/specs/2026-08-05-visual-self-repair-design.md`
- `AGENTS.md`
- `src/components/studio/preview-panel.tsx`
- `src/lib/quality/auto-optimize.ts`、`src/lib/iframe-utils.ts`
- `src/lib/ai/frame-quality-repair.ts`、`src/lib/ai/client.ts`
- `src/lib/ai/providers/codex-responses.ts`、`src/lib/ai/providers/gpt-free-codex.ts`
- `src/types/index.ts`、`src/app/api/projects/[id]/frame-tunes/apply/route.ts`、`src/lib/quality/export-gate.ts`

## Compatibility Boundary

- 仅 HTML 分镜适用；图片、UI scene 和导出格式不变。
- 默认关闭；关闭时零截图、零视觉请求，当前 DOM 审计和手动修复保持。
- DeepSeek 或不支持图片输入的配置不得处理截图；不得换 Key、模型、协议或自动重试。
- Base64、原始模型输出和凭据不进入质量报告、日志、错误响应或 localStorage。
- 视觉失败、不可用、取消、超时和未改善均不阻断导出。

## TDD Route

- Mode: off; Decision: skipped; Strict authority: not applicable.
- Test posture: post-change regression。
- Reason: 未要求严格 TDD；以聚焦 Vitest、完整测试、类型检查和构建验证跨层改动。

## Readiness Checks

### Requirement Ready Check

- Source: 已批准设计和用户对 C 方案、三时点、主截图权重、一修一审、文字排版边界、默认关闭/记忆的确认。
- Acceptance: 设计第 9 节。
- Open questions: 无。
- Decision: ready。

### Change Necessity

- 当前 DOM 规则无法读取真实截图、按画面意图修复或比较前后画面；不改代码无法实现该能力。
- 最小边界：设置、截图/视觉领域模块、共享图片 AI 调用、质量调度/报告、测试和 README。
- Decision: code-change。

### Existence and Integrity

- 新表面：`visual-self-repair.ts`。
- 证明：截图采样、主证据排序、单镜视觉输入和前后比较是新职责；继续扩充 53KB 的 `PreviewPanel` 会增加耦合。
- 复用：审计、HTML 清洗/信息保护、Responses 编码和保存 owner。
- 不变量：Agent 只返回当前镜候选；浏览器复审和确定性审计决定保存。
- 决定：add-with-proof；不建第二个 HTTP/SSE/Key/save owner。

## Files

| File | Action | Purpose |
| --- | --- | --- |
| `src/types/index.ts` | Modify | 版本化视觉摘要/状态，绝不含 data URL。 |
| `src/components/studio/studio-layout.tsx`、`settings-menu.tsx` | Modify | 新 key、默认关闭、记忆和开关说明。 |
| `src/lib/quality/visual-self-repair.ts` | Create | 截图、主截图、输入、复审、接受结果。 |
| `src/lib/iframe-utils.ts`、`src/lib/quality/auto-optimize.ts` | Modify | 隐藏 iframe 的内存快照协议和多时点复用。 |
| `src/lib/ai/client.ts`、`src/lib/ai/providers/gpt-free-codex.ts`、`src/lib/ai/providers/codex-responses.ts` | Modify | 单请求多模态 HTML 调用，复用现有 encoder。 |
| `src/lib/ai/frame-quality-repair.ts`、`src/app/api/projects/[id]/frame-quality/repair/route.ts` | Modify | 视觉提示、HTML 保护和受限请求验证。 |
| `src/components/studio/preview-panel.tsx` | Modify | 串行任务、取消、状态和唯一保存接线。 |
| `src/components/studio/quality-panel.tsx`、`storyboard-strip.tsx` | Modify | 非阻断状态。 |
| `tests/visual-self-repair.test.ts` | Create | 领域测试。 |
| `tests/preview-panel-tune.test.tsx`、`tests/settings-menu-auto-optimize.test.tsx`、`tests/codex-responses.test.ts`、`tests/frame-quality-repair.test.ts` | Modify/Create | 回归。 |
| `README.md` | Modify | 已实现能力、模型要求、隐私和非阻断边界。 |

## Tasks

### 1. 类型、默认关闭与记忆开关

Files: `src/types/index.ts`, `studio-layout.tsx`, `settings-menu.tsx`, `tests/settings-menu-auto-optimize.test.tsx`.

实现新 `ai-video:visual-self-repair:v1`，首开 `false`、刷新恢复；定义只含截图 hash/MIME/尺寸/字节数/密度/主索引/状态的 `VisualSelfRepairSummary`。设置说明“发送当前分镜截图给支持图片输入的 GPT；失败不影响导出”。聚焦验证：`npm test -- settings-menu-auto-optimize.test.tsx`。

### 2. 三时点截图与主截图选择

Files: `iframe-utils.ts`, `auto-optimize.ts`, new `visual-self-repair.ts`, `tests/visual-self-repair.test.ts`.

为 watchdog 添加 nonce 关联的快照消息，固定 35%、70%、100% 动画并等待资源后回传缩放 JPEG/WebP。实现 `captureFrameSnapshots`，处理 abort、timeout、无效图像与 iframe source/nonce 校验。以确定性像素亮度/色差/非背景覆盖计算内容密度，最高为主，平分取较晚时点。仅输出安全摘要。验证：`npm test -- visual-self-repair.test.ts auto-optimize.test.ts`。

### 3. 一次多模态 HTML 修复调用

Files: `client.ts`, `gpt-free-codex.ts`, `codex-responses.ts`, `frame-quality-repair.ts`, repair route, transport/repair tests。

扩展共享 AI client 的 HTML 调用参数为系统/用户文本、三图和 abort，沿用 Key 上下文、trace 脱敏、Responses encoder。编码主截图后再编码辅助截图，文本写清主截图最高权重，断言每任务一 fetch。视觉 prompt 只传当前镜标题、旁白、htmlPrompt、SceneSpec、时长与短全片摘要，不传全大纲；允许排版，禁止改字/事实/跨镜/伪装。复用 HTML 清洗与信息保护。非视觉配置返回 `vision_unavailable`，不回退。验证：`npm test -- codex-responses.test.ts frame-quality-repair.test.ts`。

### 4. 一修一审、串行调度和保存边界

Files: `visual-self-repair.ts`, `preview-panel.tsx`, `frame-tunes/apply` route, visual/preview tests。

实现 `runVisualSelfRepair`：原镜采样、一次 Agent、候选验证、候选采样、DOM 审计和前后比较，返回 `accepted | unchanged | unavailable | cancelled | failed`。接受条件必须同时满足：HTML/信息保护通过、无 DOM critical 或退化、主截图明确改善、辅助截图无新增严重时序问题。`PreviewPanel` 仅在开关开启时调度未处理 hash，保持一次一镜、生成/tune 暂停、AbortController 和 revision 唤醒。仅 accepted 通过既有 `frame-tunes/apply` 落库；其他结果只更新状态。自动路径停止调用旧的多轮 `autoRepairFrame` AI 兜底，手动 repair 保持旧路径。验证：`npm test -- visual-self-repair.test.ts preview-panel-tune.test.tsx`。

### 5. UI、导出回归和 README

Files: quality panel、storyboard strip、`export-gate.ts`、对应 tests、`README.md`。

展示未启用、检查中、修复中、已优化、未改善保留原画面、模型不可用；不展示截图或原始模型内容。测试视觉 `failed`/`unavailable`/`unchanged` 不增加 export gate 失败，既有 DOM gate 继续运行。README 仅在实现后加入默认关闭、模型前提、单镜三截图+代码、一修一审、非阻断和不持久化截图。验证：`npm test -- quality-panel.test.tsx storyboard-strip.test.tsx export-gate.test.ts`。

### 6. 全量验证

先运行所有聚焦测试，再运行 `npx tsc --noEmit`、`npm test`、`npm run build` 和 `git diff --check`。手工确认：首次关闭、启用并刷新保持、生成镜头后的状态推进、关闭时没有网络请求、候选未改善时原画面和导出入口均保留。所有网络测试使用 mock，不发真实 API 请求。

## Risks, Retirement and Rollback

- 字体、资源或浏览器导致快照失败：非阻断失败，保留原镜，使用 timeout/abort/nonce 校验。
- 模型删内容或改事实：HTML 清洗、可见文本/ID/本地资产断言和复审拒绝。
- 成本和模型不可用：默认关闭、每 hash 一次、每镜一次请求、无重试/切换。
- 自动视觉路径退休旧 `autoRepairFrame` 的多轮 AI 兜底；旧路径继续只服务用户显式手动修复，直到另有批准迁移。
- 回滚只需关闭新开关或移除视觉模块接线；不涉及数据库迁移，不影响手动修复/导出。

## Execution Readiness View

- Intent Lock: opt-in HTML 单镜截图驱动 GPT 自修复，不改内容事实和导出门禁。
- Scope Fence: 三时点、一修一审、默认关闭、无截图持久化；不做跨镜/全片重写或审美硬门禁。
- Baseline Lock: 复用质量调度、HTML 安全、Responses 图片编码和保存 owner；DeepSeek 不处理视觉。
- Task Batches: 开关；采样；多模态调用；调度/接受；UI/README；验证。
- Evidence: 聚焦与完整测试、类型检查、构建、手工开关/任务/导出回归、README 更新。
- Drift rule: 若隐藏渲染无法安全采样或共享 client 无法单请求传图，回到设计审查；不得增加旁路截图服务或第二套 fetch。
