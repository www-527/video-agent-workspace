import { describe, expect, it } from 'vitest';
import { applyDirectorResult, normalizeSceneSpec } from '@/lib/ai/director';
import type { FrameOutline, Outline } from '@/types';
import { runWithAIKeySnapshot } from '@/lib/ai-key-context';

const gptCredential = {
  id: 'gpt', name: 'GPT', apiKey: 'sk-gpt', model: 'gpt-5.6-terra', baseURL: 'https://relay.example/v1', source: 'saved' as const,
  apiProtocol: 'auto' as const,
  gptOptimization: { enabled: true, useResponsesAPI: true, allowChatFallback: true, reasoningProfile: 'balanced' as const, creativeFreedom: 'balanced' as const, internalImageSearch: true },
};

const frame: FrameOutline = {
  id: 'frame-1',
  index: 1,
  title: '效率对比',
  narration: '传统流程需要十分钟，而自动化之后只需要一分钟。',
  htmlPrompt: '对比传统流程和自动流程的耗时。',
};

describe('normalizeSceneSpec', () => {
  it('旧项目没有 SceneSpec 时生成兼容兜底', () => {
    const spec = normalizeSceneSpec(frame);
    expect(spec.relationship).toBe('compare');
    expect(spec.focus).toBe('效率对比');
    expect(spec.informationPool[0]).toContain('传统流程');
    expect(spec.durationHint).toBeGreaterThanOrEqual(3);
    expect(spec.visualRole).toBe('explain');
    expect(spec.realImagePriority).toBe('never');
  });

  it('does not turn a missing visual-director result into a generic override prompt', () => {
    const spec = normalizeSceneSpec({
      id: 'frame-without-prompt',
      index: 1,
      title: '付款前，先做这一步',
      narration: '核对收款人、金额和备注后再确认付款。',
    });

    expect(spec.visualIntent).toBe('');
  });

  it('keeps native visuals out of the real-image candidate pool', () => {
    const spec = normalizeSceneSpec(frame, {
      assetStrategy: 'chart',
      visualRole: 'human-proof',
      realImagePriority: 'required',
    });
    expect(spec.visualRole).toBe('human-proof');
    expect(spec.realImagePriority).toBe('never');
    expect(spec.imagePurpose).toBeTruthy();
  });

  it('repairs tangible product and historical-scene frames misclassified as css-svg', () => {
    const spec = normalizeSceneSpec({
      ...frame,
      title: '可乐的发明与产品包装',
      narration: '药剂师发明了可乐，后来形成独特的瓶子和品牌包装。',
    }, {
      assetStrategy: 'css-svg',
      visualRole: 'explain',
      realImagePriority: 'never',
    });
    expect(spec.assetStrategy).toBe('real-image');
    expect(['context', 'human-proof', 'physical-proof']).toContain(spec.visualRole);
    expect(spec.realImagePriority).toBe('required');
  });

  it('keeps mechanical process diagrams native but repairs tangible transmission comparisons', () => {
    const process = normalizeSceneSpec({
      ...frame,
      title: '发动机四冲程',
      narration: '进气、压缩、做功、排气依次发生。',
    }, { relationship: 'process', assetStrategy: 'css-svg', visualRole: 'explain' });
    expect(process.assetStrategy).toBe('css-svg');
    expect(process.realImagePriority).toBe('never');

    const comparison = normalizeSceneSpec({
      ...frame,
      title: 'AT、CVT 与 DCT 变速箱',
      narration: '三种真实机械总成的结构与驾驶感受不同。',
    }, { relationship: 'compare', assetStrategy: 'chart', visualRole: 'explain' });
    expect(comparison.assetStrategy).toBe('real-image');
    expect(comparison.visualRole).toBe('physical-proof');
    expect(comparison.realImagePriority).toBe('preferred');
  });

  it('retains precise co-equal image subjects from the director', () => {
    const spec = normalizeSceneSpec(frame, {
      assetStrategy: 'real-image',
      visualRole: 'context',
      assetSubjects: [
        { name: 'city commute', kind: 'context', query: 'car driving urban traffic', fallbackQuery: 'city commuter car street', required: true },
        { name: 'highway travel', kind: 'context', query: 'car driving open highway', fallbackQuery: 'road trip car highway', required: true },
        { name: 'invalid abstract label', kind: 'context', query: '抽象概念', fallbackQuery: '抽象概念图', required: true },
      ],
    });
    expect(spec.assetSubjects).toHaveLength(2);
    expect(spec.assetSubjects?.map(subject => subject.query)).toEqual([
      'car driving urban traffic',
      'car driving open highway',
    ]);
  });

  it('过滤非法关系并限制时长', () => {
    const spec = normalizeSceneSpec(frame, {
      relationship: 'unknown' as any,
      durationHint: 999,
      screenText: ['10 分钟', '1 分钟'],
    });
    expect(spec.relationship).toBe('compare');
    expect(spec.durationHint).toBe(20);
    expect(spec.screenText).toEqual(['10 分钟', '1 分钟']);
  });

  it('rejects an empty ui-scene only in GPT optimization mode', () => {
    const spec = runWithAIKeySnapshot(gptCredential, () => normalizeSceneSpec({
      ...frame,
      title: '古代遗址的三种解释',
      narration: '考古证据显示这里存在多层历史遗迹。',
    }, {
      renderMode: 'ui-scene',
      uiArchetype: 'overview',
      uiData: {},
    }));
    expect(spec.renderMode).toBe('html');
    expect(spec.uiData).toBeUndefined();
  });

  it('allows a populated non-business ui-scene in GPT optimization mode', () => {
    const spec = runWithAIKeySnapshot(gptCredential, () => normalizeSceneSpec({
      ...frame,
      title: '汉堡组合是怎么变化的',
      narration: '观众依次查看经典款、地区款和限时款。',
    }, {
      renderMode: 'ui-scene',
      uiArchetype: 'master-detail',
      uiData: { items: ['经典款', '地区款', '限时款'] },
    }));
    expect(spec.renderMode).toBe('ui-scene');
    expect(spec.uiData).toEqual({ items: ['经典款', '地区款', '限时款'] });
  });
});

describe('applyDirectorResult', () => {
  it('按 index 合并编导结果并保留原分镜', () => {
    const outline: Outline = { title: '自动化', totalDuration: 30, frames: [frame] };
    const result = applyDirectorResult(outline, {
      directorPlan: { coreMessage: '自动化把时间还给人' },
      frames: [{
        index: 1,
        sceneSpec: {
          relationship: 'metric',
          focus: '十倍提速',
          informationPool: ['10 分钟 → 1 分钟'],
          visualIntent: '让时间差一眼可见',
          screenText: ['10×'],
          assetHints: [],
          durationHint: 7,
        },
      }],
    });

    expect(result.frames[0].id).toBe('frame-1');
    expect(result.frames[0].sceneSpec?.relationship).toBe('metric');
    expect(result.directorPlan?.coreMessage).toBe('自动化把时间还给人');
  });
});
