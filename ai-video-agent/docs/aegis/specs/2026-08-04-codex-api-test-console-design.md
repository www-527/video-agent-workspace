# Codex-Compatible API Test Console — Design Spec

Date: `2026-08-04`
Status: `revision 2 approved in conversation; written-spec review pending`

## 1. Intent

Add a home-page button that opens an isolated API test console. The console reproduces the verified public Responses transport characteristics used by the working Codex/CC Switch path, so it can serve as a trustworthy reference before the production video-generation pipeline is migrated.

Success evidence:

- A user can open the console from the home page without entering a project.
- Any saved AI Key can be selected; the active Key is selected initially.
- One send action creates exactly one upstream HTTP request.
- Output appears incrementally from a Responses SSE stream.
- The console visibly reports first-token latency, total duration, response status, event count, response ID, usage when supplied, and the true request count.
- Closing the dialog or pressing Stop aborts the upstream request.

Stop condition: the isolated route, modal, tests, documentation, and rendered browser interaction are verified without changing the production generation route.

## 2. Confirmed Product Decisions

- Entry: a `Codex API 测试` button on the home page opens a dialog.
- Key selection: the dialog may select any available saved/environment Key and defaults to the currently active Key.
- Architecture: use a new route and a new dialog component; do not add a mode branch to `/api/settings/ai-chat`.
- Purpose: this is a reference and diagnostic console, not a video-project conversation and not a replacement for the current Key Manager chat yet.

## 3. Baseline and Evidence

- `AGENTS.md`: behavior changes require tests and a synchronized README; secrets and raw private responses must not be logged to the browser.
- `architecture/modules.yaml` and `ownership.yaml`: the frontend owns modal state and rendering; `src/lib/ai/**` owns external AI transport and credentials.
- `src/app/page.tsx`: current home page owns the primary entry actions.
- `src/components/ai-api-chat.tsx` and `/api/settings/ai-chat`: existing diagnostic conversation is non-streaming and includes retry/fallback behavior, so it cannot be the reference transport owner.
- Local CC Switch evidence for “蝶祈云公益api”: same Base URL, Key, and model succeeded repeatedly with Responses streaming; provider configuration includes `wire_api = "responses"` and `disable_response_storage = true`.
- Current OpenAI SDK source: Responses defaults to non-streaming unless `stream:true`; the SDK defaults to two internal retries unless `maxRetries:0` is configured.

## 4. Scope

### In scope

- Home-page entry button and lazy-loaded dialog.
- Key list loading through the existing masked Key settings API.
- Dedicated Codex-compatible streaming test route.
- Dedicated AI transport function under `src/lib/ai/**`.
- Normalized browser stream events and diagnostic metadata.
- In-memory conversation history limited to the latest 12 messages.
- Stop, clear, error, empty, connecting, streaming, and completed states.
- Focused route/component/home-page tests, type checking, full tests, README update, and rendered browser QA.

### Non-goals

- Changing production JSON/text/HTML generation calls.
- Replacing or removing the current Key Manager API chat.
- Importing credentials or runtime configuration from CC Switch.
- Routing through the CC Switch local proxy.
- Imitating private Codex identity headers or spoofing a Codex User-Agent.
- Adding automatic retry, Chat Completions fallback, tools, web search, project mutation, or persistent conversation storage.

## 5. User Experience

### Home page

Add an outline/secondary `Codex API 测试` button alongside the existing home-page actions. The dialog component is dynamically imported so its streaming parser and UI are loaded only when needed.

### Dialog header

The header contains:

- Key selector, defaulting to `activeId` from the existing Key list response.
- Selected Key name, model, Base URL, configured protocol, and source.
- A fixed `Codex 兼容 Responses` badge.

No unmasked credential is returned or rendered.

### Conversation area

- User messages and assistant messages are visually distinct.
- The pending assistant message is created immediately and receives `response.output_text.delta` content incrementally.
- Status progression is visible: connecting → first event/first token → streaming → completed, stopped, or failed.
- The conversation keeps at most 12 user/assistant messages in component memory and is cleared when the page reloads.
- `Enter` sends; `Shift+Enter` inserts a newline.

### Controls

- Send is disabled when there is no selected Key, input is empty, or a request is running.
- Stop aborts the browser fetch and therefore the server/upstream request.
- Clear resets messages and diagnostics when no request is running.
- Closing the dialog aborts an active request.

### Diagnostics

Display the request contract and observed result:

- endpoint `/v1/responses`
- `stream:true`
- `store:false`
- reasoning effort
- true upstream HTTP request count (fixed at one per send)
- first-event/first-text latency
- total duration
- response ID and response status
- normalized event count
- token usage when present
- sanitized final error

