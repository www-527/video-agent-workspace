// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerBar } from '@/components/studio/player-bar';
import type { ProjectDetail } from '@/types';

function projectWithAudioPath(audioPath?: string): ProjectDetail {
  return {
    uuid: 'project-1',
    title: 'Player bar test',
    type: 'html',
    canvasPreset: 'landscape-16-9',
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
    hasOutline: true,
    styleId: null,
    outline: {
      title: 'Outline',
      totalDuration: 90,
      frames: [{ id: 'frame-1', index: 1, title: 'Frame 1', narration: 'Narration' }],
    },
    videoSource: {
      frames: [{ id: 'frame-1', htmlCode: '<div>frame</div>', audioPath, audioDuration: audioPath ? 3 : undefined }],
    },
  };
}

function playerBar(overrides: Partial<React.ComponentProps<typeof PlayerBar>> = {}) {
  return (
    <PlayerBar
      project={projectWithAudioPath()}
      currentIndex={0}
      currentFrameDuration={3}
      totalDuration={90}
      status="idle"
      currentTime={0}
      audioRef={{ current: null } as RefObject<HTMLAudioElement>}
      onTogglePlay={vi.fn()}
      onRestart={vi.fn()}
      exportStatus="idle"
      exportMessage=""
      {...overrides}
    />
  );
}

describe('PlayerBar', () => {
  afterEach(() => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  it('keeps the audio element mounted and updates its source for voiced frames', () => {
    const { container, rerender } = render(playerBar());
    expect(container.querySelector('audio')).toBeTruthy();

    rerender(playerBar({ project: projectWithAudioPath('/api/data/audio/project-1/frame-1.mp3') }));
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('/api/data/audio/project-1/frame-1.mp3');
  });

  it('shows explicit playback semantics and frame-local timing', () => {
    const onTogglePlay = vi.fn();
    const onRestart = vi.fn();
    render(playerBar({
      status: 'paused',
      currentTime: 1,
      onTogglePlay,
      onRestart,
    }));

    fireEvent.click(screen.getByRole('button', { name: '继续播放' }));
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }));
    expect(onTogglePlay).toHaveBeenCalledOnce();
    expect(onRestart).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '回到开头' })).toBeNull();
    expect(screen.getByText(/已暂停 ·/)).toBeTruthy();
    expect(screen.getByText(/00:01 \/ 00:03/)).toBeTruthy();
    expect(screen.getByText('全片：01:30')).toBeTruthy();
  });

  it('exposes a non-interactive accessible frame-local progress bar', () => {
    render(playerBar({ currentTime: 1 }));
    const progress = screen.getByRole('progressbar', { name: '当前分镜播放进度' });
    expect(progress.getAttribute('aria-valuemax')).toBe('3');
    expect(progress.getAttribute('aria-valuenow')).toBe('1');
    expect(progress.getAttribute('aria-valuetext')).toBe('00:01 / 00:03');
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('toggles playback with non-repeated Space only while the preview is fullscreen', () => {
    const preview = document.createElement('div');
    const input = document.createElement('input');
    preview.appendChild(input);
    document.body.appendChild(preview);
    const onTogglePlay = vi.fn();
    render(playerBar({ previewRef: { current: preview }, onTogglePlay }));

    fireEvent.keyDown(document, { code: 'Space', key: ' ' });
    expect(onTogglePlay).not.toHaveBeenCalled();

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: preview });
    fireEvent(document, new Event('fullscreenchange'));
    const fullscreenButton = screen.getByRole('button', { name: '退出全屏' });
    expect(fullscreenButton).toBeTruthy();

    fireEvent.keyDown(document, { code: 'Space', key: ' ', repeat: true });
    fireEvent.keyDown(input, { code: 'Space', key: ' ' });
    expect(onTogglePlay).not.toHaveBeenCalled();

    const event = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onTogglePlay).toHaveBeenCalledOnce();

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    fireEvent.keyDown(document, { code: 'Space', key: ' ' });
    expect(onTogglePlay).toHaveBeenCalledOnce();
  });

  it('does not duplicate task-level export controls in the player', () => {
    render(playerBar({ onExport: vi.fn(), onCancelExport: vi.fn() }));
    expect(screen.queryByRole('button', { name: '导出视频' })).toBeNull();
  });
});
