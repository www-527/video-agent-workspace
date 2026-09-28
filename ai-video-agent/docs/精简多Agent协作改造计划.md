# AI 视频程序精简多 Agent 协作改造计划

## 1. 改造目标

在不改变用户操作和公开接口兼容性的前提下，精简现有多 Agent 架构，减少重复模型调用、角色数量和调度复杂度，同时保留并加强并行生成、失败隔离、取消、续跑、任务追踪和数据一致性能力。

本次改造遵循以下边界：

- 页面、按钮、文案、点击步骤和审批流程不变。
- `/api/agent/chat`、`/api/outline`、`/api/frames/html` 等公开 API 不删除、不重命名已有请求或响应字段，不改变已有字段语义。
- SSE 事件名称、进度展示、取消方式和缺失镜头补跑方式不变。
- 继续使用任务启动时锁定的 AI Key、Base URL 和模型；运行途中切换当前 Key 不影响已启动任务。
- 分镜流水线最多同时处理两个分镜，不提高现有外部服务并发峰值。
- 旧项目、旧 `Outline`、旧 `VideoSource` 和已有 Agent 运行记录继续可读，无需转换历史业务数据。
- 不为减少角色而牺牲内容可信度、画面有效性或失败后的可恢复性。

这里的“接口不变”指向后兼容：已有调用方不需要修改。内部任务、Trace、提示词和临时产物契约可以演进，但不得把内部调度细节暴露为新的用户步骤。

## 2. 术语和统计口径

为避免把“角色减少”误写成“所有 AI 调用都减少”，统一使用以下口径：

| 名称 | 定义 |
| --- | --- |
| 逻辑任务 | 调度器中的一个业务阶段，例如 `content-planner` |
| 模型请求 | 向模型供应商实际发出的一次 HTTP 推理请求 |
| 重试 | 同一逻辑任务因可恢复错误再次发出的模型请求 |
| AI Agent | 直接生成或审校核心业务产物的大模型角色 |
| AI 辅助服务 | 可能调用模型，但不直接生成核心产物的分类或规划服务 |
| Worker | 不依靠通用大模型推理的外部服务适配器或确定性程序 |
| System | 调度、校验、持久化、哈希和状态映射等基础能力 |

验收时同时记录：

- 逻辑任务数量；
- 模型请求次数，包括重试；
- Prompt Token、Completion Token 和总 Token；
- 各阶段耗时与全链路耗时；
- 降级、重试、复用和失败数量。

“固定调用一次”默认指一个逻辑任务；供应商请求次数受本计划定义的重试预算约束，不能把重试隐藏在“调用一次”的描述中。

## 3. 精简后的职责分类

### 3.1 核心 AI Agent

系统保留 4 个直接生成或审校核心产物的 AI Agent：

| Agent | 职责 | 逻辑调用条件 |
| --- | --- | --- |
| `content-planner` | 根据用户需求和研究资料，一次生成创作简报、标题、章节、口播和分镜草案 | 新建或重新生成内容计划时一次 |
| `content-quality` | 检查事实使用、结构、重复、时长和 AI 腔；必要时在同一响应中返回修订大纲 | Content Planner 成功后一次 |
| `director` | 将通过审校的大纲转换为 `DirectorPlan` 和 `SceneSpec`，补全素材检索语义 | HTML 项目的内容计划阶段一次 |
| `visual-composer` | 根据单镜脚本、素材和音频信息生成 HTML 画面 | 每个需要新建或重建画面的分镜一次 |

“4 个 AI Agent”只表示核心产物角色收敛为 4 个，不排除意图识别和研究规划仍存在可计费的 AI 辅助请求。

### 3.2 AI 辅助服务

| 服务 | 策略 |
| --- | --- |
| `intent-classifier` | 优先使用本地规则识别明确的单镜调整、拆分、合并等操作；规则无法可靠判断时，沿用模型分类 |
| `research-planner` | 明确无需研究或未配置研究服务时跳过；其余情况可以调用模型判断风险、生成查询词 |

AI 辅助服务必须出现在 Trace 和调用统计中，不得因为不叫 Agent 就从成本数据中消失。

### 3.3 Worker

| Worker | 职责 |
| --- | --- |
| Research Search Worker | 调用联网搜索服务，筛选来源并生成证据卡 |
| TTS Worker | 生成单镜语音及音频时长 |
| Asset Worker | 搜索、下载、复用或生成单镜素材 |

