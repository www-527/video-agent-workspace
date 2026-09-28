import { describe, expect, it } from 'vitest';
import { normalizeSceneSpec } from '@/lib/ai/director';
import { applyHtmlPromptOverride } from '@/lib/ai/visual-prompt';
import type { FrameOutline } from '@/types';

describe('applyHtmlPromptOverride', () => {
  it('discards stale visual SceneSpec fields before regenerating a manually edited frame', () => {
    const frame = {
      id: 'frame-4',
      index: 4,
      title: '中国市场表现韧性',
      narration: '可口可乐在中国市场营收125.35亿美元，有机营收增长5%。',
      htmlPrompt: '主角：中国地图轮廓；关系：单指标；屏幕文字：仅标题',
      sceneSpec: {
        relationship: 'metric',
        focus: '中国市场表现韧性',
        revealStrategy: 'single',
        focalElement: '中国地图轮廓+数字125.35亿',
        composition: 'establish',
        actionSemantics: '地图轮廓浮现，关键数字出现',
        assetStrategy: 'icon',
        informationPool: ['中国市场营收125.35亿美元'],
        visualIntent: '用地图表示中国市场业绩',
        screenText: ['中国市场表现韧性'],
        assetHints: ['简化中国地图轮廓'],
        durationHint: 5,
        prohibitedPatterns: ['卡片墙'],
      },
    } satisfies FrameOutline;
    const prompt = '主角：条形图；关系：单指标（数字125.35亿）；屏幕文字：仅标题';

    const overridden = applyHtmlPromptOverride(frame, prompt);
    const regeneratedSpec = normalizeSceneSpec(overridden, {
      visualIntent: prompt,
      informationPool: [prompt],
    });

    expect(overridden.sceneSpec).toBeUndefined();
    expect(regeneratedSpec.focalElement).not.toContain('地图');
    expect(regeneratedSpec.actionSemantics).not.toContain('地图');
    expect(regeneratedSpec.assetHints).toEqual([]);
  });
});
