# AI 对话 P0 功能实施规范

> 文档用途：交给 AI 开发代理直接执行。
>
> 项目：`ai-video-agent`
>
> 版本：V1.0
>
> 日期：2026-08-10

## 0. 执行指令

执行本规范的 AI 开发代理必须遵守以下规则：

1. 开工前完整阅读仓库根目录的 `AGENTS.md`。
2. 先检查相关类型、API、UI、数据库模型和测试，再修改代码。
3. 使用最小、完整、可回归的增量实现；不得顺带重构无关功能。
4. 所有跨层数据结构必须同步更新：
   - `prisma/schema.prisma`
   - `src/types`
   - API 校验
   - 服务端调用方
   - 前端组件
   - Vitest 测试
5. 每次改变用户可见功能、工作流、配置、接口或命令时，必须同步更新 `README.md`。
6. 不得把 API Key、附件原文、附件二进制、完整模型输入、检查点快照或用户私有内容输出到浏览器控制台。
7. 不得破坏当前 GPT 自由创作、大纲、分镜、Pexels、TTS、字幕、质量检查、预览和 MP4 导出链路。
8. 所有耗时任务必须支持取消信号；所有项目修改必须通过版本检查避免覆盖新状态。
9. 每完成一个阶段，运行该阶段的定向测试；最终运行完整测试和 TypeScript/构建验证。
10. 不得声称未实际运行的测试已经通过。

---

## 1. 目标

为没有专业剪辑经验的用户建设一条完整的 AI 视频协作链路：

```text
输入主题或上传资料
→ AI 形成创作简报
→ 必要时只问 1 个关键问题
→ 用户确认并生成初版
→ AI 自动理解当前画面或全片上下文
→ AI 导演诊断问题
→ AI 提出可预览的修改方案
→ 用户确认
→ 系统创建检查点并执行
→ 用户可以停止、重试、恢复或撤销
```

用户只需要表达目标和感受，例如：

- “把这些资料做成 60 秒产品视频。”
- “这个画面不好看。”
- “整体太像 PPT。”
- “前面有点拖沓。”
- “这张图换掉。”

用户不应被要求理解：

- HTML / UI Scene
- SceneSpec
- Visual Anchor
- AgentRun
- DOM 元素 ID
- 状态哈希
- Responses / Chat Completions
- 模型推理参数

---

## 2. P0 范围

必须交付以下六个模块：

1. 智能创作简报
2. 主聊天附件
3. 自动画面上下文
4. AI 导演诊断
5. 安全修改
6. 可靠任务控制

### 2.1 附件白名单

P0 只支持以下格式：

| 类型 | 格式 |
|---|---|
| 图片 | PNG、JPEG/JPG、WebP |
| 文档 | DOCX |
| 文本 | Markdown/MD、TXT |

### 2.2 明确禁止

P0 必须明确排除以下能力：

- GIF
- PDF
- OCR
- 网页 URL
- 网页抓取
- 服务端 URL 下载
- 音频上传
- 视频上传
- PPT/PPTX 上传
- 压缩包上传
- 宏文档
- 专业多轨时间轴
- 关键帧编辑器
- 直接发布到外部平台

实现中不得：

- 安装 PDF 解析依赖。
- 添加 PDF MIME 或扩展名白名单。
- 添加 OCR Prompt、OCR API、OCR 模型调用或扫描件检测流程。
- 添加 URL 输入框、URL Schema、远程下载函数或网页抓取路由。
- 复用 Codex API 测试窗口的 GIF 白名单到主创作对话。

---

## 3. 当前可复用能力

优先复用以下现有实现：

| 能力 | 位置 | 用途 |
|---|---|---|
| 项目、消息、AgentRun/AgentTask | `prisma/schema.prisma` | 持久化任务基础 |
| AgentRun 持久化和 Artifact 复用 | `src/lib/agents/persistence.ts` | 中断、重试、复用 |
| AbortSignal 工具 | `src/lib/agents/cancellation.ts` | 取消信号统一处理 |
| AI 对话路由 | `src/app/api/agent/chat/route.ts` | 兼容入口和现有意图路由 |
| 对话输入器 | `src/components/studio/chat-panel.tsx` | 附件、上下文、停止入口 |
| 选中分镜和元素 | `src/stores/studio-store.ts` | 上下文快照 |
| 播放状态 | `src/components/studio/preview-panel.tsx` | 当前镜和时间点 |
| 35%/70%/100% 采样 | `src/lib/quality/visual-self-repair.ts` | 导演诊断视觉证据 |
| 分镜修改草稿 | `src/components/chat/frame-review-card.tsx` | ChangeSet 适配参考 |
| 结构草稿 | `src/components/chat/frame-structure-review-card.tsx` | ChangeSet 适配参考 |
| 微调草稿与撤销 | `src/components/chat/frame-tune-review-card.tsx` | 安全修改参考 |
| Outline CreativeBrief | `src/types/index.ts` | 大纲内部创作结构 |

