import { describe, expect, it, vi } from 'vitest';
import { modifyFrameContent } from '@/lib/ai/frame-ops';
import type { FrameOutline, Outline, SceneSpec } from '@/types';

const oldSceneSpec: SceneSpec = {
  relationship: 'metric',
  focus: '中国市场规模',
  revealStrategy: 'progressive',
  focalElement: '中国地图轮廓中央的柱状条',
  composition: 'establish',
  actionSemantics: '地图中心长出柱状条',
  assetStrategy: 'css-svg',
  informationPool: ['中国市场', '125.35 亿美元', '+5%'],
  visualIntent: '在地图上展示中国市场增长',
  screenText: ['125.35 亿', '+5%'],
  assetHints: ['中国地图', '地图轮廓', '柱状条'],
  durationHint: 6,
  prohibitedPatterns: ['卡片墙'],
};

const oldFrame: FrameOutline = {
  id: 'frame-4',
  index: 4,
  title: '中国市场的规模与增长',
  narration: '中国市场规模达到 125.35 亿美元，同比增长 +5%，增长趋势已经确认。',
  htmlPrompt: '主角：中国地图轮廓中央的柱状条；关系：地图中心长出柱状条；屏幕文字：125.35 亿 / +5%',
  sceneSpec: oldSceneSpec,
};

const outline: Outline = {
  title: '市场观察',
  totalDuration: 30,
  sourceMaterial: '这是一份关于中国市场规模、增长和后续业务影响的原始分析材料。',
  creativeBrief: {
    targetAudience: '关注市场增长的业务负责人',
    viewerPainPoint: '难以判断增长是否可靠',
    valuePromise: '看懂规模与增长的业务意义',
    coreMessage: '增长需要被事实验证',
    hook: { type: 'result', text: '增长已经被数据坐实。' },
    proofPlan: '用市场规模与同比增速证明',
    cta: '继续审视增长的业务影响',
  },
  directorPlan: {
    coreMessage: '增长需要被事实验证',
    audience: '业务负责人',
    tone: '清晰可信',
    pacing: '先确认数据，再解释影响',
    visualGrammar: '关键事实用有层次的结构关系表达',
  },
  frames: [
    { id: 'frame-3', index: 3, title: '进入关键市场', narration: '接下来观察核心区域的实际表现。' },
    oldFrame,
    { id: 'frame-5', index: 5, title: '增长意味着什么', narration: '下一步把增长放回业务结果中解释。' },
  ],
  beats: [
    { id: 'beat-3', chapterId: 'chapter-1', order: 3, narration: '前情', purpose: '引出区域表现', frameId: 'frame-3' },
    { id: 'beat-4', chapterId: 'chapter-1', order: 4, narration: oldFrame.narration, purpose: '确认地区规模与增速', frameId: 'frame-4' },
    { id: 'beat-5', chapterId: 'chapter-1', order: 5, narration: '后续', purpose: '解释业务影响', frameId: 'frame-5' },
  ],
};

const rewrittenCopy = {
  title: '增长由数据坐实',
  narration: '先看结果：+5% 的变化让 125.35 亿这一规模成为中国市场最直接的增长证据。',
};

const mapVisual = {
  htmlPrompt: '主角：中国地图轮廓上的柱状条；关系：柱状条在地图上升高；屏幕文字：仅标题',
  sceneSpec: { ...oldSceneSpec },
};

const safeModelVisual = {
  htmlPrompt: '主角：125.35 亿大数字与 +5% 增长标记；关系：单指标的规模确认；屏幕文字：仅标题“增长由数据坐实”',
  sceneSpec: {
    relationship: 'metric',
    focus: '中国市场规模与增速',
    revealStrategy: 'single',
    focalElement: '125.35 亿大数字与 +5% 增长标记',
    composition: 'resolve',
    actionSemantics: '核心数值稳定建立，变化标记随后完成确认',
    assetStrategy: 'chart',
    informationPool: ['中国市场', '125.35 亿美元', '+5%'],
    visualIntent: '用单指标确认中国市场的规模与增长',
    screenText: ['增长由数据坐实'],
    assetHints: ['大数字', '增长标记'],
    durationHint: 6,
    prohibitedPatterns: ['禁止地图'],
  } satisfies SceneSpec,
};

