// @vitest-environment happy-dom

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewPanel } from '@/components/studio/preview-panel';
import { useStudioStore } from '@/stores/studio-store';
import type { ProjectDetail } from '@/types';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  getDisplayMedia: vi.fn(),
  recordStreamToMP4: vi.fn(),
  player: {
    status: 'idle' as const,
    currentIndex: 0,
    currentTime: 0,
    playbackRevision: 0,
    audioRef: { current: null },
    togglePlay: vi.fn(),
    play: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
    restart: vi.fn(),
    resetToSelectedFrame: vi.fn(),
    seek: vi.fn(),
    playFromIndex: vi.fn(),
    seekToFrame: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/webcodecs-mp4-encoder', () => ({
  isWebCodecsMP4Supported: () => true,
  recordStreamToMP4: mocks.recordStreamToMP4,
}));

vi.mock('@/components/player/use-player', () => ({
  usePlayer: () => mocks.player,
}));

vi.mock('@/components/studio/preview-toolbar', () => ({
  PreviewToolbar: ({ onExport }: { onExport: () => void }) => (
    <button type="button" onClick={onExport}>导出视频</button>
  ),
}));

vi.mock('@/components/studio/preview-canvas', () => ({
  PreviewCanvas: React.forwardRef(function PreviewCanvas() {
    return null;
  }),
}));

vi.mock('@/components/studio/storyboard-strip', () => ({
  StoryboardStrip: () => null,
}));

vi.mock('@/components/studio/player-bar', () => ({ PlayerBar: () => null }));

vi.mock('@/components/studio/export-recording-overlay', () => ({
  ExportRecordingOverlay: () => null,
}));

const BASE_TIME = '2026-07-20T00:00:00.000Z';

function renderJob(stage: 'queued' | 'completed' = 'queued') {
  return {
    id: 'render-job-1',
    projectId: 'project-export-override',
    stage,
    progress: stage === 'completed' ? 100 : 0,
    message: stage === 'completed' ? '本地离线导出完成。' : '任务已加入本地渲染队列。',
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    elapsedMs: 0,
    estimatedRemainingMs: stage === 'completed' ? 0 : null,
    cacheHits: 0,
    offlineRendered: stage === 'completed' ? 1 : 0,
    realtimeFallbacks: 0,
    failedScenes: 0,
    scenes: [{
      id: 'frame-1',
      index: 0,
      title: 'Frame 1',
      stage: stage === 'completed' ? 'completed' : 'pending',
      renderMode: 'html',
      warnings: [],
    }],
    visualWarnings: [],
  };
}

function makeProject(type: 'html' | 'image' = 'html'): ProjectDetail {
  return {
    uuid: 'project-export-override',
    title: 'Export override test',
    type,
    canvasPreset: 'landscape-16-9',
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    hasOutline: true,
    styleId: null,
    outline: {
      title: 'Outline',
      totalDuration: 3,
      frames: [
        { id: 'frame-1', index: 1, title: 'Frame 1', narration: 'First' },
      ],
    },
    videoSource: {
      frames: [
        {
          id: 'frame-1',
          htmlCode: '<html><body><div>one</div></body></html>',
          imagePath: '/frame-1.png',
          audioDuration: 3,
        },
      ],
    },
  };
}

describe('PreviewPanel export preflight override', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => (
      window.setTimeout(() => callback(performance.now()), 16)
    ));
    mocks.toastError.mockReset();
    mocks.getDisplayMedia.mockReset();
    mocks.recordStreamToMP4.mockReset();
    mocks.player.status = 'idle';
    mocks.player.currentIndex = 0;
    mocks.player.currentTime = 0;
    mocks.player.playFromIndex.mockReset();
    mocks.player.resetToSelectedFrame.mockReset();
    mocks.getDisplayMedia.mockRejectedValue(new Error('用户取消共享'));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/projects/') && init?.method === 'POST') {
        return new Response(JSON.stringify({ job: renderJob('queued') }), { status: 202 });
      }
      if (url.includes('/api/render-jobs/')) {
        return new Response(JSON.stringify({ job: renderJob('completed') }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: mocks.getDisplayMedia },
    });
    useStudioStore.setState({
      selectedFrameId: 'frame-1',
      showSubtitle: true,
      isPlaying: false,
      generatingFrames: { 'keep-quality-runner-idle': 'html' },
      tunePreview: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('blocks a failed preflight without offering an export override', async () => {
    render(
      <PreviewPanel
        project={makeProject()}
        onProjectChange={vi.fn()}
        onFrameSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出视频' }));
    const auditFrame = document.querySelector('iframe');
    expect(auditFrame?.contentWindow).toBeTruthy();
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        source: auditFrame!.contentWindow,
        data: {
          type: '__ai_video_layout_audit',
          issues: [{ code: 'out_of_bounds', label: '画面越界', detail: '元素超出安全区', severity: 'critical' }],
        },
      }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    const options = mocks.toastError.mock.calls[0]?.[1] as { action?: unknown };
    expect(options.action).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.getDisplayMedia).not.toHaveBeenCalled();
  });

  it('does not start playback, request tab sharing, or add recording tail time', async () => {
    const project = makeProject('image');
    render(
      <PreviewPanel
        project={project}
        onProjectChange={vi.fn()}
        onFrameSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出视频' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const createCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST');
    expect(createCall).toBeTruthy();
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body).not.toHaveProperty('duration');
    expect(body).not.toHaveProperty('tailPadding');
    expect(mocks.player.playFromIndex).not.toHaveBeenCalled();
    expect(mocks.recordStreamToMP4).not.toHaveBeenCalled();
    expect(mocks.getDisplayMedia).not.toHaveBeenCalled();
  });

  it('passes the quality-gate bypass to the render service for a forced export', async () => {
    render(
      <PreviewPanel
        project={makeProject('image')}
        onProjectChange={vi.fn()}
        onFrameSelect={vi.fn()}
      />,
    );

    act(() => useStudioStore.getState().requestForceExport());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const createCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST');
    expect(createCall).toBeTruthy();
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ bypassQualityGate: true });
  });

});