不要重复实现已有的：

- 画面采样器
- HTML 审计器
- 单镜质量修复
- 分镜生成控制器
- Pexels 下载和图片签名校验
- TTS 生成
- 本地渲染任务

---

## 4. 统一请求模型

新增统一的 Agent Action 请求类型：

```ts
export interface AgentActionRequest {
  projectId: string;
  clientRequestId: string;
  content: string;
  attachmentIds: string[];
  context: {
    scopeHint?: 'auto' | 'project' | 'frame' | 'element';
    selectedFrameId?: string;
    selectedElementIds?: string[];
    playbackTimeMs?: number;
    playbackRevision?: number;
  };
  sourceMessageId?: string;
  rewriteDraft?: unknown;
}
```

要求：

- `clientRequestId` 必填，用于幂等。
- 聊天请求只能传 `attachmentIds`，不得把附件二进制编码进 JSON。
- 只允许引用当前项目中 `status=ready` 的附件。
- 客户端 context 只是提示；服务端必须重新验证 frameId、elementId 和项目状态。
- 现有 `/api/agent/chat` 短期保留，功能开关关闭时继续使用旧路径。

---

## 5. 数据模型

新增 Prisma migration，不允许只使用 `prisma db push` 代替正式 migration。

### 5.1 Project 字段

```prisma
model Project {
  // existing fields...
  projectBrief Json?
  briefStatus  String @default("empty")
  assets       ProjectAsset[]
}
```

`briefStatus` 允许值：

```ts
type BriefStatus =
  | 'empty'
  | 'collecting'
  | 'needs_clarification'
  | 'ready'
  | 'confirmed';
```

### 5.2 ProjectAsset

```prisma
model ProjectAsset {
  id            String   @id @default(uuid())
  projectId     String
  kind          String   // image | document
  mimeType      String
  originalName  String
  storagePath   String
  contentHash   String   @db.VarChar(64)
  byteLength    Int
  status        String   // uploaded | processing | ready | failed | deleted
  inferredUsage String?  // content | visual | brand | reference
  summary       Json?
  metadata      Json?
  errorCode     String?
  errorMessage  String?  @db.Text
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  project       Project  @relation(fields: [projectId], references: [uuid], onDelete: Cascade)

  @@index([projectId, status])
  @@unique([projectId, contentHash])
  @@map("project_asset")
}
```

### 5.3 ProjectChangeSet

```prisma
model ProjectChangeSet {
  id              String    @id @default(uuid())
  projectId       String
  runId           String?
  status          String    // proposed | applying | applied | reverted | stale | failed
  baseStateHash   String     @db.VarChar(64)
  resultStateHash String?    @db.VarChar(64)
  scope           Json
  operations      Json
  impact          Json
  summary         Json
  checkpointId    String?
  createdAt       DateTime  @default(now())
  appliedAt       DateTime?
  revertedAt      DateTime?

  @@index([projectId, status])
  @@map("project_change_set")
}
```

### 5.4 ProjectCheckpoint

```prisma
model ProjectCheckpoint {
  id           String    @id @default(uuid())
  projectId    String
  reason       String
  stateHash    String     @db.VarChar(64)
  snapshotPath String
  snapshotHash String     @db.VarChar(64)
  summary      Json?
  changeSetId  String?
  createdAt    DateTime  @default(now())
  restoredAt   DateTime?

  @@index([projectId, createdAt])
  @@map("project_checkpoint")
}
```

### 5.5 AgentRun 扩展

给 `AgentRun` 增加：

```prisma
clientRequestId   String?
userMessageId     String?
contextSnapshot   Json?
cancelRequestedAt DateTime?
retryOfRunId      String?
resumeOfRunId     String?

@@unique([projectId, clientRequestId])
```

扩展运行类型：

```ts
type AgentRunKind =
  | 'asset-processing'
  | 'brief-resolution'
  | 'outline'
  | 'frame-generation'
  | 'project-diagnosis'
  | 'change-proposal'
  | 'change-application'
  | 'project-restore';
```

---

## 6. 本地存储

使用以下目录：