The UI may expose a collapsible normalized event timeline, but must not display Authorization headers, the API Key, hidden reasoning content, or an unbounded raw upstream payload.

## 6. Transport Contract

The server resolves the selected credential through `AIKeyStore`, constructs an OpenAI client with `maxRetries: 0`, and sends one Responses request equivalent to:

```json
{
  "model": "<selected credential model>",
  "instructions": "You are an isolated API connection test assistant...",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "<message>" }
      ]
    }
  ],
  "reasoning": { "effort": "low" },
  "store": false,
  "stream": true,
  "max_output_tokens": 1500
}
```

For multi-turn input, the latest 12 user/assistant messages are converted into Responses input-message items. The route does not use `previous_response_id`, because storage is disabled and the console owns its bounded history.

The baseline request intentionally omits tools and private Codex-only headers. `reasoning.encrypted_content` is not requested in the first version because the console does not preserve hidden reasoning items across turns; adding it later requires separate evidence and acceptance.

## 7. Browser Stream Contract

The route returns `text/event-stream` with normalized, bounded events. Each event contains a `type` and only the fields needed by the UI.

Required normalized event types:

- `meta`: selected model, fingerprinted Base URL, request count, stream/store flags, reasoning effort, and start time.
- `response.created`: response ID/status when available.
- `response.output_text.delta`: text delta.
- `response.completed`: status, usage, total duration, and event count.
- `error`: sanitized message, upstream status when available, duration, and event count.

The server emits no synthetic retry events because this reference route performs no retries. An aborted connection ends upstream iteration promptly and does not emit a misleading completed event.

## 8. Error and Security Behavior

- Validate Key ID and bounded message content with Zod before opening the stream.
- Return ordinary JSON 4xx errors for invalid input or missing Key before streaming begins.
- After streaming begins, emit a sanitized `error` event and close the stream.
- Reuse the existing upstream-error sanitization owner; do not duplicate token-redaction regexes in the component or route.
- The browser receives a host fingerprint, never the full credential or request Authorization header.
- No automatic retry and no Chat fallback are permitted in this route. This invariant makes timing and failure evidence comparable with a single Codex-style request.

## 9. Ownership and File Boundaries

- `src/lib/ai/codex-test-chat.ts`: canonical owner of the single-request Responses streaming contract and normalized transport events.
- `src/app/api/settings/codex-test-chat/route.ts`: authentication/input boundary and SSE response wiring only.
- `src/components/codex-api-test-dialog.tsx`: Key selection, conversation state, stream consumption, diagnostics, stop/clear interaction.
- `src/app/page.tsx`: lazy-loaded entry button and open state only.
- `tests/**`: transport, route, component, and home-page regressions.
- `README.md`: user-facing location, purpose, request guarantees, and limitations.

The existing `/api/settings/ai-chat` and `AIAPIChat` remain unchanged and explicitly do not own this reference contract.

## 10. Compatibility Boundary

- Existing home-page actions and dialogs retain their behavior.
- Key files and schemas do not change.
- Production AI generation does not call the new route or transport owner.
- Chat-only providers may be selected, but the console must fail clearly that this is a Responses-only reference test; it must not silently switch protocols.
- Environment-backed credentials remain selectable through the existing masked Key list contract.

## 11. Acceptance and Verification

Automated acceptance:

- Transport test proves `stream:true`, `store:false`, `maxRetries:0`, one SDK call, bounded history conversion, delta aggregation, completion metadata, error sanitization, and abort behavior.
- Route test proves invalid input and missing Key are non-streaming 4xx responses, while valid input returns SSE headers and normalized events.
- Component test proves active-Key default, alternate-Key selection, incremental text rendering, diagnostics, Stop, Clear, and absence of secret values.
- Home-page test proves the button opens the dialog without breaking existing actions.
- `npx.cmd tsc --noEmit` passes.
- Focused Vitest suites pass, followed by `npm.cmd test`.
- `git diff --check` passes and README matches implemented behavior.

Rendered acceptance:

- At the home route, the button is visible and opens the intended dialog.
- Desktop and a practical mobile viewport have no clipping, overlap, framework overlay, or scroll trap.
- Selecting a Key updates visible non-secret metadata.
- A mocked or safe local stream demonstrates incremental output and Stop behavior without relevant console errors.

Live-relay acceptance is separate: using the user's real credential may incur external requests and is not required for code completion unless the user explicitly asks for a live test.

## 12. Design Governance

### TaskIntentDraft

