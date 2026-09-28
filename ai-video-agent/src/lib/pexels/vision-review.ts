import type {
  AssetRequest,
  SmartImageCandidate,
  VisionCropRisk,
  VisionImageReview,
  VisionImageReviewStatus,
  VisionSafeTextSide,
  VisionSubjectMatch,
  VisionSubjectPosition,
} from '@/types';

/** GPT Vision must only see the small, deterministic rule-approved pool. */
export const MAX_VISION_IMAGE_CANDIDATES = 4;
export const MAX_VISION_BACKUP_PHOTOS = 2;
export const MAX_VISION_REJECTIONS = MAX_VISION_IMAGE_CANDIDATES;
export const MAX_VISION_TEXT_LENGTH = 320;
export const MAX_VISION_CANDIDATE_REASON_LENGTH = 180;

export interface VisionImageCandidateInput {
  photoId: number;
  slotIndex?: number;
  subject?: string;
  alt: string;
  width: number;
  height: number;
  layout: SmartImageCandidate['layout'];
  fitMode: SmartImageCandidate['fitMode'];
  score?: number;
}

export interface VisionImageReviewRequest {
  frameTitle: string;
  narration: string;
  composition: string;
  textPosition: 'left' | 'right';
  assetRequest?: Pick<
    AssetRequest,
    'query' | 'requiredTerms' | 'optionalTerms' | 'excludedTerms' | 'purpose' | 'subjectType'
  >;
  candidates: VisionImageCandidateInput[];
}

/** The model may omit optional presentation fields, but never controls status. */
export interface VisionImageReviewModelResponse {
  status?: 'accepted';
  selectedPhotoId?: unknown;
  backupPhotoIds?: unknown;
  subjectMatch?: unknown;
  safeTextSide?: unknown;
  subjectPosition?: unknown;
  cropRisk?: unknown;
  rationale?: unknown;
  rejections?: unknown;
}

const SUBJECT_MATCHES: readonly VisionSubjectMatch[] = ['high', 'medium', 'low'];
const SAFE_TEXT_SIDES: readonly VisionSafeTextSide[] = ['left', 'right', 'top', 'bottom', 'none'];
const SUBJECT_POSITIONS: readonly VisionSubjectPosition[] = ['left', 'center', 'right', 'mixed'];
const CROP_RISKS: readonly VisionCropRisk[] = ['low', 'medium', 'high'];

/**
 * Validates and normalizes one model response against the exact candidate set
 * supplied to the model. Invalid output throws so callers can create the
 * deterministic rule-ranked fallback instead of trusting a foreign ID.
 */
export function validateVisionImageReview(
  value: unknown,
  candidates: ReadonlyArray<Pick<VisionImageCandidateInput, 'photoId'>> | ReadonlyArray<number>,
): VisionImageReview {
  const candidateIds = normalizeCandidateIds(candidates);
  if (!candidateIds.length) throw new Error('视觉复选候选集为空。');
  if (!isRecord(value)) throw new Error('视觉复选结果必须是 JSON 对象。');

  const selectedPhotoId = readPhotoId(value.selectedPhotoId, 'selectedPhotoId');
  if (selectedPhotoId === undefined || !candidateIds.includes(selectedPhotoId)) {
    throw new Error('视觉复选主选 photoId 不在规则候选集内。');
  }

  const backupPhotoIds = readPhotoIds(value.backupPhotoIds, 'backupPhotoIds');
  if (backupPhotoIds.length > MAX_VISION_BACKUP_PHOTOS) {
    throw new Error(`视觉复选备选最多 ${MAX_VISION_BACKUP_PHOTOS} 张。`);
  }
  if (new Set(backupPhotoIds).size !== backupPhotoIds.length) {
    throw new Error('视觉复选备选 photoId 不能重复。');
  }
  if (backupPhotoIds.includes(selectedPhotoId)) {
    throw new Error('视觉复选备选不能包含主选 photoId。');
  }
  if (backupPhotoIds.some(photoId => !candidateIds.includes(photoId))) {
    throw new Error('视觉复选备选 photoId 不在规则候选集内。');
  }

  const subjectMatch = readEnum(value.subjectMatch, SUBJECT_MATCHES, 'subjectMatch');
  const safeTextSide = readEnum(value.safeTextSide, SAFE_TEXT_SIDES, 'safeTextSide', 'none');
  const subjectPosition = readEnum(value.subjectPosition, SUBJECT_POSITIONS, 'subjectPosition', 'mixed');
  const cropRisk = readEnum(value.cropRisk, CROP_RISKS, 'cropRisk');
  const rationale = boundedText(value.rationale, MAX_VISION_TEXT_LENGTH, 'rationale');
  const rejections = readRejections(value.rejections, candidateIds, selectedPhotoId, backupPhotoIds);

  return {
    status: 'accepted',
    selectedPhotoId,
    backupPhotoIds,
    subjectMatch,
    safeTextSide,
    subjectPosition,
    cropRisk,
    rationale,
    rejections,
  };
}

