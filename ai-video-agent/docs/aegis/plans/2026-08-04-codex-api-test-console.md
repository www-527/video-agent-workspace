# Codex-Compatible API Test Console — Implementation Plan

## Goal

Implement the approved home-page `Codex API 测试` dialog as an isolated, single-request, Responses SSE reference path that defaults to the active Key, permits selecting any available Key, and exposes accurate transport diagnostics without changing the legacy API chat or production generation paths.

## Architecture

The existing `AIKeyStore` remains the credential owner. A new infrastructure module owns the Codex-compatible Responses request and converts OpenAI SDK stream events into a bounded normalized event contract. A new settings route validates input and serializes those normalized events as SSE. A lazy-loaded React dialog fetches masked Key metadata, sends bounded history, consumes SSE incrementally, and owns only presentation/interaction state. The home page owns only the open button and dialog visibility.

## Tech Stack

Next.js 14 App Router, React 18, TypeScript, OpenAI Node SDK 4.x, Zod, Tailwind/Radix UI, Vitest/Testing Library.

## Baseline / Authority Refs

- Approved spec: `docs/aegis/specs/2026-08-04-codex-api-test-console-design.md`.
- Project rules: `AGENTS.md`, especially Key safety, README synchronization, and focused/full test obligations.
- Architecture: `architecture/modules.yaml` and `architecture/ownership.yaml` place external AI transport in `src/lib/ai/**` and interaction state in frontend components.
- Existing credential/list owner: `src/lib/ai-key-store.ts` and `src/app/api/settings/ai-keys/route.ts`.
- Existing legacy diagnostic baseline: `src/lib/ai/api-chat.ts`, `src/app/api/settings/ai-chat/route.ts`, and `src/components/ai-api-chat.tsx` remain intact.
- OpenAI SDK baseline: `responses.create` requires `stream:true` for SSE and the client requires `maxRetries:0` to guarantee one actual HTTP request.

## Compatibility Boundary

- Do not change `/api/settings/ai-chat`, `AIAPIChat`, or production JSON/text/HTML request routing.
- Do not change persisted Key schema or active-Key semantics.
- Do not silently use Chat Completions, retry, or route through CC Switch.
- Do not expose Key material, Authorization, hidden reasoning, or raw unbounded SDK objects.
- Existing home-page actions and dialogs must keep working.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change focused regression with mocked streaming boundaries
- Reason: the user did not request strict TDD; the approved spec supplies an explicit contract and the external relay is not required for deterministic automated verification.
- Verification: focused Vitest per slice, TypeScript, full Vitest, diff checks, then rendered browser QA.

## Verification

- `npm.cmd test -- --run tests/codex-test-chat.test.ts`
- `npm.cmd test -- --run tests/codex-test-chat-route.test.ts`
- `npm.cmd test -- --run tests/codex-api-test-dialog.test.tsx tests/home-page.test.tsx`
- `npx.cmd tsc --noEmit`
- `npm.cmd test`
- `git diff --check`
- Browser flow: `/` → `Codex API 测试` → dialog opens → active Key selected → alternate Key selection updates metadata → mocked/local stream renders deltas → Stop/Close aborts.

## Scope and Readiness

### BaselineUsageDraft

- Required refs: approved spec, project rules, architecture/ownership maps, Key store/list route, legacy diagnostic owners, OpenAI SDK behavior.
- Acknowledged before plan: all required refs.
- Cited in plan: Baseline, Architecture, Compatibility, and tasks below.
- Missing refs: none blocking.
- Decision: continue.

### Requirement Ready Check

- Requirement source: user-approved independent endpoint/component, button-dialog placement, selectable/default-active Key behavior, and approved design spec.
- Acceptance source: single real request, Responses streaming, `store:false`, no fallback/retry, visible diagnostics, abort, safety, tests, and browser QA.
- Open blocker questions: none.
- Decision: ready.

### Change Necessity

- User-visible need: a reliable Codex-format reference console is absent from the home page.
- No-change / non-code option: the legacy diagnostic cannot represent a single streaming Responses request because it owns non-streaming retry/fallback behavior.
- Why code change is necessary: the new request/stream/UI contract must execute and expose runtime evidence.
- Minimum change boundary: one infrastructure owner, one route, one dialog, home-page wiring, tests, and README.
- Decision: code-change.

### Existence Check

- Proposed new surface: Codex-compatible streaming transport owner and dialog.
- Existing reuse candidate: legacy API chat route/component.
- Why insufficient: reuse would mix incompatible retry/fallback and streaming reference contracts.
- Creation proof: approved spec and user-selected independent architecture.
- Entropy / retirement impact: additive isolated reference; later migration decides whether legacy diagnostic is retired.
- Decision: add-with-proof.

### Architecture Integrity Lens

- Invariant: external transport and secret-bearing errors stay server-side under `src/lib/ai/**`.
- Canonical contract: normalized `CodexTestStreamEvent` union emitted by the transport owner.
- Responsibility overlap: route is encoding/validation only; component is presentation only; legacy diagnostic remains separate.
- Higher-level simplification: reuse Key Store and upstream sanitization rather than adding credential/error owners.
- Retirement: none in this slice; no compatibility fallback is added.
- Verdict: proceed.

