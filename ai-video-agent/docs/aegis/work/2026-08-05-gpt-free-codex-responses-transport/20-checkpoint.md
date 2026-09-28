# Checkpoint — GPT 自由创作 Codex Responses 迁移

## TodoCheckpointDraft

- Current todo：完成。
- Completed todos：设计确认；规格写入/确认；实施计划；共享 wire core；请求级 GPT-free transport policy；生产适配器与 AI client 路由；README/协议；路由复核；全量验证。
- Active slice：none。
- Evidence refs：`90-evidence.md`；focused suite 11 files / 60 tests；full suite 106 files / 603 tests；`npx.cmd tsc --noEmit` exit 0；`npm.cmd run build` exit 0。
- Blocked on：none。
- Next step：由用户决定是否在现有 dirty branch 中整理、提交或继续集成。

## ResumeStateHint

- 先读 `10-intent.md`、父 plan、approved spec 和本文件。
- 当前 worktree 已有大量用户改动，不 reset/stage/commit。
- 首页 Codex test implementation 是未提交基线，必须保留。
- Aegis workspace 全量 check 有既有历史目录/基线/index 缺口，不把它们误判为本任务回归。

## DriftCheckDraft

- Original intent：aligned。
- Goal/stop condition：aligned。
- Compatibility boundary：aligned；仅 `workflow === "gpt-free"` 通过请求级策略切换，默认 AI 路径保持原实现。
- New owner/fallback/adapter：共享 wire core 是唯一线协议 owner；测试和生产均为薄适配器；未新增 fallback。
- Retirement track：explicit delete-first。
- Evidence growth：wire contract、测试兼容、请求隔离、生产 JSON/Text/HTML、单请求、错误、取消、全量回归与 production build 均已覆盖。
- Execution Readiness View：aligned。
- Decision：complete。