```text
data/project-assets/{projectId}/{assetId}/original.ext
data/project-assets/{projectId}/{assetId}/extracted.json
data/project-assets/{projectId}/{assetId}/digest.json
data/project-assets/{projectId}/{assetId}/preview.webp

data/project-checkpoints/{projectId}/{checkpointId}.json.gz
```

要求：

- 所有路径先 `resolve`，再验证位于预期项目目录内。
- 原始文件先写临时路径，校验和哈希完成后原子重命名。
- `extracted.json` 和 `digest.json` 不得通过通用 `/api/data` 暴露。
- 检查点不得通过 `/api/data` 暴露。
- 新目录必须加入 `.gitignore`。
- 删除项目时由数据库级联删除记录，并安全清理对应项目素材与检查点目录。
- 清理动作必须使用明确、已验证的项目目录，不得对 `data/` 根目录执行递归删除。

---

## 7. 模块 1：智能创作简报

### 7.1 新类型

```ts
export interface ProjectBrief {
  version: 'project-brief-v1';
  goal: string;
  targetAudience: string;
  platform: 'douyin' | 'video-account' | 'bilibili' | 'youtube' | 'general';
  durationSeconds: number;
  tone: string;
  coreMessage: string;
  desiredOutcome: string;
  callToAction?: string;
  mustUseAssetIds: string[];
  optionalAssetIds: string[];
  excludedAssetIds: string[];
  assumptions: Array<{
    field: string;
    value: string;
    reason: string;
  }>;
  unresolvedQuestions: BriefQuestion[];
  clarificationCount: number;
  confirmedAt?: string;
}

export interface BriefQuestion {
  id: string;
  question: string;
  choices: Array<{
    id: string;
    label: string;
    effect: string;
  }>;
}
```

### 7.2 行为

Brief Resolver 必须：

1. 综合用户文字和附件 digest。
2. 自动推断目标、受众、平台、时长、语气和核心主张。
3. 只有缺失项会明显改变成片时才提问。
4. 每轮最多一个问题。
5. 最多两轮澄清。
6. 每个问题提供 2～3 个普通语言选项。
7. 永远提供“让 AI 决定”。
8. 两轮后仍不确定时使用默认值，并写入 `assumptions`。
9. 附件已包含答案时不得重复询问。
10. 不得询问模型、协议、渲染模式或并发设置。

### 7.3 消息类型

扩展 `MessageMetadata`：

```ts
| { kind: 'clarification'; question: BriefQuestion; actions: MessageAction[] }
| { kind: 'brief_review'; brief: ProjectBrief; actions: MessageAction[] }
```

简报卡片只显示三个主要操作：

- 按这个生成
- 修改方案
- 让 AI 决定

### 7.4 大纲衔接

- `ProjectBrief` 是生成前的用户确认数据。
- `Outline.creativeBrief` 仍是大纲内部编导结构。
- 新增编译函数，把已确认的 `ProjectBrief`、附件摘要和用户原始需求编译成现有 `generateOutline` 输入。
- 不得删除或替代当前 `Outline.creativeBrief`。

### 7.5 验收

- [ ] 只输入主题能生成简报。
- [ ] 上传资料后能基于附件摘要生成简报。
- [ ] 最多两轮澄清。
- [ ] “让 AI 决定”后不重复询问同一问题。
- [ ] 刷新后简报仍存在。
- [ ] 简报确认后进入现有大纲生成链路。
- [ ] UI 不出现 SceneSpec、模型协议等术语。

---

## 8. 模块 2：主聊天附件

### 8.1 API

新增：

```text
GET    /api/projects/{id}/assets
POST   /api/projects/{id}/assets
PATCH  /api/projects/{id}/assets/{assetId}
DELETE /api/projects/{id}/assets/{assetId}
GET    /api/projects/{id}/assets/{assetId}/preview
POST   /api/projects/{id}/assets/{assetId}/retry
```

上传接口使用 `multipart/form-data`。

聊天接口不得接收二进制文件或 Base64 附件。

### 8.2 服务端白名单

允许：

```ts
const ALLOWED_ASSET_TYPES = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'text/markdown': ['.md', '.markdown'],
  'text/plain': ['.txt'],
} as const;
```

禁止把 `image/gif`、`application/pdf` 或任意 URL Schema 加入白名单。

### 8.3 限制

```ts
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_BATCH_BYTES = 100 * 1024 * 1024;
const MAX_NORMALIZED_DOCUMENT_CHARS = 500_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
```

客户端限制只用于提示；服务端必须重复验证。

### 8.4 解析

建议依赖：

- `mammoth`：DOCX 文本和标题结构提取
- `file-type`：真实文件签名
- `image-size`：图片尺寸
- `iconv-lite`：TXT 编码兜底

