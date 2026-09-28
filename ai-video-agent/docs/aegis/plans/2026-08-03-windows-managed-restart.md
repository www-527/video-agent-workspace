# Windows Managed Application Restart — Implementation Plan

## Goal

Provide a Windows launcher-owned restart flow that rebuilds and relaunches the local production Next.js app after a user confirms Restart in the UI.

## Architecture

An external PowerShell controller owns the Next.js child process. The web application only writes an opaque restart request. The controller consumes it, terminates only its tracked child process tree, rebuilds, and starts a replacement. The UI polls until the server returns, then reloads once.

## Baseline / Authority Refs

- `docs/aegis/specs/2026-08-03-windows-managed-restart-design.md`
- `src/app/api/shutdown/route.ts`
- `src/components/shutdown-button.tsx`
- `src/components/studio/settings-menu.tsx`
- `src/app/page.tsx`
- `package.json`

## Compatibility Boundary

Keep shutdown unchanged. Do not terminate a process the launcher did not start. Reject cross-origin restart requests. Bare `npm run start` remains usable but reports automatic restart as unavailable.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change regression
- Verification: focused Vitest tests, `npx tsc --noEmit`, production build, and manual launcher restart.

## Requirement Ready Check

- Requirement source: user request and approved design specification.
- Scope: Windows launcher, restart API, confirmation/reconnect UI, documentation.
- Acceptance: controller-owned child restart, automatic browser recovery, origin safety, unsupported bare-start message.
- Open questions: none.
- Decision: ready.

## Change Necessity

- User-visible need: reload fixed source without manually operating a terminal.
- Non-code alternative: document manual build/restart commands.
- Why code: documentation cannot transfer lifecycle ownership or reconnect the browser.
- Minimum boundary: launcher controller, signal route, lifecycle UI, tests, README.
- Decision: code-change.

## Existence and architecture check

- New surface: one external controller and one opaque project-local request file.
- Existing owner: shutdown only stops; it cannot own restart because it ends the parent chain.
- Canonical owner: controller owns start/stop/restart; route only produces intent.
- Invariant: no route or client code kills a PID, process parent, port-selected process, or arbitrary Node process.
- Decision: add-with-proof.

## Files

- Update the existing workspace-root `../启动AI视频程序.cmd`: supported Windows entry point.
- Create `scripts/run-managed-app.ps1`: controller build/start loop and tracked-child restart.
- Create `src/lib/app-restart.ts`: project-root request path, marker, and safe request helper.
- Create `src/app/api/restart/route.ts`: same-origin restart request producer.
- Create `src/components/restart-button.tsx`: confirmation and bounded reconnect/reload UI.
- Modify `src/components/studio/settings-menu.tsx` and `src/app/page.tsx`: action placement.
- Create `tests/restart-route.test.ts` and `tests/restart-button.test.tsx`.
- Modify `README.md`: launcher usage and limitations.

## Tasks

### 1. Implement the controller contract

Files: launcher CMD, controller PowerShell, restart helper.

1. Add a CMD entry point that resolves the project directory and starts the PowerShell controller visibly.
2. Add a controller that creates a per-launch marker, runs `npm.cmd run build`, launches `npm.cmd run start` as a tracked child, and polls the restart request file.
3. On a new request, terminate the tracked child process tree only, wait for exit/port release, rebuild, and start a replacement.
4. On build failure, retain the controller window and wait for operator action or a later request; do not loop.
5. Add helper functions for opaque `{ id, requestedAt }` request records and marker detection.

Verification:

```powershell
npx tsc --noEmit
```

Manual: launch through the CMD file and confirm that a test request stops only its tracked child.

### 2. Implement a constrained restart route

Files: restart route, restart helper, route test.

1. Reuse shutdown Origin/Host validation; return 400 for malformed Origin and 403 for a mismatch.
2. Require the active launcher marker; return Chinese 409 guidance when absent.
3. Write the opaque request after validation and return `{ ok: true }`.
4. Test accepted local request, malformed/cross-origin rejection, launcher absence, and payload shape.

Verification:

```powershell
npm test -- --run tests/restart-route.test.ts
```

### 3. Implement confirmation and reconnect UI

Files: restart button, settings menu, homepage, component test.

1. Add a distinct Restart confirmation dialog explaining that generation/export work stops.
2. POST to the restart route and show the launcher-missing error without replacing the app.
3. After acknowledgement, show a reconnecting screen, poll a same-origin endpoint on a bounded schedule, and reload exactly once on success.
4. On timeout, show a retry-page action and stop polling.
5. Test confirmation, successful reload, launcher-missing error, and timeout with fake timers.

Verification:

```powershell
npm test -- --run tests/restart-button.test.tsx
```

### 4. Document and verify the supported path

Files: README and all changed files.

1. Document the CMD launcher as the supported production start entry.
2. Explain that restart rebuilds and works only under the launcher; it cancels running work.
3. Run focused tests, type checking, production build, and a manual controller restart cycle.
4. Inspect the diff for secrets, arbitrary process termination, and README consistency.

Verification:

```powershell
npm test -- --run tests/restart-route.test.ts tests/restart-button.test.tsx
npx tsc --noEmit
npm run build
git diff --check
```

## Risks and Retirement

Build failure can leave the app unavailable; the retained controller window is the diagnosis surface. In-flight work is interrupted by design. Manual `npm run start` remains supported, but no automatic self-restart fallback is allowed.

## Execution Readiness View

- Intent Lock: restart works only through the supplied Windows launcher.
- Scope Fence: no Docker, remote hosting, Windows service, port scanning, or task resumption.
- Owner Contract: controller owns child lifecycle; route writes intent only.
- Task batches: controller/helper, route/tests, UI/tests, docs/verification.
- Completion evidence: focused tests, type check, build, and observed tracked-child restart.
