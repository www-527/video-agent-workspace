## 图片输入补充（2026-08-05）

首页“Codex API 测试”允许用户消息同时包含文本和图片。图片只能由本地文件选择或剪贴板粘贴加入当前弹窗，不写入项目、数据库、磁盘或浏览器持久存储。

- 支持 `image/png`、`image/jpeg`、`image/webp`、`image/gif`；单条用户消息最多 10 张，单张原始数据最多 15 MB，最近 12 条历史消息在一次请求中携带的图片原始数据合计最多 60 MB。
- 本地路由请求的 `messages[].images[]` 为 `{ dataUrl, mimeType, byteSize }`。服务端重新解析 data URL、校验 MIME、Base64、实际字节数及累计总量；任何不一致均返回 `400` 与 `INVALID_INPUT`，不会打开 SSE 流。
- 上游 Responses 用户内容保持顺序：文本为 `{ "type": "input_text", "text": "..." }`，图片为 `{ "type": "input_image", "image_url": "data:image/...;base64,..." }`。这与当前 `/v1/responses`、单请求、`stream:true`、`store:false` 的链路共用同一请求构造。
- 服务端的请求诊断会将每个 `image_url` 替换为 MIME、原始字节数和 data URL 字节数摘要；原始 data URL/Base64 不会进入浏览器事件、诊断面板或复制 JSON。

```json
{
  "role": "user",
  "content": "请分析这张图片",
  "images": [{ "dataUrl": "data:image/png;base64,...", "mimeType": "image/png", "byteSize": 2048 }]
}
```

# Codex Responses：测试与 GPT 自由创作输入输出协议

更新日期：`2026-08-05`

适用实现：`src/lib/ai/providers/codex-responses.ts`、`src/lib/ai/codex-test-chat.ts`、`src/lib/ai/providers/gpt-free-codex.ts`、`src/app/api/settings/codex-test-chat/route.ts`

协议定位：程序内由 **Codex API 测试**与 **GPT 自由创作生产调用**共用的 Codex 兼容 Responses 流式基准。

> 本文描述当前代码实际发送和接收的格式。它用于协议对照、故障定位和生产链路维护，不声明自己是 OpenAI Codex 内部协议的完整官方规范。

## 1. 核心约束

- 上游接口固定为 Responses：`POST /v1/responses`。
- `stream: true`，使用 SSE 流式接收。
- `store: false`，不依赖服务端保存对话。
- 测试弹窗一次点击“发送”只产生 **1 次真实上游 HTTP 请求**；GPT 自由创作每次 Agent 调用也只产生 **1 次真实上游 HTTP 请求**。一次完整创作包含多个 Agent 调用，因此不是整条创作只请求一次。
- 不使用 OpenAI SDK，不执行 SDK 内部重试。
- 不进行程序重试，不降级到 Chat Completions。
- 不调用工具、联网搜索、图片生成或视频项目能力。
- 测试上下文由客户端携带，最多保留最近 12 条用户/助手消息；生产调用使用现有 Agent system prompt 和该次业务 user prompt。
- API Key、Cookie、Bearer 凭据和 `reasoning.encrypted_content` 在服务端脱敏后才进入浏览器诊断数据。

## 2. 通信分层

```text
Codex API 测试弹窗
  │
  │ POST /api/settings/codex-test-chat
  │ JSON: keyId + messages
  ▼
Next.js 本地测试端点
  │
  │ POST <中转站>/v1/responses
  │ Codex 风格 Headers + Responses JSON
  ▼
中转站 / 上游模型
  │
  │ text/event-stream
  ▼
服务端解析、脱敏并重新输出 SSE
  │
  ├─ 原始上游事件：upstream.event
  └─ 界面事件：meta / http.response / response.* / error
```

GPT 自由创作使用同一上游线协议，但不会经过测试端点或测试弹窗：

```text
GPT 自由创作 API 路由
  → 请求级 gpt-free-codex 策略
  → 现有 AI JSON / Text / HTML 调用入口
  → GPT-free 生产适配器
  → 共享 Codex Responses 线协议核心
  → 中转站 /v1/responses SSE
  → 服务端累计正文并恢复原有 JSON / Text / HTML 业务返回值
```

这里存在两个 HTTP 层级：

1. **本地请求**：浏览器请求 `/api/settings/codex-test-chat`。
2. **上游请求**：Next.js 服务端请求中转站的 `/v1/responses`。

流开始以后，即使上游返回 502/504，本地端点通常仍然是一个已经建立的 `200 text/event-stream` 响应；真正的上游状态会通过 `http.response` 和最终 `error.status` 传给浏览器。因此诊断时应查看面板里的“HTTP 响应”，不能只看浏览器 Network 中本地端点的状态。

