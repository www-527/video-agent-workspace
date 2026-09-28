# GPT 自由视觉生成：网关重试与单镜 Prompt 精简

## 背景

GPT 自由视觉生成通过 `https://hgapi.dieqiyun.top` 的 Responses 流调用 `gpt-5.6-terra`。近期追踪显示两类问题：

- 两次请求在约 120 秒时以 `504 Gateway Time-out` 失败，`output.length=0`，没有 token 用量。这是中转站网关在转发首个输出事件前的硬性超时；本地 HTML 调用已经允许等待 300 秒，不能靠客户端超时覆盖。
- 另一次请求拿到 `response.created` 后被取消，属于外部 `AbortSignal`，不应自动重试。

自由视觉 HTML 当前要求模型一次输出完整独立 HTML/CSS/SVG/Canvas。Prompt 同时注入全片逐镜口播、完整艺术方向对象、相邻镜头、当前镜头和原始素材片段，增加首包前上下文处理和生成负担。目标是在不改变叙事与视觉连续性的前提下缩小单镜上下文。

## 目标

1. 为 `GPT 自由视觉生成` 的可恢复上游故障增加一次有界重试。
2. 将单镜视觉 Prompt 压缩为当前镜上下文、必要的全片视觉母题和前后镜摘要。
3. 保持用户取消、模型能力错误、HTML 校验失败和内容错误的原有行为。

## 非目标

- 不修改中转站的 120 秒网关配置；这是服务端/供应商责任。
- 不改变 GPT-free 的 300 秒本地 HTML 等待上限。
- 不降低 HTML 完整文档、画布、安全区、无外部资源和 `data-editor-*` 等契约要求。
- 不为无效 HTML、空输出、截断输出或用户取消启用重试。
- 不调整视觉总监、内容规划或普通 HTML 工作流的重试策略。

## 现有实现位置

- 自由视觉 Prompt 与生成：`src/lib/ai/html.ts`
  - `buildFreeFrameHtmlPrompt()`
  - `generateFreeFrameHtml()`
  - `FREE_FRAME_HTML_SYSTEM`
- GPT-free HTML 调用与 300 秒默认超时：`src/lib/ai/client.ts`
- GPT-free Responses 上游错误与 trace：`src/lib/ai/providers/gpt-free-codex.ts`
- 分镜生成路由、请求取消传播：`src/app/api/frames/html/route.ts`
- 浏览器端请求取消：`src/hooks/use-frame-generation.ts`

## 实施步骤

### 1. 定义“可恢复的视觉生成错误”

在 `html.ts` 新增局部错误分类辅助函数（或复用已有上游错误类型），仅接受以下情况：

- HTTP 502、503、504；
- 错误文本明确包含 `bad gateway`、`gateway timeout`、`service unavailable`、短暂 upstream/network 失败。

必须排除：

- `opts.abortSignal.aborted` 或 `AbortError`；
- 本地 HTML 校验/清洗错误；
- `VisionUnavailableError`；
- 输出为空、输出截断、模型返回不完整文档；
- 4xx、鉴权、配额和输入参数错误。

### 2. 为单镜自由视觉生成增加一次重试

在 `generateFreeFrameHtml()` 的调用外层增加一次有界 retry：

- 正常尝试计为第 1 次；
- 仅当第 1 次失败且命中可恢复错误时，等待一个短暂、可取消的退避时间后再请求 1 次；
- 两次请求均使用相同的 `AbortSignal`、当前镜 Prompt、视觉母题与本地图片输入；
- 如果用户取消，立即抛出取消，不进入退避或第 2 次请求；
- 如果第 2 次仍失败，保留最终的上游错误，供现有任务/追踪系统记录。

不要将 retry 放到整个项目生成路由：那会重跑已经成功的资源准备、音频或其他分镜。

### 3. 精简 `buildFreeFrameHtmlPrompt()`

保留以下信息：

- 当前镜：标题、旁白、画面意图、内容关系、动作语义、信息池、时长和画布；
- 全片内容锚点：主题与核心主张；
- 必要视觉母题：`visualBible` 的 theme、颜色、字体/空间/动作 token、视觉语言、禁用项；
- 相邻镜头：仅前后各一条 `{ title, visualIntent }` 摘要；
- 只在与当前镜匹配时保留的、长度受限的原始素材片段；
- 已提供本地图片的路径和叙事用途。

移除或压缩：

- 完整 `globalScript` 的 `[#1] ... [#N]` 逐镜口播；
- 传递给本镜但为空的 `creativeBrief`、`directorPlan`、`visualAnchor` 对象；
- 与当前镜无关的原始素材全文/宽泛片段；
- 重复出现的主题、首镜描述和相邻镜说明。

推荐做法：引入一个“当前镜/邻镜叙事上下文”构建函数，只传当前旁白与相邻镜标题/意图，不再把 `globalScript` 拼入 Prompt。继续保留 `globalScript` 参数仅在其他调用方确有用途时，避免不必要的公共 API 改动。

### 4. 测试

为 `generateFreeFrameHtml()` 与 `buildFreeFrameHtmlPrompt()` 增加或扩展单测：

1. 502/503/504 的首次失败会重试一次，第二次成功时返回有效 HTML。
2. 连续两次 504 时只调用两次，并抛出最后一次错误。
3. 已中止的信号、`AbortError`、`VisionUnavailableError`、HTML 校验错误不重试。
4. Prompt 包含当前镜旁白、内容锚点、视觉母题、前后镜摘要与画布约束。
5. Prompt 不包含完整 `[#1] ... [#N]` 全片口播；不注入空的上下文对象。
6. 为包含较长全片脚本的输入设置 Prompt 字符数上限，避免未来回归。

运行命令：

- `npm.cmd test -- <相关测试文件>`
- `npx.cmd tsc --noEmit`
- `git diff --check`

## 验收标准

- 首次出现 502/503/504 时，同一镜头最多发起两次自由视觉生成请求；第二次成功可正常保存 HTML。
- 用户取消后不发起额外请求，错误/状态仍显示为取消。
- 非瞬态模型与 HTML 校验错误不被误重试。
- Prompt 不再包含整片逐镜口播；仍足以维持当前镜内容准确性和相邻镜视觉差异。
- 不影响标准 HTML 工作流和其他 Agent。
- 测试、类型检查与 `git diff --check` 均通过。

## 风险与决策

- 重试不能消除中转站的 120 秒硬超时，只能缓解偶发网关波动；两次连续超时仍须提示用户检查/更换中转站。
- 单镜 Prompt 精简不得删掉视觉母题、当前镜意图或画布/安全区约束，否则会导致画面风格漂移或不可渲染。
- 浏览器/路由取消的触发来源目前未写入 trace；本任务不修改取消观测，但实现重试时必须尊重现有 `AbortSignal`。
