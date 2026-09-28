import { describe, expect, it } from 'vitest';
import { auditVisualRhythm } from '@/lib/render/visual-audit';
import type { FrameOutline, SceneSpec } from '@/types';

function frame(id: string, sceneSpec: Partial<SceneSpec>): FrameOutline {
  return {
    id,
    index: Number(id),
    title: `镜头 ${id}`,
    narration: '测试',
    sceneSpec: {
      relationship: 'metric',
      focus: 'focus',
      revealStrategy: 'single',
      focalElement: 'metric',
      composition: 'expand',
      actionSemantics: 'change',
      assetStrategy: 'chart',
      informationPool: [],
      visualIntent: 'test',
      screenText: [],
      assetHints: [],
      durationHint: 3,
      prohibitedPatterns: [],
      ...sceneSpec,
    },
  };
}

describe('whole-film visual audit', () => {
  it('reports repeated composition, decorative photos and missing demo labels', () => {
    const issues = auditVisualRhythm([
      frame('1', { compositionTag: 'split', visualType: 'photo' }),
      frame('2', { compositionTag: 'split', visualType: 'chart' }),
      frame('3', { compositionTag: 'split', renderMode: 'ui-scene', visualType: 'ui', isDemoData: false }),
    ]);
    expect(issues.some(issue => issue.message.includes('imagePurpose'))).toBe(true);
    expect(issues.some(issue => issue.message.includes('连续出现 3 个镜头'))).toBe(true);
    expect(issues.some(issue => issue.message.includes('演示数据'))).toBe(true);
  });
});

