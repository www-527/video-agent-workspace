# Codex API 测试图片输入设计

日期：`2026-08-05`

状态：`用户已确认设计；等待书面规格复核后制定实施计划`

## 1. 目标

为首页的“Codex API 测试”弹窗加入图片上传与粘贴能力，使用户可以向已选中 Key 对应的 Responses 中转站发送图文请求，并持续保留该测试工具的单次上游请求、SSE 输出、取消和完整脱敏诊断行为。

成功证据：用户可在输入区选择或粘贴图片、查看缩略图并移除任一图片；图文请求被转换为 Responses `input_text` 与 `input_image` 内容项；非法或超限图片在发送前/服务端得到可理解的拒绝；请求、流式输出和既有诊断不泄露图片 Base64 内容或凭据。

## 2. 已确认范围

### 范围内

- 仅修改首页“Codex API 测试”弹窗及其专用请求链路：
  - `src/components/codex-api-test-dialog.tsx`
  - `src/app/api/settings/codex-test-chat/route.ts`
  - `src/lib/ai/codex-test-chat.ts`
  - `src/lib/ai/providers/codex-responses.ts`
  - 直接相关的测试和文档。
- 图片通过文件选择或浏览器剪贴板粘贴加入当前待发送消息。
- 采用与已验证 CC Switch Responses 路线兼容的 `input_image` / `image_url` data URL 内容格式。
- 上限：每条用户消息最多 10 张图；单图原始文件最多 15 MB；最近 12 条消息会随请求重发，因此整次请求内的图片原始字节总量最多 60 MB。
- 支持 PNG、JPEG、WebP、GIF；GIF 作为图片数据原样传输，不在客户端转码。
- README 和《Codex API 测试输入输出协议》同步说明实际能力与限制。

### 明确不做

- 不修改 GPT 自由创作、生产视频生成、旧 API 对话测试、项目素材上传或任何其他图片链路。
- 不把图片写入项目、数据库、服务器磁盘、浏览器持久存储或会话恢复记录。
- 不添加中转代理、协议降级、Chat Completions 回退、自动重试或压缩/转码服务。
- 不在复制诊断或原始 SSE 诊断面板中暴露 data URL/Base64 图像内容。

## 3. 用户体验

输入区参照用户提供的 Codex 截图，而非另建上传面板：

1. 已选择的图片在文本输入区顶部以小圆角缩略图横向排列；每张都有可访问的移除按钮。
2. 左下角附件按钮打开文件选择器；向输入区粘贴剪贴板图片也会加入待发送列表。
3. 文本编辑器、附件按钮、发送按钮和图片缩略图组成同一张输入卡片；按钮状态仍受已选 Key 和进行中请求限制。
4. 发送后，成功提交的图片只作为该轮用户消息的内容存在于弹窗内存；清空、关闭或页面刷新后释放预览 URL 和内存数据。
5. 当文件类型、单图大小、总大小或图片数量不符合限制时，立即展示明确错误，并且不加入待发送列表。

## 4. 请求契约

浏览器向现有专用路由提交 JSON。用户消息从单一 `content` 字符串扩展为文本和可选图片的受限内容；助理历史仍仅承载文本。

服务端验证图片数量、允许的 MIME 类型、data URL 结构、Base64 负载、解码后的单图大小和当前轮图片总大小。客户端校验仅改善反馈，服务端校验是安全边界。

上游 `/v1/responses` 的用户消息严格编码为：

```json
{
  "type": "message",
  "role": "user",
  "content": [
    { "type": "input_text", "text": "请分析这张图" },
    {
      "type": "input_image",
      "image_url": "data:image/png;base64,..."
    }
  ]
}
```

没有图片时，生成结果保持现有纯 `input_text` 格式。每次发送仍恰好触发一次上游 `POST /v1/responses`，继续使用既有 Codex 风格 headers、`stream: true`、`store: false`、低推理强度和 SSE 解析；不因图片存在而更换端点或协议。

## 5. 隐私、安全与诊断

