# Codex API 测试图片输入实施计划

## Goal

实现已确认的首页 Codex API 测试图文输入：以 Codex 风格输入卡片选择或粘贴图片，通过当前的 `/v1/responses` 直连路线将用户消息编码为 `input_text` 与 `input_image.image_url`，并在不泄露图片 data URL 的前提下保留单次请求、SSE、取消和协议诊断。

## Architecture

新增一个无副作用的图片契约工具，作为客户端的即时文件校验和服务端 data URL 复核的共同限制来源。Dialog 只负责本地选择、粘贴、预览和消息状态；专用路由只验证 JSON 并接线 SSE；现有 Responses transport 仍是唯一的上游内容编码及服务端诊断脱敏 owner。图片诊断以元数据摘要代替 data URL。

## Tech Stack

Next.js 14 App Router、React 18、TypeScript、Zod、Web File/Clipboard API、Web Streams、native fetch、Tailwind/Radix、Vitest 与 Testing Library。

## Baseline / Authority Refs

- 已确认规格：`docs/aegis/specs/2026-08-05-codex-api-test-image-input-design.md`。
- 项目约束：`AGENTS.md`（测试、README、Key 与私有内容安全）。
- 现有隔离测试契约：`docs/aegis/specs/2026-08-04-codex-api-test-console-design.md`。
- 现有 owner：`src/components/codex-api-test-dialog.tsx`、`src/app/api/settings/codex-test-chat/route.ts`、`src/lib/ai/codex-test-chat.ts`、`src/lib/ai/providers/codex-responses.ts`。
- CC Switch 本地二进制可观察到 `Responses` / `image_url` 线索；项目既有 `/v1/responses` 实现仍是可审计的实际传输基线。

## Compatibility Boundary

- 仅首页 Codex API 测试及其专用 route/transport 路线可以发送图片。
- 旧纯文本请求 JSON 和上游纯 `input_text` 内容项保持字节语义兼容。
- 每次发送仍只发生一次 `/v1/responses` 上游 fetch；不得重试、换端点、切到 Chat 或影响 GPT 自由创作。
- 图片不写入项目、数据库、磁盘或本地持久存储；诊断/复制内容不得包含 `data:image` 或 Base64。
- 由于最近 12 条消息会随下一次请求重发，整次请求的全部图片原始字节合计不得超过 60 MB；单条用户消息仍最多 10 图、单图最多 15 MB。

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: 先补充确定性的契约和组件回归，再实现最小变更并运行聚焦测试。
- Reason: 用户未要求严格 RED/GREEN TDD；已确认规格提供了精确的外部行为与安全边界。
- Verification: 聚焦 Vitest、TypeScript、完整 Vitest、生产构建、差异检查和不发真实 relay 请求的浏览器手工检查。

## Verification

- `npm.cmd test -- --run tests/codex-test-images.test.ts tests/codex-test-chat.test.ts`
- `npm.cmd test -- --run tests/codex-test-chat-route.test.ts tests/codex-api-test-dialog.test.tsx`
- `npx.cmd tsc --noEmit`
- `npm.cmd test`
- `npm.cmd run build`
- `git diff --check`
- 手工浏览器流程：首页 → Codex API 测试 → 附件选择/粘贴 → 缩略图移除 → 图文发送 → 展开 Request → 确认图片摘要存在、data URL 不存在 → 停止/关闭。

## Scope and Readiness

### BaselineUsageDraft

- Required baseline refs: 已确认图片规格、项目 AGENTS、现有 dialog/route/transport、原 Codex 测试规格。
- Acknowledged before plan refs: 全部已读取并在本计划 Architecture、Compatibility 和任务中引用。
- Missing refs: CC Switch 仅有二进制而无源码；不阻碍复用当前已验证的 Responses 路线。
- Decision: continue.

### Requirement Ready Check

- Requirement source refs: 用户确认的“首页 Codex API 测试、Codex 式界面、更高图片上限、CC Switch/中转站兼容格式”。
- Acceptance refs: 已确认图片规格第 3、4、5、7 节。
- Open blocker questions: 无；跨历史图片的 60 MB 总上限在本计划中明确为必要的内存和请求体边界。
- Decision: ready.

### Change Necessity

