import { describe, expect, it } from 'vitest';
import {
  captureVisualRepairSamples,
  selectVisualRepairSamplePoints,
  shouldRunThreePointVerification,
  validateVisualRepairImage,
  type VisualRepairSampleRenderer,
} from '@/lib/quality/visual-self-repair';

function pngFixture(width = 1280, height = 720): Buffer {
  const value = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value, 0);
  value.write('IHDR', 12, 'ascii');
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
}

function rendererFor(points: number[]): VisualRepairSampleRenderer {
  return {
    renderSample: async ({ progress }) => {
      points.push(progress);
      return {
        image: pngFixture(),
        issues: progress < 1 ? [{ code: 'clipped', severity: 'major', label: '过程元素', detail: '过程越界', elementId: 'moving' }] : [],
        width: 1280,
        height: 720,
      };
    },
  };
}

describe('visual self repair sampling', () => {
  it('keeps one nonce across ordered 35/70/100 samples and returns only a safe summary', async () => {
    const points: number[] = [];
    const result = await captureVisualRepairSamples({
      htmlCode: '<!doctype html><html><body><main>画面</main></body></html>',
      renderer: rendererFor(points),
    });

    expect(points).toEqual([0.35, 0.7, 1]);
    expect(result.samples.map(sample => sample.label)).toEqual(['35%', '70%', '100%']);
    expect(result.samples.every(sample => sample.image?.dataUrl.startsWith('data:image/png;base64,'))).toBe(true);
    expect(result.summary.nonce).toBe(result.nonce);
    expect(result.summary.pointsWithIssues).toEqual([0.35, 0.7]);
    expect(JSON.stringify(result.summary)).not.toContain('data:image');
  });

  it('rejects an invalid screenshot before a model can receive it', async () => {
    expect(() => validateVisualRepairImage('data:image/png;base64,not-an-image')).toThrow(/有效的 PNG/);
  });

  it('uses one correctly labelled final screenshot for a simple frame', async () => {
    const points: number[] = [];
    const result = await captureVisualRepairSamples({
      htmlCode: '<main>画面</main>',
      samplePoints: selectVisualRepairSamplePoints([]),
      renderer: rendererFor(points),
    });
    expect(points).toEqual([1]);
    expect(result.samples.map(sample => sample.label)).toEqual(['100%']);
  });

  it('keeps three samples for critical, structural, temporal or numerous findings', () => {
    expect(selectVisualRepairSamplePoints([])).toEqual([1]);
    expect(selectVisualRepairSamplePoints([{ code: 'edge_spacing', label: '标签', detail: '贴边' }])).toEqual([1]);
    expect(selectVisualRepairSamplePoints([{ code: 'clipped', label: '主体', detail: '被裁切' }])).toEqual([0.35, 0.7, 1]);
    expect(selectVisualRepairSamplePoints([{ code: 'edge_spacing', label: '主体', detail: '动画入场过程贴边' }])).toEqual([0.35, 0.7, 1]);
    expect(selectVisualRepairSamplePoints(Array.from({ length: 6 }, (_, index) => ({
      code: 'edge_spacing' as const, label: `标签 ${index}`, detail: '贴边',
    })))).toEqual([0.35, 0.7, 1]);
  });

  it('propagates cancellation without retaining partial samples', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(captureVisualRepairSamples({
      htmlCode: '<main>画面</main>',
      abortSignal: controller.signal,
      renderer: rendererFor([]),
    })).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('escalates verification for process findings or timing mutations', () => {
    expect(shouldRunThreePointVerification({
      originalIssues: [],
      sampledIssues: [{ progress: 0.35, issues: [{ code: 'clipped', label: '过程', detail: '过程问题' }] }],
      beforeHtml: '<style>.x{color:red}</style>',
      afterHtml: '<style>.x{color:blue}</style>',
    })).toBe(true);
    expect(shouldRunThreePointVerification({
      originalIssues: [],
      beforeHtml: '<style>.x{color:red}</style>',
      afterHtml: '<style>.x{color:blue}</style>',
    })).toBe(false);
    expect(shouldRunThreePointVerification({
      originalIssues: [],
      beforeHtml: '<style>.x{transform:scale(1)}</style>',
      afterHtml: '<style>.x{transform:scale(.9)}</style>',
    })).toBe(true);
  });
});
