import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PexelsError } from '@/lib/pexels/client';
import { prepareSmartImageForFrame, prepareSmartImages } from '@/lib/pexels/smart-images';
import { planRealImages } from '@/lib/ai/real-image-planner';
import { searchPexels } from '@/lib/pexels/client';
import { downloadPexelsPhoto } from '@/lib/pexels/download';

vi.mock('@/lib/ai/real-image-planner', () => ({ planRealImages: vi.fn() }));
vi.mock('@/lib/pexels/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/pexels/client')>();
  return { ...actual, searchPexels: vi.fn() };
});
vi.mock('@/lib/pexels/download', () => ({ downloadPexelsPhoto: vi.fn() }));
vi.mock('@/lib/pexels/scoring', () => ({
  assessPexelsCandidates: vi.fn(({ photos }) => photos.map((photo: any, index: number) => ({
    photo,
    score: 90 - index,
    layout: 'editorial-split',
    fitMode: 'cover',
    matchedTerms: ['office'],
    missingTerms: [],
    rejectedTerms: [],
    accepted: true,
    reason: '命中：office',
  }))),
}));
vi.mock('@/lib/pexels/local-asset', () => ({ hashLocalPexelsAsset: vi.fn(async (path: string) => `hash:${path}`) }));

const outline = {
  title: 'test', totalDuration: 10,
  frames: Array.from({ length: 5 }, (_, index) => ({ id: `frame-${index + 1}`, index: index + 1, title: '办公室', narration: '员工工作' })),
} as any;
const photo = (id: number) => ({ id, width: 1920, height: 1080, url: `https://pexels.com/${id}`, photographer: `P${id}`, photographer_url: '', alt: 'office worker', src: { large2x: `https://images.pexels.com/${id}.jpg` } });
const smartPlan = (frameId: string) => ({
  frameId,
  useRealImage: true,
  priority: 80,
  reason: '',
  purpose: '建立真实办公场景',
  query: 'office worker',
  fallbackQueries: ['people office'],
  fallbackQuery: 'people office',
  subject: 'office worker',
  composition: 'editorial-split' as const,
  textPosition: 'left' as const,
  imageMotion: 'slow-push-in' as const,
  visualGroup: 'workplace',
  deadlineMs: 10_000,
  assetRequest: {
    query: 'office worker',
    fallbackQueries: ['people office'],
    requiredTerms: ['office'],
    optionalTerms: ['worker'],
    excludedTerms: [],
    subjectType: 'environment' as const,
    purpose: '建立真实办公场景',
    imageRequired: false,
  },
});

