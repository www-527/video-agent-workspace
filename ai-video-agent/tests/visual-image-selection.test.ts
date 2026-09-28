import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ callAIVisionJson: vi.fn() }));

vi.mock('@/lib/ai/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ai/client')>();
  return { ...actual, callAIVisionJson: mocks.callAIVisionJson };
});

import { buildVisionReviewUserPrompt, selectPexelsCandidatesWithVision } from '@/lib/ai/visual-image-selection';

const frame = { id: 'frame-1', index: 1, title: 'Wind turbine', narration: '展示海上风机的真实外观。' } as any;
const plan = {
  frameId: 'frame-1', useRealImage: true, priority: 80, reason: 'required', purpose: '设备外观',
  query: 'offshore wind turbine', fallbackQueries: [], subject: 'wind turbine',
  composition: 'editorial-split', textPosition: 'left', imageMotion: 'static', visualGroup: 'energy', deadlineMs: 10_000,
  assetRequest: {
    query: 'offshore wind turbine', fallbackQueries: [], requiredTerms: ['wind', 'turbine'], optionalTerms: ['sea'],
    excludedTerms: ['illustration'], subjectType: 'equipment', purpose: '设备外观', imageRequired: true,
  },
} as any;

function candidate(photoId: number, score: number) {
  const photo = {
    id: photoId, width: 2400, height: 1350, url: `https://www.pexels.com/photo/${photoId}`,
    photographer: `P${photoId}`, photographer_url: '', alt: `wind turbine ${photoId}`,
    src: { large2x: `https://images.pexels.com/photos/${photoId}/large.jpeg` },
  };
  return {
    photo,
    candidate: {
      photo, score, layout: 'editorial-split', fitMode: 'cover', matchedTerms: ['wind'], missingTerms: [],
      rejectedTerms: [], accepted: true, reason: 'rule accepted',
    },
    query: 'offshore wind turbine',
    record: {
      photoId, query: 'offshore wind turbine', slotIndex: 0, subject: 'wind turbine', alt: `wind turbine ${photoId}`,
      width: 2400, height: 1350, previewUrl: `/api/data/pexels/${photoId}.jpg`, pexelsUrl: photo.url,
      photographer: photo.photographer, photographerUrl: '', score, layout: 'editorial-split', fitMode: 'cover',
      matchedTerms: ['wind'], missingTerms: [], rejectedTerms: [], status: 'accepted', reason: 'rule accepted',
    },
  } as any;
}

describe('Pexels visual candidate selection', () => {
  it('makes one structured visual call and orders the primary before backups', async () => {
    mocks.callAIVisionJson.mockReset();
    mocks.callAIVisionJson.mockResolvedValue({
      status: 'accepted', selectedPhotoId: 3, backupPhotoIds: [1], subjectMatch: 'high', safeTextSide: 'left',
      subjectPosition: 'right', cropRisk: 'low', rationale: '主体清晰且左侧留白足够。',
      rejections: [{ photoId: 2, reason: '主体过小。' }],
    });
    const loadImageInput = vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,AA==', mimeType: 'image/jpeg' as const, byteLength: 1 }));
    const result = await selectPexelsCandidatesWithVision({
      frame, plan, candidates: [candidate(1, 95), candidate(2, 94), candidate(3, 90)],
      abortSignal: new AbortController().signal, loadImageInput,
    });

    expect(mocks.callAIVisionJson).toHaveBeenCalledTimes(1);
    expect(loadImageInput).toHaveBeenCalledTimes(3);
    expect(result.review).toMatchObject({ status: 'accepted', selectedPhotoId: 3, backupPhotoIds: [1] });
    expect(result.ordered.map(item => item.record.photoId)).toEqual([3, 1]);
    expect(result.rejected.map(item => item.candidate.record.photoId)).toEqual([2]);
    expect(mocks.callAIVisionJson.mock.calls[0][0].user).not.toContain('https://images.pexels.com');
  });

  it('falls back to the rule-ranked first candidate when JSON is invalid', async () => {
    mocks.callAIVisionJson.mockReset();
    mocks.callAIVisionJson.mockResolvedValue({ selectedPhotoId: 999 });
    const result = await selectPexelsCandidatesWithVision({
      frame, plan, candidates: [candidate(8, 98), candidate(9, 90)],
      abortSignal: new AbortController().signal,
      loadImageInput: async () => ({ dataUrl: 'data:image/jpeg;base64,AA==', mimeType: 'image/jpeg' as const, byteLength: 1 }),
    });

    expect(result.review.status).toBe('fallback');
    expect(result.review.selectedPhotoId).toBe(8);
    expect(result.ordered.map(item => item.record.photoId)).toEqual([8, 9]);
  });

  it('keeps the request limited to metadata and bounded candidate IDs', () => {
    const prompt = buildVisionReviewUserPrompt({
      frameTitle: 'Frame', narration: 'Narration', composition: 'editorial-split', textPosition: 'left',
      candidates: [{ photoId: 1, alt: 'subject', width: 100, height: 100, layout: 'editorial-split', fitMode: 'cover' }],
    });
    expect(prompt).toContain('photoId=1');
    expect(prompt).not.toContain('data:image');
  });
});
