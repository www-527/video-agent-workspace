import { describe, expect, it } from 'vitest';
import { subtitleFontSizeForCanvas } from '@/components/player/subtitle-layer';

describe('subtitleFontSizeForCanvas', () => {
  it('scales landscape subtitles from the canvas width instead of the browser viewport', () => {
    expect(subtitleFontSizeForCanvas('landscape-16-9')).toBe('1.875cqw');
  });

  it('scales portrait subtitles from the canvas width instead of forcing a large preview font', () => {
    expect(parseFloat(subtitleFontSizeForCanvas('douyin-portrait-9-16'))).toBeCloseTo(28 / 720 * 100);
    expect(subtitleFontSizeForCanvas('douyin-portrait-9-16')).toMatch(/cqw$/);
  });
});