- User-visible need: 现有界面和 route 只能发送文本，不能测试视觉模型或中转站的图片链路。
- No-change option: 不能通过设置或文档让固定 `input_text` 的请求传输图片。
- Minimum change boundary: 图片输入契约、测试 dialog、专用 route、现有 Responses 请求构造、相关测试与文档。
- Decision: code-change.

### Existence Check

- Proposed new surface: `src/lib/ai/codex-test-images.ts`，只包含 MIME/数量/大小限制、共享类型和 data URL 校验/摘要工具。
- Existing owner / reuse candidate: 444 行 dialog、route 内联 Zod 与 559 行 Responses transport。
- Why existing owners are insufficient: 将文件选择规则、data URL 解析和诊断摘要分别复制到三处会造成客户端/服务端边界漂移，并继续增加两个已较大的 owner 的混合责任。
- Creation proof: 一个纯工具文件可被三层直接复用，无 I/O、无 credential、无 UI 和无上游 fetch 职责。
- Entropy / retirement: 不创建上传服务、存储或第二个 transport；若测试弹窗退役，随该专用路线一并删除。
- Decision: add-with-proof.

### Architecture Integrity Lens

- Invariant: Dialog 管理本地 File/预览；route 执行不可信 HTTP 输入校验；transport 唯一构造上游 Responses 内容和服务端诊断；共享工具不执行 I/O。
- Higher-level simplification: 用一个一致的图片契约避免客户端和服务端独立猜测 MIME/大小限制。
- Falsifiers: 图像 data URL 进入浏览器诊断、一次发送触发第二次 fetch、或其他工作流获得图片字段即为实现偏离。
- Verdict: 在复用既有 owner 的前提下增加一个纯契约工具是最低复杂度路径。

### Plan-Time Complexity Check

- Target files: 444 行 dialog、559 行 transport、现有 route/测试与新纯工具。
- Current pressure: dialog 已混合 key 加载、会话、SSE、诊断和控制；transport 已混合请求构造、SSE 解析与脱敏。
- Projected pressure: 直接追加文件读取和 data URL 解析会造成新的混合职责。
- Recommendation: 以 `codex-test-images.ts` 收敛限制、解析和摘要；dialog 仅添加组件状态和事件处理，transport 仅映射内容项与调用摘要。预算结果：within-budget。

## Task 1: 建立共享图片契约与纯函数测试

Files:

- Create `src/lib/ai/codex-test-images.ts`.
- Create `tests/codex-test-images.test.ts`.

Why: 客户端文件校验、route data URL 复核和 transport 诊断摘要必须共享同一上限与 MIME 定义，避免图片安全边界漂移。

Change Necessity: 现有 `content: string` 类型没有地方表达或验证图片；在 dialog、route 和 transport 中各自复制规则会形成三个真相来源。

Impact / Compatibility: 该文件不执行上传、持久化或网络访问；原有纯文本类型可继续不传 `images`。

Steps:

1. 定义 `ALLOWED_CODEX_TEST_IMAGE_MIME_TYPES`（PNG/JPEG/WebP/GIF）、`MAX_CODEX_TEST_IMAGES_PER_USER_MESSAGE = 10`、`MAX_CODEX_TEST_IMAGE_BYTES = 15 * 1024 * 1024`、`MAX_CODEX_TEST_REQUEST_IMAGE_BYTES = 60 * 1024 * 1024`，以及 `CodexTestImageInput`（`dataUrl`、`mimeType`、`byteSize`）和带可选 `images` 的 `CodexTestInputMessage`。
2. 实现纯函数：基于 MIME/字节数/数量校验浏览器 File 元数据；严格解析 `data:<allowed MIME>;base64,<payload>`；通过 `Buffer.from(payload, 'base64')` 的回编码一致性和解码长度拒绝畸形 Base64；检查单图、每消息和请求总量；生成只包含 `type: 'input_image'`、MIME、原始字节数和 data URL 字节数的摘要。
3. 在 `tests/codex-test-images.test.ts` 断言合法 PNG data URL、四种允许 MIME、错误 MIME、畸形 Base64、单图/每消息/请求总量超限、以及摘要不包含 `data:image` 或 payload。
4. 运行 `npm.cmd test -- --run tests/codex-test-images.test.ts`。

