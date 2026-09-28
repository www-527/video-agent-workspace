// @vitest-environment happy-dom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewPanel } from '@/components/studio/preview-panel';
import { useStudioStore } from '@/stores/studio-store';
import { QUALITY_AUDIT_VERSION, qualityHtmlHash } from '@/lib/quality/auto-optimize';
import type { FrameQualityReport, ProjectDetail } from '@/types';

vi.mock('@/components/studio/preview-toolbar', () => ({
  PreviewToolbar: () => <div data-testid="preview-toolbar" />,
}));

const BASE_TIME = '2026-07-09T00:00:00.000Z';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function makeProject(): ProjectDetail {
  return {
    uuid: 'project-1',
    title: 'Preview panel test',
    type: 'html',
    canvasPreset: 'landscape-16-9',
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    hasOutline: true,
    styleId: null,
    outline: {
      title: 'Outline',
      totalDuration: 6,
      frames: [
        { id: 'frame-1', index: 1, title: 'Frame 1', narration: 'First' },
        { id: 'frame-2', index: 2, title: 'Frame 2', narration: 'Second' },
      ],
    },
    videoSource: {
      frames: [
        { id: 'frame-1', htmlCode: '<html><body><div>one</div></body></html>', audioDuration: 3 },
        { id: 'frame-2', htmlCode: '<html><body><div>two</div></body></html>', audioDuration: 3 },
      ],
    },
  };
}

function makeAcceptedReport(frameId: string, htmlCode: string): FrameQualityReport {
  return {
    frameId,
    status: 'passed',
    scoreBefore: 60,
    scoreAfter: 100,
    iterations: 1,
    issues: [],
    appliedFixes: [{ elementId: 'title', changes: { top: 10 }, beforeScore: 60, afterScore: 100 }],
    auditedAt: Date.now(),
    auditVersion: QUALITY_AUDIT_VERSION,
    htmlHash: qualityHtmlHash(htmlCode),
  };
}

