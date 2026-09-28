# GPT 自由创作迁移到 Codex Responses 流式协议

## 状态与需求来源

- 状态：设计已由用户于 2026-08-05 确认，等待规格复核后进入实施计划。
- 需求来源：用户要求依据 `docs/Codex API 测试输入输出协议.md`，用首页 `Codex API 测试` 的输入输出方式替换整个 `GPT 自由创作` 工作流的模型输入输出方式。
- 已确认范围：内容规划、质量审校、自由编导、HTML 画面生成与修复等所有 GPT 自由创作模型调用。

## 目标

让 `workflow === 'gpt-free'` 的每一次模型调用都使用同一套 Codex 风格 Responses 流式线协议，并以 `src/lib/ai/codex-test-chat.ts` 现有实现和协议文档作为基准。每个 Agent 调用只产生一次真实上游 HTTP 请求，不使用 SDK、程序重试、参数重试或 Chat Completions 回退。

## 非目标

- 不把整个视频创作链压缩为单个模型请求；内容规划、审校、编导和逐镜生成仍是独立 Agent 调用。
- 不把 Codex API 测试助手的固定 instructions 用于生产创作。
- 不把测试窗口的完整诊断 UI 或原始 SSE 时间线写入项目数据。
- 不改变标准项目、DeepSeek、Key 管理中的旧 API 对话测试或非 GPT 自由创作调用。
- 不改变项目数据库结构、持久化的 Key 数据格式、画幅、确认首镜、分镜、HTML 或导出契约。
- 不在本次迁移中改变 GPT 自由创作当前的 Key/模型选择和项目绑定语义。

## 已批准行为

### 上游请求

GPT 自由创作的每个模型调用必须：

- 直接 `POST <resolved-base-url>/v1/responses`；已经以 `/v1/responses` 结尾的地址保持不变。
- 使用交接文档定义的 Codex 风格 Headers 和每次调用新建的 correlation IDs。
- 使用 `stream: true`、`store: false`、`tools: []`、`tool_choice: 'auto'`、`parallel_tool_calls: false`。
- 使用 `reasoning: { effort: 'low', summary: 'auto' }`、`text: { verbosity: 'medium' }` 和 `include: ['reasoning.encrypted_content']`。
- 不发送 `max_output_tokens`、`previous_response_id` 或工具定义。
- 将现有 Agent system prompt 放入 `instructions`，将当前 Agent user prompt 转换成一个 `role: 'user'`、`type: 'input_text'` 的 Responses 输入项。
- 使用 raw `fetch`，不经过 OpenAI SDK。

### 上游响应

- 服务端按 SSE 块解析上游响应，支持 LF/CRLF、多行 `data:`、JSON 事件和可选 `[DONE]`。
- 只有 `response.output_text.delta` 可以追加业务输出，避免重复正文。
- 只有观察到 `response.completed` 才判定调用成功。
- `response.failed`、`error`、非 2xx、解析失败、只有 `[DONE]` 没有完成事件或完成事件前 EOF 都判定失败。
- JSON 调用在流完成后解析累计正文；HTML 与普通文本调用返回累计正文。
- 生产 API 继续返回现有完整 JSON 响应并维持数据库更新顺序；本次不把浏览器端创作工作台改造成上游 SSE 透传 UI。
- API Key、Bearer/Cookie 凭据和 encrypted reasoning 不进入业务输出或浏览器错误。

### 请求次数和失败策略

- “一次请求”指一个 Agent 调用对应一个真实上游 `fetch`。
- GPT 自由创作的一次用户操作可以合法触发多个 Agent 调用，因此可以产生多个按阶段可解释的上游请求。
- 每个 Agent 调用不重试、不删除不兼容参数后重试、不降低 reasoning effort、不切换到 Chat Completions。
- 失败必须终止当前阶段并通过现有业务错误边界返回脱敏后的真实上游状态；不得伪造成功或自动走旧协议。

## 架构与所有权

### 协议所有者

`src/lib/ai/codex-test-chat.ts` 中现有的地址归一化、Codex Headers、请求身份、Responses 请求体、raw fetch、SSE 解析、结束语义和脱敏逻辑应提炼为可由测试窗口和生产调用共同复用的协议核心。测试窗口保留自己的固定 instructions、多轮消息和诊断事件适配；生产调用传入 Agent instructions 与单条 user input，并只消费业务正文、完成元数据和错误。

不得在 `gpt-relay.ts` 复制第二套 Codex Headers、请求体或 SSE 解析器。

### 工作流选择

`src/lib/ai-key-context.ts` 的请求上下文负责标记当前请求是否属于 GPT 自由创作。`src/lib/ai/client.ts` 在该上下文中必须无条件选择共享 Codex Responses 传输；非 GPT 自由创作继续执行现有协议选择和兼容策略。

该标记是请求级运行时状态，不写入 Key 存储或项目持久化结构。

### 受影响入口

凡是已通过 `applyProjectAIKeyBinding` 进入 GPT 自由创作上下文的调用均应使用新传输，至少包括：

- `/api/agent/chat`
- `/api/outline`
- `/api/frames/html`
- `/api/projects/[id]/frame-quality/repair`