不得增加：

- `pdfjs-dist`
- `pdf-parse`
- Tesseract
- OCR SDK
- URL 抓取依赖

### 8.5 长文档

处理步骤：

1. 提取文本。
2. 清理控制字符。
3. 按标题和段落切块。
4. 每块保存位置、文本和哈希。
5. 生成分块摘要。
6. 生成全局 digest。
7. 使用标题权重、关键词和中文 n-gram 选择相关块。
8. 只把 digest 和有限相关原文传给模型。

P0 不引入向量数据库。

### 8.6 图片用途

图片自动推断为：

- brand
- visual
- reference

用户可以改为：

- 必须使用
- 可以使用
- 只供参考
- 不要使用

### 8.7 UI

在 `chat-panel.tsx` 输入器中增加：

- 附件按钮
- 待上传标签
- 处理中标签
- 失败与重试
- 删除附件
- 用途摘要

附件未达到 `ready` 时禁止随消息发送。

### 8.8 安全

- [ ] 真实文件头与扩展名匹配。
- [ ] 文件名不作为磁盘真实名称。
- [ ] 路径经过边界检查。
- [ ] DOCX 解压大小受限。
- [ ] 不执行宏。
- [ ] 不读取外部 URL。
- [ ] 不把全文输出到浏览器控制台。
- [ ] 不把二进制写入 AI Trace。
- [ ] 删除前检查分镜和检查点引用。
- [ ] `/api/data` 不暴露抽取文本和检查点。

### 8.9 验收

- [ ] PNG、JPEG、WebP 可上传。
- [ ] DOCX、Markdown、TXT 可上传和解析。
- [ ] 同一项目重复文件通过 SHA-256 去重。
- [ ] 损坏文件显示可理解错误。
- [ ] 伪造扩展名被拒绝。
- [ ] 刷新后附件仍存在。
- [ ] 附件可以进入 Brief 和 Outline。
- [ ] 没有 GIF、PDF、OCR、URL 入口或依赖。

---

## 9. 模块 3：自动画面上下文

### 9.1 新状态

在 Studio 共享状态中增加：

```ts
export interface PlaybackContext {
  frameId: string | null;
  currentTimeMs: number;
  durationMs: number;
  playbackRevision: number;
}
```

播放时节流更新；只在用户发送消息时生成一次上下文快照。

### 9.2 快照

```ts
export interface ChatContextSnapshot {
  version: 'chat-context-v1';
  projectId: string;
  projectUpdatedAt: string;
  projectStateHash: string;
  resolvedScope: 'project' | 'frame' | 'element';
  selectedFrameId?: string;
  selectedElementIds?: string[];
  playbackTimeMs?: number;
  frameSummary?: {
    title: string;
    narration: string;
    durationSeconds: number;
    renderMode: string;
  };
  elementSummary?: Array<{
    id: string;
    label: string;
    type: string;
  }>;
  evidence?: Array<{
    frameId: string;
    progress: number;
    imageHash: string;
    capturedAt: string;
  }>;
}
```

### 9.3 范围规则

按顺序执行：

1. “整个视频、全片、整体、前半段、后半段” → `project`
2. 明确“第 N 镜” → 指定 `frame`
3. “这个、这里、这张图、刚才那个”且有选中镜头 → 当前 `frame`
4. 有选中元素且指向标题、卡片、图片 → `element`
5. 节奏、风格一致性、开头、结尾 → `project`
6. 仍不确定 → 先展示准备检查的范围，不执行修改

### 9.4 服务端验证

客户端不得提交任意 HTML。

服务端必须：

1. 重新读取最新 Project。
2. 验证 frameId 属于当前 Outline。
3. 验证 elementId 存在于最新持久化 HTML。
4. 计算项目状态哈希。
5. 使用持久化 HTML、图片或 UI Scene 生成视觉证据。

### 9.5 视觉证据

- 复用现有 35%、70%、100% 采样。
- 单镜诊断可增加当前时间点证据。
- 全片先每镜一张代表帧。
- 只有风险镜头补三点采样。
- 缓存键至少包含 HTML/图片内容哈希、画布、时间点和采样版本。
- 内容规划类请求不采集画面。

### 9.6 UI

输入框上方显示一个可清除标签：

- `正在讨论：完整视频`
- `正在讨论：第 4 镜`
- `正在讨论：第 4 镜 · 主标题`

### 9.7 验收