- Outcome: a trustworthy, isolated Codex-compatible Responses test console on the home page.
- Goal: establish a one-request streaming reference for later production migration.
- Non-goals: production migration, CC Switch dependency, identity spoofing, retries, fallback, or persistence.
- Risks: secret exposure, false attempt counts, partial SSE parsing, abort leaks, and accidental coupling to old diagnostic behavior.

### BaselineReadSetHint

- `AGENTS.md`
- `README.md`
- `architecture/modules.yaml`
- `architecture/ownership.yaml`
- `src/app/page.tsx`
- current Key list/store contract
- current API chat/trace/upstream-error owners
- local OpenAI SDK Responses streaming behavior

### BaselineUsageDraft

- Required refs: project rules, module/ownership maps, home page, Key settings API, existing diagnostic route, OpenAI SDK implementation.
- Acknowledged before plan: all required refs above.
- Cited in design: sections 3, 8, and 9.
- Missing refs: none blocking; private Codex request headers are intentionally outside the design authority.
- Decision: continue.

### Requirement Ready Check

- Requirement source: user request and approved approach/placement/Key-selection decisions.
- Scenario: compare the program's Responses transport against a known working Codex/CC Switch path.
- Acceptance source: visible streaming, accurate diagnostics, one real request, no fallback, safe Key handling, and browser QA.
- Open blocker questions: none.
- Decision: ready.

### ImpactStatementDraft

- Affected layers: home-page UI, one settings API route, infrastructure AI transport, tests, README.
- Canonical owners: frontend dialog for presentation; `src/lib/ai/**` for upstream transport; existing Key store for credentials.
- Invariants: one send equals one real upstream request; Responses only; no credential exposure; production path unchanged.
- Compatibility: additive route and component; old diagnostic and project behavior retained.

### Existence Check

- Proposed new surface: isolated Codex-compatible reference route and dialog.
- Existing reuse candidate: `/api/settings/ai-chat` and `AIAPIChat`.
- Why insufficient: the existing owner intentionally contains non-streaming behavior, retry, and protocol fallback, which would invalidate the reference measurement.
- Creation proof: the user explicitly selected an independent endpoint/component, and the measured contract must exclude the old fallback stack.
- Entropy impact: additive but isolated; retirement trigger is a later explicit decision after production transport migration, not this task.
- Decision: add-with-proof.

### Product Risk Lens

- Value: makes protocol behavior directly observable before changing video generation.
- Trade-off: maintains two diagnostic surfaces temporarily in exchange for a clean benchmark.
- Decision: accepted independent reference surface.

### Architecture Integrity Lens

- Invariant: external AI transport remains owned by infrastructure, not the React component or route.
- Responsibility overlap: the old diagnostic stays legacy; the new owner is explicitly Responses-streaming-only.
- Higher-level simplification: normalized stream events keep SDK objects and secret-bearing errors server-side.
- Retirement: no path is retired in this slice; later production migration must separately decide whether to remove the legacy diagnostic.
- Verdict: coherent additive boundary.

### Plan-Time Complexity Check

- Current pressure: `api-chat.ts` already combines protocol fallback, retries, traces, and two API formats; adding streaming there would increase mixed responsibility.
- Better boundary: a small dedicated transport file and dialog component.
- Budget result: within budget if the route remains wiring-only and normalized event types stay bounded.
- Recommendation: add owner file; do not expand the existing mixed diagnostic owner.

## 13. ADR Signal

This design introduces a temporary durable reference owner and an additive SSE contract. An ADR is not required before implementation because the surface is internal and explicitly isolated, but completion review must revisit whether the reference owner becomes the production transport baseline or remains diagnostic-only. No baseline should be rewritten until that later migration decision is made.

## 14. Revision 2 — Complete Sanitized Protocol Diagnostics

This revision supersedes the earlier diagnostic restrictions in sections 4, 5, 7, 8, and 10 where they conflict with the requirements below. The user selected the complete-diagnostics approach after the initial console proved a successful Codex-compatible request. The console remains local and diagnostic-only, but it now needs enough evidence to compare the program's actual wire contract with Codex without exposing credentials or hidden reasoning payloads.

### 14.1 Required diagnostic surfaces

Keep the existing summary metrics and add four bounded, collapsible detail surfaces:

1. **Request**
   - final resolved `/v1/responses` URL;
   - HTTP method;
   - complete sanitized request headers;
   - exact request JSON sent upstream, including instructions, bounded message history, model, reasoning settings, tools, include fields, cache key, and client metadata;
   - encoded request-body byte count.
2. **HTTP response**
   - status code and status text;
   - response headers after sanitization;
   - response-header latency measured when `fetch` resolves;
   - content type and protocol-relevant gateway/request IDs when supplied.
