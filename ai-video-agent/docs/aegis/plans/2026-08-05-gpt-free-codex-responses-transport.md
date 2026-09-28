# GPT 自由创作迁移到 Codex Responses 流式协议实施计划

## Goal

将 `workflow === 'gpt-free'` 的 JSON、文本和 HTML 模型调用全部迁移到已由 `Codex API 测试`验证的 raw Responses SSE 协议。每个 Agent 调用只执行一次真实上游 `fetch`，不使用 OpenAI SDK、不重试、不降级参数、不回退 Chat，同时维持现有 Agent prompts、业务返回类型、项目持久化和前端交互。

## Architecture

在 `src/lib/ai/providers/codex-responses.ts` 建立唯一 Codex Responses wire core，拥有地址归一化、Headers/identity、请求体、raw fetch、SSE 解析、完成/失败语义和脱敏。`codex-test-chat.ts` 成为测试对话与完整诊断适配器；`gpt-free-codex.ts` 成为生产 JSON/text/HTML 与 AI trace 适配器，两者都只消费共享 wire core。`ai-key-context.ts` 将 credential 与请求级 transport policy 放进同一个 AsyncLocalStorage context；`client.ts` 在 `gpt-free-codex` policy 下先进入生产适配器，非 GPT 自由创作继续沿用现有 GPT relay/Chat 策略。

## Tech Stack

Next.js 14 App Router、React 18、TypeScript、raw Fetch API、WHATWG `ReadableStream`、SSE、Vitest。

## Baseline / Authority Refs

- 用户确认的规格：`docs/aegis/specs/2026-08-05-gpt-free-codex-responses-transport-design.md`。
- 线协议基准：`docs/Codex API 测试输入输出协议.md`。
- 项目规则：`AGENTS.md`，尤其是 Key 安全、README 同步和聚焦/完整验证。
- 当前协议实现：`src/lib/ai/codex-test-chat.ts` 与 `tests/codex-test-chat.test.ts`。
- 当前生产调用：`src/lib/ai/client.ts`、`src/lib/ai/providers/gpt-relay.ts`。
- 请求上下文：`src/lib/ai-key-context.ts`、`src/lib/ai-key-route.ts`。
- GPT 自由创作入口：`src/app/api/agent/chat/route.ts`、`src/app/api/outline/route.ts`、`src/app/api/frames/html/route.ts`、`src/app/api/projects/[id]/frame-quality/repair/route.ts`。
- 所有权：`architecture/modules.yaml`、`architecture/ownership.yaml` 将外部 AI transport 放在 `src/lib/ai/**`。

## Compatibility Boundary

- 仅 `workflow === 'gpt-free'` 使用新的单请求 Codex transport policy。
- 标准项目、DeepSeek、显式/自动 Responses 兼容链路、Chat Completions、Key 管理旧 API 对话测试均保持当前行为。
- `Codex API 测试`按钮、弹窗、路由和诊断事件形状保持兼容。
- 项目 Key/模型绑定、数据库 schema、Agent prompts、JSON/HTML 领域契约和浏览器业务 API 形状不变。
- 不发送真实 relay 请求；所有自动化测试使用内存 SSE stream。

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change focused regression plus negative tests for retired retry/fallback paths
- Reason: 用户未要求 strict TDD；已批准规格和现有 Codex 协议测试提供明确行为基准。
- Verification: 每个切片执行聚焦 Vitest，完成后执行 TypeScript、完整 Vitest、生产构建和 diff/security 检查。

## Verification

- `npm.cmd test -- --run tests/codex-test-chat.test.ts tests/codex-responses.test.ts`
- `npm.cmd test -- --run tests/ai-key-context.test.ts tests/gpt-free-codex-client.test.ts tests/gpt-relay-client.test.ts tests/ai-client-key-switch.test.ts`
- `npm.cmd test -- --run tests/ai-api-chat-route.test.ts tests/codex-test-chat-route.test.ts tests/home-page.test.tsx`
- `npx.cmd tsc --noEmit`
- `npm.cmd test`
- `npm.cmd run build`
- `git diff --check`
- `rg -n "Codex API 测试|GPT 自由创作|不重试|Chat" README.md 'docs/Codex API 测试输入输出协议.md'`
- `rg -n "apiKey|authorization|Bearer|encrypted_content" tests/codex-responses.test.ts tests/gpt-free-codex-client.test.ts`