## 3. 浏览器到本地端点

### 3.1 请求

```http
POST /api/settings/codex-test-chat
Content-Type: application/json
```

请求体：

```json
{
  "keyId": "已保存 Key 的内部 ID",
  "messages": [
    { "role": "user", "content": "第一问" },
    { "role": "assistant", "content": "第一答" },
    { "role": "user", "content": "第二问" }
  ]
}
```

校验规则：

| 字段 | 规则 |
|---|---|
| `keyId` | 去除首尾空格后至少 1 个字符 |
| `messages` | 1～12 条 |
| `messages[].role` | 只能是 `user` 或 `assistant` |
| `messages[].content` | 去除首尾空格后 1～200,000 个字符 |
| 最后一条消息 | 必须是 `user` |

前置校验失败时，本地端点直接返回普通 JSON，而不是 SSE：

```json
{
  "error": "具体错误信息",
  "code": "INVALID_INPUT"
}
```

可能的前置 HTTP 状态：

- `400`：请求格式无效。
- `404`：指定 Key 不存在。
- `500`：Key 读取失败或测试流启动失败。

### 3.2 本地流式响应

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
```

每个本地事件使用统一格式：

```text
data: {"type":"事件类型",...}

```

即一行 `data:` JSON，后跟两个换行符。

## 4. 上游地址解析

程序根据所选 Key 的 Base URL 生成最终 Responses 地址：

| 配置的 Base URL | 最终地址 |
|---|---|
| `https://relay.example` | `https://relay.example/v1/responses` |
| `https://relay.example/v1/` | `https://relay.example/v1/responses` |
| `https://relay.example/v1/responses` | 保持不变 |

该测试不会读取 Key 的 Chat/Responses 自动降级逻辑；无论 Key 的其他优化设置如何，这个独立端点都只测试 Responses 链路。

## 5. 上游 HTTP 请求头

当前实际发送以下请求头：

| Header | 值或生成规则 |
|---|---|
| `accept` | `text/event-stream` |
| `authorization` | `Bearer <所选 Key>` |
| `content-type` | `application/json` |
| `originator` | `codex_cli_rs` |
| `user-agent` | `codex_cli_rs/0.0.0 (Windows; x86_64)` |
| `session-id` | 每次发送新建 UUID |
| `thread-id` | 每次发送新建 UUID |
| `x-client-request-id` | 与本次 `thread-id` 相同 |
| `x-codex-installation-id` | 服务进程加载模块时生成的 UUID |
| `x-codex-window-id` | `<thread-id>:0` |
| `x-codex-turn-metadata` | 包含 installation/session/thread/turn/window 和开始时间的 JSON 字符串 |

`x-codex-turn-metadata` 的结构：

```json
{
  "installation_id": "<installation UUID>",
  "session_id": "<session UUID>",
  "thread_id": "<thread UUID>",
  "turn_id": "<turn UUID>",
  "window_id": "<thread UUID>:0",
  "request_kind": "turn",
  "turn_started_at_unix_ms": 1785893309048
}
```

注意：中转站可能在响应头中生成自己的 `x-client-request-id` 或 `x-request-id`，它们不要求与程序发出的 ID 相同。

## 6. 上游 Responses 请求体

当前请求体等价于：

```json
{
  "model": "<所选 Key 配置的模型>",
  "instructions": "你是独立的 API 连接测试助手。直接回答用户问题并保持上下文一致。不要创建或修改视频项目，不要声称调用未提供的工具，也不要输出隐藏推理过程。",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        { "type": "input_text", "text": "第一问" }
      ]
    },
    {
      "type": "message",
      "role": "assistant",
      "content": [
        { "type": "output_text", "text": "第一答" }
      ]
    },
    {
      "type": "message",
      "role": "user",
      "content": [
        { "type": "input_text", "text": "第二问" }
      ]
    }
  ],
  "tools": [],
  "tool_choice": "auto",
  "parallel_tool_calls": false,
  "reasoning": {
    "effort": "low",
    "summary": "auto"
  },
  "store": false,
  "stream": true,
  "include": [
    "reasoning.encrypted_content"
  ],
  "prompt_cache_key": "<本次 session-id>",
  "text": {
    "verbosity": "medium"
  },
  "client_metadata": {
    "x-codex-installation-id": "<installation UUID>",
    "session_id": "<session UUID>",
    "thread_id": "<thread UUID>",
    "turn_id": "<turn UUID>",
    "x-codex-window-id": "<thread UUID>:0",
    "x-codex-turn-metadata": "<与请求头相同的 JSON 字符串>"
  }
}
```