/** Alias kept explicit for call sites that validate the raw model envelope. */
export const validateVisionImageReviewResponse = validateVisionImageReview;

/**
 * Creates a stable audit record when the model, image transport or response
 * validation is unavailable. The first rule-ranked candidate remains the
 * selected asset; no model output can change that fallback.
 */
export function createVisionFallbackReview(
  candidates: ReadonlyArray<Pick<VisionImageCandidateInput, 'photoId'>> | ReadonlyArray<number>,
  reason: string,
  options?: Pick<VisionImageReview, 'model' | 'elapsedMs'>,
): VisionImageReview {
  const candidateIds = normalizeCandidateIds(candidates);
  const selectedPhotoId = candidateIds[0];
  const status: VisionImageReviewStatus = selectedPhotoId === undefined ? 'unavailable' : 'fallback';
  return {
    status,
    ...(selectedPhotoId === undefined ? {} : { selectedPhotoId }),
    backupPhotoIds: selectedPhotoId === undefined ? [] : candidateIds.slice(1, 1 + MAX_VISION_BACKUP_PHOTOS),
    subjectMatch: 'low',
    safeTextSide: 'none',
    subjectPosition: 'mixed',
    cropRisk: 'high',
    rationale: boundedText(`视觉复选不可用，${reason}；已${selectedPhotoId === undefined ? '保留空结果' : '回退到规则排序第一名'}`, MAX_VISION_TEXT_LENGTH, 'rationale'),
    rejections: [],
    ...options,
  };
}

export function normalizeVisionReviewReason(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return boundedText(fallback, MAX_VISION_TEXT_LENGTH, 'reason');
  return boundedText(value, MAX_VISION_TEXT_LENGTH, 'reason');
}

export function candidateIdsOf(
  candidates: ReadonlyArray<Pick<VisionImageCandidateInput, 'photoId'>> | ReadonlyArray<number>,
): number[] {
  return normalizeCandidateIds(candidates);
}

function normalizeCandidateIds(
  candidates: ReadonlyArray<Pick<VisionImageCandidateInput, 'photoId'>> | ReadonlyArray<number>,
): number[] {
  const ids = candidates.map(candidate => typeof candidate === 'number' ? candidate : candidate.photoId);
  const unique: number[] = [];
  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('视觉复选候选 photoId 无效。');
    if (!unique.includes(id)) unique.push(id);
  }
  if (unique.length > MAX_VISION_IMAGE_CANDIDATES) {
    throw new Error(`视觉复选候选最多 ${MAX_VISION_IMAGE_CANDIDATES} 张。`);
  }
  return unique;
}

function readPhotoId(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`视觉复选 ${field} 无效。`);
  return Number(value);
}

function readPhotoIds(value: unknown, field: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`视觉复选 ${field} 必须是数组。`);
  return value.map(item => {
    const photoId = readPhotoId(item, field);
    if (photoId === undefined) throw new Error(`视觉复选 ${field} 不能包含空值。`);
    return photoId;
  });
}

function readRejections(
  value: unknown,
  candidateIds: number[],
  selectedPhotoId: number,
  backupPhotoIds: number[],
): Array<{ photoId: number; reason: string }> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('视觉复选 rejections 必须是数组。');
  if (value.length > MAX_VISION_REJECTIONS) throw new Error(`视觉复选拒绝项最多 ${MAX_VISION_REJECTIONS} 条。`);
  const seen = new Set<number>();
  return value.map(item => {
    if (!isRecord(item)) throw new Error('视觉复选拒绝项格式无效。');
    const photoId = readPhotoId(item.photoId, 'rejections.photoId');
    if (photoId === undefined || !candidateIds.includes(photoId)) throw new Error('视觉复选拒绝项不在规则候选集内。');
    if (photoId === selectedPhotoId || backupPhotoIds.includes(photoId)) throw new Error('视觉复选拒绝项不能包含主选或备选。');
    if (seen.has(photoId)) throw new Error('视觉复选拒绝项不能重复。');
    seen.add(photoId);
    return { photoId, reason: boundedText(item.reason, MAX_VISION_CANDIDATE_REASON_LENGTH, 'rejections.reason') };
  });
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`视觉复选 ${field} 枚举值无效。`);
  return value as T;
}

function boundedText(value: unknown, maxLength: number, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`视觉复选 ${field} 不能为空。`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) throw new Error(`视觉复选 ${field} 不能为空。`);
  if (normalized.length > maxLength) throw new Error(`视觉复选 ${field} 超过 ${maxLength} 个字符。`);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