Worker 可以通过受控的媒体存储适配器写入项目专属文件目录，但不能直接覆盖 `Project.outline` 或 `Project.videoSource`。

### 3.4 System

| System | 职责 |
| --- | --- |
| Scheduler | 管理任务依赖、分镜并发、资源并发、取消、重试和状态 |
| Deterministic Asset Planner | 将 `SceneSpec` 规范化为单镜素材请求，并执行全片图片节奏和安全规则 |
| Local Quality Gate | 执行 HTML 结构、安全、素材引用和输出完整性检查 |
| Committer | 合并并持久化最终产物，避免并发覆盖 |
| Reuse Resolver | 根据输入哈希、版本和运行上下文复用合格产物 |
| Trace / Metrics | 记录任务、模型请求、Token、重试、复用和耗时 |

## 4. 目标流程

### 4.1 内容计划流程

```text
用户请求
  → Intent Router（本地规则优先，必要时 AI 分类）
  → Research Planner（按需）
  → Research Search Worker（按需）
  → Content Planner
  → Content Quality
  → Director（仅 HTML 项目）
  → Outline Committer
```

### 4.2 分镜生成流程

```text
                         ┌→ TTS Worker ─────┐
分镜任务（最多两路） ────┤                   ├→ Visual Composer
                         └→ Asset Worker ───┘        ↓
                                             Local Quality Gate
                                                    ↓
                                            VideoSource Committer
```

浏览器渲染后的布局检查和自动优化继续保留，但它属于成片画面检查，不重新包装为初始生成链路中的 Reviewer Agent。

## 5. 内容计划阶段

### 5.1 意图路由

- 明确的局部调整、删除元素、拆分分镜和合并分镜优先由本地规则判断。
- 本地规则无法可靠判断时继续使用现有模型分类，避免因强行规则化导致用户操作退化。
- 意图分类模型请求单独计入 `intent-classifier`，不计入 4 个核心 Agent，但计入总调用量和总 Token。
- 意图分类必须接收请求取消信号。
- 意图识别失败继续使用现有友好降级，不自动扩大任务范围。

### 5.2 Research Service

Research Service 拆为 Research Planner 和 Research Search Worker：

1. 明确禁用搜索、未配置搜索服务或本地规则确认是纯创作任务时直接跳过。
2. 其他请求由 Research Planner 判断风险等级并生成有限查询词。
3. Research Search Worker 并行执行查询，筛选来源并生成证据卡。
4. 研究失败时返回带失败状态的研究快照或 `null`，继续内容生成。

取消和错误规则：

- Research Planner、所有搜索请求和等待过程必须接收同一个运行取消信号。
- 外部服务超时信号与用户取消信号合并处理。
- 取消异常不得被当作“研究失败后降级”吞掉，必须终止当前运行。
- 普通网络失败可以降级，已经形成的合格证据继续保留。

### 5.3 Content Planner

Content Planner 合并原 `creative-brief` 和 `script`：

- 一次逻辑调用完成受众、核心信息、语气、时长和叙事目标分析。
- 直接生成满足现有 `Outline` 契约的标题、章节、口播和分镜草案。
- 有研究资料时必须依据证据卡创作。
- 没有证据卡时，对数字、日期、价格、政策、人物现职等高风险事实使用保守表达。
- 研究失败不阻塞生成，但结果继续携带现有研究失败信息。
- 输出必须经过 `normalizeOutline` 和本地 `contentAudit`，不能把模型原始 JSON 直接提交。

### 5.4 Content Quality

Content Quality 合并原 `content-reviewer` 和 `script-reviser`，一次逻辑调用同时完成判断和必要修订。

内部输出契约：

```ts
type ContentQualityIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
  path?: string;
  evidenceIds?: string[];
};

type ContentQualityResult = {
  decision: "pass" | "revise";
  issues: ContentQualityIssue[];
  correctedOutline?: Outline;
};
```

处理规则：

