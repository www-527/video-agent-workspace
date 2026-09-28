# GPT Vision 图片搜索复选实施计划

## 目标

将当前“GPT 生成检索意图 + Pexels 元数据规则选第一名”升级为“规则预筛 + GPT Vision 候选复选 + 图片辅助 HTML 构图”。

模型不获得任意网页访问能力；它只能在程序已经从 Pexels 检索、来源检查并限制好的候选集合里作视觉判断。授权、文件哈希、验证等级、必需素材策略和导出门禁仍由程序控制。

## 当前基线

```text
SceneSpec.assetRequest / assetSubjects
  → Pexels 查询、缓存、限流
  → alt / 尺寸 / 比例 / 必需词 / 重复素材规则评分
  → 下载规则排名前三的候选
  → 直接采用规则第一名
  → 以本地路径和元数据生成 HTML
```

规则能过滤低分辨率、错误画幅、重复图片和元数据不匹配的候选，却无法判断实体身份、主体大小、遮挡、人物朝向、文字留白、裁切风险和画面风格。因此视觉能力应介入候选选择，而不只用于生成后的截图修复。

## 决策与边界

- 保留 Pexels 为唯一图库来源；不调用或注册模型 `web_search`。
- 规则仍是强制第一层：来源、下载、最小分辨率、画幅比例、去重、必需词与排除词不由模型放宽。
- 每个实际搜图镜头在规则通过的 3–4 张候选中，最多进行一次 GPT Vision 复选。
- 模型不支持图像、超时、取消、无效 JSON 或选择越界时，回落到现有规则第一名；不增加重试、不换 Key 或协议。
- 标准 HTML 与 GPT-free 共用图库、视觉复选和审计；两条工作流保持各自的 HTML 提示词和安全校验。
- 首版复用“GPT 内部搜图能力”开关，不新增第二个设置。

## 目标流程

```text
GPT 编导生成精确检索意图
  → Pexels 搜索（缓存、限流、来源检查）
  → 确定性规则预筛，保留 3–4 张
  → GPT Vision 一次候选复选
  → 下载主选及有限备选，保存审计
  → 将主选图片作为实际图像输入给 HTML 生成
  → 现有三采样点视觉审片/修复
```

视觉复选输入包括镜头标题、旁白、`assetRequest` 的必需/排除词、画幅、目标构图、候选图片和元数据。优先使用独立图像输入，以 `photoId` 和输入顺序建立稳定映射；若中转站不支持多图输入，才考虑经单独验证的 contact sheet 兼容分支。

## 数据契约

在 `SmartImageSelection` 的审计数据中新增可选字段：

```ts
type VisionImageReview = {
  status: 'accepted' | 'fallback' | 'unavailable';
  selectedPhotoId?: number;
  backupPhotoIds: number[];
  subjectMatch: 'high' | 'medium' | 'low';
  safeTextSide?: 'left' | 'right' | 'top' | 'bottom' | 'none';
  subjectPosition?: 'left' | 'center' | 'right' | 'mixed';
  cropRisk: 'low' | 'medium' | 'high';
  rationale: string;
  rejections: Array<{ photoId: number; reason: string }>;
  model?: string;
  elapsedMs?: number;
};
```

主选与备选必须来自本次规则通过的候选集；备选必须去重且不包含主选。理由限制长度；绝不保存 Base64、远程 URL 或模型思维链。任何校验失败都生成 `fallback` 审计，并使用规则第一名。

## 阶段 1：复选契约、校验与回退

文件：`src/types/index.ts`、`src/lib/pexels/vision-review.ts`、`tests/vision-image-review.test.ts`。

1. 定义请求、响应、枚举、文本长度和候选数限制。
2. 编写纯校验函数，验证主选、备选、拒绝项均属于候选集合。
3. 定义稳定回退：无效结果采用规则排序第一项，状态写为 `fallback`。

验收：覆盖有效选择、越界 `photoId`、重复备选、空结果、错误枚举和回退。

