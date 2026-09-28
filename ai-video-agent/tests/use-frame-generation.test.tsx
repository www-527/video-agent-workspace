// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFrameGeneration } from '@/hooks/use-frame-generation';
import { useStudioStore } from '@/stores/studio-store';
import type { ProjectDetail } from '@/types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn() },
}));

const project: ProjectDetail = {
  uuid: '00000000-0000-0000-0000-000000000001',
  title: 'Recovery test',
  type: 'html',
  canvasPreset: 'landscape-16-9',
  styleId: null,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
  hasOutline: true,
  outline: {
    title: 'Recovery test',
    totalDuration: 6,
    frames: [{ id: 'frame-1', index: 1, title: 'Frame', narration: 'Narration' }],
  },
  videoSource: { frames: [{ id: 'frame-1' }] },
};

function sseResponse(status: 'completed' | 'partial_failed') {
  const payload = JSON.stringify({
    mode: 'html', total: 1, current: 1, phase: 'done', status, percent: 100,
    startedAt: '2026-08-06T00:00:00.000Z',
  });
  return new Response(`event: done\ndata: ${payload}\n\n`);
}

describe('useFrameGeneration recovery', () => {
  it('retries missing audio without forcing another visual render', async () => {
    const refreshedAfterVisual: ProjectDetail = {
      ...project,
      videoSource: { frames: [{ id: 'frame-1', htmlCode: '<!DOCTYPE html><html></html>' }] },
    };
    const refreshedComplete: ProjectDetail = {
      ...refreshedAfterVisual,
      videoSource: { frames: [{ id: 'frame-1', htmlCode: '<!DOCTYPE html><html></html>', audioPath: '/audio.mp3', audioDuration: 6 }] },
    };
    const refresh = vi.fn()
      .mockResolvedValueOnce(refreshedAfterVisual)
      .mockResolvedValueOnce(refreshedComplete);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse('partial_failed'))
      .mockResolvedValueOnce(sseResponse('completed'));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useFrameGeneration({
      project,
      onProjectRefresh: refresh,
      frameConcurrency: 5,
    }));
    await act(async () => {
      await result.current.start(['frame-1'], {
        forceVisual: true,
        forceAudio: true,
        promptOverride: 'new visual direction',
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const recoveryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody).toMatchObject({
      forceVisual: true,
      forceAudio: true,
      promptOverride: 'new visual direction',
      frameConcurrency: 5,
    });
    expect(recoveryBody).toMatchObject({ frameIds: ['frame-1'], forceVisual: false, forceAudio: false });
    expect(recoveryBody.promptOverride).toBeUndefined();
  });

  it('keeps every active frame marked until that specific frame finishes', async () => {
    let releaseStream: (() => void) | undefined;
    const paused = new Promise<void>(resolve => { releaseStream = resolve; });
    const event = (name: string, payload: Record<string, unknown>) => `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
    const base = {
      mode: 'html', total: 2, current: 1, status: 'generating', percent: 10,
      startedAt: '2026-08-06T00:00:00.000Z', phase: 'html',
    };
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode([
          event('phase_start', { ...base, frameId: 'frame-1', phase: 'html' }),
          event('phase_start', { ...base, frameId: 'frame-2', phase: 'tts', current: 2 }),
          event('frame_done', { ...base, frameId: 'frame-1', phase: 'save', current: 1 }),
        ].join('')));
        await paused;
        controller.enqueue(encoder.encode(event('done', {
          ...base, phase: 'done', status: 'completed', percent: 100, current: 2,
        })));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    const refresh = vi.fn().mockResolvedValue(project);
    useStudioStore.getState().clearGeneratingFrames();

    const { result } = renderHook(() => useFrameGeneration({ project, onProjectRefresh: refresh }));
    let run: Promise<unknown> | undefined;
    act(() => { run = result.current.start(['frame-1', 'frame-2']); });

    await waitFor(() => {
      expect(useStudioStore.getState().generatingFrames).toEqual({ 'frame-2': 'tts' });
    });

    releaseStream?.();
    await act(async () => { await run; });
    expect(useStudioStore.getState().generatingFrames).toEqual({});
  });
});
