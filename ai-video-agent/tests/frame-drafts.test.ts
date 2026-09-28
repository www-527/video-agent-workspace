import { describe, expect, it } from 'vitest';
import { applyFrameDraft, applyFrameStructureDraft, buildAddDraft, isDraftStale } from '@/lib/ai/frame-drafts';
import { findAppliedFrameStructureIds } from '@/lib/collaboration';
import type { FrameOutline, FrameReviewDraft, FrameStructureDraft, Outline, SceneSpec, VideoSource } from '@/types';

function frame(id: string, index: number, title: string): FrameOutline {
  return {
    id,
    index,
    title,
    narration: `${title} narration`,
    imagePrompt: `${title} prompt`,
  };
}

function outline(frames: FrameOutline[]): Outline {
  return {
    title: 'Test',
    totalDuration: 30,
    frames,
    collaboration: {
      mode: 'guided',
      planApproved: true,
      approvedFrameIds: ['a', 'b'],
    },
    beats: frames.map(item => ({
      id: `beat-${item.id}`,
      chapterId: 'chapter-1',
      order: item.index,
      narration: item.narration,
      purpose: item.title,
      frameId: item.id,
    })),
    chapters: [{ id: 'chapter-1', title: 'Chapter', purpose: 'Test', beatIds: frames.map(item => `beat-${item.id}`) }],
  };
}

function source(): VideoSource {
  return {
    frames: [
      { id: 'a', imagePath: '/a.png', audioPath: '/a.mp3', audioDuration: 1 },
      { id: 'b', imagePath: '/b.png', audioPath: '/b.mp3', audioDuration: 1 },
    ],
  };
}