- `pass`：不得携带 `correctedOutline`，直接使用 Content Planner 大纲。
- `revise`：必须在同一次响应中返回完整 `correctedOutline`，不再调用独立 Reviser。
- 修订大纲必须重新执行结构规范化、本地内容审计、研究快照保留和事实约束检查。
- 修订结果不能删除来源信息、协作状态必需字段或必要分镜标识。
- 审校响应不合法时使用原大纲，并记录 `QUALITY_DEGRADED` 诊断；不进入无限互评。
- 取消异常必须重新抛出，不得以“使用原大纲”降级。
- 高风险研究失败或审校降级时，沿用现有用户审批步骤，由现有研究/审计信息提示人工确认，不新增操作节点。

### 5.5 Director

Director 继续把最终内容大纲转换为画面执行计划，并使用现有 `SceneSpec` 字段表达可检索素材语义：

- `assetStrategy`
- `visualRole`
- `realImagePriority`
- `imagePurpose`
- `assetHints`
- `focus`
- `focalElement`
- `composition`

约束：

- `assetHints` 应优先输出简短、可搜索的英文查询词；多个不可替代主体使用多个提示。
- Director 只表达内容、主体、构图和素材意图，不执行下载，也不决定最终全片图片配额。
- Deterministic Asset Planner 负责验证查询词、补齐缺失字段、执行全片节奏和安全限制。
- Director 失败时使用现有确定性规范化和默认 `SceneSpec` 兜底。
- Director 的取消异常不得被兜底逻辑吞掉。

## 6. 素材规划

### 6.1 移除 AI Asset Planner

- 删除全片独立的 AI `asset-planner` 逻辑调用。
- 不再让模型重复读取整片大纲并生成 `SmartImagePlan`。
- 保留现有 Pexels、图片生成、下载、缓存和素材降级能力。

### 6.2 确定性素材契约

在生成阶段，根据已有 `SceneSpec` 临时构造内部 `AssetRequest`，不要求修改公开 API：

```ts
type AssetRequest = {
  frameId: string;
  useRealImage: boolean;
  priority: number;
  purpose: string;
  queries: string[];
  subjects: Array<{
    name: string;
    kind: string;
    query: string;
    required: boolean;
  }>;
  composition: "full-bleed" | "editorial-split" | "framed-focus";
  textPosition: "left" | "right";
  imageMotion: "slow-push-in" | "slow-pan" | "static";
  fidelity: "required" | "preferred";
  fallbackPolicy: "allow-native";
  deadlineMs: number;
};
```

确定性规则负责：

- 校验并清理英文查询词；
- 根据标题、旁白、主体类型和视觉职责补齐查询词；
- 处理人物、产品、建筑、地点、历史场景和多主体需求；
- 执行 `fast`、`balanced`、`asset-priority` 模式预算；
- 限制连续真实图片数量和全片图片比例；
- 禁止用普通图库冒充具体新闻、事故、赛事或时效现场；
- 保留既有素材和缓存，避免重复下载；
- 必需素材不可得时采用明确的原生视觉降级，不使用错误替代物。

旧项目缺少部分 `SceneSpec` 字段时，使用本地分类和默认规则生成 `AssetRequest`。

## 7. 分镜生成阶段

### 7.1 并发和资源预算

- 同时处理的分镜数始终不超过 2。
- 同一分镜的 TTS Worker 和 Asset Worker 同步启动、并行等待。
- TTS 和素材分别使用资源信号量，默认上限均不高于 2。
- Visual Composer 受分镜并发上限约束，不额外开启脱离分镜槽位的预取任务。
- 独立信号量用于隔离服务容量，不代表可以无限重试或提高供应商峰值。
- 增加并发计数测试，证明任意时刻的 TTS、素材、模型和总分镜并发不高于改造前配置。

### 7.2 降级规则

- TTS 失败时，使用已有音频或估算时长继续生成画面。
- 素材搜索失败时，使用已有素材、图片生成兜底或 HTML 原生视觉。
- 可选图片未被合格使用时，允许退回原生 HTML，并记录素材降级原因。
- 必需素材不可得时不得替换成误导性图片；使用原生表达并记录诊断。
- 单镜失败只影响当前镜头，其他镜头继续。
- 已完成的音频、素材和 HTML 立即保留。

### 7.3 Visual Composer 与 Local Quality Gate

