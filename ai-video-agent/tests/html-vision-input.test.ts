import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callAIHtml: vi.fn(),
  readLocalPexelsImageInput: vi.fn(),
}));

vi.mock('@/lib/ai/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ai/client')>();
  return { ...actual, callAIHtml: mocks.callAIHtml };
});
vi.mock('@/lib/pexels/local-asset', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/pexels/local-asset')>();
  return { ...actual, readLocalPexelsImageInput: mocks.readLocalPexelsImageInput };
});

import { generateFrameHtml, generateFreeFrameHtml } from '@/lib/ai/html';
import { VisionUnavailableError } from '@/lib/ai/client';

const path = '/api/data/pexels/project/frame-1.jpg';
const html = `<!DOCTYPE html><html><head><style>body{margin:0}main{width:1920px;height:1080px}section{position:relative}.visual{width:100%;height:100%;object-fit:cover}</style></head><body><main data-layout="split"><section data-role="text-zone"><h1>风机</h1></section><section data-role="visual-zone"><div data-role="visual-content"><img class="visual" src="${path}" alt="wind turbine"></div></section></main></body></html>`;
const asset = {
  provider: 'pexels', photoId: 1, localPath: path, query: 'wind turbine', alt: 'wind turbine', width: 1920, height: 1080,
  photographer: 'Tester', photographerUrl: '', pexelsUrl: '', fitMode: 'cover', position: 'center', layout: 'editorial-split',
  scaleFrom: 1, scaleTo: 1.02, downloadedAt: new Date(0).toISOString(),
} as any;
const review = {
  status: 'accepted', selectedPhotoId: 1, backupPhotoIds: [], subjectMatch: 'high', safeTextSide: 'left',
  subjectPosition: 'right', cropRisk: 'low', rationale: '主体在右侧。', rejections: [],
} as any;

const freeFrameOptions = () => ({
  globalScript: '旁白',
  frame: { id: 'frame-1', index: 1, title: '风机', narration: '展示风机。' } as any,
  visualBible: { version: 'gpt-visual-bible-v1', themeId: 'theme', visualLanguage: 'editorial', motifs: [], pacing: 'steady', prohibitions: [] } as any,
});

