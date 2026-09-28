import { getCanvasPreset } from '@/lib/canvas-presets';
import type { CanvasPresetId } from '@/types';

export const SUBTITLE_LINE_HEIGHT = 1.35;
export const SUBTITLE_LETTER_SPACING = '0.02em';
export const SUBTITLE_TEXT_SHADOW = '0 0.07em 0.14em rgba(0,0,0,.95), 0 0 0.28em rgba(0,0,0,.65)';

export function getSubtitleVisualStyle(canvasPreset?: CanvasPresetId) {
  const preset = getCanvasPreset(canvasPreset);
  const safeWidth = preset.platformSafeArea.right - preset.platformSafeArea.left;
  return {
    fontSize: preset.subtitle.fontSize,
    maxWidth: Math.min(preset.subtitle.maxWidth, safeWidth),
    lineHeight: SUBTITLE_LINE_HEIGHT,
    letterSpacing: SUBTITLE_LETTER_SPACING,
    textShadow: SUBTITLE_TEXT_SHADOW,
  };
}

export function subtitleFontSizeForCanvas(canvasPreset?: CanvasPresetId): string {
  const preset = getCanvasPreset(canvasPreset);
  return `${getSubtitleVisualStyle(canvasPreset).fontSize / preset.design.width * 100}cqw`;
}