## Task 2: 扩展专用 route 与 Responses 内容构造

Files:

- Modify `src/app/api/settings/codex-test-chat/route.ts`.
- Modify `src/lib/ai/codex-test-chat.ts`.
- Modify `src/lib/ai/providers/codex-responses.ts`.
- Modify `tests/codex-test-chat-route.test.ts`.
- Modify `tests/codex-test-chat.test.ts`.

Why: 只有服务端才能把不可信 data URL 安全地复核后转换为中转站实际收到的 Responses `input_image.image_url` 项。

Change Necessity: 当前 Zod schema 只接受字符串，且 provider 无法保留图片内容项顺序。

Impact / Compatibility: 纯文本历史仍生成一项 `input_text` 或 `output_text`；assistant 消息拒绝图片；route 的成功 SSE headers、取消和 Key 解析不变。

Steps:

1. 让 route 接受带可选 `images` 的 user message，调用共享解析/总量验证；任何图片无效时在打开 SSE 前返回既有形状的 `400 { error, code: 'INVALID_INPUT' }`。
2. 将 validated messages 传给 `streamCodexTestChat`；保持 route 只做验证与 SSE wiring，不在此处构造 `/v1/responses` JSON 或进行诊断脱敏。
3. 将 transport input 类型改为共享的 `CodexTestInputMessage`；在 `createCodexRequest` 中对 user content 先输出非空 `input_text`，再按输入顺序输出 `{ type: 'input_image', image_url: dataUrl }`，assistant 只输出 `output_text`。
4. 在 transport 的诊断序列化前将每个 `input_image.image_url` 替换为共享图片摘要；原始上游 `serializedBody` 仍含 data URL 并用于真实 fetch/bodyBytes，但发向浏览器的 `meta.request.body` 和可复制 JSON 不得含 data URL。
5. 为 route 测试增加一个有效带图 SSE 流断言，及 MIME、畸形 Base64、单图/总量和 assistant 图片拒绝的 400 断言；为 transport 测试增加图文 request content 顺序、纯文本回归、单 fetch、以及诊断 JSON 无 `data:image`/Base64 的断言。
6. 运行 `npm.cmd test -- --run tests/codex-test-images.test.ts tests/codex-test-chat.test.ts tests/codex-test-chat-route.test.ts`。

## Task 3: 实现 Codex 风格的图片组合输入区

Files:

- Modify `src/components/codex-api-test-dialog.tsx`.
- Modify `tests/codex-api-test-dialog.test.tsx`.

Why: 首页测试需要一个能实际选择、粘贴、预览、移除和发送图片的输入区，而不引入项目级素材上传。

Change Necessity: 现有 Textarea 只维护 `string`，无法承载图片缩略图或把 data URL 附加到所属用户消息。

Impact / Compatibility: 不修改页面入口、Key selector、SSE parser、停止/清空行为或诊断 UI；历史消息仍最多 12 条，图片随所属 user message 留在内存并计入 60 MB 请求总额。

Steps:

1. 为用户 chat message 增加可选图片数组，为待发送区增加 `pendingImages`、可见的文件输入 ref 和本地错误状态；使用 `URL.createObjectURL` 做缩略图，移除、清空、关闭和卸载时调用 `URL.revokeObjectURL`。
2. 用共享工具在文件选择与 `onPaste` 中立即校验 MIME、单图/当前条数量和在保留历史后的请求总量；使用 `FileReader.readAsDataURL` 仅为通过校验的图片创建 `CodexTestImageInput`；clipboard 中非图片项目保持正常文本粘贴。
3. 将原 Textarea 外层改成一张输入卡片：顶部横向缩略图、缩略图右上角圆形移除按钮、左下角带 `Paperclip` 图标的附件按钮、隐藏文件 input 与原发送/停止按钮；对窄视口使用可换行缩略图和不遮挡发送区的布局。
4. 发送时允许“有文字或图片”之一即可，传递 `messages: [{ role, content, images? }]`；成功启动请求后清空 pending 图片和输入文本，但已发图片保留在该条 user message 以供历史请求重发。
5. 在组件测试中 mock `FileReader` 与 object URL，覆盖点击选择、图片粘贴、缩略图/可访问移除、带图 request body、无文本带图可发送、类型/数量/大小错误、清空/关闭释放和纯文本原有行为。
6. 运行 `npm.cmd test -- --run tests/codex-api-test-dialog.test.tsx`。

