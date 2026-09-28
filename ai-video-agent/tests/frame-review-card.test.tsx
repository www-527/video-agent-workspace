// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FrameReviewCard } from '@/components/chat/frame-review-card';
import type { FrameReviewDraft, ProjectDetail } from '@/types';

const generationMocks = vi.hoisted(() => ({
  start: vi.fn(),
}));

vi.mock('@/components/studio/frame-generation-context', () => ({
  useFrameGenerationController: () => ({ start: generationMocks.start }),
}));

const project: ProjectDetail = {
  uuid: '00000000-0000-0000-0000-000000000001',
  title: 'Test',
  type: 'html',
  canvasPreset: 'landscape-16-9',
  styleId: null,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
  hasOutline: true,
  outline: {
    title: 'Test', totalDuration: 10,
    frames: [{ id: 'frame-4', index: 4, title: '中国市场旧标题', narration: '中国市场达到 125.35 亿并增长 +5%。' }],
  },
  videoSource: { frames: [{ id: 'frame-4', htmlCode: '<html>old</html>' }] },
};

const draft: FrameReviewDraft = {
  operation: 'modify', targetFrameId: 'frame-4', title: '中国市场旧标题',
  narration: '中国市场达到 125.35 亿并增长 +5%。',
  visualPrompt: '主角：中国地图轮廓中央的柱状条；关系：地图中心长出柱状条；屏幕文字：旧标题',
  htmlPrompt: '主角：中国地图轮廓中央的柱状条；关系：地图中心长出柱状条；屏幕文字：旧标题',
  sceneSpec: {
    relationship: 'metric', focus: '市场', revealStrategy: 'single', focalElement: '中国地图轮廓中央的柱状条',
    composition: 'establish', actionSemantics: '地图中心长出柱状条', assetStrategy: 'css-svg',
    informationPool: ['125.35 亿', '+5%'], visualIntent: '地图展示市场', screenText: [], assetHints: ['地图'],
    durationHint: 6, prohibitedPatterns: [],
  },
  baseUpdatedAt: project.updatedAt,
};

describe('FrameReviewCard major rewrite', () => {
  it('starts a blank replacement while keeping the old draft out of the user request', () => {
    const onRewriteDraft = vi.fn();
    render(
      <FrameReviewCard
        draft={draft}
        project={project}
        onProjectChange={vi.fn()}
        onRewriteDraft={onRewriteDraft}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /从空白镜头重做/ }));

    expect(onRewriteDraft).toHaveBeenCalledTimes(1);
    const [request, submittedDraft] = onRewriteDraft.mock.calls[0];
    expect(request).toContain('空白的新镜头重新生成');
    expect(request).not.toContain('中国地图轮廓中央的柱状条');
    expect(request).not.toContain('地图中心长出柱状条');
    expect(request).not.toContain(draft.narration);
    expect(submittedDraft).toMatchObject({
      title: draft.title,
      narration: draft.narration,
      htmlPrompt: draft.htmlPrompt,
      sceneSpec: draft.sceneSpec,
      freshStart: true,
    });
  });

  it('reports both in-progress and completed feedback when applying and regenerating a draft', async () => {
    const onAppendAssistantText = vi.fn(async (_text: string) => undefined);
    generationMocks.start.mockResolvedValueOnce({ status: 'completed' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      project: { ...project, updatedAt: '2026-07-14T00:01:00.000Z' },
      frameId: 'frame-4',
    }), { status: 200 })));

    render(
      <FrameReviewCard
        draft={draft}
        project={project}
        onProjectChange={vi.fn()}
        onAppendAssistantText={onAppendAssistantText}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /应用并重生成画面和配音/ }));

    await waitFor(() => expect(generationMocks.start).toHaveBeenCalledWith(['frame-4'], { forceVisual: true, forceAudio: true }));
    await waitFor(() => expect(onAppendAssistantText).toHaveBeenLastCalledWith(
      '第 1 镜的画面和配音已生成完成，可以在预览区查看。',
    ));
    expect(onAppendAssistantText.mock.calls.map(([message]) => message)).toEqual([
      '正在应用第 1 镜草稿，随后会重新生成画面和配音。',
      '第 1 镜草稿已应用，正在生成新画面和配音。',
      '第 1 镜的画面和配音已生成完成，可以在预览区查看。',
    ]);
  });
});
