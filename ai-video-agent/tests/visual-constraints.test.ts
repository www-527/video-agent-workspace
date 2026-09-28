import { describe, expect, it } from 'vitest';
import { hasForbiddenMapVisual } from '@/lib/ai/visual-constraints';
import { isCompleteHtmlFrameUpdate } from '@/lib/ai/frame-ops';

describe('map visual constraint', () => {
  it('rejects map concepts in an HTML visual plan', () => {
    expect(hasForbiddenMapVisual({
      htmlPrompt: '主角：中国地图轮廓；关系：单指标；屏幕文字：仅标题',
      sceneSpec: { assetHints: ['map-outline'] },
    })).toBe(true);
  });

  it('does not reject a country name without a geographic visual', () => {
    expect(hasForbiddenMapVisual('中国市场营收 125.35 亿美元')).toBe(false);
  });

  it('does not treat a prohibition note as a requested map visual', () => {
    expect(hasForbiddenMapVisual({
      htmlPrompt: '主角：125.35 亿大数字；关系：单指标确认；屏幕文字：仅标题',
      sceneSpec: {
        focalElement: '125.35 亿大数字',
        actionSemantics: '数值稳定建立',
        visualIntent: '确认中国市场规模',
        assetHints: ['刻度'],
        informationPool: ['中国市场 125.35 亿美元'],
        prohibitedPatterns: ['禁止地图'],
      },
    })).toBe(false);
  });

  it('rejects map terms only when they occur in picture-driving fields', () => {
    expect(hasForbiddenMapVisual({ sceneSpec: { focalElement: 'map-outline 上的柱状条' } })).toBe(true);
    expect(hasForbiddenMapVisual({ sceneSpec: { visualIntent: '展示地图轮廓与增长关系' } })).toBe(true);
  });

  it('rejects an otherwise complete draft that still contains a map', () => {
    expect(isCompleteHtmlFrameUpdate({
      htmlPrompt: '主角：中国地图轮廓上的柱状条；关系：单指标；屏幕文字：仅标题',
      sceneSpec: {
        relationship: 'metric', focus: '中国市场业绩', revealStrategy: 'single',
        focalElement: '中国地图轮廓', composition: 'establish', actionSemantics: '地图出现',
        assetStrategy: 'chart', informationPool: ['125.35 亿美元'], visualIntent: '展示业绩',
        screenText: [], assetHints: ['地图'], durationHint: 6, prohibitedPatterns: [],
      },
    })).toBe(false);
  });
});
