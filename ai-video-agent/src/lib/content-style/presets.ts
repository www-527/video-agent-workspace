import type { ContentStylePreset } from './types';
import { DEFAULT_PLANNER_CORE_PROMPT, PLANNER_DEFAULT_VERSION } from './defaults';

export const DEFAULT_CONTENT_STYLE_PRESET_ID = 'strong-retention';

export const BUILTIN_CONTENT_STYLE_PRESETS: ContentStylePreset[] = [
  {
    id: 'strong-retention',
    name: '强留存口播',
    description: '3 秒钩子、快速兑现收益、节拍密集，并以一个具体行动收束。',
    plannerGuidance: [
      '第一拍开头必须直接使用 creativeBrief.hook.text，在前 3 秒建立明确钩子。',
      '前两拍必须清楚兑现 creativeBrief.valuePromise。',
      '每个相邻节拍必须增加新信息，不能换句重复。',
      '最后一拍只保留 creativeBrief.cta 中的一个具体行动。',
    ],
    qualityChecks: [
      { id: 'hook-3s', rule: '前 3 秒是否有明确钩子，且第一拍以 hook.text 开头', severity: 'required' },
      { id: 'promise-2beats', rule: '前两拍是否兑现收益承诺', severity: 'required' },
      { id: 'new-information', rule: '相邻节拍是否持续提供新信息', severity: 'required' },
      { id: 'single-cta', rule: '结尾是否只有一个具体 CTA', severity: 'required' },
    ],
    exampleStructure: ['痛点或反常识钩子', '立即兑现收益', '连续信息增量', '单一行动 CTA'],
    version: 1,
    source: 'builtin',
  },
  {
    id: 'knowledge-explainer',
    name: '知识科普',
    description: '结论先行，通过机制、案例和边界把知识讲清楚。',
    plannerGuidance: ['先给出核心结论，再解释机制。', '至少用一个案例或对比验证结论。', '说明适用边界，最后给出可执行建议。'],
    qualityChecks: [
      { id: 'clear-conclusion', rule: '开头是否给出清晰结论', severity: 'required' },
      { id: 'mechanism', rule: '是否解释为什么，而非只罗列现象', severity: 'required' },
      { id: 'evidence-example', rule: '是否有事实、案例或对比支撑', severity: 'required' },
      { id: 'actionable-advice', rule: '结尾建议是否具体可执行', severity: 'preferred' },
    ],
    exampleStructure: ['核心结论', '机制解释', '案例验证', '边界条件', '行动建议'],
    version: 1,
    source: 'builtin',
  },
  {
    id: 'opinion-commentary',
    name: '观点评论',
    description: '立场明确，同时提供论据、反例和讨论空间。',
    plannerGuidance: ['尽早亮明立场和判断标准。', '用不同类型的论据支撑观点。', '主动处理至少一个合理反例或反方观点。', '结尾提出具体讨论问题。'],
    qualityChecks: [
      { id: 'position', rule: '核心立场是否清晰且前后一致', severity: 'required' },
      { id: 'arguments', rule: '是否有足够论据而非只表达情绪', severity: 'required' },
      { id: 'counterexample', rule: '是否回应合理反例或限制条件', severity: 'preferred' },
      { id: 'avoid-absolute', rule: '是否避免无依据的绝对化判断', severity: 'required' },
    ],
    exampleStructure: ['亮明立场', '主要论据', '反例或反方', '综合判断', '讨论问题'],
    version: 1,
    source: 'builtin',
  },
  {
    id: 'story-narrative',
    name: '故事叙事',
    description: '以目标、阻碍和转折推进，最后留下结果与余味。',
    plannerGuidance: ['尽快建立具体人物或主体及其目标。', '阻碍必须逐步升级并推动选择。', '转折应来自前文铺垫，不能凭空出现。', '结尾回收核心冲突并保留余味。'],
    qualityChecks: [
      { id: 'goal', rule: '主体和目标是否具体清楚', severity: 'required' },
      { id: 'obstacle', rule: '阻碍是否真实推动叙事', severity: 'required' },
      { id: 'turn', rule: '转折是否有铺垫且改变局面', severity: 'required' },
      { id: 'payoff', rule: '结果是否回收前文并留下余味', severity: 'preferred' },
    ],
    exampleStructure: ['主体与目标', '阻碍升级', '关键选择', '转折', '结果与余味'],
    version: 1,
    source: 'builtin',
  },
  {
    id: 'brand-recommendation',
    name: '品牌种草',
    description: '从真实使用场景和细节出发，突出体验价值并弱化硬广。',
    plannerGuidance: ['从目标用户的具体使用场景切入。', '用可感知的真实细节说明体验。', '把功能转译为用户价值。', '避免口号、夸张承诺和连续品牌堆叠。'],
    qualityChecks: [
      { id: 'usage-scene', rule: '使用场景是否具体', severity: 'required' },
      { id: 'credible-detail', rule: '体验细节是否可信且可感知', severity: 'required' },
      { id: 'value', rule: '是否把功能转化为用户价值', severity: 'required' },
      { id: 'soft-sell', rule: '是否避免硬广套话和无依据承诺', severity: 'required' },
    ],
    exampleStructure: ['使用场景', '真实困扰', '体验细节', '价值变化', '自然建议'],
    version: 1,
    source: 'builtin',
  },
  {
    id: 'custom-only',
    name: '自定义',
    description: '不添加特定内容风格，只应用用户自己的规则和固定运行契约。',
    plannerGuidance: [],
    qualityChecks: [],
    exampleStructure: ['按照用户要求组织内容'],
    version: 1,
    source: 'builtin',
  },
];

export function mergeContentStylePresets(customPresets: ContentStylePreset[]): ContentStylePreset[] {
  const builtinIds = new Set(BUILTIN_CONTENT_STYLE_PRESETS.map(preset => preset.id));
  return [
    ...BUILTIN_CONTENT_STYLE_PRESETS,
    ...customPresets.filter(preset => !builtinIds.has(preset.id)).map(preset => ({ ...preset, source: 'custom' as const })),
  ];
}

export function findContentStylePreset(id: string, customPresets: ContentStylePreset[]): ContentStylePreset {
  const presets = mergeContentStylePresets(customPresets);
  return presets.find(preset => preset.id === id)
    || presets.find(preset => preset.id === DEFAULT_CONTENT_STYLE_PRESET_ID)!;
}

export function buildDefaultPlannerPrompt(preset: ContentStylePreset): string {
  const styleRules = preset.plannerGuidance.length
    ? preset.plannerGuidance.map((rule, index) => `${index + 1}. ${rule}`).join('\n')
    : '按照用户明确要求组织内容，不额外套用固定表达模板。';
  return `${DEFAULT_PLANNER_CORE_PROMPT}\n\n【${preset.name}的内容规划方式】\n${preset.description}\n${styleRules}`;
}

export function plannerDefaultVersionForPreset(preset: ContentStylePreset): string {
  return `${PLANNER_DEFAULT_VERSION}:${preset.id}:v${preset.version}`;
}
