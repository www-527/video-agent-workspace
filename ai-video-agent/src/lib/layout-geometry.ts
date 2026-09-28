import { getCanvasPreset, rectHeight, rectWidth } from '@/lib/canvas-presets';
import type { CanvasPresetId } from '@/types';
import { buildPortraitGuardTokens } from '@/lib/portrait-visual-system';

export function getProtectedLayout(canvasPreset?: CanvasPresetId | string | null) {
  const preset = getCanvasPreset(canvasPreset);
  return {
    canvas: { width: preset.design.width, height: preset.design.height },
    content: { top: preset.contentArea.top, bottom: preset.contentArea.bottom },
    subtitle: { top: preset.subtitleArea.top, bottom: preset.subtitleArea.bottom },
    platformSafeArea: preset.platformSafeArea,
    split: {
      text: {
        left: preset.layout.split.text.left,
        top: preset.layout.split.text.top,
        width: rectWidth(preset.layout.split.text),
        height: rectHeight(preset.layout.split.text),
      },
      visual: {
        left: preset.layout.split.visual.left,
        top: preset.layout.split.visual.top,
        width: rectWidth(preset.layout.split.visual),
        height: rectHeight(preset.layout.split.visual),
      },
    },
    stack: preset.layout.stack,
  };
}

export const PROTECTED_LAYOUT = getProtectedLayout();

export interface StackLayoutGeometry {
  textTop: number;
  textHeight: number;
  visualTop: number;
  visualHeight: number;
  contentBottom: number;
  reachedUpperLimit: boolean;
  reachedLowerLimit: boolean;
}

export interface RectGeometry {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function calculateStackLayout(textBottom: number, canvasPreset?: CanvasPresetId | string | null): StackLayoutGeometry {
  const { content, stack } = getProtectedLayout(canvasPreset);
  const safeTextBottom = Number.isFinite(textBottom) ? textBottom : stack.visualTopMax - stack.gap;
  const requestedTop = safeTextBottom + stack.gap;
  const visualTop = Math.round(Math.min(stack.visualTopMax, Math.max(stack.visualTopMin, requestedTop)));

  return {
    textTop: content.top,
    textHeight: visualTop - content.top - stack.gap,
    visualTop,
    visualHeight: content.bottom - visualTop,
    contentBottom: content.bottom,
    reachedUpperLimit: requestedTop <= stack.visualTopMin,
    reachedLowerLimit: requestedTop >= stack.visualTopMax,
  };
}

export function isRectContained(child: RectGeometry, parent: RectGeometry, tolerance = 1): boolean {
  return child.left >= parent.left - tolerance
    && child.top >= parent.top - tolerance
    && child.right <= parent.right + tolerance
    && child.bottom <= parent.bottom + tolerance;
}

export function buildProtectedLayoutGuard(canvasPreset?: CanvasPresetId | string | null): string {
  const { canvas, content, split, stack } = getProtectedLayout(canvasPreset);
  const defaultStack = calculateStackLayout(stack.visualTopMax - stack.gap, canvasPreset);
  const portraitTokens = buildPortraitGuardTokens(canvasPreset);

  return `<style data-ai-layout-guard>
main[data-layout="split"],main[data-layout="stack"]{${portraitTokens}position:relative!important;display:block!important;width:${canvas.width}px!important;height:${canvas.height}px!important;padding:0!important;overflow:hidden!important;box-sizing:border-box!important}
main[data-layout] [data-role="text-zone"],main[data-layout] [data-role="visual-zone"]{position:absolute!important;grid-column:auto!important;grid-row:auto!important;box-sizing:border-box!important;overflow:hidden!important;isolation:isolate!important;min-width:0!important;max-width:none!important;margin:0!important;padding:0!important}
main[data-layout] [data-role="visual-content"]{position:relative!important;left:0!important;right:auto!important;top:0!important;bottom:auto!important;width:100%!important;height:100%!important;min-width:0!important;box-sizing:border-box!important;transform:none!important}
main[data-layout="split"] [data-role="text-zone"]{left:${split.text.left}px!important;right:auto!important;top:${split.text.top}px!important;bottom:auto!important;width:${split.text.width}px!important;height:${split.text.height}px!important}
main[data-layout="split"] [data-role="visual-zone"]{left:${split.visual.left}px!important;right:auto!important;top:${split.visual.top}px!important;bottom:auto!important;width:${split.visual.width}px!important;height:${split.visual.height}px!important}
main[data-layout="stack"]{--ai-stack-visual-top:${defaultStack.visualTop}px}
main[data-layout="stack"] [data-role="text-zone"]{left:${stack.left}px!important;right:auto!important;top:${content.top}px!important;bottom:auto!important;width:${stack.width}px!important;height:calc(var(--ai-stack-visual-top) - ${content.top + stack.gap}px)!important}
main[data-layout="stack"] [data-role="visual-zone"]{left:${stack.left}px!important;right:auto!important;top:var(--ai-stack-visual-top)!important;bottom:auto!important;width:${stack.width}px!important;height:calc(${content.bottom}px - var(--ai-stack-visual-top))!important}
main[data-layout] [data-role="text-zone"]{z-index:3!important}
main[data-layout] [data-role="visual-zone"]{z-index:1!important}
main[data-layout] [data-role="decoration"]{z-index:0!important}
</style>`;
}
