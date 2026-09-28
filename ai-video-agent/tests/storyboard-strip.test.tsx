// @vitest-environment happy-dom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryboardStrip } from '@/components/studio/storyboard-strip';
import { layoutIssueScope } from '@/lib/layout-issues';
import { qualityHtmlHash } from '@/lib/quality/auto-optimize';
import { useStudioStore } from '@/stores/studio-store';
import type { FrameQualityRunState, ProjectDetail } from '@/types';

const project: ProjectDetail = {
  uuid: 'storyboard-ignore-project', title: 'Storyboard ignore state', type: 'image', canvasPreset: 'landscape-16-9', styleId: null,
  createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z', hasOutline: true,
  outline: {
    title: 'Outline', totalDuration: 3,
    frames: [{ id: 'frame-1', index: 1, title: 'Frame with issue', narration: 'Narration' }],
  },
  videoSource: {
    frames: [{
      id: 'frame-1',
      qualityReport: {
        frameId: 'frame-1', status: 'needs_review', scoreBefore: 72, scoreAfter: 72, iterations: 0,
        issues: [{ code: 'clipped', severity: 'critical', label: '图表', detail: '被裁切', elementId: 'chart' }],
        appliedFixes: [], auditedAt: 0, auditVersion: 'test', htmlHash: 'test',
      },
    }],
  },
};