describe('applyFrameDraft', () => {
  it('applies modify drafts and clears only the target frame media', () => {
    const draft: FrameReviewDraft = {
      operation: 'modify',
      targetFrameId: 'b',
      title: 'B revised',
      narration: 'new narration',
      visualPrompt: 'new prompt',
      baseUpdatedAt: 'v1',
    };

    const result = applyFrameDraft({
      type: 'image',
      outline: outline([frame('a', 1, 'A'), frame('b', 2, 'B')]),
      videoSource: source(),
      draft,
      approveForGeneration: true,
    });

    expect(result.frameId).toBe('b');
    expect(result.outline.frames[1]).toMatchObject({ title: 'B revised', narration: 'new narration', imagePrompt: 'new prompt' });
    expect(result.videoSource.frames[0]).toMatchObject({ id: 'a', imagePath: '/a.png', audioPath: '/a.mp3' });
    expect(result.videoSource.frames[1]).toEqual({ id: 'b' });
    expect(result.outline.collaboration?.approvedFrameIds).toContain('b');
  });

  it('fully replaces HTML visual fields and clears the old rendered scene', () => {
    const original = frame('b', 2, 'B');
    original.htmlPrompt = '主角：旧地图轮廓；关系：旧动作；屏幕文字：旧标题';
    original.sceneSpec = {
      relationship: 'spatial', focus: '旧方案', revealStrategy: 'single', focalElement: '旧地图轮廓',
      composition: 'establish', actionSemantics: '旧动作', assetStrategy: 'css-svg', informationPool: ['事实'],
      visualIntent: '旧视觉', screenText: [], assetHints: ['地图'], durationHint: 6, prohibitedPatterns: [],
    };
    const nextSpec: SceneSpec = {
      relationship: 'metric', focus: '规模', revealStrategy: 'single', focalElement: '125.35 亿大数字',
      composition: 'resolve', actionSemantics: '数值稳定建立', assetStrategy: 'typography',
      informationPool: ['125.35 亿'], visualIntent: '确认规模', screenText: ['新标题'], assetHints: ['大数字'],
      durationHint: 6, prohibitedPatterns: ['禁止地图'],
    };
    const result = applyFrameDraft({
      type: 'html',
      outline: outline([frame('a', 1, 'A'), original]),
      videoSource: { frames: [{ id: 'a', htmlCode: '<html>A</html>' }, { id: 'b', htmlCode: '<html>old map</html>', audioPath: '/b.mp3' }] },
      draft: {
        operation: 'modify', targetFrameId: 'b', title: '新标题', narration: '新旁白',
        visualPrompt: '主角：125.35 亿大数字；关系：单指标确认；屏幕文字：仅标题',
        htmlPrompt: '主角：125.35 亿大数字；关系：单指标确认；屏幕文字：仅标题',
        sceneSpec: nextSpec, baseUpdatedAt: 'v1',
      },
    });

    expect(result.outline.frames[1]).toMatchObject({
      htmlPrompt: '主角：125.35 亿大数字；关系：单指标确认；屏幕文字：仅标题',
      sceneSpec: nextSpec,
    });
    expect(result.videoSource.frames[1]).toEqual({ id: 'b' });
  });

  it('applies add drafts, reindexes outline content, and aligns media sources', () => {
    const draft: FrameReviewDraft = {
      operation: 'add',
      insertAfterIndex: 1,
      title: 'Inserted',
      narration: 'inserted narration',
      visualPrompt: 'inserted prompt',
      baseUpdatedAt: 'v1',
    };

    const result = applyFrameDraft({
      type: 'image',
      outline: outline([frame('a', 1, 'A'), frame('b', 2, 'B')]),
      videoSource: source(),
      draft,
      approveForGeneration: true,
    });

    expect(result.outline.frames.map(item => item.title)).toEqual(['A', 'Inserted', 'B']);
    expect(result.outline.frames.map(item => item.index)).toEqual([1, 2, 3]);
    expect(result.outline.script).toBe('A narration\ninserted narration\nB narration');
    expect(result.videoSource.frames.map(item => item.id)).toEqual(['a', result.frameId, 'b']);
    expect(result.videoSource.frames[1]).toEqual({ id: result.frameId });
    expect(result.outline.collaboration?.planApproved).toBe(false);
  });

  it('does not use image prompts as html prompts in html mode', () => {
    const sceneSpec: SceneSpec = {
      relationship: 'compare',
      focus: '爱因斯坦的幽默比喻',
      revealStrategy: 'contrast',
      focalElement: '爱因斯坦',
      composition: 'expand',
      actionSemantics: '对比两种截然不同的时间体验',
      assetStrategy: 'icon',
      informationPool: ['火炉旁的一分钟像一小时', '愉快聊天的一小时像一分钟'],
      visualIntent: '观众应该理解时间感受会因场景而异',
      screenText: ['时间相对性', '感受不同'],
      assetHints: ['火炉图标', '时钟'],
      durationHint: 6,
      prohibitedPatterns: ['卡片墙'],
    };
    const draft: FrameReviewDraft = {
      operation: 'add',
      insertAfterIndex: 1,
      title: '简化相对论',
      narration: '相对论听起来遥不可及，但爱因斯坦用一个日常生活的小玩笑，就让所有人秒懂。',
      imagePrompt: 'Flat vector illustration that should not be used by html mode',
      htmlPrompt: '',
      sceneSpec,
      baseUpdatedAt: 'v1',
    };

    const result = applyFrameDraft({
      type: 'html',
      outline: outline([frame('a', 1, 'A'), frame('b', 2, 'B')]),
      videoSource: source(),
      draft,
    });

    const inserted = result.outline.frames[1];
    expect(inserted.imagePrompt).toBeUndefined();
    expect(inserted.htmlPrompt).toContain('爱因斯坦的幽默比喻');
    expect(inserted.htmlPrompt).not.toContain('Flat vector illustration');
  });

  it('builds html add draft visual text from scene spec when htmlPrompt is empty', () => {
    const sceneSpec: SceneSpec = {
      relationship: 'compare',
      focus: '爱因斯坦的幽默比喻',
      revealStrategy: 'contrast',
      focalElement: '爱因斯坦',
      composition: 'expand',
      actionSemantics: '对比两种截然不同的时间体验',
      assetStrategy: 'icon',
      informationPool: ['火炉旁的一分钟像一小时', '愉快聊天的一小时像一分钟'],
      visualIntent: '观众应该理解时间感受会因场景而异',
      screenText: ['时间相对性', '感受不同'],
      assetHints: ['火炉图标', '时钟'],
      durationHint: 6,
      prohibitedPatterns: ['卡片墙'],
    };

    const draft = buildAddDraft({
      type: 'html',
      insertAfterIndex: 8,
      baseUpdatedAt: 'v1',
      frame: {
        id: 'new',
        index: 9,
        title: '简化相对论',
        narration: '相对论听起来遥不可及，但爱因斯坦用一个日常生活的小玩笑，就让所有人秒懂。',
        imagePrompt: 'Flat vector illustration that should not be shown in html mode',
        htmlPrompt: '',
        sceneSpec,
      },
    });

    expect(draft.visualPrompt).toContain('焦点：爱因斯坦的幽默比喻');
    expect(draft.visualPrompt).not.toContain('Flat vector illustration');
  });

  it('applies delete drafts and removes the deleted frame source', () => {
    const draft: FrameReviewDraft = {
      operation: 'delete',
      targetFrameId: 'a',
      title: 'A',
      narration: 'A narration',
      baseUpdatedAt: 'v1',
    };

    const result = applyFrameDraft({
      type: 'image',
      outline: outline([frame('a', 1, 'A'), frame('b', 2, 'B')]),
      videoSource: source(),
      draft,
    });

    expect(result.outline.frames.map(item => item.id)).toEqual(['b']);
    expect(result.outline.frames[0].index).toBe(1);
    expect(result.videoSource.frames).toEqual([{ id: 'b', imagePath: '/b.png', audioPath: '/b.mp3', audioDuration: 1 }]);
    expect(result.outline.collaboration?.planApproved).toBe(false);
  });
});

