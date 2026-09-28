// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameTuneReviewCard } from '@/components/chat/frame-tune-review-card';
import { useStudioStore } from '@/stores/studio-store';
import type { FrameTuneDraft, ProjectDetail } from '@/types';

const BASE_TIME = '2026-07-09T00:00:00.000Z';

function makeProject(htmlCode: string): ProjectDetail {
  return {
    uuid: 'project-1',
    title: 'Tune card test',
    type: 'html',
    canvasPreset: 'landscape-16-9',
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    hasOutline: true,
    styleId: null,
    outline: {
      title: 'Outline',
      totalDuration: 3,
      frames: [{
        id: 'frame-1',
        index: 1,
        title: 'Frame 1',
        narration: 'Narration',
      }],
    },
    videoSource: {
      frames: [{
        id: 'frame-1',
        htmlCode,
        audioDuration: 3,
      }],
    },
  };
}

const draft: FrameTuneDraft = {
  targetFrameId: 'frame-1',
  summary: 'Move the card down',
  baseUpdatedAt: BASE_TIME,
  elements: [{
    label: 'Card',
    kind: 'visual',
    selector: '.card',
    previewAnchor: 'center',
    current: { y: '20%' },
    proposed: { y: '40%' },
    reason: 'Give the layout more room.',
  }],
};

describe('FrameTuneReviewCard', () => {
  beforeEach(() => {
    useStudioStore.setState({
      selectedFrameId: null,
      showSubtitle: true,
      isPlaying: false,
      generatingFrames: {},
      tunePreview: null,
    });
  });

  it('shows frame positions as real 1280x720 pixel coordinates', () => {
    render(
      <FrameTuneReviewCard
        draft={draft}
        project={makeProject('<html><body><div class="card">old</div></body></html>')}
        onProjectChange={vi.fn()}
      />,
    );

    expect(screen.getByText('当前 144px / 720px')).toBeTruthy();
    expect(screen.getByDisplayValue('288px')).toBeTruthy();
  });

  it('closes the temporary tune preview when asking for a major revision', async () => {
    const onSendText = vi.fn();
    const { rerender } = render(
      <FrameTuneReviewCard
        draft={draft}
        project={makeProject('<html><body><div class="card">old</div></body></html>')}
        onProjectChange={vi.fn()}
        onSendText={onSendText}
      />,
    );

    await waitFor(() => {
      expect(useStudioStore.getState().tunePreview?.htmlCode).toContain('__ai_video_tune_preview__');
    });

    fireEvent.click(screen.getByRole('button', { name: /让 AI 大改一版/ }));

    expect(onSendText).toHaveBeenCalledWith(expect.stringContaining('大改一版'));
    expect(screen.getByText('已关闭这份微调草稿。')).toBeTruthy();
    expect(useStudioStore.getState().tunePreview).toBeNull();

    rerender(
      <FrameTuneReviewCard
        draft={draft}
        project={makeProject('<html><body><div class="card">new generated html</div></body></html>')}
        onProjectChange={vi.fn()}
        onSendText={onSendText}
      />,
    );

    await waitFor(() => {
      expect(useStudioStore.getState().tunePreview).toBeNull();
    });
  });

  it('marks an element for deletion inside the existing tune card', async () => {
    render(
      <FrameTuneReviewCard
        draft={draft}
        project={makeProject('<html><body><div class="card">old</div></body></html>')}
        onProjectChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '删除元素' }));

    expect(screen.getByText('待删除')).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认删除' })).toBeTruthy();
    await waitFor(() => {
      expect(useStudioStore.getState().tunePreview?.htmlCode).toContain('outline: 3px solid rgba(220,38,38,.92)');
    });
  });
});