### Plan Pressure Test

- Owner / contract / retirement: explicit and isolated; legacy path retained intentionally.
- Architecture integrity: no caller-side SDK parsing or credential access.
- Verification scope: owner, route, UI, home page, full suite, browser.
- Task executability: four bounded slices with exact files and commands.
- Pressure result: proceed.

### Plan-Time Complexity Check

- Target artifacts: one new transport module, route, and dialog; small edits to home and README.
- Current pressure: `api-chat.ts` and `ai-key-manager.tsx` are already mixed/large and must not absorb the new reference behavior.
- Owner fit: new transport module and dialog are single-purpose and independently testable.
- Better boundary: add owner files; keep route and home page wiring-only.
- Budget result: within-budget.
- Recommendation: add owner files.

## Files

Create:

- `src/lib/ai/codex-test-chat.ts`
- `src/app/api/settings/codex-test-chat/route.ts`
- `src/components/codex-api-test-dialog.tsx`
- `tests/codex-test-chat.test.ts`
- `tests/codex-test-chat-route.test.ts`
- `tests/codex-api-test-dialog.test.tsx`
- `tests/home-page.test.tsx` only if no focused home test exists; otherwise extend the existing owner test.

Modify:

- `src/app/page.tsx`
- `README.md`

Do not modify for this workstream:

- `src/lib/ai/api-chat.ts`
- `src/app/api/settings/ai-chat/route.ts`
- `src/components/ai-api-chat.tsx`
- production generation callers.

## Task 1: Implement the single-request streaming owner

Files: create `src/lib/ai/codex-test-chat.ts`, create `tests/codex-test-chat.test.ts`.

Why: establish the canonical, testable Responses transport contract before route/UI wiring.

Impact / Compatibility: additive infrastructure API; uses credential snapshots but never persists or exposes them.

Contract:

```ts
export type CodexTestInputMessage = { role: 'user' | 'assistant'; content: string };
export type CodexTestStreamEvent =
  | { type: 'meta'; model: string; relayBaseURL: string; requestCount: 1; stream: true; store: false; reasoningEffort: 'low'; startedAt: string }
  | { type: 'response.created'; responseId?: string; status?: string; elapsedMs: number }
  | { type: 'response.output_text.delta'; delta: string; elapsedMs: number }
  | { type: 'response.completed'; responseId?: string; status?: string; usage?: { input?: number; output?: number; total?: number }; firstEventMs?: number; firstTextMs?: number; durationMs: number; eventCount: number }
  | { type: 'error'; message: string; status?: number; durationMs: number; eventCount: number };

export async function* streamCodexTestChat(input: {
  credential: AIKeySnapshot;
  messages: CodexTestInputMessage[];
  abortSignal?: AbortSignal;
}): AsyncGenerator<CodexTestStreamEvent>;
```

Steps:

1. Build bounded Responses input items from the latest 12 messages with explicit `input_text` content.
2. Create `OpenAI` with `apiKey`, `baseURL`, `maxRetries: 0`, and existing `normalizeResponsesJsonContentType(fetch)`.
3. Yield `meta`, then call `responses.create` once with `stream:true`, `store:false`, `reasoning:{effort:'low'}`, and `max_output_tokens:1500`.
4. Iterate SDK events and normalize only created/in-progress, output-text delta, completed, and error-relevant metadata; count all events without forwarding hidden reasoning.
5. On error, reuse `getUpstreamAIError`/sanitization to yield one bounded error event; rethrow AbortError without converting it into a completed result.
6. Test the exact request payload, client retry setting through a mocked OpenAI constructor/client boundary, one call, delta ordering, timing fields, usage, sanitization, and abort propagation.
7. Run `npm.cmd test -- --run tests/codex-test-chat.test.ts`.

## Task 2: Add the dedicated SSE route

Files: create `src/app/api/settings/codex-test-chat/route.ts`, create `tests/codex-test-chat-route.test.ts`.

Why: keep Key resolution and upstream iteration server-side while giving the browser a stable normalized stream.

Impact / Compatibility: additive POST endpoint; no changes to existing route behavior.

Steps:

1. Define a Zod request schema with `keyId`, one-to-twelve `{role,content}` messages, 4,000-character item bounds, and a final user message invariant.
2. Resolve the selected Key with `aiKeyStore.getSnapshot` before returning an SSE response, so validation/not-found failures remain ordinary JSON 4xx responses.
3. Create a `ReadableStream<Uint8Array>` that serializes each normalized event as `data: <json>\n\n` and closes after completion/error.
4. Pass `request.signal` to the transport generator and cancel its iterator when the browser cancels the stream.
5. Set `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache, no-transform`, and `connection: keep-alive`.
6. Test 400 invalid input, 404 missing Key, SSE headers/event framing, completion close, error event, and cancellation.
7. Run `npm.cmd test -- --run tests/codex-test-chat-route.test.ts`.

## Task 3: Build the dialog and home-page entry