describe('StoryboardStrip', () => {
  beforeEach(() => {
    useStudioStore.setState({
      generatingFrames: {}, qualityRuns: {}, qualityRepairRequests: {}, qualityRepairStops: {}, layoutAudits: {},
      ignoredLayoutIssueKeys: {}, permanentlyIgnoredLayoutIssueKeys: {},
    });
  });

  it('removes the thumbnail quality indicator as soon as the issue is ignored', async () => {
    render(<StoryboardStrip project={project} onProjectChange={() => undefined} selectedFrameId={null} onFrameSelect={() => undefined} />);

    expect(screen.getByTitle('查看 1 个质量问题')).toBeTruthy();

    const scope = layoutIssueScope(project.uuid, 'frame-1', qualityHtmlHash(''));
    act(() => {
      useStudioStore.setState({
        ignoredLayoutIssueKeys: { [scope]: ['clipped::chart::'] },
      });
    });

    await waitFor(() => expect(screen.queryByTitle('查看 1 个质量问题')).toBeNull());
  });

  it('clears a stored thumbnail warning after a newer runtime audit passes', () => {
    useStudioStore.setState({
      layoutAudits: { 'frame-1': { frameId: 'frame-1', auditedAt: Date.now(), issues: [] } },
    });

    render(<StoryboardStrip project={project} onProjectChange={() => undefined} selectedFrameId={null} onFrameSelect={() => undefined} />);

    expect(screen.queryByTitle('查看 1 个质量问题')).toBeNull();
  });

  it('uses the real 9:16 aspect ratio for portrait storyboard thumbnails', () => {
    const portrait = { ...project, canvasPreset: 'douyin-portrait-9-16' as const };
    const { container } = render(<StoryboardStrip project={portrait} onProjectChange={() => undefined} selectedFrameId={null} onFrameSelect={() => undefined} />);
    const card = container.querySelector('[role="button"]') as HTMLElement;
    const preview = card.querySelector('.relative.w-full') as HTMLElement;
    expect(card.style.width).toBe('72px');
    expect(preview.style.aspectRatio).toBe('720 / 1280');
  });

  it('shows every concurrently generating frame in the bottom storyboard strip', () => {
    const twoFrames: ProjectDetail = {
      ...project,
      outline: {
        ...project.outline!,
        frames: [
          ...project.outline!.frames,
          { id: 'frame-2', index: 2, title: 'Second frame', narration: 'Second narration' },
        ],
      },
      videoSource: { frames: [{ id: 'frame-1' }, { id: 'frame-2' }] },
    };
    useStudioStore.setState({ generatingFrames: { 'frame-1': 'html', 'frame-2': 'tts' } });

    render(<StoryboardStrip project={twoFrames} onProjectChange={() => undefined} selectedFrameId={null} onFrameSelect={() => undefined} />);

    expect(screen.getAllByTestId('frame-generation-indicator')).toHaveLength(2);
    expect(screen.getByLabelText('分镜 1 正在生成')).toBeTruthy();
    expect(screen.getByLabelText('分镜 2 正在生成')).toBeTruthy();
  });

  it('shows the repair state immediately without blurring the card chrome', () => {
    useStudioStore.setState({ qualityRepairRequests: { 'frame-1': 1 } });
    render(<StoryboardStrip project={project} onProjectChange={() => undefined} selectedFrameId={null} onFrameSelect={() => undefined} />);

    const indicator = screen.getByTestId('frame-repair-indicator');
    const thumbnailContent = screen.getByTestId('storyboard-thumbnail-content');
    const card = screen.getByRole('button', { name: '选择分镜 #1 Frame with issue，正在优化' });
    const title = screen.getByText('Frame with issue');
    const issueButton = screen.getByTitle('查看 1 个质量问题');

    expect(indicator.getAttribute('data-state')).toBe('repairing');
    expect(screen.getByText('正在优化')).toBeTruthy();
    expect(indicator.classList.contains('pointer-events-none')).toBe(true);
    expect(thumbnailContent.classList.contains('storyboard-thumbnail-content--repairing')).toBe(true);
    expect(title.classList.contains('storyboard-thumbnail-content--repairing')).toBe(false);
    expect(card.getAttribute('aria-label')).toBe('选择分镜 #1 Frame with issue，正在优化');
    expect(issueButton.classList.contains('z-20')).toBe(true);
  });

  it.each([
    'auditing',
    'sampling',
    'optimizing',
    'visual_repairing',
    'terminal_verifying',
    'sampling_recheck',
    'saving',
    'cancelling',
  ] as const)('shows the overlay for the %s repair phase', status => {
    const run: FrameQualityRunState = {
      frameId: 'frame-1', status, message: 'test', updatedAt: 0,
    };
    useStudioStore.setState({
      qualityRuns: { 'frame-1': run },
      qualityRepairStops: status === 'cancelling' ? { 'frame-1': true } : {},
    });
    render(<StoryboardStrip project={project} onProjectChange={() => undefined} selectedFrameId={null} onFrameSelect={() => undefined} />);

    expect(screen.getByTestId('frame-repair-indicator')).toBeTruthy();
    expect(screen.getByTestId('storyboard-thumbnail-content').classList.contains('storyboard-thumbnail-content--repairing')).toBe(true);
    expect(screen.getByText(status === 'cancelling' ? '正在停止' : '正在优化')).toBeTruthy();
  });

  it.each([
    'passed',
    'saved',
    'needs_review',
    'unchanged',
    'unavailable',
    'cancelled',
    'failed',
  ] as const)('does not leave the overlay for the terminal %s phase', status => {
    const run: FrameQualityRunState = {
      frameId: 'frame-1', status, message: 'test', updatedAt: 0,
    };
    useStudioStore.setState({ qualityRuns: { 'frame-1': run } });
    render(<StoryboardStrip project={project} onProjectChange={() => undefined} selectedFrameId={null} onFrameSelect={() => undefined} />);

    expect(screen.queryByTestId('frame-repair-indicator')).toBeNull();
    expect(screen.getByTestId('storyboard-thumbnail-content').classList.contains('storyboard-thumbnail-content--repairing')).toBe(false);
  });

  it('keeps repair state independent for concurrent frames', () => {
    const twoFrames: ProjectDetail = {
      ...project,
      outline: {
        ...project.outline!,
        frames: [
          ...project.outline!.frames,
          { id: 'frame-2', index: 2, title: 'Second frame', narration: 'Second narration' },
        ],
      },
      videoSource: { frames: [{ id: 'frame-1' }, { id: 'frame-2' }] },
    };
    useStudioStore.setState({ qualityRepairRequests: { 'frame-1': 1, 'frame-2': 1 } });

    const { container } = render(<StoryboardStrip project={twoFrames} onProjectChange={() => undefined} selectedFrameId={null} onFrameSelect={() => undefined} />);

    expect(screen.getAllByTestId('frame-repair-indicator')).toHaveLength(2);
    expect(container.querySelectorAll('.storyboard-thumbnail-content--repairing')).toHaveLength(2);
  });

  it('keeps first-generation feedback ahead of repair feedback', () => {
    useStudioStore.setState({
      generatingFrames: { 'frame-1': 'html' },
      qualityRepairRequests: { 'frame-1': 1 },
    });
    render(<StoryboardStrip project={project} onProjectChange={() => undefined} selectedFrameId={null} onFrameSelect={() => undefined} />);

    expect(screen.getByTestId('frame-generation-indicator')).toBeTruthy();
    expect(screen.queryByTestId('frame-repair-indicator')).toBeNull();
    expect(screen.queryByText('正在优化')).toBeNull();
  });

  it('keeps card, keyboard, and issue interactions available while repairing', () => {
    const onFrameSelect = vi.fn();
    const onQualityOpen = vi.fn();
    useStudioStore.setState({ qualityRepairRequests: { 'frame-1': 1 } });
    render(<StoryboardStrip project={project} onProjectChange={() => undefined} selectedFrameId={null} onFrameSelect={onFrameSelect} onQualityOpen={onQualityOpen} />);

    const card = screen.getByRole('button', { name: '选择分镜 #1 Frame with issue，正在优化' });
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    fireEvent.click(screen.getByTitle('查看 1 个质量问题'));

    expect(onFrameSelect).toHaveBeenCalledTimes(4);
    expect(onFrameSelect).toHaveBeenLastCalledWith('frame-1');
    expect(onQualityOpen).toHaveBeenCalledTimes(1);
  });

  it('removes the overlay after the request is cleared and a terminal state is stored', async () => {
    useStudioStore.setState({ qualityRepairRequests: { 'frame-1': 1 } });
    render(<StoryboardStrip project={project} onProjectChange={() => undefined} selectedFrameId={null} onFrameSelect={() => undefined} />);
    expect(screen.getByTestId('frame-repair-indicator')).toBeTruthy();

    act(() => {
      useStudioStore.setState({
        qualityRepairRequests: {},
        qualityRuns: { 'frame-1': { frameId: 'frame-1', status: 'passed', message: 'done', updatedAt: 1 } },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('frame-repair-indicator')).toBeNull();
      expect(screen.getByTestId('storyboard-thumbnail-content').classList.contains('storyboard-thumbnail-content--repairing')).toBe(false);
    });
  });
});
