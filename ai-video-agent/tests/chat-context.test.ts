import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  project: null as any,
  findUnique: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: mocks.findUnique } },
}));

import { createChatContextSnapshot, resolveScope } from '@/lib/context/chat-context';

describe('chat context resolution', () => {
  beforeEach(() => {
    mocks.project = {
      uuid: 'project-context',
      type: 'html',
      updatedAt: new Date('2026-08-10T00:00:00.000Z'),
      outline: {
        title: '测试视频',
        frames: [
          { id: 'frame-1', index: 1, title: '开场', narration: '开场旁白' },
          { id: 'frame-2', index: 2, title: '解释', narration: '解释旁白' },
          { id: 'frame-3', index: 3, title: '结论', narration: '结论旁白', sceneSpec: { durationHint: 5 } },
        ],
      },
      videoSource: {
        frames: [
          { id: 'frame-1', htmlCode: '<main>one</main>' },
          { id: 'frame-2', htmlCode: '<main>two</main>' },
          { id: 'frame-3', htmlCode: '<main><h1 data-editor-id="title" data-editor-label="主标题">结论</h1></main>' },
        ],
      },
      styleId: 'clean',
      contentStyle: null,
      gptOptimization: null,
      projectBrief: null,
      assets: [],
    };
    mocks.findUnique.mockImplementation(async () => mocks.project);
  });

  it('resolves whole-project and explicit-frame language before client hints', () => {
    const frames = mocks.project.outline.frames;
    expect(resolveScope({ content: '整体太像 PPT', selectedFrame: frames[2] })).toMatchObject({ scope: 'project', frame: null, ambiguous: false });
    expect(resolveScope({ content: '第 2 镜有点乱', selectedFrame: frames[0], explicitFrame: frames[1] })).toMatchObject({ scope: 'frame', frame: { id: 'frame-2' } });
  });

  it('uses the current frame for pronouns and the selected title for element feedback', async () => {
    const frame = await createChatContextSnapshot({
      projectId: 'project-context',
      content: '这个不好看',
      context: { selectedFrameId: 'frame-3', playbackTimeMs: 2_500, playbackRevision: 4 },
    });
    expect(frame.snapshot).toMatchObject({
      resolvedScope: 'frame',
      selectedFrameId: 'frame-3',
      playbackTimeMs: 2_500,
      frameSummary: { title: '结论', durationSeconds: 5 },
    });

    const element = await createChatContextSnapshot({
      projectId: 'project-context',
      content: '这个标题小一点',
      context: { selectedFrameId: 'frame-3', selectedElementIds: ['title'] },
    });
    expect(element.snapshot).toMatchObject({
      resolvedScope: 'element',
      selectedFrameId: 'frame-3',
      selectedElementIds: ['title'],
      elementSummary: [{ id: 'title', label: '主标题', type: 'text' }],
    });
  });

  it('rejects stale IDs and changes the state hash when protected state changes', async () => {
    await expect(createChatContextSnapshot({
      projectId: 'project-context',
      content: '这个不好看',
      context: { selectedFrameId: 'removed-frame' },
    })).rejects.toThrow('分镜已经变化');

    const before = await createChatContextSnapshot({
      projectId: 'project-context', content: '整体检查', context: {},
    });
    mocks.project = {
      ...mocks.project,
      outline: {
        ...mocks.project.outline,
        frames: mocks.project.outline.frames.map((frame: any) => frame.id === 'frame-1' ? { ...frame, narration: '旁白已变化' } : frame),
      },
    };
    const after = await createChatContextSnapshot({
      projectId: 'project-context', content: '整体检查', context: {},
    });
    expect(after.snapshot.projectStateHash).not.toBe(before.snapshot.projectStateHash);
  });
});
