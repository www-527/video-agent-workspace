import type { CanvasPresetId } from '@/types';

export interface CanvasRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CanvasPreset {
  id: CanvasPresetId;
  name: string;
  shortName: string;
  aspectRatio: '16:9' | '9:16';
  imageAspectRatio: '16:9' | '9:16';
  design: { width: number; height: number };
  output: { width: number; height: number; fps: 30 };
  platformSafeArea: CanvasRect;
  contentArea: CanvasRect;
  subtitleArea: CanvasRect;
  subtitle: {
    horizontal: number;
    vertical: number;
    maxWidth: number;
    fontSize: number;
    horizontalRange: [number, number];
    verticalRange: [number, number];
  };
  layout: {
    split: { text: CanvasRect; visual: CanvasRect };
    stack: {
      left: number;
      width: number;
      gap: number;
      visualTopMin: number;
      visualTopMax: number;
    };
  };
}

export const DEFAULT_CANVAS_PRESET: CanvasPresetId = 'landscape-16-9';

export const CANVAS_PRESETS: Record<CanvasPresetId, CanvasPreset> = {
  'landscape-16-9': {
    id: 'landscape-16-9',
    name: '横屏 16:9',
    shortName: '横屏',
    aspectRatio: '16:9',
    imageAspectRatio: '16:9',
    design: { width: 1280, height: 720 },
    output: { width: 1920, height: 1080, fps: 30 },
    platformSafeArea: { left: 0, top: 0, right: 1280, bottom: 720 },
    contentArea: { left: 72, top: 56, right: 1208, bottom: 600 },
    subtitleArea: { left: 72, top: 600, right: 1208, bottom: 720 },
    subtitle: { horizontal: 50, vertical: 12, maxWidth: 768, fontSize: 24, horizontalRange: [15, 85], verticalRange: [5, 80] },
    layout: {
      split: {
        text: { left: 72, top: 56, right: 512, bottom: 600 },
        visual: { left: 568, top: 56, right: 1208, bottom: 600 },
      },
      stack: { left: 72, width: 1136, gap: 24, visualTopMin: 240, visualTopMax: 304 },
    },
  },
  'douyin-portrait-9-16': {
    id: 'douyin-portrait-9-16',
    name: '抖音竖屏 9:16',
    shortName: '抖音竖屏',
    aspectRatio: '9:16',
    imageAspectRatio: '9:16',
    design: { width: 720, height: 1280 },
    output: { width: 1080, height: 1920, fps: 30 },
    platformSafeArea: { left: 48, top: 80, right: 608, bottom: 1040 },
    contentArea: { left: 48, top: 80, right: 608, bottom: 920 },
    subtitleArea: { left: 48, top: 920, right: 608, bottom: 1040 },
    subtitle: { horizontal: 46, vertical: 23, maxWidth: 520, fontSize: 28, horizontalRange: [43, 48], verticalRange: [22, 25] },
    layout: {
      split: {
        text: { left: 48, top: 80, right: 608, bottom: 380 },
        visual: { left: 48, top: 412, right: 608, bottom: 920 },
      },
      stack: { left: 48, width: 560, gap: 24, visualTopMin: 360, visualTopMax: 420 },
    },
  },
};

export function normalizeCanvasPreset(value?: string | null): CanvasPresetId {
  return value === 'douyin-portrait-9-16' ? value : DEFAULT_CANVAS_PRESET;
}

export function getCanvasPreset(value?: string | null): CanvasPreset {
  return CANVAS_PRESETS[normalizeCanvasPreset(value)];
}

export function isPortraitPreset(value?: string | null): boolean {
  return normalizeCanvasPreset(value) === 'douyin-portrait-9-16';
}

export function rectWidth(rect: CanvasRect): number {
  return rect.right - rect.left;
}

export function rectHeight(rect: CanvasRect): number {
  return rect.bottom - rect.top;
}

export function canvasPromptSummary(value?: string | null): string {
  const preset = getCanvasPreset(value);
  return preset.id === 'douyin-portrait-9-16'
    ? `9:16 portrait canvas (${preset.design.width}x${preset.design.height}); use vertical stacking, top-to-bottom progression and one clear focal subject`
    : `16:9 landscape canvas (${preset.design.width}x${preset.design.height})`;
}

export function portraitSafeAreaStyle(value?: string | null): Record<string, string> {
  const canvas = getCanvasPreset(value);
  if (canvas.id !== 'douyin-portrait-9-16') return {};
  return {
    padding: `${canvas.platformSafeArea.top}px ${canvas.design.width - canvas.platformSafeArea.right}px ${canvas.design.height - canvas.platformSafeArea.bottom}px ${canvas.platformSafeArea.left}px`,
    '--ui-safe-top': `${canvas.platformSafeArea.top}px`,
    '--ui-safe-right': `${canvas.design.width - canvas.platformSafeArea.right}px`,
  };
}