## Scope and Readiness

### BaselineUsageDraft

- Required baseline refs：已批准规格、线协议、项目规则、当前协议/生产调用/上下文 owners、GPT 自由创作 routes、架构所有权。
- Acknowledged before plan refs：全部。
- Cited in plan refs：全部列于 Baseline / Authority Refs，并落实到下列任务。
- Missing refs：无阻塞缺口。
- Decision：continue。

### Requirement Ready Check

- Requirement source refs：用户选择“整个 GPT 自由创作工作流”并两次确认设计/规格。
- Goals and scope refs：已批准规格的目标、非目标和已批准行为。
- User / scenario refs：GPT 自由创作内容规划、审校、编导、HTML 生成/修复。
- Requirement item refs：单 fetch、raw SSE、固定 Codex fields、保留 prompts/业务返回、无 retry/fallback。
- Acceptance / verification criteria refs：规格验收标准 1～9。
- Open blocker questions：无。
- Decision：ready。

### Change Necessity

- User-visible need：GPT 自由创作当前强制走 Chat 或兼容 Responses 重试/回退，未使用已验证的 Codex SSE 线协议。
- No-change / non-code option：只改 Key 的 `apiProtocol` 无法保证 Codex Headers、raw SSE、单 fetch、无 SDK 重试和无参数回退。
- Why code change is necessary：协议构造、响应消费和工作流传输选择都在代码内。
- Minimum change boundary：唯一 wire core、测试/生产适配器、请求上下文 policy、shared client 分流、测试与文档。
- Decision：code-change。

### Existence Check

- Proposed new surface：`providers/codex-responses.ts` wire core 与 `providers/gpt-free-codex.ts` production adapter。
- Existing owner / reuse candidate：554 行的 `codex-test-chat.ts` 与 471 行的 legacy `gpt-relay.ts`。
- Why existing surface is insufficient：继续把生产模式塞进测试 owner 会混合诊断 UI 与生产返回；复制到 gpt-relay 会产生第二套 Headers/SSE owner。
- Creation proof：提取 wire core 会让测试 owner 变薄；production adapter 只做业务输出/trace 映射，不拥有协议构造。
- Entropy / retirement impact：删除 GPT 自由创作旧分支可达性，不增加 fallback；新 adapter 依赖唯一 wire core。
- Decision：add-with-proof。

### Architecture Integrity Lens

- Invariant：协议细节只有一个 owner；caller 不构造 Headers/SSE；Key 不进入浏览器或 trace。
- Canonical owner / contract：`streamCodexResponses()` 及其 typed event/result contract。
- Responsibility overlap：测试适配器保留诊断；生产适配器保留业务/trace；client 只分流。
- Higher-level simplification：请求上下文统一保存 credential + transport policy，避免 WeakMap/全局布尔或 route 复制判断。
- Retirement / falsifier：若 GPT 自由创作仍能调用 OpenAI SDK、发生第二次 fetch 或进入 Chat，则迁移失败。
- Verdict：proceed。

### Plan Pressure Test

- Owner / contract / retirement：wire core、adapter、context、client 分工明确；旧 GPT-free retry/fallback 不保留。
- Architecture integrity / higher-level path：从现有测试协议提取，不重写第二套。
- Verification scope：wire contract、context isolation、三种输出、negative retry/fallback、非目标回归、完整构建。
- Task executability：五个有序切片，文件和命令明确。
- Pressure result：proceed。

### Plan-Time Complexity Check