3. **Raw SSE timeline**
   - one entry for every decoded upstream SSE data block, including duplicate event types;
   - monotonic sequence, elapsed arrival time, encoded data byte count, event type, known/unknown classification, and sanitized JSON payload;
   - explicit `[DONE]` observation when present;
   - unknown-event count and parser-error evidence.
4. **Transport summary**
   - request count, request/response byte totals, first-header, first-event, first-text, and total duration;
   - Response ID, Responses status, usage, raw-event count, unknown-event count, and final termination mode;
   - termination mode is one of `response.completed`, `done`, `eof`, `failed`, or `aborted`.

The UI must provide a copy action for one complete diagnostic JSON snapshot. The copied representation uses the same server-produced sanitized values; the browser must not reconstruct headers or secrets independently.

### 14.2 Sanitization contract

Sanitization happens before any diagnostic event crosses the route boundary. The React component never receives the original Authorization value or API Key.

- Replace Authorization, proxy authorization, cookies, set-cookie values, API-key fields, and credential-like bearer/token values with `[REDACTED]`.
- Preserve protocol token-usage fields such as `input_tokens`, `output_tokens`, and `total_tokens`; these are measurements, not credentials.
- Replace every `reasoning.encrypted_content` value with a bounded marker containing only presence and encoded byte length. Never send the encrypted payload to the browser.
- User and system prompt text is intentionally visible in the local diagnostic request preview because exact input comparison is an approved requirement.
- Apply recursive sanitization to raw upstream JSON and bounded error previews before serialization.
- Each raw event payload is capped at 32 KiB and the aggregate retained diagnostic payload is capped at 512 KiB. When a cap is reached, emit an explicit truncation flag and original/retained byte counts; never truncate silently.

### 14.3 Event contract additions

Extend the normalized browser stream with bounded diagnostic events while retaining the existing message-rendering events:

- `meta` gains resolved endpoint, method, sanitized request headers/body, request byte count, and generated correlation IDs.
- `http.response` reports status, status text, sanitized response headers, content type, and header latency.
- `upstream.event` reports sequence, elapsed time, event type, byte count, known/unknown flag, sanitized payload, and truncation metadata.
- `stream.done` records reception of `[DONE]`.
- `response.completed` and `error` gain response byte totals, unknown-event count, termination mode, and diagnostic truncation state.

`response.output_text.delta` remains the only event used to append assistant-visible text. Raw timeline events must not cause text to be rendered twice.

### 14.4 Ownership and compatibility

- `src/lib/ai/codex-test-chat.ts` remains the sole owner of upstream request construction, response observation, sanitization, raw SSE capture, limits, and normalized diagnostic events.
- The API route remains SSE wiring only and does not inspect or duplicate diagnostic payloads.
- The React dialog stores and renders the already-sanitized evidence, provides copy interaction, and applies no credential redaction of its own.
- One send still equals exactly one upstream request. No retry, Chat fallback, alternate endpoint attempt, or production transport change is allowed.
- Existing conversation behavior, active-Key default, Stop, Clear, and empty-assistant cleanup remain unchanged.

### 14.5 Revised acceptance criteria

Automated evidence must prove:

- the actual final endpoint, method, request headers/body, correlation IDs, and request byte count reach the browser only in sanitized form;
- no API Key, Authorization value, Cookie, set-cookie value, bearer token, or encrypted reasoning content appears anywhere in serialized diagnostic events;
- HTTP status/text/headers and header latency are visible for success and failure responses;
- every upstream SSE block is represented once in the raw timeline, duplicate delta types are retained, unknown events are flagged, and `[DONE]` is recorded;
- assistant text is still appended exactly once;
- response bytes, unknown count, termination mode, and truncation flags are accurate;
- copy diagnostics returns the complete sanitized snapshot;
- cancellation reports `aborted` without fabricating completion;
- focused tests, TypeScript, full tests, production build, and rendered browser QA pass without sending an automatic live-relay request.

### 14.6 Revision governance

- Requirement source: the user's explicit selection of complete sanitized diagnostics (option 2).
- Product boundary: complete local protocol visibility, not unrestricted secret dumping or a general network proxy.
- Architecture result: reuse the existing transport and dialog owners; no new endpoint, fallback, persistence store, or production owner is introduced.
- Complexity boundary: extract diagnostic rendering subcomponents or pure sanitizer helpers only if the existing owner would otherwise mix transport, security, and presentation responsibilities beyond a cohesive edit.
- ADR signal: none added; this remains an internal diagnostic contract. If the diagnostic event contract later becomes a production observability API, that requires a separate architecture decision.
