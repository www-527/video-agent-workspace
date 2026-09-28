import { describe, expect, it } from 'vitest';
import {
  MAX_VISION_BACKUP_PHOTOS,
  MAX_VISION_IMAGE_CANDIDATES,
  createVisionFallbackReview,
  validateVisionImageReview,
} from '@/lib/pexels/vision-review';

const candidates = [
  { photoId: 101 },
  { photoId: 102 },
  { photoId: 103 },
  { photoId: 104 },
];

const valid = {
  status: 'accepted',
  selectedPhotoId: 103,
  backupPhotoIds: [101, 104],
  subjectMatch: 'high',
  safeTextSide: 'left',
  subjectPosition: 'right',
  cropRisk: 'low',
  rationale: '主体清晰位于右侧，左侧有稳定留白，适合当前分镜标题。',
  rejections: [{ photoId: 102, reason: '主体被遮挡，裁切后难以辨认。' }],
};

describe('VisionImageReview contract', () => {
  it('accepts an in-bounds primary, unique backups and rejected candidates', () => {
    expect(validateVisionImageReview(valid, candidates)).toMatchObject({
      status: 'accepted',
      selectedPhotoId: 103,
      backupPhotoIds: [101, 104],
      rejections: [{ photoId: 102 }],
    });
  });

  it('rejects a primary photo outside the rule-approved candidate set', () => {
    expect(() => validateVisionImageReview({ ...valid, selectedPhotoId: 999 }, candidates)).toThrow(/主选/);
  });

  it('rejects duplicate or out-of-bounds backups', () => {
    expect(() => validateVisionImageReview({ ...valid, backupPhotoIds: [101, 101] }, candidates)).toThrow(/重复/);
    expect(() => validateVisionImageReview({ ...valid, backupPhotoIds: [999] }, candidates)).toThrow(/候选集/);
    expect(() => validateVisionImageReview({ ...valid, backupPhotoIds: [101, 102, 104] }, candidates)).toThrow(/最多/);
  });

  it('rejects invalid enums and overlong explanations', () => {
    expect(() => validateVisionImageReview({ ...valid, cropRisk: 'unknown' }, candidates)).toThrow(/枚举/);
    expect(() => validateVisionImageReview({ ...valid, rationale: 'x'.repeat(321) }, candidates)).toThrow(/超过/);
  });

  it('rejects empty candidates and invalid rejection references', () => {
    expect(() => validateVisionImageReview(valid, [])).toThrow(/候选集为空/);
    expect(() => validateVisionImageReview({ ...valid, rejections: [{ photoId: 103, reason: 'bad' }] }, candidates)).toThrow(/主选/);
  });

  it('creates a deterministic rule-first fallback with bounded backups', () => {
    const review = createVisionFallbackReview(candidates, '模型不支持图片输入', { model: 'vision-model', elapsedMs: 42 });
    expect(review).toMatchObject({
      status: 'fallback',
      selectedPhotoId: 101,
      backupPhotoIds: [102, 103],
      model: 'vision-model',
      elapsedMs: 42,
    });
    expect(review.backupPhotoIds).toHaveLength(MAX_VISION_BACKUP_PHOTOS);
  });

  it('marks an empty rule result unavailable without inventing a photo id', () => {
    expect(createVisionFallbackReview([], '规则预筛没有候选')).toMatchObject({
      status: 'unavailable',
      backupPhotoIds: [],
    });
    expect(createVisionFallbackReview([], '规则预筛没有候选').selectedPhotoId).toBeUndefined();
  });

  it('enforces the four-image candidate ceiling', () => {
    expect(candidates).toHaveLength(MAX_VISION_IMAGE_CANDIDATES);
    expect(() => validateVisionImageReview(valid, [...candidates, { photoId: 105 }])).toThrow(/最多/);
  });
});