## Task 4: 同步协议文档并完成全量验证

Files:

- Modify `README.md`.
- Modify `docs/Codex API 测试输入输出协议.md`.
- Modify prior task中被测试证明需要调整的文件；不得扩展到生产 workflow。

Why: README 是公开能力的唯一说明，协议文档必须准确展示图文 payload 和脱敏边界。

Change Necessity: 文档目前明确描述 `messages[].content` 为文本且只列出 `input_text`，与实现后的用户可见行为冲突。

Impact / Compatibility: 文档仅记录已实现的首页测试行为；不暗示 GPT 自由创作已获得图片输入。

Steps:

1. 在 README 首页 Codex API 测试条目写明上传/粘贴、支持 MIME、10 图/15 MB/60 MB 上限、Responses `input_image.image_url` 格式和图片诊断仅提供摘要。
2. 在协议文档更新浏览器请求 schema、带图请求 JSON、上游 input JSON、验证错误边界和诊断脱敏段落；明确图片仅属于首页测试，不进入生产视频项目。
3. 运行聚焦测试：`npm.cmd test -- --run tests/codex-test-images.test.ts tests/codex-test-chat.test.ts tests/codex-test-chat-route.test.ts tests/codex-api-test-dialog.test.tsx`。
4. 运行 `npx.cmd tsc --noEmit`、`npm.cmd test`、`npm.cmd run build` 和 `git diff --check`。
5. 在本地浏览器执行 Verification 所列手工流程，使用本地 mocked/safe response，不自动使用真实 Key 或中转站。

## Risks, Rollback, and Retirement

- 请求体风险：Base64 使传输膨胀约三分之一；60 MB 原图上限由 server 校验和当前 12 消息窗口共同约束。若中转站有更严格 body limit，界面应显示其返回的脱敏错误，不自动分片或重试。
- 内存风险：预览 object URL 与 data URL 都只在 dialog 内存中保留，清空/关闭/卸载立即释放 preview URL；不加入持久化状态。
- 回滚：删除图片契约导入和 optional `images` 字段即可回到纯文本构造；没有数据库、迁移、文件存储或旧路径退休工作。
- Retirement: 不退休任何现有 owner；旧 API 对话测试和生产流继续保持各自边界。
- ADR/baseline sync: 目前不需要 ADR；若图片多模态契约未来供生产 workflow 使用，必须独立设计并重新评估持久化、大小限制和 provider 兼容性。

## Execution Readiness View

- Intent Lock: 只让首页 Codex API 测试发送安全、可诊断的图文 Responses 请求。
- Scope Fence: 不修改 GPT 自由创作、视频项目、旧 API 对话测试、Key 配置或 CC Switch。
- Baseline Lock: 单上游 `/v1/responses` 请求、无 retry/fallback、服务端脱敏、route wiring-only 保持不变。
- Approved Behavior: Codex 式图片缩略图输入、选择/粘贴/移除、10 图/15 MB/60 MB、`input_image.image_url`。
- Owner / Contract Constraints: 共享工具定义边界；transport 唯一构造上游与脱敏；dialog 不重建安全策略；route 不重建 transport。
- Compatibility Boundary: 纯文本 JSON 与生产链路保持不变。
- Retirement Boundary: 无旧逻辑删除；不新增兼容 fallback。
- Task Batches: 契约与测试 → route/transport → UI → 文档与全量验证。
- Test Obligations: 聚焦 images/transport/route/dialog，随后 types、full tests、build、diff、浏览器手工检查。
- Review Gates: 每批后查看差异与聚焦测试；发现诊断含 data URL、第二次 fetch 或跨 scope 改动则回退到对应 owner。
- Drift / Rewind Rules: 任何生产 workflow、持久化或协议 fallback 触碰都视为 scope drift，停止并回到规格讨论。
- Evidence Required Before Completion: 新图文 payload、拒绝路径、脱敏诊断、单请求/SSE/取消回归及全部验证命令结果。
- Advisory Boundary: 该视图仅为实施指导，不构成发布、验收或权限决定。