## 阶段 2：接入 Pexels 候选选择

文件：`src/lib/pexels/smart-images.ts`、`src/lib/ai/visual-image-selection.ts`、现有 AI client/Responses 图像输入适配层。

1. 保持 `assessPexelsCandidates` 为第一关，按规则分数保留不超过 4 张。
2. 以一次结构化视觉调用复选候选。
3. 校验后按“视觉主选 → 视觉备选 → 规则分数”重排。
4. 复用取消、超时、追踪和 GPT 专项推理档位；一镜只允许一次视觉请求。

验收：视觉模型不能访问候选以外的网站；每镜不超过一次调用和四张输入；不可用时不产生第二次上游请求。

## 阶段 3：下载、审计和编辑器选择

文件：`src/lib/pexels/smart-images.ts`、素材选择相关类型、组件与测试。

1. 下载主选和最多两个备选，主选始终位于 `realImages[0]`，维持现有渲染兼容性。
2. 将选择理由、拒绝理由、回退原因、模型标识和耗时写入 `imageSelection`。
3. 用户手动切换备选时保留原主选审计，不重新调用视觉模型。

验收：编辑器能解释选中/拒绝理由；手动切换不破坏本地路径、哈希、授权或验证等级。

## 阶段 4：图片辅助 HTML 构图

文件：`src/lib/ai/html.ts`、GPT-free 自由 HTML 路径、图像输入编码/Responses transport 共享适配层。

1. 将主选本地图片作为图像输入和 HTML 生成提示一起发送。
2. 把 `safeTextSide`、`subjectPosition`、`cropRisk` 作为构图建议写入提示词，不放宽安全区、真实性和“必须使用指定路径”的硬约束。
3. 多素材镜头按槽位传入并保持逐一图片引用校验；超过模型输入预算时明确回退到文字元数据路径。

验收：模型可利用主体位置和留白安排文字；最终 HTML 仍只引用程序提供的本地素材；不支持视觉输入时维持现有输出。

## 阶段 5：工作流回归与文档

覆盖标准 HTML 与 GPT-free 的搜图、复选、素材注入和图片引用；覆盖 `required` 素材的 block / needs-review / allow-native 语义、限流、下载失败、取消、视觉不可用、超时、无效 JSON、重复素材和整片预算。

README 需要说明：视觉复选提升相关性和构图适配，但不构成身份或事实真实性的最终证明。

## 验证

- 新增视觉复选纯函数、Pexels 选择、HTML 图像输入和 GPT-free 回归测试。
- 运行 `npm.cmd test -- --run tests/vision-image-review.test.ts tests/real-image-planner-recovery.test.ts` 及新增聚焦测试。
- 运行 `.\node_modules\.bin\tsc.cmd --noEmit`、完整 `npm.cmd test` 与 `git diff --check`。
- 手动使用人物、产品、地点三个主题分别生成标准 HTML 与 GPT-free 项目，确认理由可见、构图合理、备选可切换，且模型不可用时仍能规则回退。

## 风险与回滚

- 成本与时延：规则先筛，每镜最多一次复选、最多四张候选。
- 中转站兼容：不支持图片输入时只回退规则排序，不切换模型、Key 或协议。
- 隐私：仅将本项目检索的候选发送给当前项目模型；审计不保存 Base64、临时图像数据或推理过程。
- 回滚：视觉复选字段均为可选 JSON。关闭内部搜图或移除复选调用即可恢复当前规则选图，无数据库迁移和既有素材重写。

## 完成标准

1. 每个符合条件的搜图镜头能以一次视觉调用完成结构化候选复选。
2. 任意视觉故障下，结果与当前规则选图行为兼容。
3. 主选、备选、拒绝与回退可被编辑器和项目审计读取。
4. 入选图片能作为视觉输入帮助 HTML 构图，但 HTML 只能使用程序提供的本地素材。
5. 标准 HTML、GPT-free、取消、必需素材和导出相关回归测试通过。
