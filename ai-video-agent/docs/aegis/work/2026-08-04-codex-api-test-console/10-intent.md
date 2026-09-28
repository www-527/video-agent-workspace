# Codex-Compatible API Test Console — Intent

- Requested outcome: add a home-page button/dialog that reproduces the verified Codex-compatible Responses streaming shape as a reference for later production migration.
- Scope: one streaming transport owner, one SSE route, one lazy dialog, home-page wiring, tests, README, browser QA.
- Non-goals: production migration, CC Switch runtime dependency, retries, Chat fallback, private Codex identity spoofing, persistent chat.
- Parent spec: `docs/aegis/specs/2026-08-04-codex-api-test-console-design.md`.
- Parent plan: `docs/aegis/plans/2026-08-04-codex-api-test-console.md`.
- Required baseline refs: `AGENTS.md`, architecture/ownership YAML, Key Store/list API, legacy diagnostic owners, OpenAI SDK streaming/retry behavior.
- Baseline usage: all required refs acknowledged and cited; none missing.
- Impact: additive internal SSE contract and home-page UI; production and legacy diagnostic behavior remain unchanged.
- Execution readiness: present in the parent plan; intent/scope/baseline/compatibility/review locks aligned.

## Complete sanitized diagnostics revision

- Requested outcome: expose final request, HTTP response, every bounded raw SSE event, transport totals, termination mode, and a copyable diagnostic snapshot.
- Approved safety boundary: exact local prompt text is visible; credentials, cookies, bearer values, and `reasoning.encrypted_content` are sanitized on the server before any browser event is built.
- Revision spec: section 14 of the parent spec.
- Revision plan: `docs/aegis/plans/2026-08-04-codex-api-complete-diagnostics.md`.
- Scope fence: existing diagnostic endpoint/dialog only; no production migration, persistence, retry, fallback, alternate endpoint, or automatic live request.
- Execution isolation: continue on the existing non-main `codex/sync-video-project` worktree because the complete feature baseline is uncommitted and cannot be reproduced from Git HEAD without transporting unrelated user changes; agents receive file-level edit fences and must preserve the dirty worktree.
