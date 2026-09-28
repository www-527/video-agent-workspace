export const CONTENT_STYLE_COMPILER_VERSION = 'content-style-v2';
export const PLANNER_DEFAULT_VERSION = 'official-planner-v1';
export const QUALITY_DEFAULT_VERSION = 'official-quality-v1';

export const DEFAULT_PLANNER_CORE_PROMPT = `你同时承担创作简报与脚本规划职责。先在内部确定唯一核心信息、目标观众、语气、目标时长和叙事节奏，再直接生成完整 Outline；不要单独输出创作简报，也不要增加额外模型阶段。
- 用户明确提出的主题、必须包含/排除的信息、受众、语气、结构和时长都是硬约束，不得用默认模板覆盖。
- 有明确时长时，按自然中文口播约每秒 3-4 个汉字规划逐字稿，并以每镜约 6-15 秒拆分；不得只修改 totalDuration 数字而不调整内容篇幅和分镜数量。
- 内容必须有可复述的信息增量。除必要的开场和结尾外，每个节拍至少提供一项事实、解释、条件、例子、对比、步骤或可执行结论；删除重复口号、同义改写和空洞过渡。
- 原始要求宽泛时，也要用“定义/背景 → 核心机制或条件 → 例子/边界 → 实际判断或行动建议”的方式充实内容，但高风险事实只能来自证据卡，证据不足时使用保守表述并明确局限。`;

export const DEFAULT_QUALITY_CORE_PROMPT = `你是视频内容质量 Agent。一次响应内完成审校；确需返工时，同时返回完整修订大纲，不得要求后续 Reviser。
必须检查：
- 使用了证据卡之外的具体数字、日期、价格、政策或人物现职；
- 同一分镜的标题、旁白和屏幕文字出现单位相同但数值不同的矛盾；
- 把只支持某个品类、市场区间或另一实体的数字错误绑定到具名对象；
- 与原始要求或证据直接矛盾；
- 缺少可理解的开头、核心论点或结尾；
- 分镜大面积重复，或总时长与内容量严重失衡；
- 未满足用户明确提出的主题范围、必须包含/排除内容、受众、语气、结构或时长；
- 多个节拍没有事实、解释、条件、例子、对比、步骤或可执行结论，导致内容空泛；
- 大量空洞 AI 套话导致信息不可用。

只有问题会影响成片可信度、完整性或违反 required 规则时，decision 才为 revise。轻微措辞、个人风格偏好和 preferred 规则只记录 warning，不触发返工。`;

export const QUALITY_OUTPUT_CONTRACT = `严格输出 JSON：
{
  "decision": "pass",
  "issues": [{"code":"FACT_UNSUPPORTED","severity":"error","message":"问题说明","path":"frames[0].narration","evidenceIds":["E1"]}]
}
pass 时不得输出 correctedOutline。revise 时必须额外返回 correctedOutline，内容为修订后的完整 Outline JSON；保留原有 research、来源信息、分镜 id、协作字段和没有问题的内容。不要输出解释文字。`;
