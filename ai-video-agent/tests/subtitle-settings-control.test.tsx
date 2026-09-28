// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SubtitleSettingsControl } from '@/components/studio/subtitle-settings-control';
import { useStudioStore } from '@/stores/studio-store';

describe('SubtitleSettingsControl', () => {
  beforeEach(() => {
    useStudioStore.setState({
      showSubtitle: true,
      subtitleHorizontal: 50,
      subtitleVertical: 12,
      selectedFrameId: 'frame-1',
    });
  });

  it('keeps the compact label while updating the shared studio settings', () => {
    render(<SubtitleSettingsControl />);

    expect(screen.getByText('字幕')).toBeTruthy();
    expect(screen.queryByText('全局')).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: '切换全局字幕显示' }));
    expect(useStudioStore.getState().showSubtitle).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '打开全局字幕设置' }));
    expect(screen.getByRole('dialog', { name: '全局字幕设置' })).toBeTruthy();
    expect(screen.getByText('应用于所有分镜，并在预览中实时生效')).toBeTruthy();

    fireEvent.change(screen.getByRole('slider', { name: '水平位置' }), { target: { value: '65' } });
    fireEvent.change(screen.getByRole('slider', { name: '垂直位置' }), { target: { value: '24' } });

    expect(useStudioStore.getState().subtitleHorizontal).toBe(65);
    expect(useStudioStore.getState().subtitleVertical).toBe(24);
  });

  it('constrains portrait subtitles to the conservative Douyin safe area', () => {
    render(<SubtitleSettingsControl canvasPreset="douyin-portrait-9-16" />);
    fireEvent.click(screen.getByRole('button', { name: '打开全局字幕设置' }));

    expect(screen.getByRole('slider', { name: '水平位置' }).getAttribute('min')).toBe('43');
    expect(screen.getByRole('slider', { name: '水平位置' }).getAttribute('max')).toBe('48');
    expect(screen.getByRole('slider', { name: '垂直位置' }).getAttribute('min')).toBe('22');
    expect(screen.getByRole('slider', { name: '垂直位置' }).getAttribute('max')).toBe('25');

    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(useStudioStore.getState().subtitleHorizontal).toBe(46);
    expect(useStudioStore.getState().subtitleVertical).toBe(23);
  });
});