- 图片仅在当前浏览器内存与该次 HTTPS/HTTP 请求体中出现；路由不写入持久存储。
- 数据大小按照原始解码字节校验，避免仅依据 Base64 字符数绕过限制。
- 既有请求诊断须将每张图片替换为安全摘要：`type`、MIME 类型、原始字节数和 data-URL 字节数；绝不能向浏览器诊断事件或复制 JSON 发送原始 data URL。
- 现有 API Key、Authorization、Cookie、Bearer 与加密 reasoning 内容的服务端脱敏约束保持不变。
- 上传/粘贴操作不启动网络请求；只有发送操作才发起一次路由请求和一次上游请求。

## 6. 兼容性与所有权

- `codex-api-test-dialog.tsx` 仍是测试弹窗的本地交互和预览状态 owner。
- `codex-test-chat/route.ts` 保持 HTTP 输入校验与 SSE 接线职责；不得在路由中重建上游协议。
- `codex-responses.ts` 仍是 Responses 请求构造和服务端诊断脱敏的唯一 owner；图片内容项在这里与文本内容项共同编码。
- `codex-test-chat.ts` 仅透传已验证的多模态消息至 transport。
- 旧的文本调用者不得被迫构造图片字段；其纯文本请求体保持不变。

CC Switch 本地安装目录只包含二进制；二进制可观察到 Responses 和 `image_url` 路由线索，但不能替代可审计的源码契约。因此实现复用当前项目已验证的 `/v1/responses` 请求构造，并将 `input_image` 放进同一 `content` 数组，不新增代理转换层。

## 7. 验收与验证

- 组件测试覆盖：点击选择、粘贴、缩略图渲染、逐图移除、数量/大小/类型拒绝、带图发送、清空与关闭释放。
- 路由测试覆盖：合法图文消息可建立 SSE；畸形 data URL、不允许 MIME、Base64 无效、超单图/总大小/数量返回普通 400 JSON。
- transport 测试覆盖：纯文本保持现有 JSON；图文消息按顺序生成 `input_text` 和 `input_image.image_url`；诊断请求体只含图片摘要且无 `data:image`/Base64。
- 回归测试证明一次发送仍只执行一次上游 fetch、停止仍中断该请求，且 assistant SSE 文本不重复。
- 运行聚焦 Vitest、TypeScript 检查、完整 Vitest、生产构建和 `git diff --check`；不在自动测试中发送真实中转站请求。
- 浏览器人工检查：首页打开测试弹窗后，桌面与窄视口的图片输入区无溢出或遮挡，文件选择、粘贴、移除、发送和诊断摘要可用。

## 8. 设计依据与检查

### 任务意图

- 结果：在首页的隔离 Codex API 测试中可靠测试多模态 Responses 请求。
- 停止条件：图文输入、严格服务端验证、单请求传输、无图片泄露诊断及文档/测试均已实现并验证。
- 风险：过大 JSON 请求的内存压力、诊断泄露 Base64、错误的中转站消息形状，以及对生产工作流的意外影响。

### 基线使用

- 已读取：`AGENTS.md`、现有 Codex API 测试设计、当前 dialog/route/transport、README、协议文档，以及本地 CC Switch 二进制可观察字符串。
- 结论：需求与现有“首页隔离诊断、单 Responses 请求、不触及项目/生产链路”的产品与架构基线一致。

### 存在性与架构完整性

- 决定：复用已有 dialog、专用路由和 Responses transport owner；不创建上传服务、图片存储、代理或兼容回退。
- 不变量：上游消息构造只由 transport owner 负责；一条发送仍然只有一次上游请求；图片诊断内容永不跨越服务端安全边界。
- 复杂度：dialog 当前已较大，因此实现计划应评估将可复用的图片输入/校验逻辑提取为小型专用组件或纯工具，避免继续混合 SSE、诊断和文件 I/O 的责任。
- ADR 信号：无。本变更仅扩展内部诊断请求内容，不创建公开或持久化架构契约。
