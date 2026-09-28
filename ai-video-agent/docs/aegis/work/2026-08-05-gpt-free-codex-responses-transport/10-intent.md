# Task Intent — GPT 自由创作 Codex Responses 迁移

## Requested Outcome

整个 GPT 自由创作工作流的模型输入输出使用交接文档定义的 Codex Responses SSE 协议，每个 Agent 调用一次真实 fetch，不重试、不降级 Chat，同时保留现有业务 prompts、输出类型、项目持久化和非目标工作流。

## Scope

- 唯一 Codex wire core。
- 测试诊断与生产输出两个薄适配器。
- 请求级 GPT-free transport policy。
- shared AI client 三种输出模式分流。
- 聚焦/完整测试、README 和协议文档。

## Non-goals

- 不改变数据库、持久化 Key schema、Key/model binding、浏览器业务 API 或标准/DeepSeek 工作流。
- 不发 live relay 请求。
- 不处理仓库中既有无关改动或 Aegis 历史治理缺口。

## Success Evidence

- 请求契约和 SSE 结束语义测试。
- one-fetch/no-SDK/no-retry/no-Chat negative tests。
- JSON/text/HTML 输出兼容测试。
- default-policy 与测试弹窗回归。
- TypeScript、完整 Vitest、build、diff/security checks。

## Stop Conditions

- done：计划验收证据全部通过，剩余 live relay 风险明确。
- needs-verification：自动化或构建证据不完整。
- scope-exceeded：需要 schema/UI/standard workflow/compat fallback 变更。
- blocked：相同外部阻塞连续达到方法包阈值且无法继续。

## BaselineReadSetHint

- `AGENTS.md`
- `docs/Codex API 测试输入输出协议.md`
- `docs/aegis/specs/2026-08-05-gpt-free-codex-responses-transport-design.md`
- `docs/aegis/plans/2026-08-05-gpt-free-codex-responses-transport.md`
- `src/lib/ai/codex-test-chat.ts`
- `src/lib/ai/providers/gpt-relay.ts`
- `src/lib/ai/client.ts`
- `src/lib/ai-key-context.ts`
- `architecture/modules.yaml`
- `architecture/ownership.yaml`

## BaselineUsageDraft

- Required baseline refs：全部以上 refs。
- Acknowledged before plan refs：全部。
- Cited in plan refs：全部。
- Missing refs：none。
- Decision：continue。

## ImpactStatementDraft

- Affected layers：infrastructure transport、request context、shared client、tests、docs。
- Canonical owner：`providers/codex-responses.ts`。
- Invariants：business prompts/returns、Key safety、project persistence、non-target workflows。
- Compatibility：GPT-free delete-first；default-policy retained。
- ADR signal：production transport owner change，需要 completion-time ADR backfill check。

## Execution Readiness View

见父计划同名章节。当前状态：present and aligned。
