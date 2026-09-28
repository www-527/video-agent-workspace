import { describe, expect, it } from 'vitest';
import {
  PROTECTED_LAYOUT,
  buildProtectedLayoutGuard,
  calculateStackLayout,
  isRectContained,
} from '@/lib/layout-geometry';

describe('adaptive protected layout geometry', () => {
  it('raises a short-title stack visual zone to the safe upper limit', () => {
    expect(calculateStackLayout(180)).toMatchObject({
      textTop: 56,
      textHeight: 160,
      visualTop: 240,
      visualHeight: 360,
      reachedUpperLimit: true,
      reachedLowerLimit: false,
    });
  });

  it('keeps the 24px gutter for a normal stack title', () => {
    expect(calculateStackLayout(260)).toMatchObject({
      textHeight: 204,
      visualTop: 284,
      visualHeight: 316,
      reachedUpperLimit: false,
      reachedLowerLimit: false,
    });
  });

  it('does not push a tall title into the visual or subtitle safety limits', () => {
    expect(calculateStackLayout(290)).toMatchObject({
      visualTop: 304,
      visualHeight: 296,
      reachedLowerLimit: true,
    });
    expect(calculateStackLayout(Number.NaN).visualTop).toBe(304);
  });

  it('leaves split geometry unchanged', () => {
    expect(PROTECTED_LAYOUT.split.visual).toEqual({
      left: 568,
      top: 56,
      width: 640,
      height: 544,
    });
  });

  it('regresses the stack orbit composition with geometry instead of pixels', () => {
    const layout = calculateStackLayout(190);
    const visualZone = {
      left: PROTECTED_LAYOUT.stack.left,
      top: layout.visualTop,
      right: PROTECTED_LAYOUT.stack.left + PROTECTED_LAYOUT.stack.width,
      bottom: layout.contentBottom,
    };
    const orbitElements = [
      { left: 280, top: 252, right: 344, bottom: 316 },
      { left: 936, top: 252, right: 1000, bottom: 316 },
      { left: 304, top: 512, right: 368, bottom: 576 },
      { left: 912, top: 512, right: 976, bottom: 576 },
    ];

    expect(orbitElements.every(rect => isRectContained(rect, visualZone))).toBe(true);
  });

  it('detects a visual element that crosses a protected zone edge', () => {
    const zone = { left: 72, top: 240, right: 1208, bottom: 600 };
    expect(isRectContained({ left: 280, top: 220, right: 344, bottom: 284 }, zone)).toBe(false);
  });

  it('keeps protected-zone geometry application-owned', () => {
    const guard = buildProtectedLayoutGuard();
    expect(guard).toContain('[data-role="text-zone"],main[data-layout] [data-role="visual-zone"]');
    expect(guard).toContain('padding:0!important');
  });
});