Files: create `src/components/codex-api-test-dialog.tsx`, modify `src/app/page.tsx`, create `tests/codex-api-test-dialog.test.tsx`, add/extend focused home-page test.

Why: expose the reference transport where requested with selectable Key and observable stream behavior.

Impact / Compatibility: additive lazy UI; existing actions remain unchanged.

Steps:

1. Define minimal masked Key-list types matching the existing GET response; fetch only when the dialog first opens and default selection to `activeId` or the first item.
2. Render a responsive Radix Dialog with Key selector, non-secret metadata, fixed contract badges, conversation pane, diagnostics pane, textarea, Send/Stop/Clear controls, and accessible labels/live regions.
3. Implement one `AbortController` per send and abort on Stop, dialog close, component unmount, or a subsequent reset.
4. POST bounded history to the new route, parse `text/event-stream` across arbitrary chunk boundaries with a persistent buffer, and dispatch parsed events by `type`.
5. Append text deltas to one pending assistant message via functional state updates; finalize diagnostics on completed/error and retain at most 12 messages.
6. Implement Enter-to-send and Shift+Enter newline without submitting during IME composition.
7. Dynamically import the dialog in `page.tsx`, add a `Codex API 测试` outline button, and keep only `codexTestOpen` state in the page.
8. Test active-Key default, alternate selection metadata, incremental/chunk-split SSE parsing, completed/error diagnostics, no secret rendering, Stop abort, Clear, dialog close abort, keyboard behavior, and home-page open behavior.
9. Run `npm.cmd test -- --run tests/codex-api-test-dialog.test.tsx tests/home-page.test.tsx` (replace the second path with the actual extended existing test when discovered).

## Task 4: Documentation, integration verification, and rendered QA

Files: modify `README.md`; inspect all changed files.

Why: keep public behavior documentation and prove the visible interaction, not only the TypeScript contract.

Impact / Compatibility: documentation describes only implemented behavior; no live relay call is required.

Steps:

1. Add the home-page test console to the feature list and document its selectable Key, Responses-only single-request behavior, `stream:true`, `store:false`, no retry/fallback guarantee, diagnostics, and separation from production generation.
2. Run focused suites from Tasks 1–3.
3. Run `npx.cmd tsc --noEmit`.
4. Run `npm.cmd test`.
5. Run `git diff --check`, inspect `git diff --stat`, and verify no Key/token/Authorization value appears in source/docs output.
6. Start/reuse the local app and use the in-app Browser plugin for the flow `/` → open console → inspect default selection → switch Key → exercise a safe mocked/local stream interaction → Stop/Clear/close; check desktop and mobile viewport, console, overlay, clipping, and scroll behavior.
7. Do not make a live request with the user's real credential unless separately authorized; record that external relay behavior remains unverified by this deterministic QA pass.

## Risks

- SSE chunks may split JSON/event delimiters: keep a persistent parser buffer and test split boundaries.
- Browser cancellation may not immediately stop SDK iteration: propagate `request.signal`, implement stream `cancel`, and test abort.
- Secret leakage through errors: normalize/sanitize server-side and test with synthetic Bearer/sk values.
- Misleading request counts: SDK `maxRetries:0`, no route retry/fallback, and fixed requestCount `1` after the single create call.
- Old SDK event variants: ignore unknown events while counting them; normalize only stable event fields.
- Existing dirty worktree: preserve all pre-existing changes and do not stage/commit automatically.

## Retirement

- The legacy diagnostic route/component stay active because production and Key Manager behavior still depend on them.
- The new reference route has no fallback path to retire in this slice.
- Later production migration must explicitly decide whether this module becomes the shared production Responses owner and whether the legacy diagnostic can be removed; this plan does not pre-approve that migration.

## Execution Readiness View

- Intent Lock: isolated home-page Codex-compatible Responses reference console.
- Scope Fence: new transport/route/dialog, home wiring, tests, README; no production migration or CC Switch dependency.
- Baseline Lock: approved design spec, project rules, architecture ownership, existing Key owner, preserved dirty worktree.
- Approved Behavior: selectable/default-active Key, one request, streaming output, accurate diagnostics, abort, no retry/fallback.
- Owner / Contract Constraints: infrastructure owns transport; route wires SSE; frontend renders normalized events only.
- Compatibility Boundary: legacy diagnostic and production generation unchanged; Key schema unchanged.
- Retirement Boundary: retain old diagnostic until a separate migration decision.
- Task Batches: transport → route → dialog/home → docs/full verification/browser QA.
- Test Obligations: focused owner/route/UI tests, typecheck, full Vitest, diff/security checks, rendered interaction.
- Review Gates: no secrets, no hidden retries, no Chat fallback, no private Codex identity spoofing, no production caller changes.
- Drift / Rewind Rules: if the implementation requires Key schema changes, CC Switch runtime dependency, or production routing edits, stop and return to design.
- Evidence Required Before Completion: passing commands, SSE contract tests, browser screenshot/DOM/console/interaction evidence, README diff.
- Advisory Boundary: method-pack execution guidance only; not GateDecision, PolicySnapshot, or completion authority.
