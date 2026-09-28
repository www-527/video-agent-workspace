// @vitest-environment happy-dom

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewCanvas } from '@/components/studio/preview-canvas';
import { useStudioStore } from '@/stores/studio-store';
import type { FrameSource, ProjectDetail } from '@/types';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const project: ProjectDetail = {
  uuid: 'project-1',
  title: 'Transition test',
  type: 'html',
  canvasPreset: 'landscape-16-9',
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  hasOutline: true,
  styleId: null,
  outline: {
    title: 'Outline',
    totalDuration: 6,
    frames: [
      { id: 'frame-a', index: 1, title: 'A', narration: 'First scene' },
      { id: 'frame-b', index: 2, title: 'B', narration: 'Second scene' },
    ],
  },
  videoSource: { frames: [] },
};

const sourceA: FrameSource = {
  id: 'frame-a',
  audioDuration: 3,
  htmlCode: '<style>@keyframes enter{from{opacity:0}to{opacity:1}}h1{animation:enter .4s both}</style><h1>A</h1>',
};
const sourceB: FrameSource = {
  id: 'frame-b',
  audioDuration: 3,
  htmlCode: '<style>@keyframes enter{from{opacity:0}to{opacity:1}}h1{animation:enter .4s both}</style><h1>B</h1>',
};

describe('PreviewCanvas scene transitions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    useStudioStore.setState({
      selectedElement: null,
      selectedElementIds: [],
      layoutAudits: {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the original outgoing iframe alive instead of replaying its entry animation', async () => {
    const view = render(
      <PreviewCanvas project={project} frameSource={sourceA} showSubtitle={false} playbackRevision={1} />,
    );
    const iframeA = view.container.querySelector('iframe');
    const layerA = iframeA?.closest('[data-preview-layer]');
    expect(iframeA).not.toBeNull();

    view.rerender(
      <PreviewCanvas project={project} frameSource={sourceB} showSubtitle={false} playbackRevision={2} />,
    );

    await act(async () => {});
    expect(view.container.querySelectorAll('iframe')).toHaveLength(2);
    expect(view.container.querySelector('iframe')).toBe(iframeA);
    expect(iframeA?.closest('[data-preview-layer]')).toBe(layerA);
    expect(layerA?.getAttribute('data-preview-layer')).toBe('outgoing');

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(view.container.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('keeps the current iframe mounted when playback restarts the same frame', async () => {
    const view = render(
      <PreviewCanvas
        project={project}
        frameSource={sourceA}
        showSubtitle={false}
        isPlaying={false}
        playbackRevision={0}
      />,
    );
    const iframe = view.container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const postMessage = vi.spyOn(iframe!.contentWindow!, 'postMessage');
    postMessage.mockClear();

    view.rerender(
      <PreviewCanvas
        project={project}
        frameSource={sourceA}
        showSubtitle={false}
        isPlaying
        playbackRevision={1}
      />,
    );

    await act(async () => {});
    expect(view.container.querySelector('iframe')).toBe(iframe);
    const playbackMessages = postMessage.mock.calls.filter(([message]) => (
      (message as { type?: string }).type === '__ai_video_playback_state'
    ));
    expect(playbackMessages.length).toBeGreaterThanOrEqual(1);
    playbackMessages.forEach(([message]) => {
      expect(message).toMatchObject({ isPlaying: true, playbackRevision: 1 });
    });
    expect(new Set(playbackMessages.map(([message]) => JSON.stringify(message)))).toHaveLength(1);
  });

  it('defers same-frame HTML updates until playback stops', async () => {
    const view = render(
      <PreviewCanvas
        project={project}
        frameSource={sourceA}
        showSubtitle={false}
        isPlaying
        playbackRevision={1}
      />,
    );
    const iframe = view.container.querySelector('iframe');
    const initialSrcDoc = iframe?.getAttribute('srcdoc');
    const updatedSource = {
      ...sourceA,
      htmlCode: '<style>h1{color:red}</style><h1>UPDATED AFTER REPAIR</h1>',
    };

    view.rerender(
      <PreviewCanvas
        project={project}
        frameSource={updatedSource}
        showSubtitle={false}
        isPlaying
        playbackRevision={1}
      />,
    );
    await act(async () => {});

    expect(view.container.querySelector('iframe')).toBe(iframe);
    expect(iframe?.getAttribute('srcdoc')).toBe(initialSrcDoc);
    expect(iframe?.getAttribute('srcdoc')).not.toContain('UPDATED AFTER REPAIR');

    view.rerender(
      <PreviewCanvas
        project={project}
        frameSource={updatedSource}
        showSubtitle={false}
        isPlaying={false}
        playbackRevision={1}
      />,
    );
    await act(async () => {});

    expect(view.container.querySelector('iframe')).toBe(iframe);
    expect(iframe?.getAttribute('srcdoc')).toContain('UPDATED AFTER REPAIR');
  });
});
