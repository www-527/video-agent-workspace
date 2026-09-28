# Codex API Complete Sanitized Diagnostics — Implementation Plan

## Goal

Upgrade the existing home-page Codex API test console from a success/failure summary into a complete, locally inspectable protocol diagnostic surface. One send must still create exactly one upstream Responses request, while the browser receives the final endpoint, sanitized request contract, HTTP response evidence, every bounded raw SSE event, transport byte/timing totals, termination mode, and a copyable sanitized snapshot.

## Architecture

`src/lib/ai/codex-test-chat.ts` remains the canonical transport and sanitization owner. It constructs one request, creates a sanitized request snapshot before `fetch`, observes response headers when `fetch` resolves, captures every upstream SSE data block before normalized dispatch, and emits bounded diagnostic events through the existing route. The route stays a pass-through SSE boundary. `CodexAPITestDialog` continues to own conversation and request lifecycle state, while a new presentation-only `CodexProtocolDiagnostics` component renders the large request/response/raw-event snapshot without reconstructing or sanitizing secrets.

## Tech Stack

Next.js 14 App Router, React 18, TypeScript, Web Streams, native `fetch`/`Headers`, Zod, Tailwind/Radix primitives, Vitest, Testing Library, and the existing Browser plugin workflow.

## Baseline / Authority Refs

- Approved revision: `docs/aegis/specs/2026-08-04-codex-api-test-console-design.md`, section 14.
- Existing parent plan: `docs/aegis/plans/2026-08-04-codex-api-test-console.md`.
- Transport owner: `src/lib/ai/codex-test-chat.ts`.
- Route boundary: `src/app/api/settings/codex-test-chat/route.ts`.
- UI owner: `src/components/codex-api-test-dialog.tsx`.
- Existing safety owner: `src/lib/ai/upstream-error.ts` remains responsible for user-facing upstream error redaction; protocol snapshot redaction remains local to the Codex test transport because it must handle structured headers and event JSON.

## Compatibility Boundary

- Do not change `/api/settings/ai-chat`, production JSON/text/HTML generation, Key persistence, or CC Switch configuration.
- One send equals one upstream request; no retry, fallback, alternate URL probe, or Chat request.
- Existing conversation rendering consumes only normalized delta events and must not duplicate text from raw-event evidence.
- The route remains SSE wiring and must never resolve credentials or sanitize diagnostics independently.
- The browser may receive exact local prompt text but must never receive original Authorization, Key, Cookie, proxy authorization, set-cookie, bearer credential, or `reasoning.encrypted_content` values.
- No diagnostic state is persisted to disk or shared outside the current dialog unless the user explicitly presses Copy.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change contract and regression verification with deterministic mocked streams
- Reason: the user requested implementation but not strict TDD; the approved spec defines exact observable behavior.
- Verification: focused transport/UI/route suites, TypeScript, full tests, production build, diff checks, and rendered local browser QA without a live external request.

## Verification

- `npm.cmd test -- --run tests/codex-test-chat.test.ts`
- `npm.cmd test -- --run tests/codex-test-chat-route.test.ts`
- `npm.cmd test -- --run tests/codex-api-test-dialog.test.tsx tests/home-page.test.tsx`
- `npx.cmd tsc --noEmit`
- `npm.cmd test`
- `npm.cmd run build`
- `git diff --check`
- Browser flow: `/` → `Codex API 测试` → verify summary → expand Request/HTTP/Raw SSE/Summary → inspect redaction and duplicate raw delta rows → press Copy → confirm copied JSON contains no secret → close without sending.

## Scope and Readiness

### Aegis Visibility

Planning is required because this change expands a security-sensitive browser contract across transport, SSE normalization, and React rendering; the main risks are credential leakage, duplicate text rendering, unbounded diagnostic memory, and a second diagnostics owner.

### Plan Basis

- Fact: the current successful panel receives only five normalized event variants and discards final URL, request headers/body, response headers, duplicate raw events, bytes, `[DONE]`, and EOF details.
- Fact: the user approved complete diagnostics with forced server-side redaction.
- Assumption: prompt text is intentionally visible locally; credentials and encrypted reasoning payloads are not.
- Unknown: individual relays may omit `[DONE]` or expose vendor-specific headers/events; the design records both without requiring them.

### BaselineUsageDraft

- Required baseline refs: approved section 14, existing transport event types, route passthrough, dialog state/consumer, upstream error sanitization.
- Acknowledged before plan refs: all listed refs.
- Cited in plan refs: Architecture, Compatibility, Tasks 1–4.
- Missing refs: no blocking authority gap.
- Decision: continue.