- `visual-composer` 等待音频和素材任务成功或降级后生成 HTML。
- 移除独立的 `frame-reviewer` 任务角色；现有确定性校验归入 Local Quality Gate。
- 移除外层 `repair` Agent，不再在调度器外层重新执行一整套 HTML 生成。
- 保留 `generateFrameHtml` 内部根据具体错误进行的定向修复提示。
- 保留 HTML 提取、安全清理、结构校验和素材引用检查。

Local Quality Gate 分为：

| 级别 | 示例 | 处理 |
| --- | --- | --- |
| 硬失败 | HTML 不完整、危险内容、必要结构缺失 | 在共享预算内定向修复；耗尽后该镜失败 |
| 素材降级 | 可选图片未引用或不可用 | 转为原生 HTML，不判整镜失败 |
| 诊断警告 | 非关键元数据缺失 | 保留结果并记录诊断 |

### 7.4 模型请求预算

避免 `模型客户端重试 × HTML 内部重试 × 图片降级 × 外层 Repair` 产生乘法放大：

- Content Planner、Content Quality、Director：每个逻辑任务最多 2 次模型请求，第二次仅用于可恢复网络错误或 JSON 格式修复。
- Visual Composer：调度器外层 `maxAttempts=1`。
- 每个分镜的 Visual Composer 使用一个共享请求预算，默认最多 3 次模型请求。
- 图片版本、原生降级版本和校验反馈修复共同消耗这 3 次预算，不分别重新获得预算。
- 相同提示词的确定性校验失败不得原样重试；再次请求必须携带明确校验反馈或切换为原生降级方案。
- 用户取消不消耗后续重试，收到取消后不得再发新请求。

如实际验证证明 3 次预算无法维持当前成功率，应通过基准数据调整单一总预算，不得恢复多层独立重试。

### 7.5 浏览器布局检查

- 保留渲染后的浏览器布局检查和自动优化。
- 它检查真实 DOM、字幕安全区、溢出、遮挡和可读性，不是重复审查模型文本。
- 用户主动触发的质量修复和单镜调整流程保持不变，不混入初始生成 Agent 数量统计。

## 8. 调度、取消、复用与恢复

### 8.1 调度规则

- 依赖未完成的任务不得启动。
- 失败依赖只有在任务明确允许降级时才能继续。
- 单镜失败不终止其他分镜。
- 同一项目、同一运行类型只允许一个活动实例。
- 待执行任务收到取消后直接标记为 `cancelled`。
- 运行中的任务共享同一取消信号。
- 已完成产物不会因后续取消或失败被删除。

### 8.2 取消协议

所有 Agent、AI 辅助服务和 Worker 遵守统一规则：

```ts
if (abortSignal?.aborted) {
  throw abortSignal.reason ?? new DOMException("Aborted", "AbortError");
}
```

- 降级 `catch` 在处理普通错误前必须先检查取消。
- Research Planner、联网搜索、TTS、素材下载、图片生成和 HTML 模型请求必须接收取消信号。
- 取消后不得继续提交新的 `Outline` 或 `VideoSource` 更新。
- SSE `aborted` 对应数据库 `AgentRun.status = "cancelled"`。
- 应用重启后遗留的 `queued`、`running` 运行和任务标记为 `interrupted`。

### 8.3 三种复用语义

避免把“跳过已有镜头”和“输入哈希缓存”混为一谈：

1. **活动去重**：同一项目的同类活动运行返回现有冲突语义，不创建第二个运行。
2. **缺失镜头续跑**：根据 `frameId` 和当前产物完整性跳过已经完成的音频、素材或 HTML。
3. **历史任务复用**：Reuse Resolver 根据任务输入哈希查找可安全复用的已完成 `AgentTask` 产物。

任务哈希至少包含：

```text
pipelineVersion
taskRole
promptVersion
normalizedInput
projectType
styleId / material policy
model
baseUrl fingerprint
AI key identity fingerprint
```

规则：

- 不在哈希或数据库中保存 API Key 明文。
- 不使用易因无关保存而变化的 `projectUpdatedAt` 作为主要内容哈希。
- 输入内容、提示词版本、模型或素材策略变化时不得错误复用。
- 复用只接受状态为 `completed`、产物契约有效且版本兼容的任务。
- `reused` 任务不增加模型请求次数，但必须出现在 Trace 中。

### 8.4 恢复语义

本次不增加新的恢复按钮：

