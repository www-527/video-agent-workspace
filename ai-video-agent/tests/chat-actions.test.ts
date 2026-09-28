import { describe, expect, it } from 'vitest';
import { buildFrozenActions, buildNextActions, getProjectStage } from '@/components/chat/chat-actions';
import type { Outline, ProjectDetail, VideoSource } from '@/types';

const baseOutline: Outline = {
  title: 'Test',
  totalDuration: 12,
  frames: [
    { id: 'frame-1', index: 1, title: 'One', narration: 'One' },
    { id: 'frame-2', index: 2, title: 'Two', narration: 'Two' },
  ],
};

function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    uuid: 'project-1',
    title: 'Test',
    type: 'html',
    canvasPreset: 'landscape-16-9',
    styleId: null,
    outline: null,
    videoSource: null,
    createdAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
    hasOutline: false,
    ...overrides,
  };
}

function outline(overrides: Partial<Outline> = {}): Outline {
  return {
    ...baseOutline,
    collaboration: {
      mode: 'guided',
      planApproved: false,
      approvedFrameIds: [],
    },
    ...overrides,
  };
}

function source(frames: VideoSource['frames']): VideoSource {
  return { frames };
}

describe('chat action stage flow', () => {
  it('detects no outline and returns no stage action', () => {
    const p = project();
    expect(getProjectStage(p)).toBe('no_outline');
    expect(buildNextActions(p)).toEqual([]);
  });

  it('keeps outline approval out of chat history when outline is ready', () => {
    const p = project({ outline: outline(), hasOutline: true });
    expect(getProjectStage(p)).toBe('outline_ready');
    expect(buildNextActions(p)).toEqual([]);
  });

  it('continues full video generation for approved html projects', () => {
    const p = project({
      outline: outline({ collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: [] } }),
      hasOutline: true,
    });
    expect(getProjectStage(p)).toBe('plan_approved');
    expect(buildNextActions(p)).toEqual([]);
  });

  it('continues full video generation when a legacy html sample exists', () => {
    const p = project({
      outline: outline({ collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: [] } }),
      videoSource: source([
        { id: 'frame-1', htmlCode: '<div>sample</div>', audioPath: '/audio/1.mp3' },
        { id: 'frame-2' },
      ]),
      hasOutline: true,
    });
    expect(getProjectStage(p)).toBe('sample_generated');
    expect(buildNextActions(p)).toEqual([]);
  });

  it('shows anchor approval after html sample exists even before audio is ready', () => {
    const p = project({
      outline: outline({ collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: [] } }),
      videoSource: source([
        { id: 'frame-1', htmlCode: '<div>sample</div>' },
        { id: 'frame-2' },
      ]),
      hasOutline: true,
    });
    expect(getProjectStage(p)).toBe('sample_generated');
    expect(buildNextActions(p)).toEqual([]);
  });

  it('shows generating the remaining frames after html visual anchor is approved', () => {
    const p = project({
      outline: outline({
        collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: ['frame-1'] },
        visualAnchor: {
          themeId: 'default',
          colors: [],
          fontFamilies: [],
          titleTreatment: '',
          numberTreatment: '',
          labelTreatment: '',
          whitespaceRatio: 0.4,
          motionTempo: 'balanced',
          prohibitedPatterns: [],
          approvedFrameIds: ['frame-1'],
        },
      }),
      videoSource: source([
        { id: 'frame-1', htmlCode: '<div>sample</div>', audioPath: '/audio/1.mp3' },
        { id: 'frame-2' },
      ]),
      hasOutline: true,
    });
    expect(getProjectStage(p)).toBe('visual_anchor_approved');
    expect(buildNextActions(p)).toEqual([]);
  });

  it('skips visual anchor flow for image projects', () => {
    const p = project({
      type: 'image',
      outline: outline({ collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: [] } }),
      hasOutline: true,
    });
    expect(getProjectStage(p)).toBe('plan_approved');
    expect(buildNextActions(p)).toEqual([]);
  });

  it('shows export when all frames are generated', () => {
    const p = project({
      type: 'image',
      outline: outline({ collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: [] } }),
      videoSource: source([
        { id: 'frame-1', imagePath: '/images/1.png', audioPath: '/audio/1.mp3' },
        { id: 'frame-2', imagePath: '/images/2.png', audioPath: '/audio/2.mp3' },
      ]),
      hasOutline: true,
    });
    expect(getProjectStage(p)).toBe('frames_generated');
    expect(buildNextActions(p)).toEqual([]);
  });

  it('does not treat misaligned generated media as completed frames', () => {
    const p = project({
      type: 'image',
      outline: outline({ collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: [] } }),
      videoSource: source([
        { id: 'frame-2', imagePath: '/images/2.png', audioPath: '/audio/2.mp3' },
      ]),
      hasOutline: true,
    });
    expect(getProjectStage(p)).toBe('plan_approved');
    expect(buildNextActions(p)).toEqual([]);
  });

  it('does not duplicate outline view when an outline card is present', () => {
    const p = project({ outline: outline(), hasOutline: true });
    const actions = buildNextActions(
      p,
      [{ id: 'view_outline', label: '查看完整大纲', variant: 'outline' }],
      { hasOutlineCard: true },
    );
    expect(actions).toEqual([]);
  });

  it('keeps frozen metadata actions instead of replacing them with the current project stage', () => {
    const p = project({
      outline: outline({ collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: [] } }),
      videoSource: source([
        { id: 'frame-1', htmlCode: '<div>sample</div>' },
        { id: 'frame-2' },
      ]),
      hasOutline: true,
    });

    expect(getProjectStage(p)).toBe('sample_generated');
    expect(buildFrozenActions(
      [
        { id: 'approve_plan', label: '确认内容计划', variant: 'default' },
        { id: 'generate_sample', label: '生成首镜样片', variant: 'default' },
      ],
      p,
    ).map(action => action.id)).toEqual(['generate_sample']);
  });

  it('hides frozen export actions until every frame has generated media and audio', () => {
    const p = project({
      type: 'image',
      outline: outline({ collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: [] } }),
      videoSource: source([
        { id: 'frame-1', imagePath: '/images/1.png', audioPath: '/audio/1.mp3' },
        { id: 'frame-2' },
      ]),
      hasOutline: true,
    });

    expect(buildFrozenActions(
      [{ id: 'export_video', label: '导出视频', variant: 'default' }],
      p,
    )).toEqual([]);
  });

  it('removes frozen export actions after every frame has generated media and audio', () => {
    const p = project({
      type: 'image',
      outline: outline({ collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: [] } }),
      videoSource: source([
        { id: 'frame-1', imagePath: '/images/1.png', audioPath: '/audio/1.mp3' },
        { id: 'frame-2', imagePath: '/images/2.png', audioPath: '/audio/2.mp3' },
      ]),
      hasOutline: true,
    });

    expect(buildFrozenActions(
      [{ id: 'export_video', label: '导出视频', variant: 'default' }],
      p,
    )).toEqual([]);
  });

  it('hides frozen plan approval buttons after approval', () => {
    const p = project({
      outline: outline({ collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: [] } }),
      hasOutline: true,
    });

    const actions = buildFrozenActions(
      [{ id: 'approve_plan', label: '确认内容计划', variant: 'default' }],
      p,
    );

    expect(actions).toEqual([]);
  });

  it('does not replace a completed plan approval with a duplicate generation action', () => {
    const p = project({
      outline: outline({ collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: [] } }),
      hasOutline: true,
    });

    const actions = buildFrozenActions(
      [{ id: 'approve_plan', label: '纭鍐呭璁″垝', variant: 'default' }],
      p,
    );

    expect(actions).toEqual([]);
  });

  it('keeps frame approval independent from global plan approval', () => {
    const p = project({
      outline: outline({ collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: [] } }),
      hasOutline: true,
    });

    const actions = buildFrozenActions(
      [{ id: 'approve_frame', label: '确认这句内容', frameId: 'frame-2', variant: 'default' }],
      p,
    );

    expect(actions[0]).toMatchObject({
      id: 'approve_frame',
      label: '确认这句内容',
    });
    expect(actions[0]).not.toHaveProperty('disabled');
    expect(actions[0]).not.toHaveProperty('completed');
  });

  it('marks only the approved frame review bubble as completed', () => {
    const p = project({
      outline: outline({ collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: ['frame-2'] } }),
      hasOutline: true,
    });

    const actions = buildFrozenActions(
      [
        { id: 'approve_frame', label: '确认这句内容', frameId: 'frame-1', variant: 'default' },
        { id: 'approve_frame', label: '确认这句内容', frameId: 'frame-2', variant: 'default' },
      ],
      p,
    );

    expect(actions[0]).toMatchObject({ frameId: 'frame-1' });
    expect(actions[0]).not.toHaveProperty('completed');
    expect(actions[1]).toMatchObject({
      frameId: 'frame-2',
      label: '内容计划已确认',
      disabled: true,
      completed: true,
      variant: 'secondary',
    });
  });

  it('disables frozen first-frame regeneration after visual anchor approval', () => {
    const p = project({
      outline: outline({
        collaboration: { mode: 'guided', planApproved: true, approvedFrameIds: ['frame-1'] },
        visualAnchor: {
          themeId: 'default',
          colors: [],
          fontFamilies: [],
          titleTreatment: '',
          numberTreatment: '',
          labelTreatment: '',
          whitespaceRatio: 0.4,
          motionTempo: 'balanced',
          prohibitedPatterns: [],
          approvedFrameIds: ['frame-1'],
        },
      }),
      hasOutline: true,
    });

    const actions = buildFrozenActions(
      [{ id: 'generate_sample', label: '重新生成首镜', variant: 'outline', forceVisual: true }],
      p,
    );

    expect(actions[0]).toMatchObject({
      id: 'generate_sample',
      label: '主题风格已确认',
      disabled: true,
      completed: true,
      variant: 'secondary',
      forceVisual: true,
    });
  });
});