describe('prepareSmartImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchPexels).mockReset();
    vi.mocked(downloadPexelsPhoto).mockReset();
  });

  it('tries the next ranked candidate and only mutates its returned source copy', async () => {
    vi.mocked(planRealImages).mockResolvedValue([smartPlan('frame-1')]);
    vi.mocked(searchPexels).mockResolvedValue({ photos: [photo(1), photo(2)], total_results: 2, page: 1, per_page: 15 });
    vi.mocked(downloadPexelsPhoto).mockRejectedValueOnce(new Error('download failed')).mockResolvedValueOnce('/api/data/pexels/project/frame-1-2.jpg');
    const sources = outline.frames.map((frame: any) => ({ id: frame.id }));
    const result = await prepareSmartImages({ projectId: 'project', outline, targetFrameIds: ['frame-1'], sources, abortSignal: new AbortController().signal });
    expect(downloadPexelsPhoto).toHaveBeenCalledTimes(2);
    expect(result.sources[0].realImage?.photoId).toBe(2);
    expect(result.sources[0].imageSelection?.candidates[0]).toMatchObject({
      photoId: 2,
      localPath: '/api/data/pexels/project/frame-1-2.jpg',
      status: 'accepted',
    });
    expect(sources[0].realImage).toBeUndefined();
    expect(result.downloaded).toBe(1);
  });

  it('stops remaining requests on rate limiting and degrades every remaining frame', async () => {
    vi.mocked(planRealImages).mockResolvedValue(outline.frames.slice(0, 2).map((frame: any) => smartPlan(frame.id)));
    vi.mocked(searchPexels).mockRejectedValue(new PexelsError('rate limited', 429));
    const result = await prepareSmartImages({ projectId: 'project', outline, targetFrameIds: ['frame-1', 'frame-2'], sources: outline.frames.map((frame: any) => ({ id: frame.id })), abortSignal: new AbortController().signal });
    expect(searchPexels).toHaveBeenCalledTimes(1);
    expect(result.skipped.map(item => item.frameId)).toEqual(['frame-1', 'frame-2']);
    expect(result.failed).toHaveLength(0);
  });

  it('does no network work for an unplanned frame', async () => {
    const plan = { ...smartPlan('frame-1'), useRealImage: false };
    const result = await prepareSmartImageForFrame({
      projectId: 'project',
      frame: outline.frames[0],
      plan,
      abortSignal: new AbortController().signal,
    });
    expect(result.status).toBe('not-planned');
    expect(searchPexels).not.toHaveBeenCalled();
    expect(downloadPexelsPhoto).not.toHaveBeenCalled();
    expect(result.selection).toMatchObject({ status: 'not-planned' });
  });

  it('uses the AssetRequest subject type for a default equipment request', async () => {
    vi.mocked(searchPexels).mockResolvedValue({ photos: [photo(41)], total_results: 1, page: 1, per_page: 15 });
    vi.mocked(downloadPexelsPhoto).mockResolvedValue('/api/data/pexels/project/frame-1-slot-1-candidate-41.jpg');
    const plan = {
      ...smartPlan('frame-1'),
      query: 'offshore wind turbine at sea',
      fallbackQueries: [],
      fallbackQuery: 'offshore wind turbine at sea',
      assetRequest: {
        query: 'offshore wind turbine at sea',
        fallbackQueries: [],
        requiredTerms: ['wind', 'turbine'],
        optionalTerms: ['offshore', 'sea'],
        excludedTerms: ['solar'],
        subjectType: 'equipment' as const,
        purpose: '展示海上风机',
        imageRequired: true,
      },
    };
    const result = await prepareSmartImageForFrame({
      projectId: 'project',
      frame: outline.frames[0],
      plan,
      abortSignal: new AbortController().signal,
    });
    expect(result.status).toBe('accepted');
    expect(searchPexels).toHaveBeenCalledWith('offshore wind turbine at sea', expect.any(AbortSignal), 'landscape');
  });

  it('reuses an accepted source without searching or downloading', async () => {
    const existingSource = {
      id: 'frame-1',
      realImage: {
        provider: 'pexels', photoId: 9, localPath: '/api/data/pexels/project/frame-1-9.jpg', query: 'office',
        alt: 'office', width: 1920, height: 1080, photographer: 'P9', photographerUrl: '', pexelsUrl: '',
        fitMode: 'cover', position: 'center', layout: 'editorial-split', scaleFrom: 1.02, scaleTo: 1.06,
        downloadedAt: new Date().toISOString(),
      },
    } as any;
    const result = await prepareSmartImageForFrame({
      projectId: 'project', frame: outline.frames[0], plan: smartPlan('frame-1'), existingSource,
      abortSignal: new AbortController().signal,
    });
    expect(result.status).toBe('accepted');
    expect(result.assets[0].photoId).toBe(9);
    expect(searchPexels).not.toHaveBeenCalled();
  });

  it('turns a frame deadline into a timed-out fallback result', async () => {
    vi.mocked(searchPexels).mockImplementation((_query, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')), { once: true });
    }));
    const result = await prepareSmartImageForFrame({
      projectId: 'project',
      frame: outline.frames[0],
      plan: smartPlan('frame-1'),
      abortSignal: new AbortController().signal,
      deadlineMs: 5,
    });
    expect(result.status).toBe('timed-out');
    expect(result.reason).toContain('超时');
  });

  it('uses native HTML fallback after Pexels fails and records the fallback reason', async () => {
    vi.mocked(searchPexels).mockResolvedValue({ photos: [], total_results: 0, page: 1, per_page: 15 });
    const result = await prepareSmartImageForFrame({
      projectId: 'project',
      frame: outline.frames[0],
      plan: smartPlan('frame-1'),
      abortSignal: new AbortController().signal,
    });
    expect(result.status).toBe('rejected');
    expect(result.assets).toEqual([]);
    expect(result.fallbacks).toEqual([
      expect.objectContaining({ from: 'pexels', to: 'html' }),
    ]);
    expect(result.reason).toContain('原生 HTML 图解');
  });

  it('preserves an explicit parent abort instead of converting it to fallback', async () => {
    vi.mocked(searchPexels).mockImplementation((_query, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const controller = new AbortController();
    const pending = prepareSmartImageForFrame({
      projectId: 'project',
      frame: outline.frames[0],
      plan: smartPlan('frame-1'),
      abortSignal: controller.signal,
      deadlineMs: 1_000,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('accepts a multi-subject frame only after every required subject is found', async () => {
    const plan = {
      ...smartPlan('frame-1'),
      fallbackQueries: [],
      fidelity: 'required' as const,
      fallbackPolicy: 'block' as const,
      subjects: [
        { name: 'cocoa pod', kind: 'natural-object' as const, query: 'cocoa pod', fallbackQuery: 'cocoa pod', required: true },
        { name: 'contour bottle', kind: 'product' as const, query: 'contour bottle', fallbackQuery: 'contour bottle', required: true },
      ],
    };
    vi.mocked(searchPexels)
      .mockResolvedValueOnce({ photos: [photo(11)], total_results: 1, page: 1, per_page: 15 })
      .mockResolvedValueOnce({ photos: [photo(12)], total_results: 1, page: 1, per_page: 15 });
    vi.mocked(downloadPexelsPhoto)
      .mockResolvedValueOnce('/api/data/pexels/project/frame-1-1-11.jpg')
      .mockResolvedValueOnce('/api/data/pexels/project/frame-1-2-12.jpg');

    const result = await prepareSmartImageForFrame({
      projectId: 'project', frame: outline.frames[0], plan,
      abortSignal: new AbortController().signal,
    });
    expect(result.status).toBe('accepted');
    expect(result.assets.map(asset => asset.photoId)).toEqual([11, 12]);
  });

  it('rejects the whole frame when one required subject is missing', async () => {
    const plan = {
      ...smartPlan('frame-1'),
      fallbackQueries: [],
      subjects: [
        { name: 'cocoa pod', kind: 'natural-object' as const, query: 'cocoa pod', fallbackQuery: 'cocoa pod', required: true },
        { name: 'contour bottle', kind: 'product' as const, query: 'contour bottle', fallbackQuery: 'contour bottle', required: true },
      ],
    };
    vi.mocked(searchPexels)
      .mockResolvedValueOnce({ photos: [photo(21)], total_results: 1, page: 1, per_page: 15 })
      .mockResolvedValue({ photos: [], total_results: 0, page: 1, per_page: 15 });
    vi.mocked(downloadPexelsPhoto).mockResolvedValue('/api/data/pexels/project/frame-1-1-21.jpg');

    const result = await prepareSmartImageForFrame({
      projectId: 'project', frame: outline.frames[0], plan,
      abortSignal: new AbortController().signal,
    });
    expect(result.status).toBe('rejected');
    expect(result.assets).toEqual([]);
  });
});
