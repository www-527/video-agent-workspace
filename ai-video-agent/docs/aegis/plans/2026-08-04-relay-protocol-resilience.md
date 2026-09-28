# Relay Protocol Resilience

## Goal

Make OpenAI-compatible relay configuration express the provider's wire protocol independently from GPT creative optimizations, and make diagnostic chat tolerate bounded transient upstream failures without hiding the final upstream status.

## Architecture

`AIKeyStore` remains the canonical owner of per-provider connection settings. A new `apiProtocol` field (`auto`, `responses`, or `chat.completions`) is persisted with each key and exposed in Key Management. The shared AI client and diagnostic chat select their protocol from this field; `auto` preserves the existing GPT-optimization routing policy. Diagnostic requests retry only transient failures with short bounded backoff. Existing upstream-error preservation remains the route boundary.

## Tech Stack

Next.js 14 App Router, React 18, TypeScript, Zod, OpenAI Node SDK, Vitest.

## Baseline / Authority Refs

- `AGENTS.md`: behavior changes require focused Vitest coverage and README synchronization.
- `architecture/modules.yaml`, `ownership.yaml`, `quality-budget.yaml`: external-provider configuration and request behavior belong to `src/lib/ai/**`; UI and API routes only wire that owner.
- Current worktree changes in `src/lib/ai/upstream-error.ts`, AI routes, client, tests, and README are retained as the active baseline.
- Local CC Switch 3.19.1 database: provider “蝶祈云公益api” declares `wire_api = "responses"` / `apiFormat = "openai_responses"`; its recent proxy records show successful Responses traffic.

## Compatibility Boundary

- Existing v1-v5 key files migrate in memory and write as v6 on the next mutation.
- Existing keys default to `auto`, preserving current behavior until a protocol is explicitly selected.
- DeepSeek and other Chat-only keys remain on Chat under `auto`.
- Existing GPT optimization settings keep their creative/reasoning meaning; explicit provider protocol no longer requires enabling creative optimization.
- Final upstream HTTP errors continue to preserve status and sanitized error payload.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change regression plus existing diagnostic reproduction
- Reason: the user did not request strict TDD; focused regression coverage is proportional to this persisted-contract change.
- Verification: focused Vitest suites, TypeScript check, then full test suite if focused checks pass.

## Requirement Ready Check

- Requirement source refs: user report and console trace; user identified the matching CC Switch provider.
- Goals and scope refs: stabilize this program's relay connection behavior by borrowing applicable CC Switch provider-routing ideas.
- User / scenario refs: saved relay at `https://hgapi.dieqiyun.top`, model `gpt-5.6-terra`, diagnostic chat failed through Chat Completions with `502 Upstream access forbidden`.
- Requirement item refs: protocol-correct routing, bounded transient retry, safe error reporting.
- Acceptance / verification criteria refs: Responses can be selected independently; diagnostic trace shows multiple bounded attempts; final upstream status remains observable; old settings migrate.
- Open blocker questions: none.
- Decision: ready.

## Change Necessity

- User-visible need: the relay must use its supported protocol and survive brief upstream pool failures.
- No-change / non-code option: manually enabling GPT optimization routes this one key to Responses, but conflates transport protocol with creative behavior and does not address bounded diagnostic retries.
- Why code change is necessary: the stored provider contract has no API-format field and the diagnostic chat currently performs one Chat attempt when optimization is off.
- Minimum change boundary: key schema/store and API wiring, shared protocol selection at AI request owners, Key Management control, focused tests, README.
- Decision: code-change.

## Architecture Integrity Lens

- Invariant: provider wire protocol is connection metadata, not creative-generation policy.
- Canonical owner / contract: `AIKeyStore` / `AIKeySnapshot`; request owners consume it.
- Responsibility overlap: remove routing dependence on the GPT optimization master switch when a protocol is explicit; do not duplicate hostname-specific rules.
- Higher-level simplification: one persisted `apiProtocol` setting replaces endpoint-name detection and per-caller special cases.
- Retirement / falsifier: old `auto` behavior remains the compatibility path; no legacy field is removed in this slice.
- Verdict: proceed.

## Existence / Minimality Check

- Proposed new surface: one field on the existing provider credential contract, not a new provider registry or proxy subsystem.
- Existing owner / reuse candidate: `AIKeyStore`, `createGPTClient`, and existing Responses/Chat request functions.
- Why existing surface is insufficient: `gptOptimization.enabled` controls unrelated creative behavior and cannot faithfully represent CC Switch's provider-level `apiFormat`.
- Creation proof: local CC Switch data explicitly stores the provider API format; the failing app does not.
- Entropy / retirement impact: small v6 migration; no hostname rules, duplicate clients, or permanent emergency branch.
- Decision: add-with-proof.

## Plan-Time Complexity Check

- Target files: `src/lib/ai-key-store.ts`, `src/lib/ai/api-chat.ts`, `src/lib/ai/client.ts`, API route, Key Management UI, tests, README.
- Existing size / shape signals: store and UI are large but already own these settings; request logic already has separate Responses and Chat helpers.
- Owner fit: schema mutations stay in the store; retry helper stays in diagnostic request owner; UI is wiring-only.
- Add-in-place risk: avoid embedding retry policy in the React component or API route.
- Better file boundary: reuse existing request functions and add small exported protocol predicates only if both request owners need them.
- Recommendation: edit-in-place for existing owners; extract a tiny protocol helper only if duplication appears.

## Tasks

### Task 1: Persist provider API protocol

Files: `src/lib/ai-key-store.ts`, `src/app/api/settings/ai-keys/route.ts`, `tests/ai-key-store.test.ts`, `tests/ai-key-api.test.ts`.