- 应用重启只负责把残留任务标记为 `interrupted`，不自动在后台重放。
- 用户沿用现有生成入口后，系统根据 `VideoSource` 和输入哈希接续缺失任务。
- “恢复能力”指已有产物保留和安全续跑，不承诺进程重启后自动继续未完成网络请求。

## 9. 数据持久化与提交一致性

### 9.1 角色兼容

保留旧角色的读取类型，新增角色只用于新任务：

```ts
type AIAgentRole =
  | "content-planner"
  | "content-quality"
  | "director"
  | "visual-composer";

type WorkerRole = "research-search" | "tts" | "asset";
type SystemRole = "intent-router" | "scheduler" | "validator" | "committer" | "persistence";
type PersistedRole = LegacyAgentRole | AIAgentRole | WorkerRole | SystemRole;
```

- 不直接删除历史角色字符串的解析能力。
- 数据库中的 `role` 继续使用字符串，旧记录无需重写。
- Trace 分类通过映射函数完成，不依赖数据库迁移来修改旧角色。
- 每个新运行记录 `pipelineVersion`；可以放在现有运行摘要中，若新增数据库字段则提供向后兼容的 nullable migration。

### 9.2 Committer 边界

- Agent 和 Worker 不直接更新 `Project.outline` 或 `Project.videoSource`。
- Worker 可以写入受限的项目媒体目录，并返回路径、时长、来源和校验信息。
- Outline Committer 在内容链路成功后一次提交最终 Outline。
- VideoSource Committer 以 `frameId` 合并单镜补丁，不根据陈旧数组下标覆盖整片数据。

### 9.3 并发一致性

单个请求内的 Promise 队列不足以处理跨请求竞争。Committer 必须：

- 每次提交读取或锁定最新项目状态；
- 按 `frameId` 合并补丁；
- 使用数据库事务、行锁或 `updatedAt` 乐观锁检测并发修改；
- 冲突时重新读取并有限重试；
- 不覆盖质量修复、单镜调整或另一镜头刚写入的结果；
- 同时提交 Outline 和初始 VideoSource 时保证两者对应同一组 frameId。

进程内串行队列可以减少冲突，但数据库级检查才是最终一致性保证。

### 9.4 AI Key 快照

- 任务启动时获取 AI Key、Base URL 和模型快照。
- 所有子任务继承同一快照。
- 快照只在运行期内存上下文中使用。
- 数据库只保存不含密钥的身份指纹或配置版本，用于安全复用判断。

## 10. Trace 与可观测性

Trace 按四类展示：

```text
AI Agent
  content-planner
  content-quality
  director
  visual-composer

AI Support
  intent-classifier
  research-planner

Worker
  research-search
  tts
  asset

System
  intent-router
  scheduler
  asset-planner
  validator
  committer
  persistence
```

每条 Trace 至少携带：

- `runId`
- `taskId`
- `role`
- `category`
- `pipelineVersion`
- `inputHash`
- `attempt`
- `maxAttempts`
- `startedAt`
- `durationMs`
- `status`
- `reused`
- Token 使用量（模型请求）

Trace 不出现在普通用户界面，不记录 API Key、完整私密配置或不必要的用户原始内容。

## 11. 实施顺序

### 阶段 0：冻结契约与建立基线

1. 保存现有公开 API、SSE 事件和关键 UI 流程的契约测试。
2. 记录当前各场景的逻辑任务数、模型请求数、Token、成功率和耗时。
3. 固定评测主题、模型、模拟延迟和素材模式。
4. 明确 `pipelineVersion`、提示词版本和 Trace 字段。

### 阶段 1：先补基础设施

1. 拆分 `LegacyAgentRole`、新角色和 Trace 分类类型。
2. 建立统一取消辅助函数，修复 Research 和所有降级 `catch` 的取消传播。
3. 实现 Reuse Resolver 和稳定输入哈希。
4. 把单请求保存队列升级为数据库安全的 Committer。
5. 增加状态映射和重启中断处理测试。

该阶段先修基础能力，避免内容和生成链路同时变化时难以定位数据问题。

### 阶段 2：内容链路精简

1. 新增 `content-planner` 和 `content-quality`。
2. 合并 Creative Brief 与 Script 的提示词、输入和输出。
3. 合并 Reviewer 与 Reviser，建立一次审校直接修订的严格契约。
4. 为修订结果增加二次本地规范化和内容审计。
5. 修复 Director 和内容阶段的取消降级行为。
6. 保持最终 `Outline`、接口响应和页面展示兼容。

