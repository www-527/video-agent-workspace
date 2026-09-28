import { describe, expect, it } from 'vitest';
import { getWorkbenchPrimaryLabel, resolveWorkbenchStage } from '@/lib/workbench-stage';
import type { ProjectDetail } from '@/types';

function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    uuid: 'p1', title: 'Stage test', type: 'html', canvasPreset: 'landscape-16-9', styleId: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    hasOutline: true,
    outline: {
      title: 'Outline', totalDuration: 3,
      collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: [] },
      frames: [{ id: 'f1', index: 1, title: 'Frame', narration: 'Text' }],
    },
    videoSource: { frames: [{ id: 'f1', htmlCode: '<div>done</div>', audioPath: '/f1.mp3' }] },
    ...overrides,
  };
}

describe('workbench stage', () => {
  it('maps an approved completed project to the sole export action', () => {
    const state = resolveWorkbenchStage(project());
    expect(state.stage).toBe('completed');
    expect(getWorkbenchPrimaryLabel(state)).toBe('导出视频');
  });

  it('prioritizes unsaved editor work over generation and export', () => {
    const state = resolveWorkbenchStage(project(), { editorDirty: true, generating: true, exporting: true });
    expect(state.stage).toBe('editing');
    expect(getWorkbenchPrimaryLabel(state)).toBeNull();
  });

  it('blocks export only when blocking issues exist', () => {
    const state = resolveWorkbenchStage(project(), { blockingIssueCount: 2 });
    expect(state.stage).toBe('quality_blocked');
    expect(getWorkbenchPrimaryLabel(state)).toBe('全片剩余 2 个严重问题');
  });

  it('requires the existing plan approval for GPT-free projects too', () => {
    const state = resolveWorkbenchStage(project({
      workflow: 'gpt-free',
      outline: {
        ...project().outline!,
        collaboration: { mode: 'guided', planApproved: false, approvedFrameIds: [] },
      },
      videoSource: { frames: [{ id: 'f1' }] },
    }));

    expect(state.stage).toBe('outline_ready');
    expect(state.pendingFrameIds).toEqual(['f1']);
  });
});