- [ ] 选择第 3 镜后说“这个不好看”，范围为第 3 镜。
- [ ] 选中标题后说“这个小一点”，定位到标题。
- [ ] 说“整体太像 PPT”，范围为全片。
- [ ] 过期 frameId/elementId 被拒绝。
- [ ] 相同内容哈希复用视觉证据。
- [ ] 内容任务不截图。

---

## 10. 模块 4：AI 导演诊断

### 10.1 强制约束

导演诊断必须只读。

诊断阶段不得：

- 更新 Outline。
- 更新 VideoSource。
- 替换素材。
- 生成配音。
- 生成 HTML。
- 自动调用 ChangeSet Apply。

### 10.2 两阶段诊断

阶段一：确定性检查，不调用 AI。

检查：

- 字幕遮挡
- 文字越界
- 元素重叠
- 信息密度
- 单镜旁白时长
- 图片缺失或损坏
- 空画面
- 镜头时长异常
- 重复布局
- 风格明显不一致

阶段二：只在需要时调用视觉模型。

处理：

- 太像 PPT
- 廉价
- 没重点
- 图片与旁白不相关
- 视觉节奏不合理
- 整体风格不统一

### 10.3 输出类型

```ts
export interface DirectorDiagnosis {
  version: 'director-diagnosis-v1';
  scope: {
    type: 'project' | 'frame' | 'element';
    frameIds: string[];
  };
  summary: string;
  issues: Array<{
    id: string;
    category: 'content' | 'rhythm' | 'visual' | 'readability' | 'asset' | 'audio';
    severity: 'minor' | 'important' | 'blocking';
    userFacingExplanation: string;
    evidenceFrameIds: string[];
    technicalEvidence?: Record<string, unknown>;
  }>;
  options: Array<{
    id: string;
    label: string;
    description: string;
    intensity: 'light' | 'recommended' | 'redesign';
    expectedImpact: string;
  }>;
  recommendedOptionId: string;
  baseStateHash: string;
}
```

### 10.4 UI

默认只突出一个推荐方案。

卡片操作：

- 按推荐方案修改
- 轻微调整
- 重新设计
- 先不改

技术证据折叠显示。

### 10.5 模型限制

- 视觉诊断必须使用具备视觉输入能力的模型。
- DeepSeek 不得用于视觉诊断。
- 没有视觉模型时仍可返回确定性检查结果，并明确说明视觉诊断不可用。
- 诊断失败不得修改或清空当前视频。

### 10.6 验收

- [ ] “不好看、太乱、节奏慢、像 PPT”得到具体解释。
- [ ] 诊断不修改项目。
- [ ] 每次只突出一个推荐方案。
- [ ] 项目变化后旧诊断标记过期。
- [ ] DeepSeek 不进入视觉链路。
- [ ] 视觉失败保留规则检查结果。

---

## 11. 模块 5：安全修改

### 11.1 标准链路

```text
用户要求或导演诊断
→ 生成 ChangeSet
→ 程序计算影响范围
→ 用户确认
→ 校验 baseStateHash
→ 创建 ProjectCheckpoint
→ 事务性应用结构修改
→ 调度受影响镜头
→ 写入 resultStateHash
→ 提供撤销
```

### 11.2 受控操作

```ts
export type ChangeSetOperation =
  | { type: 'update_frame_text'; frameId: string; title?: string; narration?: string }
  | { type: 'add_frame'; afterFrameId?: string; draft: FrameOutline }
  | { type: 'delete_frame'; frameId: string }
  | { type: 'split_frame'; frameId: string; frames: FrameOutline[] }
  | { type: 'merge_frames'; frameIds: string[]; frame: FrameOutline }
  | { type: 'regenerate_visual'; frameId: string; reason: string }
  | { type: 'regenerate_audio'; frameId: string; reason: string }
  | { type: 'replace_asset'; frameId: string; assetId: string }
  | { type: 'tune_element'; frameId: string; command: EditCommand }
  | { type: 'update_project_style'; styleId: string };
```

AI 只能返回允许的操作，不得返回完整 Project JSON 覆盖数据库。

### 11.3 影响计算

```ts
export interface ChangeImpact {
  affectedFrameIds: string[];
  outlineChanged: boolean;
  visualRegenerationCount: number;
  audioRegenerationCount: number;
  assetReplacementCount: number;
  preservedFrameCount: number;
  estimatedStageCount: number;
  warnings: string[];
}
```

影响数量必须由程序确定性计算，不能信任模型自报数量。

### 11.4 状态哈希

新增稳定的项目状态哈希函数，至少覆盖：

- Outline
- VideoSource
- styleId
- contentStyle
- gptOptimization
- ProjectBrief
- 素材绑定

