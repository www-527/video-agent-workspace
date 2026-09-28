import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithAIKeySnapshot } from '@/lib/ai-key-context';
import type { AIKeySnapshot } from '@/lib/ai-key-store';

const mocks = vi.hoisted(() => ({
  searchPexels: vi.fn(),
  downloadPexelsPhoto: vi.fn(),
  selectPexelsCandidatesWithVision: vi.fn(),
}));

vi.mock('@/lib/pexels/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/pexels/client')>();
  return { ...actual, searchPexels: mocks.searchPexels };
});
vi.mock('@/lib/pexels/download', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/pexels/download')>();
  return { ...actual, downloadPexelsPhoto: mocks.downloadPexelsPhoto };
});
vi.mock('@/lib/pexels/scoring', () => ({
  assessPexelsCandidates: vi.fn(({ photos }) => photos.map((photo: any, index: number) => ({
    photo, score: 100 - index, layout: 'editorial-split', fitMode: 'cover', matchedTerms: ['wind'],
    missingTerms: [], rejectedTerms: [], accepted: true, reason: 'rule accepted',
  }))),
}));
vi.mock('@/lib/pexels/local-asset', () => ({ hashLocalPexelsAsset: vi.fn(async (path: string) => `hash:${path}`) }));
vi.mock('@/lib/ai/visual-image-selection', () => ({ selectPexelsCandidatesWithVision: mocks.selectPexelsCandidatesWithVision }));

import { prepareSmartImageForFrame } from '@/lib/pexels/smart-images';

const credential: AIKeySnapshot = {
  id: 'vision', name: 'Vision', apiKey: 'secret', model: 'vision-model', baseURL: 'https://relay.example/v1',
  apiProtocol: 'auto', source: 'saved',
  gptOptimization: {
    enabled: true, useResponsesAPI: true, allowChatFallback: true, reasoningProfile: 'balanced',
    creativeFreedom: 'balanced', internalImageSearch: true,
  },
};

const frame = { id: 'frame-1', index: 1, title: '风机', narration: '展示海上风机。' } as any;
const plan = {
  frameId: 'frame-1', useRealImage: true, priority: 80, reason: 'required', purpose: '设备', query: 'offshore wind turbine',
  fallbackQueries: [], subject: 'wind turbine', composition: 'editorial-split', textPosition: 'left', imageMotion: 'static',
  visualGroup: 'energy', deadlineMs: 10_000,
  assetRequest: {
    query: 'offshore wind turbine', fallbackQueries: [], requiredTerms: ['wind'], optionalTerms: ['turbine'], excludedTerms: [],
    subjectType: 'equipment', purpose: '设备', imageRequired: true,
  },
} as any;

const photo = (id: number) => ({
  id, width: 2400, height: 1350, url: `https://www.pexels.com/photo/${id}`, photographer: `P${id}`, photographer_url: '',
  alt: `wind turbine ${id}`, src: { large2x: `https://images.pexels.com/${id}.jpg` },
});

describe('smart image GPT Vision integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchPexels.mockResolvedValue({ photos: [photo(1), photo(2), photo(3), photo(4)], total_results: 4, page: 1, per_page: 15 });
    mocks.downloadPexelsPhoto.mockImplementation(async ({ photo: item }: any) => `/api/data/pexels/project/frame-${item.id}.jpg`);
  });

  it('keeps rules first, performs one visual review and downloads only primary plus two backups', async () => {
    mocks.selectPexelsCandidatesWithVision.mockImplementation(async ({ candidates }: any) => ({
      review: {
        status: 'accepted', selectedPhotoId: 3, backupPhotoIds: [1, 2], subjectMatch: 'high', safeTextSide: 'left',
        subjectPosition: 'right', cropRisk: 'low', rationale: '主体清晰。', rejections: [{ photoId: 4, reason: '主体过小。' }],
      },
      ordered: [candidates[2], candidates[0], candidates[1]],
      rejected: [{ candidate: candidates[3], reason: '主体过小。' }],
    }));

    const result = await runWithAIKeySnapshot(credential, () => prepareSmartImageForFrame({
      projectId: 'project', frame, plan, abortSignal: new AbortController().signal,
    }));

    expect(mocks.selectPexelsCandidatesWithVision).toHaveBeenCalledTimes(1);
    expect(mocks.downloadPexelsPhoto).toHaveBeenCalledTimes(3);
    expect(result.assets.map(asset => asset.photoId)).toEqual([3]);
    expect(result.assets[0]?.verificationLevel).toBe('vision-confirmed');
    expect(result.selection?.visionReview).toMatchObject({ status: 'accepted', selectedPhotoId: 3 });
    expect(result.selection?.rejectedCandidates?.some(item => item.photoId === 4 && item.rejectionCode === 'vision-rejected')).toBe(true);
  });

  it('uses rule order and metadata verification when the visual review falls back', async () => {
    mocks.selectPexelsCandidatesWithVision.mockImplementation(async ({ candidates }: any) => ({
      review: {
        status: 'fallback', selectedPhotoId: 1, backupPhotoIds: [2, 3], subjectMatch: 'low', safeTextSide: 'none',
        subjectPosition: 'mixed', cropRisk: 'high', rationale: '视觉模型不可用，回退规则。', rejections: [],
      },
      ordered: candidates,
      rejected: [],
    }));

    const result = await runWithAIKeySnapshot(credential, () => prepareSmartImageForFrame({
      projectId: 'project', frame, plan, abortSignal: new AbortController().signal,
    }));

    expect(result.assets[0]?.photoId).toBe(1);
    expect(result.assets[0]?.verificationLevel).toBe('metadata-matched');
    expect(result.selection?.visionReview?.status).toBe('fallback');
  });
});
