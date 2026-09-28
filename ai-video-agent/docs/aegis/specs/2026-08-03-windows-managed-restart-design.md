# Windows Managed Application Restart

## Goal

Let a local Windows user select **Restart application** from the studio, have the installed launcher rebuild and restart the Next.js service, and have the browser reconnect without manually closing a terminal.

## Confirmed scope

- The supported runtime is a Windows launcher supplied by this project.
- The launcher, not the Next.js process, owns the service lifecycle.
- Restart rebuilds the production application before starting it again.
- Restart cancels in-flight generation and export work.
- The existing **Close application** action remains available.

## Architecture

The existing workspace-root `../启动AI视频程序.cmd` starts a persistent PowerShell controller. The controller starts `npm.cmd run build`, then starts `npm.cmd run start` as its child process. It watches a project-local restart request file that is created by a same-origin API request.

When the controller sees a new request, it terminates only the process tree it started, waits for the port to be released, rebuilds, and starts a fresh service. The API does not kill the running server. The browser shows a restart state and polls the health endpoint until the service returns, then reloads.

## Owners

- Launcher and lifecycle ownership: the controller under `scripts/`, reached through the existing workspace-root `../启动AI视频程序.cmd` compatibility entry point.
- Restart request validation and signal creation: a new `src/app/api/restart/route.ts` route, sharing the same-origin policy used by shutdown.
- User interaction and reconnect UX: the existing `src/components/shutdown-button.tsx` lifecycle dialog, renamed or split only if keeping both actions would reduce clarity.
- Entry point: `src/components/studio/settings-menu.tsx` and `src/app/page.tsx` retain the existing lifecycle action placement.

## Contract

- `POST /api/restart` accepts no body and requires the request Origin host to match Host when Origin is supplied.
- Success returns `{ ok: true }` only after a restart request file has been written.
- The request file contains no user data or secrets; it contains a unique request id and timestamp.
- Only the project launcher consumes the file. A service not started by the launcher must return a clear unsupported response; it must not terminate itself.

## User flow

1. User chooses **Restart application** and confirms the interruption warning.
2. UI sends `POST /api/restart`, disables repeated activation, and displays a reconnecting state.
3. The controller stops its known child process tree, rebuilds, and starts the server.
4. UI periodically requests a same-origin health resource. On the first successful response it reloads once.
5. If reconnection does not occur within a bounded period, the UI explains that the launcher/build may have failed and retains an action to retry the page.

## Non-goals

- No port scanning or termination of arbitrary Node processes.
- No automatic restart for bare `npm run start`, `npm run dev`, Docker, or remote deployment.
- No preservation or resumption of in-progress generation/export work.
- No elevated Windows permissions or service installation.

## Compatibility and safety

- Existing shutdown behavior is unchanged.
- The application remains usable when not run by the launcher; only restart is unavailable with a specific explanation.
- The controller removes consumed restart requests and does not accept commands from network clients.
- Build failure leaves the controller alive and reports its failure in the controller window; it must not repeatedly restart in a tight loop.

## Acceptance evidence

- Launching through the workspace-root `../启动AI视频程序.cmd` starts the app at `127.0.0.1:3000`.
- Clicking Restart returns a confirmation, interrupts the known child service only, rebuilds, starts a new server, and reloads the browser.
- A browser request from a different Origin receives `403`.
- Running via bare `npm run start` reports that automatic restart needs the launcher and does not kill the process.
- Focused route/component tests and TypeScript/build verification pass.

## ADR signal

The durable lifecycle-owner decision is: an external launcher owns service start/stop/restart; the web server is only a request producer. This replaces any future temptation to have the server kill its own parent process for restart.