要求：

- JSON 先稳定排序再哈希。
- ChangeSet 保存 `baseStateHash`。
- Apply 前重新计算；不一致则状态改为 `stale`。
- Apply 完成后保存 `resultStateHash`。

### 11.5 检查点

快照包含：

- Outline
- VideoSource
- styleId
- contentStyle
- gptOptimization
- ProjectBrief
- 素材绑定

写入顺序：

1. 写临时 gzip 文件。
2. 计算 SHA-256。
3. 原子重命名。
4. 创建数据库记录。
5. 执行项目修改。

### 11.6 Apply

- 先验证 ChangeSet 状态是 `proposed`。
- 先验证 `baseStateHash`。
- 结构修改在 Prisma transaction 中完成。
- 事务提交后再调度画面和音频任务。
- 单镜生成失败不撤销已经应用的结构修改。
- 生成失败后允许只重试失败镜头。
- 不得重复执行已经应用的 split/merge/delete。

### 11.7 Revert

P0 只保证撤销最近一次项目级 AI 修改。

- 当前状态等于 `resultStateHash` 时可直接恢复。
- 当前状态不等于 `resultStateHash` 时禁止静默恢复。
- 必须提示恢复会覆盖后续修改。
- 恢复前验证快照哈希和引用媒体存在。
- 恢复完成后更新 Project、ChangeSet 和 Checkpoint 状态。

### 11.8 保留策略

- 每项目保留最近 20 个检查点，或 30 天。
- 被有效检查点引用的媒体不得清理。
- 清理前扫描当前项目和所有有效检查点引用。
- 先从最旧且无引用检查点开始清理。

### 11.9 迁移现有草稿

按以下顺序逐步适配：

1. 新的全片诊断和批量修改先使用 ChangeSet。
2. 拆分和合并草稿接入 ChangeSet。
3. 新增、删除和重写分镜接入 ChangeSet。
4. 最后将轻量微调接入统一检查点。

不得一次性删除现有草稿实现。

### 11.10 验收

- [ ] 批量修改显示影响范围。
- [ ] Apply 前必有检查点。
- [ ] 过期 ChangeSet 不能应用。
- [ ] 修改失败不破坏检查点。
- [ ] 撤销恢复 Outline、VideoSource 和素材引用。
- [ ] 重试不重复执行结构修改。
- [ ] 被检查点引用的媒体不被清理。

---

## 12. 模块 6：可靠任务控制

### 12.1 API

```text
POST /api/projects/{id}/agent-runs
GET  /api/projects/{id}/agent-runs/{runId}
POST /api/projects/{id}/agent-runs/{runId}/cancel
POST /api/projects/{id}/agent-runs/{runId}/retry
POST /api/projects/{id}/agent-runs/{runId}/resume
```

P0 使用 750～1000ms 轮询持久化状态。

不要为了 P0 强制引入 SSE；后续可以在不改变 Run 数据模型的前提下增加。

### 12.2 取消

服务端维护：

```ts
Map<runId, AbortController>
```

取消顺序：

1. 客户端调用 cancel。
2. 数据库写 `cancelRequestedAt`。
3. UI 状态进入 `cancelling`。
4. 服务端按 runId 调用 `AbortController.abort()`。
5. 所有上游模型和子任务传递同一 signal。
6. 每个任务边界检查数据库取消标记。
7. 最终写 `cancelled`。
8. 已完成 Artifact 保留。

### 12.3 重试

- 只创建失败任务和必要依赖。
- 使用 `role + inputHash` 复用已完成 Artifact。
- 新 Run 保存 `retryOfRunId`。
- 结构修改已经应用时，只重试画面或音频，不再重复 Apply。

### 12.4 恢复

- 服务启动或创建同类任务时，将数据库遗留 `running` 标记为 `interrupted`。
- UI 显示“上次任务被中断”。
- 用户点击继续后创建新 Run，并保存 `resumeOfRunId`。
- 已完成任务通过输入哈希复用。
- 不允许永久显示无实际进程的 `running`。

### 12.5 幂等

- `projectId + clientRequestId` 唯一。
- 双击发送只创建一个 Run。
- 网络超时重发相同 ID 返回同一个 Run。
- Apply 通过 ChangeSet 状态二次防重。

### 12.6 UI

发送按钮状态：

- 空闲：发送
- 创建任务：加载
- 运行：停止
- 正在取消：禁用并显示“正在停止”
- 失败：消息卡显示重试
- 中断：消息卡显示继续

普通错误文案必须给出下一步，不直接只显示 502、JSON parse error 或 Response ID。