describe('HTML image-assisted generation', () => {
  it('sends the localized primary image and soft composition guidance to standard HTML', async () => {
    mocks.callAIHtml.mockReset();
    mocks.readLocalPexelsImageInput.mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,AA==', mimeType: 'image/jpeg', byteLength: 1 });
    mocks.callAIHtml.mockResolvedValue({ output: html, finishReason: 'stop', outputLength: html.length, reasoningLength: 0, lengthLimited: false, emptyOutput: false });

    await generateFrameHtml({
      globalScript: '旁白', stylePrompt: 'editorial', frame: { id: 'frame-1', index: 1, title: '风机', narration: '展示风机。' } as any,
      realImages: [asset], visionReview: review,
    });

    expect(mocks.callAIHtml).toHaveBeenCalledTimes(1);
    expect(mocks.callAIHtml.mock.calls[0][0]).toMatchObject({
      requiresVision: true,
      images: [{ dataUrl: 'data:image/jpeg;base64,AA==', label: 'photoId=1' }],
    });
    expect(mocks.callAIHtml.mock.calls[0][0].user).toContain('主体位置：right');
    expect(mocks.callAIHtml.mock.calls[0][0].user).toContain(path);
  });

  it('uses the same localized image input adapter for GPT-free HTML', async () => {
    mocks.callAIHtml.mockReset();
    mocks.readLocalPexelsImageInput.mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,AA==', mimeType: 'image/jpeg', byteLength: 1 });
    mocks.callAIHtml.mockResolvedValue({ output: html, finishReason: 'stop', outputLength: html.length, reasoningLength: 0, lengthLimited: false, emptyOutput: false });

    await generateFreeFrameHtml({
      globalScript: '旁白', frame: { id: 'frame-1', index: 1, title: '风机', narration: '展示风机。' } as any,
      visualBible: { version: 'gpt-visual-bible-v1', themeId: 'theme', visualLanguage: 'editorial', motifs: [], pacing: 'steady', prohibitions: [] } as any,
      realImages: [asset], visionReview: review,
    });

    expect(mocks.callAIHtml).toHaveBeenCalledTimes(1);
    expect(mocks.callAIHtml.mock.calls[0][0].images).toEqual([
      expect.objectContaining({ dataUrl: 'data:image/jpeg;base64,AA==', mimeType: 'image/jpeg' }),
    ]);
    expect(mocks.callAIHtml.mock.calls[0][0].requiresVision).toBe(true);
  });

  it('keeps over-budget local paths in the prompt while limiting transient image inputs', async () => {
    mocks.callAIHtml.mockReset();
    mocks.readLocalPexelsImageInput.mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,AA==', mimeType: 'image/jpeg', byteLength: 1 });
    const assets = Array.from({ length: 11 }, (_, index) => ({
      ...asset,
      photoId: index + 1,
      localPath: `/api/data/pexels/project/frame-${index + 1}.jpg`,
    }));
    const output = `<!DOCTYPE html><html><head><style>body{margin:0}main{width:1920px;height:1080px}.visual{width:100px;height:100px}</style></head><body><main><section data-role="text-zone"><h1>多素材</h1></section><section data-role="visual-zone"><div data-role="visual-content">${assets.map(item => `<img class="visual" src="${item.localPath}" alt="wind turbine">`).join('')}</div></section></main></body></html>`;
    mocks.callAIHtml.mockResolvedValue({ output, finishReason: 'stop', outputLength: output.length, reasoningLength: 0, lengthLimited: false, emptyOutput: false });

    await generateFreeFrameHtml({
      globalScript: '旁白', frame: { id: 'frame-1', index: 1, title: '多素材', narration: '展示多张素材。' } as any,
      visualBible: { version: 'gpt-visual-bible-v1', themeId: 'theme', visualLanguage: 'editorial', motifs: [], pacing: 'steady', prohibitions: [] } as any,
      realImages: assets,
    });

    expect(mocks.callAIHtml).toHaveBeenCalledTimes(1);
    expect(mocks.callAIHtml.mock.calls[0][0].images).toHaveLength(10);
    expect(mocks.callAIHtml.mock.calls[0][0].user).toContain('超出图片输入预算');
    expect(mocks.callAIHtml.mock.calls[0][0].user).toContain('/api/data/pexels/project/frame-11.jpg');
  });

  it('does not duplicate a GPT-free HTML request after a non-vision stream failure', async () => {
    mocks.callAIHtml.mockReset();
    mocks.callAIHtml.mockRejectedValue(new Error('stream_read_error'));

    await expect(generateFreeFrameHtml({
      globalScript: '旁白',
      frame: { id: 'frame-1', index: 1, title: '失败', narration: '流读取失败。' } as any,
      visualBible: { version: 'gpt-visual-bible-v1', themeId: 'theme', visualLanguage: 'editorial', motifs: [], pacing: 'steady', prohibitions: [] } as any,
    })).rejects.toThrow('stream_read_error');

    expect(mocks.callAIHtml).toHaveBeenCalledTimes(1);
  });

  it('retries each recoverable gateway status once and returns the second valid HTML result', async () => {
    for (const [status, message] of [[502, 'Bad Gateway'], [503, 'Service Unavailable'], [504, 'Gateway Time-out']]) {
      mocks.callAIHtml.mockReset();
      const gatewayError = Object.assign(new Error(`${status} ${message}`), { status });
      mocks.callAIHtml
        .mockRejectedValueOnce(gatewayError)
        .mockResolvedValueOnce({ output: html, finishReason: 'completed', outputLength: html.length, reasoningLength: 0, lengthLimited: false, emptyOutput: false });

      await expect(generateFreeFrameHtml(freeFrameOptions())).resolves.toContain('<!DOCTYPE html>');

      expect(mocks.callAIHtml).toHaveBeenCalledTimes(2);
      expect(mocks.callAIHtml.mock.calls[1][0]).toMatchObject({
        user: mocks.callAIHtml.mock.calls[0][0].user,
        abortSignal: mocks.callAIHtml.mock.calls[0][0].abortSignal,
      });
    }
  });

  it('stops after the second gateway failure and preserves that final upstream error', async () => {
    mocks.callAIHtml.mockReset();
    const firstError = Object.assign(new Error('503 Service Unavailable'), { status: 503 });
    const finalError = Object.assign(new Error('504 Gateway Time-out'), { status: 504 });
    mocks.callAIHtml.mockRejectedValueOnce(firstError).mockRejectedValueOnce(finalError);

    await expect(generateFreeFrameHtml(freeFrameOptions())).rejects.toBe(finalError);
    expect(mocks.callAIHtml).toHaveBeenCalledTimes(2);
  });

  it('never retries cancellation, unavailable vision, or local HTML validation errors', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const cases: Array<{ error?: Error; output?: string }> = [
      { error: abortError },
      { error: new VisionUnavailableError() },
      { output: '<!DOCTYPE html><html><body>too short</body></html>' },
    ];

    for (const testCase of cases) {
      mocks.callAIHtml.mockReset();
      if (testCase.error) mocks.callAIHtml.mockRejectedValue(testCase.error);
      else mocks.callAIHtml.mockResolvedValue({ output: testCase.output, finishReason: 'completed', outputLength: testCase.output!.length, reasoningLength: 0, lengthLimited: false, emptyOutput: false });

      await expect(generateFreeFrameHtml(freeFrameOptions())).rejects.toBeDefined();
      expect(mocks.callAIHtml).toHaveBeenCalledTimes(1);
    }
  });

  it('honors cancellation during retry backoff without making a second request', async () => {
    mocks.callAIHtml.mockReset();
    const controller = new AbortController();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    mocks.callAIHtml.mockImplementationOnce(async () => {
      setTimeout(() => controller.abort(abortError), 20);
      throw Object.assign(new Error('502 Bad Gateway'), { status: 502 });
    });

    await expect(generateFreeFrameHtml({ ...freeFrameOptions(), abortSignal: controller.signal })).rejects.toBe(abortError);
    expect(mocks.callAIHtml).toHaveBeenCalledTimes(1);
  });
});