- Artifact class：Source Complexity + Test Complexity。
- Target files：`codex-test-chat.ts` 554 行、`client.ts` 559 行、`gpt-relay.ts` 471 行、`codex-test-chat.test.ts` 263 行、`gpt-relay-client.test.ts` 312 行。
- Current pressure：三个共享 source owners 接近软压力区；测试 owner 尚可。
- Projected post-change pressure：提取 wire core 后 `codex-test-chat.ts` 下降；`client.ts` 只增加小型分流；`gpt-relay.ts` 不吸收新责任。
- Budget result：within-budget if extracted；直接 add-in-place 为 at-risk。
- Planned governance：新 wire core + production adapter；原文件 wiring-only/retirement edits。
- Recommendation：extract helper owner；不向 `gpt-relay.ts` 复制协议。

## Files

Create:

- `src/lib/ai/providers/codex-responses.ts`
- `src/lib/ai/providers/gpt-free-codex.ts`
- `tests/codex-responses.test.ts`
- `tests/gpt-free-codex-client.test.ts`

Modify:

- `src/lib/ai/codex-test-chat.ts`
- `src/lib/ai-key-context.ts`
- `src/lib/ai/client.ts`
- `tests/codex-test-chat.test.ts`
- `tests/ai-key-context.test.ts`
- `tests/gpt-relay-client.test.ts`
- `tests/ai-client-key-switch.test.ts`
- `README.md`
- `docs/Codex API 测试输入输出协议.md`

Inspect-only unless type/test evidence requires a wiring correction:

- `src/app/api/agent/chat/route.ts`
- `src/app/api/outline/route.ts`
- `src/app/api/frames/html/route.ts`
- `src/app/api/projects/[id]/frame-quality/repair/route.ts`
- `src/app/api/settings/codex-test-chat/route.ts`
- `src/components/codex-api-test-dialog.tsx`

Do not modify:

- Prisma schema/migrations or persisted Key file schema.
- standard/DeepSeek prompts and generation semantics.
- live credentials or generated media.
- git index/commits; the worktree already contains user-owned changes.

## Task 1: Extract the unique Codex Responses wire core

Files: create `src/lib/ai/providers/codex-responses.ts`; modify `src/lib/ai/codex-test-chat.ts`; create `tests/codex-responses.test.ts`; update `tests/codex-test-chat.test.ts` only for import/ownership adjustments.

Why: production and test must share the exact Headers/request/SSE behavior without turning the diagnostic dialog module into a mixed-purpose production owner.

Change Necessity: a shared source owner is required because copying `createCodexHeaders`, `createCodexRequest`, `parseSSE`, error extraction, sanitization or completion semantics would create protocol drift; minimum boundary is extraction plus a thin test wrapper.

Impact / Compatibility: `streamCodexTestChat` and `CodexTestStreamEvent` remain exported with their current behavior; the test route/dialog should not change.

Implementation contract:

```ts
export interface CodexResponsesInputMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CodexResponsesStreamOptions {
  credential: AIKeySnapshot;
  instructions: string;
  messages: CodexResponsesInputMessage[];
  abortSignal?: AbortSignal;
  fetchImpl?: FetchImplementation;
}

export async function* streamCodexResponses(
  options: CodexResponsesStreamOptions,
): AsyncGenerator<CodexResponsesStreamEvent>;

export function buildResponsesURL(baseURL: string): string;
```

Steps:

1. Move request identity, URL, Headers, generic request body, raw fetch, SSE parsing, HTTP failure extraction, sanitization, diagnostic caps and completion/error event creation to the new wire core.
2. Parameterize only `instructions` and bounded `messages`; keep all other fields exactly aligned with the protocol document.
3. Keep the latest 12 message mapping with user=`input_text` and assistant=`output_text`.
4. Re-export compatible event/input types and `buildResponsesURL` from `codex-test-chat.ts`; implement `streamCodexTestChat` as `yield* streamCodexResponses({ instructions: CODEX_TEST_INSTRUCTIONS, ... })`.
5. Add focused core tests for Headers/body, exact single fetch, CRLF/multiline events, delta-only output events, completed requirement, non-2xx, failed/eof/done/abort and redaction; retain existing dialog-facing diagnostic assertions.
6. Run `npm.cmd test -- --run tests/codex-responses.test.ts tests/codex-test-chat.test.ts`.
7. Run `npx.cmd tsc --noEmit`.