### 12.7 验收

- [ ] 普通 AI 对话请求可停止。
- [ ] 取消信号传到实际上游调用。
- [ ] 双击发送只创建一个 Run。
- [ ] 刷新页面后仍显示任务状态。
- [ ] 服务重启后旧任务为 interrupted。
- [ ] 失败镜头可独立重试。
- [ ] 恢复不重复生成已完成镜头。
- [ ] 错误信息提供可执行下一步。
- [ ] 取消后 1 秒内进入 cancelling。

---

## 13. 前端消息类型

扩展 `MessageMetadata`：

```ts
export type MessageMetadata =
  | ExistingMessageMetadata
  | { kind: 'asset_summary'; assets: AssetSummary[] }
  | { kind: 'clarification'; question: BriefQuestion; actions: MessageAction[] }
  | { kind: 'brief_review'; brief: ProjectBrief; actions: MessageAction[] }
  | { kind: 'director_diagnosis'; diagnosis: DirectorDiagnosis; actions: MessageAction[] }
  | { kind: 'change_set'; changeSet: ChangeSetSummary; actions: MessageAction[] }
  | { kind: 'agent_run'; runId: string; status: AgentRunStatus; actions?: MessageAction[] }
  | { kind: 'checkpoint'; checkpointId: string; canRevert: boolean; actions: MessageAction[] };
```

对应组件建议：

```text
src/components/chat/asset-attachments/
src/components/chat/brief-cards/
src/components/chat/diagnosis-cards/
src/components/chat/change-set-cards/
src/components/chat/run-status-card.tsx
src/components/chat/context-chip.tsx
```

不要把所有卡片继续堆进 `chat-panel.tsx`。

---

## 14. 开发顺序

必须按以下阶段推进。

### 阶段 0：基础设施

交付：

- Prisma migration
- 公共类型
- 项目状态哈希
- ProjectCheckpoint 读写
- AgentRun 扩展
- AbortController registry
- 功能开关

出口条件：

- 可以创建和恢复测试检查点。
- 可以创建、查询和取消测试 Run。
- 旧项目仍能打开。

### 阶段 1：附件

交付：

- 上传 API
- 文件安全校验
- 本地存储
- DOCX/MD/TXT 解析
- 图片元数据
- 摘要与用途
- 输入器附件 UI

出口条件：

- 六种白名单格式可用。
- 没有 GIF/PDF/OCR/URL 路径。
- 附件可以随消息提交。

### 阶段 2：智能简报

交付：

- Brief Resolver
- 澄清策略
- 简报卡片
- 持久化
- Brief → Outline 编译

出口条件：

- 主题输入和资料输入都能进入现有大纲生成。

### 阶段 3：画面上下文

交付：

- PlaybackContext
- Context Snapshot
- 范围解析
- 服务端验证
- 视觉证据缓存
- 上下文标签

出口条件：

- “这个/这里/整体”范围正确。

### 阶段 4：导演诊断

交付：

- 确定性检查
- 视觉诊断
- 结构化结果
- 推荐方案卡片
- 过期处理

出口条件：

- 诊断只读且能处理非专业反馈。

### 阶段 5：安全修改

交付：

- ChangeSet
- Impact
- Checkpoint
- Apply
- Revert
- 现有草稿适配

出口条件：

- 可预览、可应用、可撤销。

### 阶段 6：整合与回归

交付：

- 停止、重试、恢复 UI
- 全链路错误文案
- API 集成测试
- E2E 测试
- README

出口条件：

- 六个模块形成完整闭环。

---

## 15. 测试计划

### 15.1 单元测试

必须覆盖：

#### 附件

- 文件签名
- MIME 伪造
- 路径越界
- DOCX 解压限制
- 文本编码
- 内容分块
- SHA-256 去重
- 删除引用
- GIF/PDF 拒绝
- URL 输入拒绝

#### 简报

- 默认值
- 高影响缺失项
- 最大两轮
- 让 AI 决定
- 附件摘要合并
- Outline 编译

#### 上下文

- 当前镜
- 当前元素
- 全片
- 指代词
- 过期 ID
- 状态哈希变化
- 证据缓存

#### 诊断

- 只读
- 无视觉模型回退
- DeepSeek 拒绝
- 推荐唯一
- 诊断过期

#### ChangeSet

- 影响计算
- 状态哈希冲突
- 创建检查点
- Apply
- Revert
- 后续修改后禁止直接撤销
- 媒体引用保留

#### AgentRun

- 幂等
- cancel
- cancelling
- failed-only retry
- interrupted
- resume
- Artifact 复用

