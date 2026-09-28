import { describe, expect, it } from 'vitest';
import { createFreeFirstFrameVisualAnchor, createVisualAnchor, isAnchorApproved } from '@/lib/ai/visual-anchor';
import { getDefaultStyle } from '@/lib/styles/presets';

describe('visual anchor', () => {
  it('样片确认后才成为已批准锚点', () => {
    const provisional = createVisualAnchor(getDefaultStyle());
    const approved = createVisualAnchor(getDefaultStyle(), ['frame-1']);
    expect(isAnchorApproved(provisional)).toBe(false);
    expect(isAnchorApproved(approved)).toBe(true);
    expect(approved.colors.length).toBeGreaterThan(3);
  });

  it('uses a compact first-frame cue without imposing a composition template', () => {
    const anchor = createFreeFirstFrameVisualAnchor({
      frames: [{
        id: 'frame-1', index: 1, title: '增长的代价', narration: '用户增长后，系统压力开始显现。',
        htmlPrompt: '用尺度反转表现增长与压力。',
      }],
    });

    expect(anchor).toEqual({
      frameId: 'frame-1',
      summary: '增长的代价：用尺度反转表现增长与压力。',
    });
  });

  it('keeps existing first-frame anchors short for legacy projects', () => {
    const anchor = createFreeFirstFrameVisualAnchor({
      frames: [{ id: 'frame-1', index: 1, title: '首镜', narration: '旁白' }],
      freeFirstChapterAnchor: { frameId: 'frame-1', summary: '画面线索'.repeat(100) },
    });

    expect(anchor?.summary).toHaveLength(220);
  });
});