Why: represent the upstream protocol as provider connection metadata and preserve old settings.

Impact / Compatibility: migrate v5 to v6 with `auto`; add/update operations return the new field without exposing secrets.

Steps:

1. Add the protocol type/schema/default, v5 migration, store/list/snapshot fields, and `updateAPIProtocol` mutation.
2. Add the API PATCH action and validation.
3. Update focused persistence and route tests.
4. Run `npm test -- --run tests/ai-key-store.test.ts tests/ai-key-api.test.ts`.

### Task 2: Route and retry diagnostic requests

Files: `src/lib/ai/api-chat.ts`, `tests/ai-api-chat.test.ts`, `tests/ai-api-chat-route.test.ts`.

Why: reproduce CC Switch's relevant reliability behavior without building a full local proxy or multi-provider failover queue.

Repair track: protocol mismatch is fixed by explicit routing; transient 408/409/425/429/5xx and transport errors receive at most three attempts with short abort-aware backoff. Parameter compatibility retries remain separate from transport attempts.

Retirement track: the one-attempt diagnostic behavior is retired; final errors still flow through the existing sanitized upstream-error owner.

Steps:

1. Select Responses or Chat from explicit protocol, with `auto` preserving the current preference.
2. Wrap each protocol call in a shared bounded retry loop that traces each network attempt accurately.
3. Keep Responses-to-Chat compatibility fallback only where configuration permits it.
4. Add tests for explicit Responses while GPT optimization is off, transient 502 recovery, non-retryable 400, attempt metadata, and exhausted-error preservation.
5. Run `npm test -- --run tests/ai-api-chat.test.ts tests/ai-api-chat-route.test.ts`.

### Task 3: Apply explicit protocol to production AI calls

Files: `src/lib/ai/client.ts`, `tests/gpt-relay-client.test.ts`, related client tests if required.

Why: the setting must affect real project generation, not only the diagnostic panel.

Impact / Compatibility: explicit Responses works without creative optimization; explicit Chat suppresses Responses; `auto` retains prior behavior.

Steps:

1. Replace the three GPT-optimization-only Responses gates with the shared protocol decision.
2. Retain existing request-scoped Responses outage fallback and parameter recovery.
3. Add regression coverage for explicit Responses with optimization off and explicit Chat with optimization on.
4. Run `npm test -- --run tests/gpt-relay-client.test.ts tests/ai-client-key-switch.test.ts`.

### Task 4: Expose protocol configuration and document behavior

Files: `src/components/ai-key-manager.tsx`, `tests/ai-key-manager.test.tsx`, `README.md`.

Why: users need to pin “蝶祈云公益api” to Responses without coupling it to GPT creative settings.

Impact / Compatibility: add one connection-level select; environment-backed keys may persist their protocol in the settings file even though Base URL remains environment-controlled.

Steps:

1. Add the protocol selector under Connection and Model and PATCH the existing Key API.
2. Add a UI test that verifies the request payload and rendered selection.
3. Update README with `auto` / Responses / Chat behavior and bounded diagnostic retries.
4. Run `npm test -- --run tests/ai-key-manager.test.tsx tests/ai-api-chat-ui.test.tsx`.

### Task 5: Verify and review

Files: all changed files.

Steps:

1. Run `npx tsc --noEmit`.
2. Run `npm test`.
3. Inspect `git diff --check`, `git diff --stat`, and the complete relevant diff.
4. Confirm README behavior matches implementation and no secret or CC Switch database content was copied into the repository.

## Risks

- Persisted-schema regression: controlled by v1-v5 migration tests and v6 write/read coverage.
- Retry amplification: bounded to transient failures and three total attempts; deterministic 4xx is not retried.
- Abort responsiveness: backoff and requests must honor the caller signal.
- Incorrect protocol default: `auto` preserves prior behavior; the user can explicitly select Responses for this relay.
- Existing dirty worktree: preserve the current upstream-error and README changes; no unrelated cleanup.

## Retirement

- Retire the implicit assumption that creative GPT optimization owns provider wire protocol.
- Retire one-attempt diagnostic transport behavior.
- Retain `auto` as the compatibility path for existing keys.
- Do not add multi-provider failover/circuit-breaker persistence in this slice; the program currently stores one endpoint per key, so that would be a separate product feature.

## Execution Readiness View

- Intent Lock: protocol-correct, boundedly resilient OpenAI-compatible relay calls.
- Scope Fence: one provider protocol field, request routing/retry, UI, tests, README; no key import from CC Switch and no new local proxy.
- Baseline Lock: preserve all pre-existing dirty changes named above.
- Approved Behavior: explicit Responses works independently of GPT optimization; auto stays compatible; transient retries are bounded.
- Owner / Contract Constraints: store owns connection metadata; shared AI modules own routing/retry; routes/UI only wire them.
- Compatibility Boundary: v1-v5 settings and DeepSeek auto behavior remain valid.
- Retirement Boundary: old implicit coupling and one-attempt diagnostic behavior only.
- Task Batches: persistence, diagnostic routing, production routing, UI/docs, verification.
- Test Obligations: focused suites, typecheck, full Vitest, diff checks.
- Review Gates: no hostname special casing, no secret output, no retry on deterministic client errors.
- Drift / Rewind Rules: if schema growth requires a second migration owner or retry changes spread outside `src/lib/ai/**`, return to plan review.
- Evidence Required Before Completion: focused and full test output, typecheck, final diff/README inspection.
- Advisory Boundary: method-pack execution guidance only; not GateDecision, PolicySnapshot, or completion authority.
