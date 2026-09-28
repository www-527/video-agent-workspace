// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FrameStructureReviewCard } from '@/components/chat/frame-structure-review-card';
import type { FrameStructureDraft, ProjectDetail } from '@/types';

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
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
  hasOutline: true,
  outline: {
    title: 'Test',
    totalDuration: 12,
    frames: [{ id: 'frame-3', index: 3, title: 'Before split', narration: 'Before split narration' }],
  },
  videoSource: { frames: [{ id: 'frame-3' }] },
};

const draft: FrameStructureDraft = {
  operation: 'split',
  targetFrameIds: ['frame-3'],
  baseUpdatedAt: project.updatedAt,
  frames: [
    { title: 'Part one', narration: 'Part one narration', htmlPrompt: 'Visual prompt one' },
    { title: 'Part two', narration: 'Part two narration', htmlPrompt: 'Visual prompt two' },
  ],
};

describe('FrameStructureReviewCard', () => {
  it('keeps the retry control after partial generation failure and retries the narration', async () => {
    const updatedProject: ProjectDetail = {
      ...project,
      updatedAt: '2026-08-07T00:01:00.000Z',
      outline: {
        ...project.outline!,
        frames: [
          { id: 'frame-3', index: 3, title: 'Part one', narration: 'Part one narration' },
          { id: 'frame-4', index: 4, title: 'Part two', narration: 'Part two narration' },
        ],
      },
      videoSource: { frames: [{ id: 'frame-3', htmlCode: '<html>rendered</html>' }, { id: 'frame-4' }] },
    };
    generationMocks.start.mockReset()
      .mockResolvedValueOnce({ status: 'partial_failed', message: 'TTS unavailable' })
      .mockResolvedValueOnce({ status: 'completed' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      project: updatedProject,
      frameIds: ['frame-3', 'frame-4'],
    }), { status: 200 })));

    render(
      <FrameStructureReviewCard
        draft={draft}
        project={project}
        onProjectChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '应用并重生成画面和配音' }));

    await waitFor(() => expect(generationMocks.start).toHaveBeenCalledWith(
      ['frame-3', 'frame-4'],
      { forceAudio: true },
    ));
    const retry = await screen.findByRole('button', { name: '重试生成画面和配音' });
    fireEvent.click(retry);

    await waitFor(() => expect(generationMocks.start).toHaveBeenCalledTimes(2));
    expect(generationMocks.start).toHaveBeenLastCalledWith(
      ['frame-3', 'frame-4'],
      { forceAudio: true },
    );
  });
});