### Requirement Ready Check

- Requirement source refs: user selection of option 2 and written-spec confirmation.
- Goals and scope refs: approved spec section 14.1–14.6.
- User / scenario refs: compare the program's real request with Codex after a successful relay test.
- Requirement item refs: request, HTTP response, raw SSE, transport summary, copy, redaction, bounds, single-request invariant.
- Acceptance / verification criteria refs: approved spec section 14.5.
- Open blocker questions: none.
- Decision: ready.

### Files

- Modify `src/lib/ai/codex-test-chat.ts`: expanded diagnostic event contract, redaction, size limits, byte/timing accounting, raw SSE observation, termination reporting.
- Modify `src/components/codex-api-test-dialog.tsx`: collect the new events, integrate details component, copy action, preserve message behavior.
- Create `src/components/codex-protocol-diagnostics.tsx`: presentation-only details, JSON views, raw timeline, copy control.
- Modify `tests/codex-test-chat.test.ts`: transport evidence, redaction, unknown/DONE/EOF/truncation, byte counters.
- Modify `tests/codex-api-test-dialog.test.tsx`: rendered details and copy behavior, no secret leakage, no duplicate assistant output.
- Modify `tests/codex-test-chat-route.test.ts` only if the expanded mocked event union requires route passthrough assertions.
- Modify `README.md`: describe complete sanitized diagnostics and explicit security limits.

### Change Necessity

- User-visible need: current panel cannot inspect the wire request or raw upstream stream.
- No-change / non-code option: browser DevTools cannot reliably see the server-to-relay request, and current normalized events have already discarded the missing evidence.
- Why code change is necessary: evidence must be captured at the server transport boundary before it is lost and sanitized before it reaches the browser.
- Minimum change boundary: existing transport event contract, existing dialog state, one presentation-only component, focused tests, README.
- Decision: code-change.

### Existence Check

- Proposed new surface: `CodexProtocolDiagnostics` presentation component.
- Existing owner / reuse candidate: the 448-line `CodexAPITestDialog`.
- Why existing surface is insufficient: adding four JSON/timeline surfaces and copy behavior in place would mix request lifecycle, conversation rendering, and large diagnostic presentation in an already substantial component.
- Creation proof: the new component has a single presentation-only interface and no fetch, credential, redaction, or persistence responsibility.
- Entropy / retirement impact: no duplicate backend owner; remove the component if the diagnostic feature is retired with the parent dialog.
- Decision: add-with-proof.

### Architecture Integrity Lens

- Invariant: transport captures and sanitizes; route forwards; dialog coordinates; diagnostics component renders.
- Canonical owner / contract: `CodexTestStreamEvent` in `codex-test-chat.ts`.
- Responsibility overlap: no redaction regexes or request reconstruction in React.
- Higher-level simplification: one diagnostic snapshot state replaces ad hoc parallel metric fields where practical.
- Retirement / falsifier: any original secret observable in route output, duplicated assistant delta, or second upstream call invalidates the design.
- Verdict: proceed with the existing transport owner plus presentation extraction.

### Plan Pressure Test

- Owner / contract / retirement: owner boundaries are explicit; no old path is retired.
- Architecture integrity / higher-level path: no new endpoint or general proxy is needed.
- Verification scope: security, protocol fidelity, streaming behavior, UI, build, and rendered interaction are covered.
- Task executability: each task names exact files, data shapes, and verification commands.
- Pressure result: proceed.

### Plan-Time Complexity Check

- Artifact class: source and maintained test complexity.
- Target files / artifacts: 322-line transport, 448-line dialog, 185-line transport test, 171-line UI test.
- Current pressure: the dialog is already the largest owner and would become mixed-purpose if all detail UI were added in place.
- Projected post-change pressure: transport grows moderately with cohesive instrumentation; dialog shrinks or remains stable by extracting details; tests remain split by owner.
- Budget result: within-budget with presentation extraction.
- Planned governance: keep sanitization/accounting as pure helpers in the transport module; create only one presentation component.
- Better file boundary: `codex-protocol-diagnostics.tsx` for rendering only.
- Recommendation: edit transport in place; extract UI presentation.

## Execution Readiness View