### 阶段 3：素材和生成链路精简

1. 让 Director 使用现有 `SceneSpec` 输出完整、可检索的素材语义。
2. 实现 Deterministic Asset Planner 和 `AssetRequest` 规范化。
3. 删除 AI Asset Planner 调用。
4. 将 Audio、Asset 恢复为 Worker 分类。
5. 将确定性 Frame Reviewer 合并进 Local Quality Gate。
6. 删除外层 Repair 任务。
7. 实现 Visual Composer 全局共享请求预算。
8. 保留浏览器布局检查和自动优化。

### 阶段 4：兼容验证和受控切换

1. 使用固定样本离线对比旧链路和新链路，不默认对真实用户双跑，避免费用翻倍。
2. 使用内部 `pipelineVersion` 或服务端开关保留短期回退能力。
3. 验证旧项目、旧 AgentTask、缺字段 SceneSpec 和部分完成 VideoSource。
4. 完成故障注入、调用数量和质量非回退测试后切换默认链路。
5. 若新增配置开关，同步更新 `.env.example` 和 README。

### 阶段 5：清理和文档收口

1. 稳定观察后删除只被旧流程使用的提示词和死代码。
2. 不删除历史数据库记录和旧角色读取类型。
3. 更新 README 中已实际落地的后台协作说明。
4. 移除临时回退开关前再次运行全量回归和生产构建。

## 12. 测试计划

### 12.1 内容契约

- 明确无需研究的请求不调用 Tavily。
- 需要研究时，研究结果和证据卡传入 Content Planner。
- Research Planner 的模型请求被单独统计。
- 研究失败后仍能生成合法 Outline。
- Content Planner 输出满足现有 `Outline` 契约。
- Content Quality `pass` 不修改大纲。
- Content Quality `revise` 同次返回修订大纲，不产生独立 Reviser 调用。
- 修订结果重新执行规范化、内容审计和证据约束。
- 审校 JSON 非法时记录降级诊断，不进入循环。
- Director 失败时确定性兜底生成可用 `SceneSpec`。

### 12.2 取消与错误注入

分别在以下阶段注入取消：

- 意图分类；
- Research Planner；
- Tavily 查询；
- Content Planner；
- Content Quality；
- Director；
- TTS；
- 素材搜索和下载；
- Visual Composer；
- Local Quality Gate 之后、提交之前。

断言：

- 不再启动后续任务；
- 不把取消记录成普通失败或成功降级；
- 不继续发送新模型请求；
- 不提交取消后产生的新 Outline/VideoSource；
- 已在取消前完成并提交的产物继续保留；
- SSE 为 `aborted`，AgentRun 为 `cancelled`。

### 12.3 素材规划

- 旧 SceneSpec 缺少提示时能够生成安全的默认 `AssetRequest`。
- 多主体分镜生成多个查询而不是只搜索一个泛化关键词。
- 具体时效事件不会被普通图库冒充。
- 图片比例、连续图片数量和模式预算正确。
- 已有素材被复用，不重复下载。
- 必需素材不可得时不使用错误替代图。
- 不再产生 `asset-planner` 模型请求。

### 12.4 分镜生成

- TTS 和素材任务确实并行启动。
- 分镜并发上限始终为 2。
- TTS、素材和模型并发不高于配置上限。
- Visual Composer 等待依赖成功或降级结果。
- 单镜失败不会终止其他镜头。
- 已完成镜头立即发送原有 `frame_done`。
- 已有完整镜头不会被重复生成。
- Local Quality Gate 正确区分硬失败和素材降级。
- 单镜模型请求总数不超过共享预算。
- 不存在 HTML 内部重试被外层任务再次放大的情况。

### 12.5 数据、复用与竞争

- 同项目多个镜头同时完成不会丢失 `videoSource` 更新。
- 分镜生成与质量修复并发提交不会相互覆盖。
- 分镜生成与单镜调整并发时能检测冲突并安全合并或拒绝陈旧结果。
- 同输入、同版本、同模型可以复用已完成任务。
- Prompt、模型、风格或素材策略改变后不会错误复用。
- 重复活动请求不会创建冲突运行。
- 应用重启后残留任务标记为 `interrupted`。
- 用户再次执行现有生成操作时只接续缺失产物。
- 旧项目和旧 Agent 任务记录可正常读取。

