// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayer } from '@/components/player/use-player';
import { useStudioStore } from '@/stores/studio-store';
import type { ProjectDetail } from '@/types';

function projectWithSources(
  frames: Array<{ id: string; audioDuration?: number; audioPath?: string }>,
): ProjectDetail {
  return {
    uuid: 'project-1',
    title: 'Player test',
    type: 'html',
    canvasPreset: 'landscape-16-9',
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
    hasOutline: true,
    styleId: null,
    outline: {
      title: 'Outline',
      totalDuration: frames.reduce((sum, frame) => sum + (frame.audioDuration ?? 3), 0),
      frames: frames.map((frame, index) => ({
        id: frame.id,
        index,
        title: `Frame ${index + 1}`,
        narration: `Narration ${index + 1}`,
      })),
    },
    videoSource: {
      frames: frames.map(frame => ({
        id: frame.id,
        audioDuration: frame.audioDuration,
        audioPath: frame.audioPath,
        htmlCode: '<div>frame</div>',
      })),
    },
  };
}

describe('usePlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => (
      window.setTimeout(() => callback(performance.now()), 16)
    ));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => window.clearTimeout(id));
    useStudioStore.setState({ selectedFrameId: null, isPlaying: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('seeks to a storyboard frame while paused', () => {
    const project = projectWithSources([{ id: 'a' }, { id: 'b' }]);
    const { result } = renderHook(() => usePlayer(project, 0));

    act(() => result.current.seekToFrame('b'));

    expect(result.current.currentIndex).toBe(1);
    expect(result.current.currentTime).toBe(0);
    expect(result.current.status).toBe('idle');
    expect(useStudioStore.getState().selectedFrameId).toBe('b');
  });

  it('jumps to a storyboard frame and keeps playing', () => {
    const project = projectWithSources([{ id: 'a' }, { id: 'b', audioDuration: 2 }]);
    const { result } = renderHook(() => usePlayer(project, 0));

    act(() => result.current.play());
    const revisionBeforeJump = result.current.playbackRevision;
    act(() => result.current.playFromIndex(1));

    expect(result.current.currentIndex).toBe(1);
    expect(result.current.status).toBe('playing');
    expect(result.current.playbackRevision).toBeGreaterThan(revisionBeforeJump);
    expect(useStudioStore.getState().selectedFrameId).toBe('b');
  });

  it('ignores a silent duration placeholder when no audio file exists', () => {
    const project = projectWithSources([{ id: 'a', audioDuration: 1 }, { id: 'b', audioDuration: 1 }]);
    const { result } = renderHook(() => usePlayer(project, 0));

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(2999));
    expect(result.current.currentIndex).toBe(0);

    act(() => vi.advanceTimersByTime(1));

    expect(result.current.currentIndex).toBe(1);
    expect(result.current.status).toBe('playing');
    expect(useStudioStore.getState().selectedFrameId).toBe('b');
  });

  it('uses a 3 second default duration when a frame has no audioDuration', () => {
    const project = projectWithSources([{ id: 'a' }, { id: 'b', audioDuration: 1 }]);
    const { result } = renderHook(() => usePlayer(project, 0));

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(2999));
    expect(result.current.currentIndex).toBe(0);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.currentIndex).toBe(1);
    expect(useStudioStore.getState().selectedFrameId).toBe('b');
  });

  it('tracks audio currentTime on animation frames without timeupdate events', async () => {
    const project = projectWithSources([{ id: 'a', audioDuration: 3, audioPath: '/a.mp3' }]);
    const { result } = renderHook(() => usePlayer(project, 0));
    const audio = document.createElement('audio');
    Object.defineProperty(audio, 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(audio, 'ended', { configurable: true, value: false });
    vi.spyOn(audio, 'play').mockResolvedValue();
    vi.spyOn(audio, 'pause').mockImplementation(() => {});
    (result.current.audioRef as React.MutableRefObject<HTMLAudioElement | null>).current = audio;

    await act(async () => {
      result.current.play();
      await Promise.resolve();
    });

    audio.currentTime = 1.25;
    act(() => vi.advanceTimersByTime(16));
    expect(result.current.currentTime).toBe(1.25);

    act(() => result.current.pause());
    audio.currentTime = 2.5;
    act(() => vi.advanceTimersByTime(64));
    expect(result.current.currentTime).toBe(1.25);
    expect(result.current.status).toBe('paused');
  });

  it('uses the loaded media duration and fills progress before advancing', async () => {
    const project = projectWithSources([
      { id: 'a', audioDuration: 3, audioPath: '/a.mp3' },
      { id: 'b', audioDuration: 1 },
    ]);
    const { result } = renderHook(() => usePlayer(project, 0));
    const audio = document.createElement('audio');
    Object.defineProperty(audio, 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(audio, 'duration', { configurable: true, value: 1.25 });
    Object.defineProperty(audio, 'ended', { configurable: true, value: false });
    vi.spyOn(audio, 'play').mockResolvedValue();
    vi.spyOn(audio, 'pause').mockImplementation(() => {});
    (result.current.audioRef as React.MutableRefObject<HTMLAudioElement | null>).current = audio;

    await act(async () => {
      result.current.play();
      await Promise.resolve();
    });

    expect(result.current.currentFrameDuration).toBe(1.25);
    act(() => audio.dispatchEvent(new Event('ended')));
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.currentTime).toBe(1.25);

    act(() => vi.advanceTimersByTime(125));
    expect(result.current.currentIndex).toBe(0);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.currentIndex).toBe(1);
  });

  it('resumes a paused frame from its preserved time', () => {
    const project = projectWithSources([{ id: 'a', audioDuration: 3 }]);
    const { result } = renderHook(() => usePlayer(project, 0));

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1200));
    act(() => result.current.pause());
    const pausedAt = result.current.currentTime;

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.currentTime).toBe(pausedAt);

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.status).toBe('playing');
    expect(result.current.currentTime).toBeGreaterThan(pausedAt);
  });

  it('separates restart from resetting the selected frame', () => {
    const project = projectWithSources([{ id: 'a', audioDuration: 3 }]);
    const { result } = renderHook(() => usePlayer(project, 0));

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1200));
    act(() => result.current.restart());
    expect(result.current.currentTime).toBe(0);
    expect(result.current.status).toBe('playing');

    act(() => vi.advanceTimersByTime(400));
    act(() => result.current.resetToSelectedFrame());
    expect(result.current.currentTime).toBe(0);
    expect(result.current.status).toBe('idle');
  });

  it('seeks only within the current frame and preserves paused state', () => {
    const project = projectWithSources([{ id: 'a', audioDuration: 3 }, { id: 'b', audioDuration: 5 }]);
    const { result } = renderHook(() => usePlayer(project, 0));

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(500));
    act(() => result.current.pause());
    act(() => result.current.seek(12));

    expect(result.current.currentIndex).toBe(0);
    expect(result.current.currentTime).toBe(3);
    expect(result.current.status).toBe('paused');
  });
});
