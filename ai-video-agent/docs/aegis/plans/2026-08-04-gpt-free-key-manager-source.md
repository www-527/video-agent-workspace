# GPT 自由创作统一使用 Key 管理实施计划

## Goal

让 Key 管理成为 GPT 自由创作唯一的 Key/模型选择源，移除项目级绑定，同时保持任务级快照和旧项目兼容。

## Architecture

复用现有 `runWithActiveAIKey` / `getTaskAIKeySnapshot` 请求上下文。删除 GPT 自由项目的 `applyProjectAIKeyBinding` 覆盖路径；项目仅保存工作流、画幅和首镜确认设置。

## Tech Stack

Next.js 14、React 18、TypeScript、Prisma、Vitest。

## Baseline/Authority Refs

- `AGENTS.md`
- `README.md`
- `docs/aegis/specs/2026-08-04-gpt-free-key-manager-source-brief.md`
- 用户于 2026-08-04 确认的行为设计。

## Compatibility Boundary

保留 Prisma `aiBinding` 可空列及历史迁移，但应用不再写入或读取它作为运行时 Key 来源。旧项目直接改用当前活动 Key；其他 AI、图片、研究和 TTS 链路不变。

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change regression
- Reason: 用户未要求严格 TDD，现有 API 与上下文测试可覆盖契约变化。
- Verification: 聚焦 Vitest、完整 `npm test`、`npm run build`。

## Planning Decisions

- Requirement Ready Check: ready；目标、场景、Key 生效时机和 DeepSeek 边界均已确认。
- Change Necessity: code-change；仅改文档无法移除弹窗选择和运行时项目绑定。
- Existing owner / existence check: 复用 Key 管理、`runWithActiveAIKey` 和任务快照，不新增 Key 路由或兼容适配器。
- Architecture integrity: Key 管理是唯一选择源；项目绑定这一重复 owner 必须退休。
- Complexity: 删除覆盖分支会降低复杂度；不在本次删除数据库列。
- Ripple signal: 项目创建 UI、创建 API、所有调用 `applyProjectAIKeyBinding` 的路由、项目类型/展示、测试和 README。

## Tasks

### 1. 简化创建界面和项目创建契约

Files:
- Modify `src/components/projects/gpt-free-project-dialog.tsx`
- Modify `src/app/api/projects/route.ts`
- Modify `tests/project-canvas-api.test.ts`

Steps:
1. 删除弹窗 Key/模型状态、请求和控件，仅提交工作流、画幅及首镜确认。
2. 创建 API 不再接收或要求 `aiBinding`，仍拒绝 GPT 自由图片项目。
3. 更新 API 测试，证明无绑定可创建、图片类型仍受限。
4. Run `npm.cmd test -- --run tests/project-canvas-api.test.ts`.

### 2. 退休运行时项目 Key 覆盖

Files:
- Modify `src/lib/ai-key-context.ts`
- Modify `src/app/api/agent/chat/route.ts`
- Modify `src/app/api/outline/route.ts`
- Modify `src/app/api/frames/html/route.ts`
- Modify `src/app/api/frames/html/image-search/route.ts`
- Modify `src/app/api/projects/[id]/frame-quality/repair/route.ts`
- Modify affected project projection files and `src/types/index.ts`
- Modify/add focused context tests

Steps:
1. 删除 `applyProjectAIKeyBinding` 及所有调用，让路由外层活动 Key 上下文成为唯一 owner。
2. 从新项目和运行时 DTO 中移除 `aiBinding` 传播；保留 Prisma 列作为被忽略的历史数据。
3. 增加回归测试，证明任务快照稳定且项目绑定不能覆盖活动 Key。
4. Run focused AI key and route tests.

Repair Track: 删除重复 Key owner，统一到 Key 管理活动快照。

Retirement Track: 应用层 `aiBinding` 写入、读取和覆盖逻辑全部移除；数据库列暂留，原因是避免破坏性迁移，后续数据库清理任务可单独删除。

### 3. 同步用户说明与模型语义

Files:
- Modify `README.md`
- Modify `src/components/studio/studio-layout.tsx` if stale model tooltip remains

Steps:
1. 更新首页和 GPT 自由创作流程说明。
2. 明确“视觉总监/视觉审查”不代表多模态视觉接口，DeepSeek 可用于自由 HTML 文本生成测试。
3. 保持实际能力与 README 一致。

### 4. 完整验证

Steps:
1. Run `git diff --check`.
2. Run `npm.cmd test` and expect all tests to pass.
3. Run `npm.cmd run build` and expect successful production build.
4. Search for active `applyProjectAIKeyBinding` and project-level Key binding references; only historical migration/schema compatibility may remain.

## Risks

- Key 在两个独立请求之间切换会改变同一项目后续生成结果；这是已确认行为。
- DeepSeek 的长 HTML 完整性和创意质量可能低于 GPT；属于模型质量差异，不是路由错误。
- 遗留数据库字段继续占用少量结构熵，但避免了不必要的数据迁移风险。

## Execution Readiness View

- Intent Lock: Key 管理唯一控制 GPT 自由创作连接。
- Scope Fence: 创建 UI、项目 API、运行时 Key 上下文、DTO、测试、README。
- Baseline Lock: `AGENTS.md` 与已确认 Spec Brief。
- Approved Behavior: 每个新任务读取活动 Key并固定快照；DeepSeek 可跑文本到 HTML 链路。
- Owner / Contract Constraints: 不新增第二 Key owner。
- Compatibility Boundary: 历史 `aiBinding` 列保留但忽略。
- Retirement Boundary: 删除应用层绑定路径，不做数据库列删除。
- Test Obligations: 聚焦测试、完整测试、生产构建、残留引用搜索。
- Drift / Rewind Rules: 若发现其他运行时依赖绑定字段，暂停并回到规格核对。
- Advisory Boundary: method-pack execution guidance only; not GateDecision, PolicySnapshot, or completion authority.