### 6.1 上下文转换

- 只发送最近 12 条消息。
- 用户历史必须使用 `type: "input_text"`。
- 助手历史必须使用 `type: "output_text"`。
- 每次请求都携带完整的有限历史，不使用 `previous_response_id`。
- 对话只存在于当前弹窗内，刷新页面后消失。
- `store:false` 表示不要求 Responses 保存本次响应；它与上游自己的 Prompt Cache 不是同一个概念。

### 6.2 明确没有发送的内容

- 不发送 `max_output_tokens`。
- 不发送工具定义。
- 不发送 `previous_response_id`。
- 不发送视频项目数据。
- 不把隐藏推理内容重新加入后续对话。

### 6.3 GPT 自由创作的生产映射

- `instructions` 使用对应 Agent 已有的 system prompt，不替换内容规划、质量审校、编导或画面合成的业务提示词。
- `input` 使用该次 Agent 调用的 user prompt，并转换为 Responses message；不携带测试弹窗的 12 条对话历史。
- 其余线协议字段与测试基准一致：`tools:[]`、`tool_choice:"auto"`、`parallel_tool_calls:false`、低推理强度、`store:false`、`stream:true`、中等文本详细度，且不发送 Token 上限。
- 服务端只累计 `response.output_text.delta`，观察到 `response.completed` 后才按调用入口恢复为 JSON、纯文本或 HTML。浏览器和现有 API 路由继续接收原业务格式，不直接消费上游 SSE。
- JSON 入口只允许去除最外层 Markdown 代码围栏后解析；空输出、未完成流和非法 JSON 均按一次调用失败处理。
- 失败时保留脱敏后的上游 HTTP 状态与错误语义；不重试、不移除参数重发、不调用 SDK，也不回退到 Chat Completions。

## 7. 上游 SSE 输入格式

上游成功响应应为：

```http
Content-Type: text/event-stream
```

解析器支持：

- `\n\n` 或 `\r\n\r\n` 分隔事件块。
- 一个事件块内多行 `data:` 合并后解析。
- `data: {JSON}` Responses 事件。
- `data: [DONE]` 传统结束标记。

事件类型以 JSON 内的 `type` 字段为准，而不是 SSE 的 `event:` 字段。

典型上游序列：

```text
response.created
response.in_progress
response.output_item.added
response.reasoning_summary_text.delta      （可选）
response.reasoning_summary_text.done       （可选）
response.content_part.added
response.output_text.delta                 （重复多次）
response.output_text.done
response.content_part.done
response.output_item.done
response.completed
[DONE]                                     （可选）
```

当前“已知事件”白名单包括：

```text
response.created
response.in_progress
response.output_item.added
response.content_part.added
response.output_text.delta
response.output_text.done
response.content_part.done
response.output_item.done
response.completed
response.failed
response.incomplete
response.reasoning_summary_text.delta
response.reasoning_summary_text.done
error
```

不在白名单内的事件仍会被记录和继续处理，只在诊断中标记为“未知”。例如当前上游出现的 `response.reasoning_summary_part.added` 和 `response.reasoning_summary_part.done` 会计入未知事件，但不会导致请求失败。

## 8. 服务端输出给浏览器的事件

程序不会把上游流原封不动地直接透传。它会为每个上游事件生成一条脱敏的 `upstream.event`，同时为界面关心的事件生成归一化事件。

### 8.1 `meta`

每次发送的第一条事件：

```json
{
  "type": "meta",
  "model": "gpt-5.6-terra",
  "relayBaseURL": "https://relay.example",
  "requestCount": 1,
  "stream": true,
  "store": false,
  "reasoningEffort": "low",
  "startedAt": "2026-08-05T01:28:29.048Z",
  "request": {
    "endpoint": "https://relay.example/v1/responses",
    "method": "POST",
    "headers": { "authorization": "[REDACTED]" },
    "body": {},
    "bodyBytes": 6519,
    "correlation": {
      "sessionId": "...",
      "threadId": "...",
      "turnId": "...",
      "clientRequestId": "..."
    }
  }
}
```

实际事件中的 `headers` 和 `body` 是完整的脱敏快照，不是上例中的省略对象。

### 8.2 `http.response`

记录真实上游 HTTP 响应：

```json
{
  "type": "http.response",
  "status": 200,
  "statusText": "OK",
  "headers": {
    "content-type": "text/event-stream",
    "x-request-id": "..."
  },
  "contentType": "text/event-stream",
  "elapsedMs": 2372
}
```

