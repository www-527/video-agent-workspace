import type { FrameOutline, SmartImageCandidate, SmartImagePlan, VisionImageReview } from '@/types';
import type { PexelsPhoto } from '@/lib/pexels/client';
import type { ScoredPexelsPhoto } from '@/lib/pexels/scoring';
import { getCurrentAIKeySnapshot } from '@/lib/ai-key-context';
import { callAIVisionJson, type AIHtmlImageInput } from './client';
import {
  MAX_VISION_IMAGE_CANDIDATES,
  createVisionFallbackReview,
  validateVisionImageReview,
  type VisionImageCandidateInput,
  type VisionImageReviewModelResponse,
  type VisionImageReviewRequest,
} from '@/lib/pexels/vision-review';

const VISION_REVIEW_SYSTEM = `你是受限的 Pexels 候选图片视觉复选器。
你只能比较输入中的候选图片，不能搜索网页、打开网址、猜测候选集合之外的图片，也不能改变程序的来源、授权、分辨率、画幅或必需词规则。
请根据镜头标题、旁白、素材请求、目标构图和图片实际内容，选择一个最合适的 photoId，并给出最多两个备选。只返回一个完整 JSON 对象，不要 Markdown、解释、思维过程或额外字段。
主选和备选必须使用输入候选的 photoId；被拒绝项也必须来自输入候选。视觉判断只用于相关性和构图适配，不是身份或事实真实性的最终证明。`;

export interface VisualPexelsCandidate {
  photo: PexelsPhoto;
  candidate: ScoredPexelsPhoto;
  query: string;
  record: SmartImageCandidate;
}

export interface VisualImageSelectionResult {
  review: VisionImageReview;
  ordered: VisualPexelsCandidate[];
  rejected: Array<{ candidate: VisualPexelsCandidate; reason: string }>;
}

export async function selectPexelsCandidatesWithVision(args: {
  frame: FrameOutline;
  plan: SmartImagePlan;
  candidates: VisualPexelsCandidate[];
  abortSignal: AbortSignal;
  loadImageInput: (photo: PexelsPhoto, signal: AbortSignal) => Promise<AIHtmlImageInput>;
}): Promise<VisualImageSelectionResult> {
  const candidates = dedupeCandidates(args.candidates).slice(0, MAX_VISION_IMAGE_CANDIDATES);
  const model = currentModel();
  if (!candidates.length) {
    return { review: createVisionFallbackReview([], '规则预筛没有候选', { model, elapsedMs: 0 }), ordered: [], rejected: [] };
  }

  const startedAt = Date.now();
  try {
    const inputs = await Promise.all(candidates.map(async candidate => {
      const input = await args.loadImageInput(candidate.photo, args.abortSignal);
      return { ...input, label: `photoId=${candidate.photo.id}` };
    }));
    const request = buildVisionReviewRequest(args.frame, args.plan, candidates);
    const output = await callAIVisionJson<VisionImageReviewModelResponse>({
      stage: 'Pexels 视觉复选',
      system: VISION_REVIEW_SYSTEM,
      user: buildVisionReviewUserPrompt(request),
      images: inputs,
      maxTokens: 700,
      abortSignal: args.abortSignal,
    });
    const review = validateVisionImageReview(output, candidates.map(candidate => candidate.record.photoId));
    const acceptedReview: VisionImageReview = {
      ...review,
      model,
      elapsedMs: Date.now() - startedAt,
    };
    return {
      review: acceptedReview,
      ordered: orderCandidates(candidates, acceptedReview),
      rejected: rejectedCandidates(candidates, acceptedReview),
    };
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : '视觉复选不可用';
    const review = createVisionFallbackReview(candidates.map(candidate => candidate.record), reason, {
      model,
      elapsedMs: Date.now() - startedAt,
    });
    return { review, ordered: candidates, rejected: [] };
  }
}

export function buildVisionReviewRequest(
  frame: FrameOutline,
  plan: SmartImagePlan,
  candidates: VisualPexelsCandidate[],
): VisionImageReviewRequest {
  const assetRequest = plan.assetRequest || frame.sceneSpec?.assetRequest;
  return {
    frameTitle: frame.title,
    narration: frame.narration,
    composition: plan.composition,
    textPosition: plan.textPosition,
    ...(assetRequest ? {
      assetRequest: {
        query: assetRequest.query,
        requiredTerms: assetRequest.requiredTerms,
        optionalTerms: assetRequest.optionalTerms,
        excludedTerms: assetRequest.excludedTerms,
        purpose: assetRequest.purpose,
        subjectType: assetRequest.subjectType,
      },
    } : {}),
    candidates: candidates.map(candidate => ({
      photoId: candidate.record.photoId,
      ...(candidate.record.slotIndex === undefined ? {} : { slotIndex: candidate.record.slotIndex }),
      subject: candidate.record.subject || plan.subject,
      alt: candidate.record.alt,
      width: candidate.record.width,
      height: candidate.record.height,
      layout: candidate.record.layout,
      fitMode: candidate.record.fitMode,
      score: candidate.record.score,
    } satisfies VisionImageCandidateInput)),
  };
}

export function buildVisionReviewUserPrompt(request: VisionImageReviewRequest): string {
  return `【候选图片输入顺序】\n${request.candidates.map((candidate, index) => `${index + 1}. photoId=${candidate.photoId}`).join('\n')}

【镜头与构图约束】
${JSON.stringify(request, null, 2)}

请返回：selectedPhotoId、backupPhotoIds（最多 2 个）、subjectMatch、safeTextSide、subjectPosition、cropRisk、简短 rationale，以及可选的 rejections 数组。不要返回候选之外的 ID。`;
}

function dedupeCandidates(candidates: VisualPexelsCandidate[]): VisualPexelsCandidate[] {
  const seen = new Set<number>();
  return candidates.filter(candidate => {
    if (seen.has(candidate.record.photoId)) return false;
    seen.add(candidate.record.photoId);
    return true;
  });
}

function orderCandidates(candidates: VisualPexelsCandidate[], review: VisionImageReview): VisualPexelsCandidate[] {
  const byId = new Map(candidates.map(candidate => [candidate.record.photoId, candidate]));
  const rejected = new Set(review.rejections.map(item => item.photoId));
  const orderedIds = [review.selectedPhotoId, ...review.backupPhotoIds]
    .filter((photoId): photoId is number => photoId !== undefined)
    .filter(photoId => !rejected.has(photoId));
  const rest = candidates
    .filter(candidate => !orderedIds.includes(candidate.record.photoId) && !rejected.has(candidate.record.photoId))
    .sort((left, right) => right.record.score - left.record.score)
    .map(candidate => candidate.record.photoId);
  return [...orderedIds, ...rest]
    .map(photoId => byId.get(photoId))
    .filter((candidate): candidate is VisualPexelsCandidate => Boolean(candidate));
}

function rejectedCandidates(
  candidates: VisualPexelsCandidate[],
  review: VisionImageReview,
): Array<{ candidate: VisualPexelsCandidate; reason: string }> {
  const byId = new Map(candidates.map(candidate => [candidate.record.photoId, candidate]));
  return review.rejections.flatMap(item => {
    const candidate = byId.get(item.photoId);
    return candidate ? [{ candidate, reason: item.reason }] : [];
  });
}

function currentModel(): string | undefined {
  // The audit only records the configured model name, never a key or raw
  // upstream response.
  return getCurrentAIKeySnapshot()?.model;
}