describe('PreviewPanel tune preview mode', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    useStudioStore.setState({
      selectedFrameId: 'frame-1',
      showSubtitle: true,
      isPlaying: false,
      generatingFrames: {},
      tunePreview: {
        frameId: 'frame-1',
        htmlCode: '<html><body><div>temporary tune preview</div></body></html>',
      },
      qualityRepairRequests: {},
      qualityRepairJobs: {},
      qualityRepairStops: {},
      qualityRuns: {},
      layoutAudits: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the repair blur and status overlay on the large preview for the active frame', () => {
    useStudioStore.setState({ qualityRepairRequests: { 'frame-1': 1 } });

    render(
      <PreviewPanel
        project={makeProject()}
        onProjectChange={vi.fn()}
        onFrameSelect={vi.fn()}
      />,
    );

    expect(screen.getByTestId('preview-canvas-content').classList.contains('preview-canvas-content--repairing')).toBe(true);
    expect(screen.getByTestId('preview-repair-indicator').getAttribute('data-state')).toBe('repairing');
    expect(screen.getByTestId('preview-repair-indicator').textContent).toContain('正在优化');
  });

  it('exits tune preview before manually switching storyboard frames', async () => {
    const onFrameSelect = vi.fn((id: string | null) => {
      useStudioStore.getState().setSelectedFrameId(id);
    });

    render(
      <PreviewPanel
        project={makeProject()}
        onProjectChange={vi.fn()}
        onFrameSelect={onFrameSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /选择分镜 #2 Frame 2/ }));

    await waitFor(() => {
      expect(useStudioStore.getState().tunePreview).toBeNull();
      expect(useStudioStore.getState().selectedFrameId).toBe('frame-2');
    });
  });

  it('does not trigger automatic visual repair when the setting is disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useStudioStore.setState({ tunePreview: null });

    render(
      <PreviewPanel
        project={makeProject()}
        onProjectChange={vi.fn()}
        onFrameSelect={vi.fn()}
        autoOptimizeEnabled={false}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useStudioStore.getState().qualityRuns).toEqual({});
  });

  it('automatically triggers the same visual repair action in outline order', async () => {
    const project = makeProject();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/frame-quality/repair')) {
        const body = JSON.parse(String(init?.body || '{}')) as { frameId: string };
        const htmlCode = `<html><body><div>${body.frameId}-fixed</div></body></html>`;
        return {
          ok: true,
          json: async () => ({
            status: 'accepted',
            htmlCode,
            report: makeAcceptedReport(body.frameId, htmlCode),
            verification: 'terminal',
          }),
        } as Response;
      }
      if (url.endsWith('/frame-tunes/apply')) {
        return { ok: true, json: async () => ({ project }) } as Response;
      }
      return { ok: false, json: async () => ({ error: 'unexpected request' }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    useStudioStore.setState({ tunePreview: null });

    render(
      <PreviewPanel
        project={project}
        onProjectChange={vi.fn()}
        onFrameSelect={vi.fn()}
      />,
    );

    await waitFor(() => {
      const repairCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/frame-quality/repair'));
      expect(repairCalls).toHaveLength(2);
    });

    const repairedFrameIds = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/frame-quality/repair'))
      .map(([, init]) => (JSON.parse(String((init as RequestInit).body || '{}')) as { frameId: string }).frameId);
    expect(repairedFrameIds).toEqual(['frame-1', 'frame-2']);
    expect(useStudioStore.getState().qualityRepairRequests).toEqual({});
  });

  it('defers an in-flight automatic repair update until playback stops', async () => {
    const project = makeProject();
    const onProjectChange = vi.fn();
    let completeRepair: (() => void) | undefined;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/frame-quality/repair')) {
        const body = JSON.parse(String(init?.body || '{}')) as { frameId: string };
        return new Promise<Response>(resolve => {
          completeRepair = () => {
            const htmlCode = `<html><body><div>${body.frameId}-fixed</div></body></html>`;
            resolve({
              ok: true,
              json: async () => ({
                status: 'accepted',
                htmlCode,
                report: makeAcceptedReport(body.frameId, htmlCode),
                verification: 'terminal',
              }),
            } as Response);
          };
        });
      }
      if (url.endsWith('/frame-tunes/apply')) {
        return Promise.resolve({ ok: true, json: async () => ({ project }) } as Response);
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: 'unexpected request' }) } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    useStudioStore.setState({ tunePreview: null });

    render(
      <PreviewPanel
        project={project}
        onProjectChange={onProjectChange}
        onFrameSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(completeRepair).toBeTypeOf('function'));
    const playButton = document.querySelector('button.min-w-20');
    expect(playButton).not.toBeNull();
    fireEvent.click(playButton!);
    await waitFor(() => expect(useStudioStore.getState().isPlaying).toBe(true));

    act(() => completeRepair?.());
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/frame-tunes/apply'))).toBe(true);
    });
    expect(onProjectChange).not.toHaveBeenCalled();

    fireEvent.click(playButton!);
    await waitFor(() => expect(useStudioStore.getState().isPlaying).toBe(false));
    await waitFor(() => expect(onProjectChange).toHaveBeenCalledWith(project));
  });

  it('starts manual frame repairs up to the configured frame concurrency', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/frame-quality/repair')) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: 'unexpected request' }) } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    useStudioStore.setState({
      tunePreview: null,
      qualityRepairRequests: { 'frame-1': 1, 'frame-2': 1 },
      qualityRepairJobs: {
        'frame-1': '11111111-1111-4111-8111-111111111111',
        'frame-2': '22222222-2222-4222-8222-222222222222',
      },
    });

    render(
      <PreviewPanel
        project={makeProject()}
        onProjectChange={vi.fn()}
        onFrameSelect={vi.fn()}
        autoOptimizeEnabled={false}
        frameConcurrency={2}
      />,
    );

    await waitFor(() => {
      const repairCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/frame-quality/repair'));
      expect(repairCalls).toHaveLength(2);
    });
    expect(useStudioStore.getState().qualityRuns['frame-1']?.status).toBe('visual_repairing');
    expect(useStudioStore.getState().qualityRuns['frame-2']?.status).toBe('visual_repairing');
  });

  it('aborts an active AI repair without saving a partial result', async () => {
    const repairJobId = 'b259cd05-5541-4aa6-bdfe-2220d4eb9c39';
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/cancel')) {
        return Promise.resolve({ ok: true, json: async () => ({ jobId: repairJobId, status: 'cancelled' }) } as Response);
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    useStudioStore.setState({
      tunePreview: null,
      qualityRepairRequests: { 'frame-1': 1 },
      qualityRepairJobs: { 'frame-1': repairJobId },
    });

    const project = makeProject();
    project.videoSource!.frames.forEach(frame => {
      frame.qualityReport = {
        frameId: frame.id,
        status: 'passed',
        scoreBefore: 100,
        scoreAfter: 100,
        iterations: 0,
        issues: [],
        appliedFixes: [],
        auditedAt: Date.now(),
        auditVersion: QUALITY_AUDIT_VERSION,
        htmlHash: qualityHtmlHash(frame.htmlCode!),
      };
    });

    render(
      <PreviewPanel
        project={project}
        onProjectChange={vi.fn()}
        onFrameSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/frame-quality/repair'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));

    act(() => useStudioStore.getState().stopQualityRepair('frame-1'));

    await waitFor(() => {
      const repairCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/frame-quality/repair') && !String(url).includes('/cancel'));
      expect((repairCall?.[1] as RequestInit).signal?.aborted).toBe(true);
      expect(useStudioStore.getState().qualityRuns['frame-1']?.status).toBe('needs_review');
      expect(useStudioStore.getState().qualityRuns['frame-1']?.message).toContain('已停止修复');
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toEqual(expect.arrayContaining([
      expect.stringContaining('/frame-tunes/apply'),
    ]));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/frame-quality/repair/${repairJobId}/cancel`),
      expect.objectContaining({ method: 'POST' }),
    );

    await waitFor(() => expect(useStudioStore.getState().qualityRepairJobs['frame-1']).toBeUndefined());
    act(() => useStudioStore.getState().requestQualityRepair('frame-1'));

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => (
      String(url).includes('/frame-quality/repair') && !String(url).includes('/cancel')
    ))).toHaveLength(2));
    const nextJobId = useStudioStore.getState().qualityRepairJobs['frame-1'];
    expect(nextJobId).toBeTruthy();
    expect(nextJobId).not.toBe(repairJobId);

    act(() => useStudioStore.getState().stopQualityRepair('frame-1'));
    await waitFor(() => {
      const repairCalls = fetchMock.mock.calls.filter(([url]) => (
        String(url).includes('/frame-quality/repair') && !String(url).includes('/cancel')
      ));
      expect((repairCalls[1][1] as RequestInit).signal?.aborted).toBe(true);
      expect(useStudioStore.getState().qualityRuns['frame-1']?.status).toBe('needs_review');
    });
  });
});