### 15.2 API 集成场景

1. 上传 DOCX → 处理完成 → 随消息发送。
2. 上传产品图片 → 推断为 visual。
3. 上传 GIF → 415/400，明确不支持。
4. 上传 PDF → 415/400，明确不支持。
5. 提交 URL 形式附件 → Schema 拒绝。
6. 损坏 DOCX → failed → retry。
7. 生成 Brief → 用户选择 → confirmed。
8. 选中分镜 → “这个不好看” → 当前镜诊断。
9. “整体节奏慢” → 全片诊断。
10. 推荐方案 → ChangeSet → Apply。
11. Apply 后 Revert → 状态精确恢复。
12. ChangeSet 生成后项目更新 → Apply 被拒绝。
13. Run 运行中取消。
14. 重启后 interrupted → resume。

### 15.3 端到端场景

#### 场景 A：只有主题

```text
帮我做一个 1 分钟介绍黑洞的视频。
```

验收：最多一个问题，简报确认后生成。

#### 场景 B：DOCX 加图片

```text
把这些产品资料和图片做成一条竖屏产品视频。
```

验收：文档作为内容来源，图片作为视觉素材；无专业配置。

#### 场景 C：当前镜头反馈

```text
这个看起来太像 PPT。
```

验收：锁定当前镜，先诊断，确认后修改，可撤销。

#### 场景 D：全片反馈

```text
整体有点拖沓。
```

验收：识别慢镜头，显示影响和预计新时长。

#### 场景 E：中断恢复

生成到一半关闭程序。

验收：完成镜头保留，重新打开后只继续未完成部分。

---

## 16. 功能开关

建议增加：

```text
NOVICE_AGENT_V2
PROJECT_ASSETS_V1
PROJECT_BRIEF_V1
CHAT_CONTEXT_V1
DIRECTOR_DIAGNOSIS_V1
PROJECT_CHANGESET_V1
PERSISTENT_CHAT_RUNS_V1
```

要求：

- 开发环境可分别启用。
- 默认先对新项目启用。
- 旧路径短期可回退。
- 功能开关不能导致两条链路同时写入同一个项目。

---

## 17. 上线顺序

1. 开发环境全部启用。
2. 新建测试项目启用。
3. 内部验证“资料 → 简报 → 视频”。
4. 默认启用附件和简报。
5. 灰度启用上下文和导演诊断。
6. 最后启用 ChangeSet 和项目级撤销。
7. 稳定后让旧 `/api/agent/chat` 委托给新 Run 系统。

---

## 18. 完成定义

只有以下条件全部满足，P0 才算完成：

- [ ] 用户可输入主题。
- [ ] 用户可上传 PNG、JPEG、WebP、DOCX、Markdown、TXT。
- [ ] 没有 GIF 支持。
- [ ] 没有 PDF 支持。
- [ ] 没有 OCR。
- [ ] 没有 URL 抓取或下载。
- [ ] AI 能生成并持久化 ProjectBrief。
- [ ] 最多两轮澄清。
- [ ] 用户可以选择“让 AI 决定”。
- [ ] AI 能自动识别当前镜、元素或全片上下文。
- [ ] 模糊反馈先诊断，不直接修改。
- [ ] 导演诊断只读。
- [ ] 所有批量修改通过 ChangeSet。
- [ ] Apply 前有 ProjectCheckpoint。
- [ ] 过期 ChangeSet 被拒绝。
- [ ] 最近一次 AI 修改可撤销。
- [ ] 所有耗时任务可停止。
- [ ] 失败任务可重试。
- [ ] 中断任务可恢复。
- [ ] 双击和网络重试不重复执行。
- [ ] 已完成 Artifact 可复用。
- [ ] 旧项目仍可打开。
- [ ] 大纲、分镜、Pexels、TTS、字幕、质量检查、预览和 MP4 导出回归通过。
- [ ] `README.md` 与最终功能同步。
- [ ] 相关 Vitest、TypeScript 检查和构建验证实际通过，或明确记录无法运行的原因。

---

## 19. 推荐验证命令

根据实际改动运行最接近的测试；最终至少运行：

```powershell
npm test
npx tsc --noEmit
npm run build
```

如果新增 Prisma migration：

```powershell
npm run db:generate
npm run db:migrate
```

交付前检查：

```powershell
git diff -- prisma src tests README.md
```

确认：

- 没有 `.env`、API Key、用户附件、生成媒体或数据库文件进入 Git。
- 没有 GIF、PDF、OCR、URL 处理代码意外进入 P0。
- README 只描述已经实现并验证的功能。