const conceptFrame: FrameOutline = {
  id: 'frame-2',
  index: 2,
  title: '先分清：AI Native',
  narration: 'AI Native 不是在现有产品上增加 AI 功能，而是让 AI 成为产品内核。',
  htmlPrompt: '主角：既有产品边缘外挂的 AI 功能模块；关系：外挂功能与原生内核的区别；屏幕文字：仅标题',
  sceneSpec: {
    relationship: 'compare',
    focus: 'AI Native 与 AI-enabled 的结构差别',
    revealStrategy: 'contrast',
    focalElement: '既有产品边缘外挂的 AI 功能模块',
    composition: 'conflict',
    actionSemantics: '外挂模块停留在系统外侧',
    assetStrategy: 'css-svg',
    informationPool: ['AI Native', 'AI-enabled'],
    visualIntent: '观众理解 AI Native 不是外挂功能',
    screenText: [],
    assetHints: ['系统外框', '外挂模块'],
    durationHint: 6,
    prohibitedPatterns: ['卡片墙'],
  },
};

const conceptOutline: Outline = {
  title: 'AI Native',
  totalDuration: 18,
  sourceMaterial: 'AI Native 不是给现有产品叠加 AI 功能，而是从产品内核开始重构。',
  frames: [
    { id: 'frame-1', index: 1, title: '什么是 AI Native', narration: '先把概念说清楚。' },
    conceptFrame,
    { id: 'frame-3', index: 3, title: '为什么差别重要', narration: '接着看这种结构差异带来的能力变化。' },
  ],
};

const conceptCopy = {
  title: 'AI 应该长在内核里',
  narration: '重点不在新增一个 AI 功能，而在让 AI 从一开始就是产品能力的一部分。',
};

const invalidConceptMetricVisual = {
  htmlPrompt: '主角：AI Native 大数字；关系：单指标的规模确认；屏幕文字：仅标题“AI 应该长在内核里”',
  sceneSpec: {
    relationship: 'metric',
    focus: 'AI Native 的核心价值',
    revealStrategy: 'single',
    focalElement: 'AI Native 大数字',
    composition: 'resolve',
    actionSemantics: '核心数值稳定建立',
    assetStrategy: 'typography',
    informationPool: ['AI Native'],
    visualIntent: '用单指标确认 AI Native 的价值',
    screenText: ['AI 应该长在内核里'],
    assetHints: ['大数字'],
    durationHint: 6,
    prohibitedPatterns: ['卡片墙'],
  } satisfies SceneSpec,
};

function callerWith(responses: unknown[]) {
  const calls: Array<{ system: string; user: string; stage?: string }> = [];
  const caller = vi.fn(async (options: { system: string; user: string; stage?: string }) => {
    calls.push(options);
    return responses.shift();
  }) as any;
  return { caller, calls };
}

describe('HTML major rewrite flow', () => {
  it('recreates the target frame from project context without passing its old draft to either agent', async () => {
    const { caller, calls } = callerWith([rewrittenCopy, mapVisual]);
    const userRequirement = [
      '请基于第 3 镜的当前草稿大改一版，不要只做轻微润色。',
      '当前项目是 html 模式：请生成 htmlPrompt 和 sceneSpec，不要输出 imagePrompt。',
      '要求：重新设计叙事角度、旁白表达和画面意图；保留事实准确性和分镜主题，但句式、信息组织、视觉呈现都要明显不同。',
    ].join('\n');

    const result = await modifyFrameContent({
      type: 'html',
      outline,
      frameIndex: 1,
      userModification: userRequirement,
      conversationContext: '用户希望画面采用更强的视觉隐喻。',
      baselineFrame: oldFrame,
      aiJsonCaller: caller,
    });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.user).toContain(userRequirement);
    }
    expect(calls[1].user).toContain('【原始素材】');
    expect(calls[1].user).toContain('【创作简报】');
    expect(calls[1].user).toContain('【整片视觉总纲】');
    expect(calls[1].user).toContain('【本镜在叙事中的职责】');
    for (const call of calls) {
      expect(call.user).not.toContain(oldFrame.title);
      expect(call.user).not.toContain(oldFrame.narration);
      expect(call.user).not.toContain(oldFrame.htmlPrompt!);
    }
    expect(calls[0].user).toContain('【本镜待重新策划；不要参考旧标题、旧旁白或旧视觉方案】');
    expect(result).toMatchObject({
      ...rewrittenCopy,
      htmlPrompt: mapVisual.htmlPrompt,
      sceneSpec: mapVisual.sceneSpec,
    });
  });

  it('accepts an agent-chosen metric visual for a definition-only frame instead of enforcing a preset visual strategy', async () => {
    const { caller } = callerWith([conceptCopy, invalidConceptMetricVisual]);

    const result = await modifyFrameContent({
      type: 'html',
      outline: conceptOutline,
      frameIndex: 1,
      userModification: '请基于第 2 镜的当前草稿大改一版，不要只做轻微润色。',
      baselineFrame: conceptFrame,
      aiJsonCaller: caller,
    });

    expect(result).toMatchObject({
      ...conceptCopy,
      htmlPrompt: invalidConceptMetricVisual.htmlPrompt,
      sceneSpec: invalidConceptMetricVisual.sceneSpec,
    });
  });
});
