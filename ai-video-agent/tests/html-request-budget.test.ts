import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ callAIHtml: vi.fn() }));

vi.mock('@/lib/ai/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ai/client')>();
  return { ...actual, callAIHtml: mocks.callAIHtml };
});

import { generateFrameHtml } from '@/lib/ai/html';

const nativeHtml = `<!DOCTYPE html>
<html><head><style>
body{margin:0;width:1280px;height:720px;background:#fff;color:#111}
main{width:1280px;height:720px;display:grid;grid-template-columns:1fr 1fr;overflow:hidden}
[data-role="text-zone"],[data-role="visual-zone"]{padding:72px}
</style></head><body>
<main data-layout="split">
<section data-role="text-zone"><h1>精简请求预算</h1><p>校验反馈和原生降级共享同一预算。</p></section>
<section data-role="visual-zone"><div data-role="visual-content">A clear deterministic visual composition</div></section>
</main></body></html>`;

describe('visual composer shared request budget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('repairs the image composition once before using native fallback in the same request budget', async () => {
    mocks.callAIHtml
      .mockResolvedValueOnce({
        output: nativeHtml,
        finishReason: 'stop',
        outputLength: nativeHtml.length,
        reasoningLength: 0,
        lengthLimited: false,
        emptyOutput: false,
      })
      .mockResolvedValueOnce({
        output: nativeHtml,
        finishReason: 'stop',
        outputLength: nativeHtml.length,
        reasoningLength: 0,
        lengthLimited: false,
        emptyOutput: false,
      })
      .mockResolvedValueOnce({
        output: nativeHtml,
        finishReason: 'stop',
        outputLength: nativeHtml.length,
        reasoningLength: 0,
        lengthLimited: false,
        emptyOutput: false,
      });

    const html = await generateFrameHtml({
      globalScript: '旁白',
      stylePrompt: 'editorial',
      frame: { id: 'frame-1', index: 1, title: '预算', narration: '一次预算完成画面。' },
      realImage: {
        provider: 'pexels',
        photoId: 1,
        localPath: '/api/data/pexels/project/frame-1.jpg',
        query: 'editorial',
        alt: 'editorial subject',
        width: 1920,
        height: 1080,
        photographer: 'Tester',
        photographerUrl: 'https://example.com',
        pexelsUrl: 'https://example.com/photo',
        fitMode: 'cover',
        position: 'center',
        layout: 'editorial-split',
        scaleFrom: 1,
        scaleTo: 1.05,
        downloadedAt: new Date(0).toISOString(),
      },
      allowNativeImageFallback: true,
    });

    expect(html).toContain('精简请求预算');
    expect(mocks.callAIHtml).toHaveBeenCalledTimes(3);
    expect(mocks.callAIHtml.mock.calls[1][0].user).not.toContain('素材降级');
    expect(mocks.callAIHtml.mock.calls[1][0].user).toContain('/api/data/pexels/project/frame-1.jpg');
    expect(mocks.callAIHtml.mock.calls[2][0].user).toContain('素材降级');
    expect(mocks.callAIHtml.mock.calls[2][0].traceMaxAttempts).toBe(3);
  });
});