- Intent Lock: expose complete sanitized wire evidence for the existing independent Codex test.
- Scope Fence: diagnostic endpoint/dialog only; no production migration, retry, persistence, or live test.
- Baseline Lock: approved spec section 14 and current single-request direct-fetch behavior.
- Approved Behavior: complete request/HTTP/SSE/summary details with server-side redaction and bounded capture.
- Owner / Contract Constraints: transport owns evidence and sanitization; route forwards; UI renders.
- Compatibility Boundary: existing messages, Key selection, Stop/Clear, zero retries, and production routes remain unchanged.
- Retirement Boundary: no existing diagnostic or production path is removed.
- Task Batches: event/security contract → UI/details → tests/docs → full verification.
- Test Obligations: secret absence, exact event counts, `[DONE]`, unknown events, byte limits, single delta rendering, copy safety, full regression.
- Review Gates: focused tests after transport and UI slices; browser inspection before completion.
- Drift / Rewind Rules: stop and return to design if complete evidence requires exposing credentials, persisting diagnostics, or changing the route into a proxy.
- Evidence Required Before Completion: passing focused/full tests, typecheck, build, diff check, browser snapshot/console/interaction evidence.
- Advisory Boundary: method-pack execution guidance only; not GateDecision, PolicySnapshot, or completion authority.

## Tasks

### Task 1 — Expand the server diagnostic contract safely

**Files:** modify `src/lib/ai/codex-test-chat.ts`; modify `tests/codex-test-chat.test.ts`.

**Why:** all protocol evidence originates at this boundary and must be sanitized before the browser can observe it.

**Change Necessity:** current code discards headers, raw SSE blocks, byte counts, and termination evidence. The minimum stable repair is to enrich the existing event generator rather than add logging or another endpoint.

**Impact / Compatibility:** retain existing `meta`, `response.created`, delta, completed, and error events. Add fields/events without changing the route. Preserve exactly one `fetch` call.

**Implementation steps:**

1. Define serializable diagnostic types for sanitized header records, request snapshot, raw-event snapshot, truncation metadata, and termination mode.
2. Add constants `MAX_RAW_EVENT_BYTES = 32 * 1024` and `MAX_DIAGNOSTIC_BYTES = 512 * 1024`.
3. Add pure recursive sanitization that redacts credential-bearing keys/values, preserves usage token counts, and replaces `encrypted_content` with `{ redacted: true, encodedBytes: number }`.
4. Build request URL, headers, and body exactly once; derive the browser snapshot from those same objects so the preview cannot drift from the actual request.
5. Emit enriched `meta` before `fetch`, with method, endpoint, sanitized headers/body, request bytes, and correlation IDs.
6. Emit `http.response` immediately after `fetch` resolves, including status/text, sanitized response headers, content type, and elapsed header time; do this for non-2xx responses before emitting the final error.
7. Change the SSE decoder to return structured observations for every data block and `[DONE]`, tracking raw bytes and diagnostic retention limits without dropping normalized behavior.
8. Emit one `upstream.event` per parsed JSON data block and one `stream.done` for `[DONE]`; mark known vs unknown types and parser errors without interpreting unknown events as failures.
9. Add response byte totals, unknown count, termination mode, and truncation state to completion/error outcomes. Report EOF when no semantic completion occurs and aborted when cancellation is observed.
10. Extend transport tests with a request containing a fake Key/Cookie/encrypted payload and assert the serialized event list contains none of the originals; assert exact URL/body evidence, response headers, duplicate deltas, unknown event, `[DONE]`, byte totals, and truncation flags.
11. Run `npm.cmd test -- --run tests/codex-test-chat.test.ts` and `npx.cmd tsc --noEmit`.

### Task 2 — Add the complete protocol details UI

**Files:** create `src/components/codex-protocol-diagnostics.tsx`; modify `src/components/codex-api-test-dialog.tsx`; modify `tests/codex-api-test-dialog.test.tsx`.

**Why:** the current narrow metric column cannot present full JSON and a per-event timeline clearly or accessibly.

**Change Necessity:** the event evidence needs user-facing inspection and copy behavior; keeping it only in the SSE contract does not satisfy the complete-test requirement.

**Impact / Compatibility:** preserve the current top summary cards and conversation layout. The new component is presentation-only and receives an already-sanitized snapshot plus a copy callback.

**Implementation steps:**