局部画面微调的纯确定性应用步骤不产生模型请求，不需要新增协议接线。若后续新增 GPT 自由创作模型入口，必须先进入同一请求上下文，不得自行选择传输。

## 兼容与退役边界

### 保留

- `Codex API 测试`弹窗、`/api/settings/codex-test-chat` 及其诊断契约。
- 非 GPT 自由创作的 `gpt-relay.ts` Responses 兼容策略、Chat 路径和旧 API 对话测试。
- 现有 Agent prompts、JSON/HTML 解析后的领域类型和前端业务 API 返回形状。

### 退役

- GPT 自由创作强制 Chat Completions 的旧选择。
- GPT 自由创作调用中的 Responses 重试、reasoning/token/structured-output 参数重试。
- GPT 自由创作从 Responses 降级到 Chat Completions 的回退分支。

退役路径为 `delete-first`。不保留隐藏开关或自动兼容分支；因为这是内部工作流替换，且没有已证明的外部调用方依赖旧传输。

## 安全与可观测性

- 生产调用继续发布现有 AI trace 所需的阶段、模型、耗时、Response ID、状态、Token 用量和累计输出，但不记录 encrypted reasoning 原文或凭据。
- 上游错误应保留可诊断的 HTTP 状态和脱敏错误内容。
- 测试窗口仍可显示完整脱敏协议证据；生产项目只保留业务所需信息。

## 验收标准

1. GPT 自由创作的 JSON、文本和 HTML 调用均发送与交接文档一致的 Codex Headers、Responses 请求字段和 SSE 模式。
2. 生产 instructions 使用原 Agent system prompt，输入使用原 Agent user prompt；测试助手 instructions 不进入生产请求。
3. 每个 GPT 自由创作 Agent 调用只执行一次真实 `fetch`，OpenAI SDK、程序重试、参数降级和 Chat 回退均不可达。
4. 分块、CRLF、多行 data、未知事件和 `[DONE]` 不会造成正文重复；只有 `response.completed` 可以成功结束。
5. JSON、文本和 HTML 业务调用维持当前返回类型与调用方行为。
6. 上游非 2xx、失败事件、解析错误、无完成事件 EOF 和用户取消均按各自语义失败，且不泄露凭据。
7. 标准项目、DeepSeek、Key 管理旧 API 对话测试与 Codex API 测试弹窗保持现有行为。
8. README 和 `docs/Codex API 测试输入输出协议.md` 明确说明共享协议核心、生产适用范围、一次 Agent 调用一次请求，以及 GPT 自由创作无重试/无 Chat 回退。
9. 聚焦 Vitest、TypeScript、完整 Vitest、生产构建和差异检查通过；无需真实 Key 的自动化测试不得发起 live relay 请求。

## 实施边界与复杂度

- 优先在现有协议所有者中提炼共享核心，不新建重复 transport owner。
- `client.ts` 只负责按请求上下文选择传输和保持既有返回类型，不实现协议细节。
- `ai-key-context.ts` 只保存请求级工作流/credential 上下文，不包含协议构造逻辑。
- 如果共享核心提炼导致 `codex-test-chat.ts` 同时承担过多测试 UI 适配和生产协议责任，允许将纯协议核心提取到 `src/lib/ai/providers/codex-responses.ts`；测试与生产都必须依赖该唯一核心，原文件不得保留第二套实现。

## 工作草案

### TaskIntentDraft

- Outcome：整个 GPT 自由创作工作流统一使用已验证的 Codex Responses SSE 输入输出方式。
- Success evidence：精确请求契约、单 fetch、完成语义、三种输出模式和非目标回归均有自动化证据。
- Stop condition：代码、文档和验证完成；live relay 行为仅在用户另行授权时验证。
- Risks：长 HTML 流、JSON 完整性、取消传播、共享客户端误伤标准工作流、凭据泄漏。

### BaselineReadSetHint

- `AGENTS.md`
- `docs/Codex API 测试输入输出协议.md`
- `docs/aegis/specs/2026-08-04-codex-api-test-console-design.md`
- `src/lib/ai/codex-test-chat.ts`
- `src/lib/ai/providers/gpt-relay.ts`
- `src/lib/ai/client.ts`
- `src/lib/ai-key-context.ts`
- `architecture/modules.yaml`
- `architecture/ownership.yaml`

### BaselineUsageDraft

- Required refs：以上全部。
- Acknowledged before design：全部已读取并用于所有权和兼容边界。
- Missing refs：无阻塞缺口。
- Decision：continue。

### ImpactStatementDraft

- Affected layers：AI transport、request-local Key/workflow context、shared AI client、GPT 自由创作 routes、tests、README/protocol docs。
- Canonical owner：唯一 Codex Responses wire core。
- Invariants：业务 prompts/outputs、项目持久化、标准工作流、Key 安全。
- Compatibility：只在 GPT 自由创作退役旧协议；其他调用保留。
- ADR signal：共享生产传输所有权发生变化，实施完成后应评估是否需要补充内部 ADR/架构基线；不预先宣称已接受。