`elapsedMs` 是从服务端开始处理本次发送到收到上游响应头的应用层耗时。

### 8.3 `upstream.event`

每个上游 JSON 事件都会生成一条：

```json
{
  "type": "upstream.event",
  "sequence": 10,
  "elapsedMs": 6011,
  "eventType": "response.output_text.delta",
  "bytes": 221,
  "known": true,
  "payload": {
    "type": "response.output_text.delta",
    "delta": "你好"
  },
  "truncated": false,
  "originalBytes": 215,
  "retainedBytes": 215
}
```

说明：

- `sequence`：上游 JSON 事件在本次流中的序号，从 1 开始。
- `elapsedMs`：该事件到达时距请求开始的时间。
- `bytes`：原始 `data:` 内容的 UTF-8 字节数。
- `known`：是否属于当前白名单。
- `payload`：服务端脱敏后的事件内容。
- `parseError`：仅在 JSON 无法解析时出现。

### 8.4 `stream.done`

上游出现 `data: [DONE]` 时生成：

```json
{
  "type": "stream.done",
  "sequence": 1457,
  "elapsedMs": 31254,
  "bytes": 6
}
```

`[DONE]` 不计入 `eventCount`。Responses 流可以只用 `response.completed` 正常结束，因此 `doneReceived:false` 本身不是错误。

### 8.5 `response.created`

从上游同名事件提取给界面：

```json
{
  "type": "response.created",
  "responseId": "resp_...",
  "status": "in_progress",
  "elapsedMs": 2373
}
```

### 8.6 `response.output_text.delta`

界面只使用该事件追加助手正文：

```json
{
  "type": "response.output_text.delta",
  "delta": "一小段文本",
  "elapsedMs": 6011
}
```

### 8.7 `response.completed`

只有观察到上游 `response.completed` 后，程序才会输出成功汇总：

```json
{
  "type": "response.completed",
  "responseId": "resp_...",
  "status": "completed",
  "usage": {
    "input": 1303,
    "output": 1598,
    "total": 2901
  },
  "firstEventMs": 2373,
  "firstTextMs": 6011,
  "durationMs": 31254,
  "eventCount": 1456,
  "responseBytes": 349949,
  "unknownEventCount": 2,
  "terminationMode": "response.completed",
  "diagnosticsTruncated": false,
  "doneReceived": false
}
```

### 8.8 `error`

流开始后的失败统一输出：

```json
{
  "type": "error",
  "message": "504 Gateway Time-out",
  "status": 504,
  "durationMs": 18600,
  "eventCount": 0,
  "responseBytes": 167,
  "unknownEventCount": 0,
  "terminationMode": "failed",
  "diagnosticsTruncated": false,
  "doneReceived": false
}
```

HTML 网关错误会优先提取 `<title>` 或 `<h1>`，避免把整页 nginx HTML 直接作为主错误信息。

## 9. 正常结束与异常结束

| 条件 | 结果 | `terminationMode` |
|---|---|---|
| 收到 `response.completed`，随后流结束 | 成功 | `response.completed` |
| 收到 `[DONE]`，但没有 `response.completed` | 失败 | `done` |
| 流结束，但两种结束标记都没有 | 失败 | `eof` |
| 上游非 2xx、`response.failed`、`error` 或 SSE 解析失败 | 失败 | `failed` |
| 用户点击停止、关闭弹窗或浏览器取消请求 | 客户端停止 | UI 显示 `aborted`；服务端不伪造完成事件 |

`response.incomplete` 当前会被记录为已知原始事件，但不会被当作成功完成；若流随后结束且没有 `response.completed`，最终按 `eof` 失败处理。

## 10. 计数和耗时定义

| 指标 | 定义 |
|---|---|
| 真实请求 | 每次发送固定为 1 次上游 `fetch` |
| 响应头耗时 | 发起测试到收到上游 HTTP 响应头 |
| 首事件 | 发起测试到收到第一条上游 JSON SSE 事件 |
| 首文本 | 发起测试到收到第一条 `response.output_text.delta` |
| 总耗时 | 发起测试到服务端输出成功或失败汇总 |
| 流事件 | 收到的上游 JSON SSE 事件数；不含 `[DONE]`，也不含本地归一化事件 |
| 响应数据 | 所有上游 `data:` 内容累计的 UTF-8 字节数 |
| 未知事件 | `type` 不在当前白名单中的上游 JSON 事件数 |

这些时间是应用层 HTTP/SSE 观测值，不提供 DNS、TCP 建连、TLS 握手等分阶段网络抓包数据。

## 11. 诊断快照格式

“复制 JSON”得到：

