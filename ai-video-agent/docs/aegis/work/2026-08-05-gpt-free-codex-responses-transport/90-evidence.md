# Evidence — GPT 自由创作 Codex Responses 迁移

## Outcome

- `workflow === "gpt-free"` 的 JSON、文本和 HTML AI 调用现在由请求级 `gpt-free-codex` 策略路由到共享 Codex Responses 流式核心。
- 测试弹窗和生产调用共用同一线协议 owner；测试适配器保留最近 12 条消息，生产适配器保留原 Agent system/user prompt 与原业务 JSON/Text/HTML 返回形状。
- 每次 Agent 调用只执行一次原生 `fetch`，不构造 OpenAI SDK client，不执行程序重试、参数降级或 Chat Completions 回退。
- 默认策略、标准工作流、DeepSeek、旧 API 对话测试及显式非 GPT-free 协议继续保留原实现。

## Source Evidence

- 共享线协议 owner：`src/lib/ai/providers/codex-responses.ts`
- 测试薄适配器：`src/lib/ai/codex-test-chat.ts`
- 生产薄适配器：`src/lib/ai/providers/gpt-free-codex.ts`
- 请求策略与项目绑定：`src/lib/ai-key-context.ts`
- AI JSON/Text/HTML 策略路由：`src/lib/ai/client.ts`
- 生产入口复核：`src/app/api/agent/chat/route.ts`、`src/app/api/outline/route.ts`、`src/app/api/frames/html/route.ts`、`src/app/api/projects/[id]/frame-quality/repair/route.ts`
- 线协议文档：`docs/Codex API 测试输入输出协议.md`
- 用户文档：`README.md`

## Verification Evidence

1. Focused integration suite
   - Command: `npm.cmd test -- --run tests/codex-responses.test.ts tests/codex-test-chat.test.ts tests/codex-test-chat-route.test.ts tests/gpt-free-codex-client.test.ts tests/ai-key-context.test.ts tests/gpt-relay-client.test.ts tests/ai-client-key-switch.test.ts tests/outline-agent-compaction.test.ts tests/html-request-budget.test.ts tests/frame-quality-repair.test.ts tests/agent-orchestrator.test.ts`
   - Result: 11 files passed; 60 tests passed.
2. TypeScript
   - Command: `npx.cmd tsc --noEmit`
   - Result: exit 0.
3. Full regression suite
   - Command: `npm.cmd test`
   - Result: 106 files passed; 603 tests passed.
4. Production build
   - Command: `npm.cmd run build`
   - Result: compiled, typechecked, generated 33 static pages, and emitted all dynamic API routes successfully; exit 0.
5. Focused contract assertions
   - `tests/codex-responses.test.ts` proves the exact fixed body fields, custom instructions, one fetch, CRLF/multiline SSE parsing, and missing-completion failure.
   - `tests/gpt-free-codex-client.test.ts` proves JSON/Text/HTML compatibility, one fetch on success/failure/cancel/malformed JSON, absence of SDK construction, absence of Token limits, and preserved sanitized HTTP status.
   - `tests/ai-key-context.test.ts` proves default isolation, GPT-free policy binding, project override preservation, and concurrent request isolation.
   - Existing relay tests prove the default policy still retains its prior retry, parameter downgrade, and Chat fallback behavior.

## Route Coverage

- `/api/agent/chat`: project binding occurs before intent/content AI calls.
- `/api/outline`: project binding occurs before outline generation.
- `/api/frames/html`: project binding occurs before Visual Bible, director, quality and HTML calls; the request-local context is inherited by stream continuations.
- `/api/projects/[id]/frame-quality/repair`: project binding occurs before selecting and invoking the GPT-free repair function.
- `/api/frames/html/image-search`: GPT-free projects are rejected before any AI or image-search work, preserving the native-HTML-only boundary.
- All AI-capable routes above use `withAIKeyRoute`, so each request owns an isolated AsyncLocalStorage context object.

## Security and Failure Semantics

- Authorization, cookies, API-key-like fields, Bearer values, `sk-...` credentials and `reasoning.encrypted_content` are sanitized before diagnostic exposure.
- Raw upstream error status is copied to the production error object only after its message is sanitized.
- A completed event is required for success; `[DONE]` alone and EOF-before-completion fail closed.
- No database schema, persistent source-of-truth data, external system, release, commit, push or merge action was performed.

## Governance Closure

- Repair track: extracted the existing test wire format into one canonical core and added two thin adapters.
- Retirement track: GPT-free production calls no longer enter the older SDK/Responses retry/parameter-downgrade/Chat-fallback branch; that branch is intentionally retained for default-policy callers.
- Lingering-reference result: `src/lib/ai/client.ts` checks `gpt-free-codex` before constructing an SDK client or consulting the old relay fallback state in all three shared call entry points.
- Residual risk: a real relay can still differ from the documented SSE event contract; current behavior fails closed without automatic compatibility retries, as approved.

## ADR and Baseline Closure

- ADR action: skip. Reversing the request-level routing is localized and does not satisfy the hard-to-reverse creation gate, even though the ownership split and no-fallback choice have a real trade-off.
- Lighter durable record: approved design, implementation plan, this work evidence, the protocol document and README.
- Baseline alignment: product requirement and runtime boundary are aligned with the user-confirmed design; current-state ownership and compatibility boundaries are recorded in the protocol document and README.

## Workspace Integrity Boundary

- The target already contained an incomplete historical Aegis workspace before this task. Its helper-wide structural check reports pre-existing missing ADR/baseline/index coverage outside this change.
- `aegis-workspace.py bundle` could not run because this historical workspace has no helper-created `task-intent-draft.json` sidecar for the work record. `aegis-workspace.py check` independently reported the existing missing `docs/aegis/adr`, incomplete `BASELINE-GOVERNANCE.md`, and historical unindexed artifacts.
- This task does not claim that helper structure validates semantic correctness; completion rests on the source, focused tests, full suite, TypeScript and production build evidence above.
