import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ callAIHtml: vi.fn() }));

vi.mock('@/lib/ai/client', () => ({
  callAIHtml: mocks.callAIHtml,
  isVisionUnavailableError: (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === 'vision_unavailable'),
}));

import { repairFreeFrameHtmlWithAI } from '@/lib/ai/frame-quality-repair';
import type { VisualRepairSample } from '@/lib/quality/visual-self-repair';

const html = '<!DOCTYPE html><html><head><style>html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#ffffff}main{position:relative;width:100%;height:100%;display:grid;place-items:center}h1{font-size:64px;line-height:1.1;color:#111827}</style></head><body><main data-editor-id="root"><h1 data-editor-id="title">测试标题</h1></main></body></html>';
const sample: VisualRepairSample = {
  progress: 1,
  label: '100%',
  issues: [],
  image: {
    dataUrl: 'data:image/png;base64,AA==',
    mimeType: 'image/png',
    byteLength: 1,
    width: 1280,
    height: 720,
  },
};

describe('frame quality visual retry', () => {
  beforeEach(() => mocks.callAIHtml.mockReset());

  it('uses medium reasoning and retries one failed frame request exactly once', async () => {
    mocks.callAIHtml
      .mockRejectedValueOnce(Object.assign(new Error('503 service unavailable'), { status: 503 }))
      .mockResolvedValueOnce({ output: html, finishReason: 'completed', outputLength: html.length, reasoningLength: 0, lengthLimited: false, emptyOutput: false });

    await expect(repairFreeFrameHtmlWithAI({
      frame: { id: 'frame-1', index: 1, title: '测试标题', narration: '' },
      htmlCode: html,
      issues: [],
      visualSamples: [sample],
    })).resolves.toContain('测试标题');

    expect(mocks.callAIHtml).toHaveBeenCalledTimes(2);
    expect(mocks.callAIHtml.mock.calls[0][0]).toMatchObject({ reasoningEffort: 'medium', traceAttempt: 1, traceMaxAttempts: 2 });
    expect(mocks.callAIHtml.mock.calls[1][0]).toMatchObject({ reasoningEffort: 'medium', traceAttempt: 2, traceMaxAttempts: 2 });
    expect(mocks.callAIHtml.mock.calls[1][0].user).toContain('上次失败');
  });

  it('does not retry an explicit vision capability failure', async () => {
    mocks.callAIHtml.mockRejectedValueOnce(Object.assign(new Error('vision unsupported'), { code: 'vision_unavailable' }));
    await expect(repairFreeFrameHtmlWithAI({
      frame: { id: 'frame-1', index: 1, title: '测试标题', narration: '' },
      htmlCode: html,
      issues: [],
      visualSamples: [sample],
    })).rejects.toThrow(/vision unsupported/);
    expect(mocks.callAIHtml).toHaveBeenCalledTimes(1);
  });
});
