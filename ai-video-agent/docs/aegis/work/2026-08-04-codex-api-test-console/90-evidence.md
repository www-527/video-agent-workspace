# Codex-Compatible API Test Console — Evidence

## Verification evidence

- `npm.cmd test`: exit 0; 104 test files and 587 tests passed, including 14 new focused transport, route, dialog, and home-page tests.
- `npx.cmd tsc --noEmit`: exit 0.
- `npm.cmd run build`: exit 0; Next.js compiled, type-checked, generated all pages, and registered `/api/settings/codex-test-chat`.
- Browser QA at `http://localhost:3000/`: entry visible; dialog opened; active Key `11` selected by default; alternate Key `pro` selected successfully; desktop and 390x844 narrow viewport remained usable; browser console error count 0.
- Live request deliberately not sent: visual QA did not transmit a saved API Key or create an upstream request without explicit authorization.
- Feature-source secret scan: no secret-like values found in the new endpoint, transport, dialog, sanitizer, or page wiring.
- `git diff --check`: exit 0; only repository line-ending warnings were reported.

## Contract evidence

- Transport tests prove `maxRetries: 0`, one `responses.create` call, `stream: true`, `store: false`, low reasoning effort, bounded message history, sanitized failures, and abort propagation.
- Route tests prove pre-stream validation, missing-Key handling, normalized SSE framing, signal propagation, and iterator cancellation.
- UI tests prove current-Key defaulting, alternate-Key selection, split-SSE consumption, incremental diagnostics, Stop abort, Clear behavior, and home-page dialog wiring.
- Legacy `/api/settings/ai-chat` and production generation callers remain separate owners; the new console does not redirect them.

## Workspace integrity boundary

- `aegis-workspace.py bundle` could not assemble a helper bundle because this repository's existing work records are Markdown-only and lack `task-intent-draft.json`.
- `aegis-workspace.py check` also reports pre-existing workspace structure/index/baseline issues, including a missing `docs/aegis/adr` directory and unindexed historical artifacts.
- These findings concern Aegis workspace structure, not application compilation or runtime behavior. They were not broadened into this product feature.

## Residual risk

- No real relay request was made during implementation QA. Actual `蝶祈云公益api` latency, SSE event order, and upstream acceptance still require a user-initiated send from the new window.
- The test console is a diagnostic reference only; production migration remains a separate decision and implementation task.

## Confidence

- Grade: B. Direct target, regression, build, and rendered UI evidence are fresh; the remaining bounded gap is live relay behavior.
# Complete sanitized diagnostics revision

- Focused verification: 4 files, 20 tests passed.
- Full regression: 104 files, 593 tests passed.
- Static/build: `npx.cmd tsc --noEmit` and `npm.cmd run build` exited 0.
- Security regression: sentinel API Key, cookie, and encrypted payload are absent from serialized diagnostic events; usage token counts remain visible.
- Browser QA: home page opened the revised dialog; Request, HTTP Response, Raw SSE, Transport Summary, and disabled pre-request Copy control rendered; no framework overlay or relevant console error.
- External boundary: no live relay request was generated during automated verification.