Repair Track: canonicalize the already-working protocol implementation without changing behavior.

Retirement Track: remove moved helper implementations from `codex-test-chat.ts`; no compatibility copy remains.

## Task 2: Add request-local GPT-free transport policy

Files: modify `src/lib/ai-key-context.ts`; modify `tests/ai-key-context.test.ts`.

Why: shared AI calls need a concurrency-safe signal that identifies GPT 自由创作 without mutating persistent Key configuration or leaking workflow checks into every caller.

Change Necessity: Key protocol settings cannot express the approved workflow-only behavior; minimum boundary is extending the existing AsyncLocalStorage value from a bare credential to a credential + policy context while preserving its public credential helpers.

Impact / Compatibility: existing `getTaskAIKeySnapshot`, `getCurrentAIKeySnapshot`, `runWithActiveAIKey`, `runWithAIKeySnapshot`, optimization helpers and project binding behavior retain their signatures.

Implementation contract:

```ts
export type AITransportPolicy = 'default' | 'gpt-free-codex';
export function getCurrentAITransportPolicy(): AITransportPolicy;
```

Steps:

1. Change AsyncLocalStorage to store `{ credential: AIKeySnapshot; transportPolicy: AITransportPolicy }`.
2. Make active/supplied snapshot helpers enter policy `default` and preserve async/concurrent isolation.
3. Make `applyProjectAIKeyBinding('gpt-free', ...)` preserve the selected Key/model and creative settings but enter policy `gpt-free-codex`; remove the comment/setting that deliberately forces Chat as the GPT-free transport choice.
4. Ensure `applyProjectGPTOptimizationOverride` replaces only the credential settings and preserves the current transport policy.
5. Test default policy, GPT-free policy, concurrent isolation, binding/model preservation and override policy preservation.
6. Run `npm.cmd test -- --run tests/ai-key-context.test.ts`.
7. Run `npx.cmd tsc --noEmit`.

Repair Track: replace implicit “GPT-free means forced Chat settings” with an explicit workflow transport policy.

Retirement Track: the old forced Chat selection is deleted; no fallback flag is used as a proxy for workflow identity.

## Task 3: Implement the production JSON/text/HTML adapter and client routing

Files: create `src/lib/ai/providers/gpt-free-codex.ts`; modify `src/lib/ai/client.ts`; create `tests/gpt-free-codex-client.test.ts`; update `tests/gpt-relay-client.test.ts` and `tests/ai-client-key-switch.test.ts` mocks for the new context selector.

Why: production callers require the existing return types and trace data while using the shared streaming wire contract exactly once.

Change Necessity: the wire generator emits protocol events, while callers need parsed JSON/string/`AIHtmlResult`; minimum boundary is one production adapter plus early shared-client routing.

Impact / Compatibility: `callAIJson`, `callAIText`, and `callAIHtml` signatures stay stable. Non GPT-free calls continue through current OpenAI/relay code.

Implementation contract:

```ts
export async function callGPTFreeCodexJson<T>(options: GPTFreeCodexCallOptions): Promise<T>;
export async function callGPTFreeCodexText(options: GPTFreeCodexCallOptions): Promise<string>;
export async function callGPTFreeCodexHtml(options: GPTFreeCodexCallOptions): Promise<GPTFreeCodexTextResult>;
```

Steps:

1. Consume `streamCodexResponses` once, accumulate only `response.output_text.delta`, capture meta/HTTP/completion data, and convert normalized error events into the existing upstream error shape.
2. Publish one AI trace per Agent call with `apiMode:'responses'`, configured/actual model, stage, response ID/status, duration, usage and accumulated output; never include encrypted reasoning or credentials.
3. Parse JSON after `response.completed`, stripping only an optional outer JSON Markdown fence; preserve malformed output in `AIJsonParseError` at the `client.ts` boundary.
4. Return text verbatim and map HTML output to the existing `{ output, finishReason, outputLength, reasoningLength:0, lengthLimited:false, emptyOutput }` shape.
5. Refactor `client.ts` so it obtains the task credential before constructing any OpenAI client; when policy is `gpt-free-codex`, route immediately to the production adapter and ignore caller `maxRetries`, `maxTokens`, temperature and no-thinking transport parameters as required by the fixed protocol.
6. Preserve existing GPT overlays because they are Agent prompt behavior: apply `withGPTSystemOverlay` before calling the new adapter for JSON/text/HTML.
7. Keep the entire legacy Responses/Chat implementation reachable only for policy `default`.
8. Test exact Agent instructions/user input, JSON/text/HTML outputs, one fetch, no OpenAI constructor, no retry after 502 or malformed output, no Chat call, abort propagation, trace fields and secret redaction.
9. Run `npm.cmd test -- --run tests/gpt-free-codex-client.test.ts tests/gpt-relay-client.test.ts tests/ai-client-key-switch.test.ts`.
10. Run `npx.cmd tsc --noEmit`.

Repair Track: move GPT-free production transport to the approved canonical owner while preserving public call signatures.

Retirement Track: GPT-free calls can no longer enter `requestResponsesFallback`, `callGPTRelay*`, OpenAI SDK Chat, reasoning downgrade or token/format parameter fallback.

## Task 4: Prove route/workflow coverage and update documentation

Files: modify `README.md`; modify `docs/Codex API 测试输入输出协议.md`; modify route tests only if needed to assert propagated upstream status without changing response shapes.

Why: users need the production behavior documented, and route coverage must show that every GPT-free entry establishes the new context while standard callers stay unchanged.

Change Necessity: README synchronization is mandatory for behavior changes; protocol documentation currently says the test path does not affect production generation and would become false.

Impact / Compatibility: documentation replaces the old GPT-free retry/fallback description only for that workflow; general relay resilience documentation stays valid for default policy.

Steps:

1. Update README feature/workflow/protocol sections to state that GPT 自由创作 uses raw Codex Responses SSE per Agent call, with no SDK/retry/parameter fallback/Chat downgrade and unchanged business UI output.
2. Update the protocol document title/scope and implementation ownership to describe the shared wire core and two adapters; distinguish test multi-turn messages from production system+user calls.
3. Replace “该窗口不会改变当前视频生成调用” with the new shared-core boundary, and define “one request” as one Agent call for production.
4. Use bounded code inspection/tests to confirm every GPT-free AI route calls `applyProjectAIKeyBinding` before model work; do not edit routes that already satisfy the invariant.
5. Run `npm.cmd test -- --run tests/ai-api-chat-route.test.ts tests/codex-test-chat-route.test.ts tests/home-page.test.tsx`.
6. Run `rg -n "applyProjectAIKeyBinding" src/app/api/agent/chat/route.ts src/app/api/outline/route.ts src/app/api/frames/html/route.ts 'src/app/api/projects/[id]/frame-quality/repair/route.ts'`.
7. Run `git diff --check`.

Repair Track: align public/protocol documentation with implemented production ownership.

Retirement Track: remove statements that GPT-free uses the old Chat/Responses retry strategy; retain that strategy only for default-policy callers.

## Task 5: Full verification, security review and retirement audit

Files: inspect all changed files; update tests/source only for evidence-backed defects found by these checks.

Why: shared transport changes can silently affect credentials, request counts, output completeness or non-target workflows even when focused tests pass.

Change Necessity: no new feature code is planned in this task; any repair must remain inside the approved owners and be justified by a failing check.

Impact / Compatibility: no live relay calls, no database mutation, no git staging/commit.

Steps:

1. Run all focused commands listed under Verification.
2. Run `npx.cmd tsc --noEmit`.
3. Run `npm.cmd test`.
4. Run `npm.cmd run build`.
5. Run `git diff --check` and inspect `git diff --stat` plus targeted diffs for the changed owners.
6. Run lingering-reference checks proving the GPT-free policy never calls `callGPTRelay*`, `chat.completions.create`, parameter fallback helpers or more than one fetch.
7. Search changed source/tests/docs for credential literals and verify every Authorization/encrypted reasoning assertion expects redaction.
8. Confirm the old compatibility behavior is still covered by `gpt-relay-client.test.ts` under default policy.
9. Update the active long-task evidence/checkpoint records with exact exit statuses and uncovered live-relay scope.

Repair Track: only fix defects falsified by the listed checks, at the canonical owner.

Retirement Track: declare migration incomplete if any GPT-free SDK/retry/Chat path remains reachable; do not mask it with a compatibility exception.

## Risks

- Long HTML output may expose SSE boundary bugs: exercise arbitrary chunk splits and completion-only success.
- JSON agents may return Markdown fences because structured-output parameter is intentionally absent: strip only the outer fence and otherwise surface parse failure without retry.
- Fixed low reasoning/no token limit may change creative latency/length: this is approved protocol behavior and should be visible in traces, not silently overridden.
- Context policy could leak across concurrent requests: retain AsyncLocalStorage isolation tests.
- Extracting the existing test transport could regress diagnostics: keep its current route/dialog tests and event aliases.
- Existing dirty worktree contains unrelated/user changes: use narrow patches, never reset, stage or commit.

## Retirement

### Anti-Entropy Declaration

- Deletion Class：code-retirement。
- Old Path/Object：GPT 自由创作强制 Chat、Responses retry/parameter downgrade and Chat fallback reachability。
- New Canonical Owner：shared Codex Responses wire core + GPT-free production adapter。
- Expected Preserved Behavior：Agent prompts、业务输出、Key/model binding、project data、standard workflows。
- Expected Retired Behavior：GPT-free SDK transport、retry、parameter fallback、Chat downgrade。
- External Boundary Touched：yes, upstream wire protocol；public browser business APIs remain stable。
- Source-of-Truth Data Risk：none。
- User Confirmation Required：no。

### Retirement Decision

- Path：delete-first。
- Why：internal workflow path with no proven external dependency on old transport。
- Non-edits：default-policy relay compatibility and Chat behavior remain active。

### Verification Plan

- Main-path check：three GPT-free output modes complete through one raw SSE fetch。
- Lingering-reference check：policy branch has no SDK/retry/fallback reachability。
- Negative check：502/malformed JSON/EOF fail after one request and never call Chat。
- Boundary check：default policy still passes existing relay/Chat tests；test console remains compatible。

## Execution Readiness View

- Intent Lock：entire GPT-free model workflow uses Codex Responses SSE transport。
- Scope Fence：wire core, adapters, context/client routing, tests, README/protocol docs；no persistence/schema/UI redesign。
- Baseline Lock：approved spec, protocol handoff, project rules, existing transport owners and architecture maps。
- Approved Behavior：one fetch per Agent, fixed Codex request fields, response.completed success, no retry/fallback, preserved prompts/returns。
- Owner / Contract Constraints：wire core owns protocol；test adapter owns diagnostics；production adapter owns output/trace；client only routes。
- Compatibility Boundary：only GPT-free changes；default-policy and test console behavior stay stable。
- Retirement Boundary：delete GPT-free old transport reachability；retain non-target compatibility code。
- Task Batches：wire extraction → context policy → production adapter/client → docs/coverage → full verification。
- Test Obligations：focused core/context/client/routes, TypeScript, full Vitest, build, diff/security/lingering checks。
- Review Gates：no credential leakage, no second protocol owner, no SDK on GPT-free, no retry/Chat, no target route missed。
- Drift / Rewind Rules：if implementation requires schema changes, browser SSE API redesign, standard workflow changes or a compatibility fallback, stop and return to design。
- Evidence Required Before Completion：fresh exit statuses for all commands, targeted diff audit, retirement negative tests, documented uncovered live-relay scope。
- Advisory Boundary：method-pack execution guidance only；not GateDecision, PolicySnapshot, or completion authority。