```json
{
  "meta": {},
  "httpResponse": {},
  "rawEvents": [],
  "final": {},
  "clientPhase": "completed"
}
```

- `meta`：模型、中转站、实际请求和关联 ID。
- `httpResponse`：上游状态、响应头和响应头耗时。
- `rawEvents`：脱敏后的全部保留事件及 `[DONE]`。
- `final`：最终 `response.completed` 或 `error`。
- `clientPhase`：`idle | connecting | streaming | completed | stopped | failed`。

诊断容量限制：

- 单个原始事件最多保留 `32 KiB`。
- 单次请求全部原始事件累计最多保留 `512 KiB`。
- 超限时事件带 `truncated:true`，并保留 `originalBytes`、`retainedBytes` 和截断预览。
- 截断只影响诊断快照，不影响正文增量输出。

## 12. 安全与脱敏

以下字段值会替换为 `[REDACTED]`：

- `authorization`
- `proxy-authorization`
- `cookie` / `set-cookie`
- `apiKey` / `api_key` 及同类拼写
- access/refresh/id token
- password、secret
- `Bearer <credential>`
- `sk-...` 形式的凭据

`reasoning.encrypted_content` 不返回原文，只返回：

```json
{
  "redacted": true,
  "encodedBytes": 932
}
```

本地 instructions、用户输入和助手输出不会自动隐藏，因为它们用于精确核对请求；复制诊断后不应直接公开含私人对话的文件。

## 13. 当前边界与注意事项

- 这是“Codex 风格通信基准”，不是 Codex 客户端所有功能的复制品。
- `user-agent` 当前版本写作 `0.0.0`，用于保持现行测试格式，不代表真实 Codex 发布版本。
- 不支持工具调用事件的业务执行；工具相关事件只可能作为原始诊断出现。
- 不恢复隐藏推理状态，不保证与 Codex 多轮推理状态管理完全相同。
- 不使用服务端会话存储；测试弹窗的多轮一致性依赖最近 12 条显式消息，GPT 自由创作的跨 Agent 依赖仍由现有业务产物显式传递。
- `reasoning.effort` 固定为 `low`，`text.verbosity` 固定为 `medium`。
- 中转站是否真正支持某个模型、事件扩展或缓存策略，仍由该中转站决定。
- 一次成功请求只能证明该时刻链路可用；长期稳定性需要多次采样统计 5xx 比例、首事件 P50/P95 和中途断流率。
- 本协议替换范围仅为 `workflow === "gpt-free"` 的 AI 文本、JSON 和 HTML 调用。标准工作流、DeepSeek、旧 API 对话测试以及显式的非 GPT-free 协议配置继续保留原有 SDK、重试和兼容逻辑。
- Codex API 测试弹窗仍是隔离的诊断界面，不读取或写入视频项目；它与生产链路共用线协议核心，不代表测试操作会触发创作。

## 14. 实现所有权

| 文件 | 责任 |
|---|---|
| `src/lib/ai/providers/codex-responses.ts` | 上游地址、Headers、固定请求字段、单请求约束、SSE 解析、脱敏和事件归一化的唯一线协议所有者 |
| `src/lib/ai/codex-test-chat.ts` | 测试专用 instructions、最近 12 条消息和共享线协议的薄适配 |
| `src/lib/ai/providers/gpt-free-codex.ts` | GPT 自由创作的正文累计、业务 JSON/Text/HTML 输出与一次调用追踪 |
| `src/lib/ai-key-context.ts` | 在单个服务端请求内绑定项目 Key、模型及 `gpt-free-codex` 传输策略 |
| `src/lib/ai/client.ts` | 根据请求级策略选择 GPT-free 生产适配器；默认策略继续走原实现 |
| `src/app/api/settings/codex-test-chat/route.ts` | 本地输入校验、Key 解析、SSE 响应接线 |
| `src/components/codex-api-test-dialog.tsx` | 对话状态、最近 12 条消息、发送/停止/清空和正文增量渲染 |
| `src/components/codex-protocol-diagnostics.tsx` | 完整协议诊断的展示与复制 |
| `tests/codex-responses.test.ts` | 共享线协议、请求字段、SSE 边界和异常结束的回归测试 |
| `tests/codex-test-chat.test.ts` | 测试适配器的上下文、错误、脱敏、截断和取消行为回归测试 |
| `tests/gpt-free-codex-client.test.ts` | 生产 JSON/Text/HTML、单请求、错误、取消和禁止 SDK/Chat 回退的回归测试 |

若后续修改请求头、请求体字段、事件白名单、结束语义、容量限制或重试策略，应同步更新本文和对应测试。