describe('isDraftStale', () => {
  it('rejects drafts whose base project timestamp no longer matches', () => {
    expect(isDraftStale('2026-07-08T00:00:00.000Z', '2026-07-08T00:00:01.000Z')).toBe(true);
    expect(isDraftStale('2026-07-08T00:00:00.000Z', '2026-07-08T00:00:00.000Z')).toBe(false);
  });
});

describe('applyFrameStructureDraft', () => {
  it('splits one frame atomically, keeps its id for the first result, and clears changed media', () => {
    const draft: FrameStructureDraft = {
      operation: 'split',
      targetFrameIds: ['a'],
      frames: [
        { title: '误区二', narration: '误区二 narration', imagePrompt: 'second misconception' },
        { title: '误区三', narration: '误区三 narration', imagePrompt: 'third misconception' },
      ],
      baseUpdatedAt: 'v1',
    };

    const result = applyFrameStructureDraft({
      type: 'image',
      outline: outline([frame('a', 1, '误区二和三'), frame('b', 2, '结论')]),
      videoSource: source(),
      draft,
      approveForGeneration: true,
    });

    expect(result.outline.frames.map(item => item.title)).toEqual(['误区二', '误区三', '结论']);
    expect(result.outline.frames.map(item => item.index)).toEqual([1, 2, 3]);
    expect(result.frameIds[0]).toBe('a');
    expect(result.frameIds[1]).not.toBe('a');
    expect(result.outline.collaboration?.planApproved).toBe(true);
    expect(result.outline.collaboration?.approvedFrameIds).toEqual(expect.arrayContaining(result.frameIds));
    expect(result.videoSource.frames[0]).toEqual({ id: 'a' });
    expect(result.videoSource.frames[1]).toEqual({ id: result.frameIds[1] });
    expect(result.videoSource.frames[2]).toMatchObject({ id: 'b', imagePath: '/b.png' });
    expect(result.outline.script).toBe('误区二 narration\n误区三 narration\n结论 narration');
    expect(findAppliedFrameStructureIds(result.outline, draft)).toEqual(result.frameIds);
  });

  it('merges consecutive frames, keeps the first id, removes later media, and reindexes', () => {
    const draft: FrameStructureDraft = {
      operation: 'merge',
      targetFrameIds: ['a', 'b'],
      frames: [{ title: '合并内容', narration: '合并后的 narration', imagePrompt: 'merged prompt' }],
      baseUpdatedAt: 'v1',
    };

    const result = applyFrameStructureDraft({
      type: 'image',
      outline: outline([frame('a', 1, 'A'), frame('b', 2, 'B')]),
      videoSource: source(),
      draft,
      approveForGeneration: true,
    });

    expect(result.frameIds).toEqual(['a']);
    expect(result.outline.frames).toHaveLength(1);
    expect(result.outline.frames[0]).toMatchObject({ id: 'a', index: 1, title: '合并内容' });
    expect(result.videoSource.frames).toEqual([{ id: 'a' }]);
    expect(result.outline.chapters?.[0].beatIds).toEqual(['beat-a']);
    expect(findAppliedFrameStructureIds(result.outline, draft)).toEqual(['a']);
  });

  it('rejects merging non-consecutive frames', () => {
    const draft: FrameStructureDraft = {
      operation: 'merge',
      targetFrameIds: ['a', 'c'],
      frames: [{ title: 'invalid', narration: '', imagePrompt: '' }],
      baseUpdatedAt: 'v1',
    };
    const frames = [frame('a', 1, 'A'), frame('b', 2, 'B'), frame('c', 3, 'C')];
    expect(() => applyFrameStructureDraft({
      type: 'image', outline: outline(frames), videoSource: { frames: frames.map(item => ({ id: item.id })) }, draft,
    })).toThrow('只能合并连续分镜');
  });

  it('does not approve the whole plan when only an unapproved structure draft was reviewed', () => {
    const draft: FrameStructureDraft = {
      operation: 'split',
      targetFrameIds: ['a'],
      frames: [
        { title: 'A1', narration: 'A1', imagePrompt: 'A1' },
        { title: 'A2', narration: 'A2', imagePrompt: 'A2' },
      ],
      baseUpdatedAt: 'v1',
    };
    const current = outline([frame('a', 1, 'A'), frame('b', 2, 'B')]);
    current.collaboration = { mode: 'guided', planApproved: false, approvedFrameIds: [] };
    const result = applyFrameStructureDraft({
      type: 'image', outline: current, videoSource: source(), draft, approveForGeneration: true,
    });
    expect(result.outline.collaboration?.planApproved).toBe(false);
    expect(result.outline.collaboration?.approvedFrameIds).toEqual(expect.arrayContaining(result.frameIds));
  });
});