### 12.6 回归、质量和性能

- 现有聊天、审批、生成、单镜修改、质量修复、预览和导出测试全部通过。
- 页面、文案、按钮、点击次数、进度和失败后的操作不变。
- TypeScript 检查、Vitest 全量测试和生产构建通过。
- 增加逻辑任务数、模型请求数和 Token 断言。
- 在相同模拟调用耗时下，新链路不慢于旧链路。
- 固定评测集的 Outline 合法率、事实问题率、HTML 成功率和浏览器布局通过率不低于旧链路。

性能和成本至少按以下场景分别统计：

| 场景 | 研究 | 审校 | 素材 | 用途 |
| --- | --- | --- | --- | --- |
| A | 无 | pass | 关闭 | 普通创作基线 |
| B | 有 | pass | balanced | 常规完整链路 |
| C | 有 | revise | asset-priority | 高成本上界 |
| D | 无 | pass | balanced | 素材规划收益 |
| E | 任意 | 任意 | 任意 | 取消与缺失镜头续跑 |

## 13. 验收标准

改造完成需同时满足：

- 用户操作、审批步骤、已有 API 字段和 SSE 协议保持兼容。
- 核心产物 AI Agent 收敛为 4 个。
- AI 辅助服务被如实分类和计费统计。
- 普通内容链路减少 1 个逻辑模型阶段；触发修订时减少 2 个逻辑模型阶段。
- 全片 AI Asset Planner 模型请求为 0。
- 合格镜头不产生独立 Reviewer 模型调用或外层 Repair 模型调用。
- 每镜 Visual Composer 模型请求不超过统一预算。
- 分镜并发、失败隔离、取消和缺失镜头续跑不退化。
- 取消不会被降级逻辑吞掉。
- 输入哈希复用真实可用，并且不会跨不兼容版本错误复用。
- 跨镜头、跨请求写入不丢失 `VideoSource` 更新。
- 旧项目和历史 Agent 记录继续可读。
- 所有契约、故障注入、并发和回归测试通过。
- 固定评测集的内容质量和画面成功率不低于改造前。
- 在相同模型和模拟耗时下，完整生成速度不慢于改造前。

成本目标：

- 普通主题总 Token 目标降低 15%～25%；
- 内容计划或完整任务耗时目标改善 15%～30%。

以上百分比是目标区间，不是未经测量的承诺。最终结果以 Trace、固定评测集和自动化性能测试为准；如未达到目标，仍需报告各场景的实际数据和原因。

## 14. 风险与回退

| 风险 | 控制方式 |
| --- | --- |
| 合并 Planner 后提示词过大或输出截断 | 限制输入、结构化契约、输出规范化、固定评测 |
| Quality 同次修订导致漏检 | 本地审计、证据约束、降级诊断、人工审批不变 |
| 移除 AI Asset Planner 后查询质量下降 | Director 提供英文提示、确定性规范化、素材评测集 |
| 重试预算降低成功率 | 共享预算内定向修复，依据基准调整总预算 |
| 新旧角色导致历史记录解析失败 | PersistedRole 兼容联合类型和旧记录测试 |
| 并发提交覆盖其他操作 | 数据库事务或乐观锁、按 frameId 合并 |
| 取消被 catch 吞掉 | 统一取消辅助函数和逐阶段故障注入 |

切换期间保留服务端流水线版本开关。出现以下任一情况时回退旧链路：

- 公开接口或审批流程回归；
- 固定评测集质量显著下降；
- 产物覆盖或错误复用；
- 取消后仍有模型请求或项目提交；
- HTML 成功率低于旧链路且无法通过统一预算修复。

## 15. 暂不实施的事项

- 不引入独立 Worker 服务、Redis 或消息队列。
- 不允许用户分别为不同 Agent 选择模型。
- 不提高两镜并发上限。
- 不在界面增加 Agent 状态、恢复按钮或新的操作步骤。
- 不在应用重启后自动重放未完成的外部请求。
- 不引入多轮 Agent 辩论、无限互评或自动扩大任务图。
- 不为使用框架而迁移到 LangGraph、AutoGen、AgentScope 或 CAMEL。