1. Define a `CodexProtocolDiagnosticsProps` interface using exported diagnostic types from the transport module; do not duplicate the event schema.
2. Render four native collapsible sections: Request, HTTP Response, Raw SSE, and Transport Summary.
3. Use bounded `<pre>` blocks with horizontal scrolling and readable wrapping controls; show explicit empty/unavailable states and truncation badges.
4. Render raw SSE rows with sequence, elapsed time, type, bytes, known/unknown state, and expandable sanitized payload. Include a distinct `[DONE]` row.
5. Add a Copy diagnostics button that serializes only the state received from the server and writes it through `navigator.clipboard.writeText`; show copied/failed feedback without persisting data.
6. Extend dialog diagnostics state to retain meta request snapshot, HTTP response snapshot, raw events, DONE observation, bytes, unknown count, termination, and truncation.
7. Update `applyEvent` so raw events update only diagnostics; only normalized delta events append assistant content.
8. Reset the full snapshot on Send and Clear; retain completed evidence until the next send or clear; Stop records aborted state from the normal request lifecycle.
9. Add UI tests proving full endpoint/status/header/body/timeline rendering, duplicate raw deltas with one assistant answer, copied JSON redaction, and unchanged Clear/Stop behavior.
10. Run `npm.cmd test -- --run tests/codex-api-test-dialog.test.tsx tests/home-page.test.tsx` and `npx.cmd tsc --noEmit`.

### Task 3 — Verify route passthrough and failure evidence

**Files:** modify `tests/codex-test-chat-route.test.ts` if required; avoid production changes to `src/app/api/settings/codex-test-chat/route.ts` unless type compilation proves a wiring mismatch.

**Why:** the route must forward the expanded union without filtering, buffering, logging, or exposing credentials through an alternate error path.

**Change Necessity:** test coverage is necessary because this is the public browser boundary; production route changes are not expected.

**Impact / Compatibility:** request validation, missing-Key JSON errors, SSE headers, cancellation, and iterator return remain unchanged.

**Implementation steps:**

1. Add representative `http.response`, `upstream.event`, and `stream.done` mocked events to the valid-route test.
2. Assert each event is serialized once and response headers remain SSE/no-cache.
3. Assert a redacted marker passes unchanged and no test secret appears in the route body.
4. Run `npm.cmd test -- --run tests/codex-test-chat-route.test.ts`.

### Task 4 — Synchronize documentation and run completion verification

**Files:** modify `README.md`; inspect all changed target files.

**Why:** users need to know what “complete” includes and which sensitive evidence is intentionally unavailable.

**Change Necessity:** the README currently describes only the one-request benchmark and would understate the new diagnostic/security contract.

**Impact / Compatibility:** documentation only; do not change Key configuration guidance or claim packet-level DNS/TCP/TLS timing.

**Implementation steps:**

1. Document the four detail sections, copy action, exact prompt visibility, credential/encrypted-content redaction, 32 KiB/512 KiB limits, and zero-retry invariant.
2. State that header latency and SSE arrival timing are application-level measurements, not packet-level DNS/TCP/TLS traces.
3. Run the three focused test commands, then `npx.cmd tsc --noEmit`, `npm.cmd test`, `npm.cmd run build`, and `git diff --check`.
4. Use the Browser workflow at `http://localhost:3000/`: open the dialog, inspect page identity/nonblank/no-overlay/console, exercise all four details sections and Copy using mocked or existing in-memory evidence without sending a live request, and capture a screenshot.
5. Inspect `rg -n "sk-codex-test-secret|Bearer sk-|encrypted_content"` across serialized UI fixtures and changed runtime output paths; test fixtures may contain sentinel inputs only when assertions prove absence from outputs.

## Risks and Controls

- **Credential leakage:** sanitize at the transport boundary and assert serialized-event absence using sentinel secrets.
- **Hidden reasoning leakage:** replace encrypted payload values before any browser event is constructed.
- **Memory growth:** enforce per-event and aggregate byte limits with explicit truncation evidence.
- **Duplicate assistant output:** raw events never update conversation messages; normalized delta remains the only text owner.
- **Misleading timing:** label header/event/text/application duration precisely; do not claim DNS/TCP/TLS timing.
- **Clipboard exposure:** copying is explicit user action and contains only the already-sanitized snapshot.
- **Dirty worktree:** preserve all unrelated user changes and do not stage, commit, reset, or delete them during execution.

## Retirement

- No production or legacy diagnostic path is retired.
- The existing compact normalized timeline is replaced by the richer raw timeline within the same dialog, not kept as a competing detail owner.
- If the complete protocol diagnostic feature is later removed, delete `CodexProtocolDiagnostics` with the parent event additions; no persisted data migration is required.
- No compatibility adapter or fallback is introduced, so no deferred retirement trigger is needed.
