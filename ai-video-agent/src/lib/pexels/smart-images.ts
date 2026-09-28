import { planRealImages } from '@/lib/ai/real-image-planner';
import type {
  FrameOutline,
  FrameSource,
  AssetRequest,
  ImageSubjectPlan,
  Outline,
  PersonImagePlan,
  RealImageAsset,
  SmartImageFrameStatus,
  SmartImageMode,
  SmartImagePlan,
  SmartImageCandidate,
  SmartImageSelection,
  VisualFallbackRecord,
  CanvasPresetId,
  VisionImageReview,
} from '@/types';
import { searchPexels, PexelsError } from './client';
import { downloadPexelsPhoto, fetchPexelsPhotoImageInput } from './download';
import { assessPexelsCandidates, type ScoredPexelsPhoto } from './scoring';
import { hashLocalPexelsAsset } from './local-asset';
import { meetsAssetVerificationLevel } from '@/lib/ai/visual-asset-policy';
import { getCurrentAITransportPolicy, getCurrentGPTOptimizationSettings } from '@/lib/ai-key-context';
import { selectPexelsCandidatesWithVision } from '@/lib/ai/visual-image-selection';

export interface SmartImagePreparationResult {
  sources: FrameSource[];
  planned: number;
  downloaded: number;
  skipped: Array<{ frameId: string; reason: string }>;
  failed: Array<{ frameId: string; reason: string }>;
}

export interface SmartImageProgressEvent {
  stage: 'planning' | 'searching' | 'candidate-ready' | 'downloading' | 'accepted' | 'fallback';
  status?: SmartImageFrameStatus;
  frameId?: string;
  current?: number;
  total?: number;
  message?: string;
}

export interface SmartImageSelectionContext {
  usedPhotoIds: Set<number>;
  previousPhotographer?: string;
  previousColor?: string;
}

export interface SmartImageFrameResult {
  frameId: string;
  status: SmartImageFrameStatus;
  assets: RealImageAsset[];
  attemptedQueries: string[];
  candidateCount: number;
  reason: string;
  elapsedMs: number;
  rateLimited?: boolean;
  fallbacks?: VisualFallbackRecord[];
  selection?: SmartImageSelection;
}

const UNAVAILABLE_REASON = '素材服务暂不可用，已自动使用动画设计';

/**
 * Prepares at most one frame's optional assets. It never writes Prisma/project
 * state; the HTML route owns persistence after verifying actual image usage.
 */
export async function prepareSmartImageForFrame(args: {
  projectId: string;
  frame: FrameOutline;
  plan?: SmartImagePlan;
  existingSource?: FrameSource;
  abortSignal: AbortSignal;
  deadlineMs?: number;
  selectionContext?: SmartImageSelectionContext;
  onProgress?: (event: SmartImageProgressEvent) => void;
  canvasPreset?: CanvasPresetId;
}): Promise<SmartImageFrameResult> {
  const startedAt = Date.now();
  assertNotAborted(args.abortSignal);
  const existingAssets = assetsOf(args.existingSource);
  if (existingAssets.length) {
    return {
      ...result(args.frame.id, 'accepted', existingAssets, [], 0, '复用已验收的真实素材', startedAt),
      selection: args.existingSource?.imageSelection,
    };
  }
  const gptOptimization = getCurrentGPTOptimizationSettings();
  const gptFreeTransport = getCurrentAITransportPolicy() === 'gpt-free-codex';
  if (gptOptimization?.enabled && !gptOptimization.internalImageSearch && !gptFreeTransport) {
    const reason = 'GPT 内部搜图已在专项设置中关闭；未发起网络搜索';
    return {
      ...result(args.frame.id, 'not-planned', [], [], 0, reason, startedAt),
      selection: createSelection(args.plan, 'not-planned', reason, [], [], []),
    };
  }
  if (!args.plan?.useRealImage) {
    const reason = args.plan?.reason || '该分镜采用 HTML 原生视觉';
    const needsReview = gptOptimization?.enabled
      && args.plan?.requirement?.attempt === 'required'
      && args.plan.requirement.failurePolicy !== 'allow-native';
    const status: SmartImageFrameStatus = needsReview ? 'needs-review' : 'not-planned';
    return {
      ...result(args.frame.id, status, [], [], 0, reason, startedAt),
      selection: createSelection(args.plan, status, reason, [], [], []),
    };
  }

  const timeoutSignal = AbortSignal.timeout(args.deadlineMs || args.plan.deadlineMs || 10_000);
  const signal = AbortSignal.any([args.abortSignal, timeoutSignal]);
  const context = args.selectionContext || { usedPhotoIds: new Set<number>() };
  const attemptedQueries: string[] = [];
  let candidateCount = 0;
  let lastFailure = '未找到足够匹配的真实素材';
  const requests: Array<PersonImagePlan | ImageSubjectPlan> = args.plan.subjects?.length
    ? args.plan.subjects
    : args.plan.people?.length
    ? args.plan.people
    : [{
        name: args.plan.subject,
        kind: subjectKindForAssetRequest(args.plan.assetRequest?.subjectType),
        query: args.plan.query,
        fallbackQuery: args.plan.fallbackQueries?.[0] || args.plan.fallbackQuery || args.plan.query,
        required: args.plan.assetRequest?.imageRequired === true,
      }];
  const selectedAssets: RealImageAsset[] = [];
  const candidateRecords: SmartImageCandidate[] = [];
  const rejectedCandidateRecords: SmartImageCandidate[] = [];
  let visionReview: VisionImageReview | undefined;
  let visionReviewUsed = false;
  const useVisionReview = Boolean(gptOptimization?.enabled && (gptOptimization.internalImageSearch || gptFreeTransport));

  try {
    let remainingSceneSearches = gptOptimization?.enabled ? 2 : Number.POSITIVE_INFINITY;
    for (let slotIndex = 0; slotIndex < requests.length; slotIndex++) {
      const request = requests[slotIndex];
      const queries = [...new Set([
        request.query,
        request.fallbackQuery,
        ...(args.plan.fallbackQueries || []),
      ].filter(Boolean))].slice(0, gptOptimization?.enabled ? 2 : 4);
      const candidatePool = new Map<number, { candidate: ScoredPexelsPhoto; query: string }>();

      for (const query of queries) {
        if (remainingSceneSearches <= 0) break;
        remainingSceneSearches--;
        assertNotAborted(signal);
        attemptedQueries.push(query);
        args.onProgress?.({
          stage: 'searching', status: 'searching', frameId: args.frame.id,
          message: `正在匹配真实素材：${query}`,
        });
        const requestKind = 'kind' in request ? request.kind : args.plan.assetRequest?.subjectType;
        const personRequest = requestKind === 'person';
        const multiSubject = requests.length > 1;
        const slotTerms = multiSubject ? queryTerms(request.query) : [];
        const search = await searchPexels(query, signal, personRequest || args.canvasPreset === 'douyin-portrait-9-16' ? 'portrait' : 'landscape');
        const scoringSubject = /[a-z]{3,}/i.test(request.name) ? request.name : query;
        const assessments = assessPexelsCandidates({
          photos: gptOptimization?.enabled ? search.photos.slice(0, 8) : search.photos,
          subject: scoringSubject,
          layout: args.plan.composition,
          usedPhotoIds: context.usedPhotoIds,
          previousPhotographer: context.previousPhotographer,
          previousColor: context.previousColor,
          requirePortrait: personRequest,
          requireSubjectMatch: personRequest,
          minimumSubjectMatches: personRequest ? 1 : ('required' in request && request.required ? 1 : 0),
          requiredTerms: multiSubject ? slotTerms.slice(0, 1) : args.plan.assetRequest?.requiredTerms,
          optionalTerms: multiSubject ? slotTerms.slice(1, 5) : args.plan.assetRequest?.optionalTerms,
          excludedTerms: args.plan.assetRequest?.excludedTerms,
          canvasPreset: args.canvasPreset,
        });
        const accepted = assessments.filter(candidate => candidate.accepted);
        for (const candidate of accepted) {
          const existing = candidatePool.get(candidate.photo.id);
          if (!existing || candidate.score > existing.candidate.score) candidatePool.set(candidate.photo.id, { candidate, query });
        }
        for (const candidate of assessments.filter(item => !item.accepted).slice(0, 5)) {
          if (rejectedCandidateRecords.some(item => item.photoId === candidate.photo.id && item.slotIndex === slotIndex)) continue;
          rejectedCandidateRecords.push(toCandidate(candidate, query, slotIndex, request.name, 'rejected'));
        }
        candidateCount += accepted.length;
        args.onProgress?.({
          stage: 'candidate-ready', status: 'candidate-ready', frameId: args.frame.id,
          message: `已筛选 ${accepted.length} 个合格候选素材`,
        });
      }

      const ranked = [...candidatePool.values()]
        .sort((left, right) => right.candidate.score - left.candidate.score)
        .slice(0, gptOptimization?.enabled ? 4 : 3);
      if (!ranked.length) {
        lastFailure = rejectedCandidateRecords.find(item => item.slotIndex === slotIndex)?.reason || lastFailure;
      } else {
        const ruleCandidates = ranked.map(item => ({
          photo: item.candidate.photo,
          candidate: item.candidate,
          query: item.query,
          record: toCandidate(item.candidate, item.query, slotIndex, request.name, 'accepted'),
        }));
        let ordered = ruleCandidates;
        let slotVisionReview: VisionImageReview | undefined;
        if (useVisionReview && !visionReviewUsed) {
          visionReviewUsed = true;
          const reviewed = await selectPexelsCandidatesWithVision({
            frame: args.frame,
            plan: args.plan,
            candidates: ruleCandidates,
            abortSignal: signal,
            loadImageInput: (photo, imageSignal) => fetchPexelsPhotoImageInput({ photo, abortSignal: imageSignal }),
          });
          slotVisionReview = reviewed.review;
          visionReview = visionReview || reviewed.review;
          ordered = reviewed.ordered;
          for (const rejection of reviewed.rejected) {
            const rejected = {
              ...rejection.candidate.record,
              status: 'rejected' as const,
              rejectionCode: 'vision-rejected',
              reason: `视觉复选拒绝：${rejection.reason}`,
              verificationLevel: 'metadata-matched' as const,
            };
            if (!rejectedCandidateRecords.some(item => item.photoId === rejected.photoId && item.slotIndex === rejected.slotIndex)) {
              rejectedCandidateRecords.push(rejected);
            }
          }
        }
        const downloadCandidates = ordered.slice(0, 1 + 2);
        for (const item of downloadCandidates) context.usedPhotoIds.add(item.photo.id);
        args.onProgress?.({
          stage: 'downloading', status: 'downloading', frameId: args.frame.id,
          message: `正在本地化 ${downloadCandidates.length} 个可靠候选`,
        });
        const localized = await Promise.all(downloadCandidates.map(async item => {
          try {
            const localPath = await downloadPexelsPhoto({
              projectId: args.projectId,
              frameId: `${args.frame.id}-slot-${slotIndex + 1}-candidate`,
              photo: item.candidate.photo,
              abortSignal: signal,
            });
            const localFileHash = await hashLocalPexelsAsset(localPath);
            return {
              ...item,
              localPath,
              localFileHash,
              record: {
                ...item.record,
                localPath,
                localFileHash,
                previewUrl: localPath,
                verificationLevel: slotVisionReview?.status === 'accepted'
                  ? 'vision-confirmed' as const
                  : item.record.verificationLevel,
              },
            };
          } catch (error) {
            context.usedPhotoIds.delete(item.candidate.photo.id);
            assertNotAborted(args.abortSignal, error);
            if (timeoutSignal.aborted) throw error;
            lastFailure = messageOf(error, '素材下载失败');
            rejectedCandidateRecords.push({
              ...toCandidate(item.candidate, item.query, slotIndex, request.name, 'download-failed'),
              reason: `本地化失败：${lastFailure}`,
            });
            return null;
          }
        }));
        const ready = localized.filter((item): item is NonNullable<typeof item> => Boolean(item));
        if (ready.length) {
          const selected = ready[0];
          const asset = await toAsset(
            selected.candidate,
            selected.localPath,
            selected.query,
            request.name,
            args.plan,
            selected.localFileHash,
            selected.record.verificationLevel,
          );
          selectedAssets.push(asset);
          candidateRecords.push(...ready.map(item => item.record));
          context.previousPhotographer = asset.photographer;
          context.previousColor = asset.avgColor;
        }
      }

      if (selectedAssets.length <= slotIndex) {
        args.onProgress?.({ stage: 'fallback', status: 'rejected', frameId: args.frame.id, message: lastFailure });
        return generateFallbackImage({
          projectId: args.projectId,
          frame: args.frame,
          plan: args.plan,
          abortSignal: args.abortSignal,
          attemptedQueries,
          candidateCount,
          pexelsReason: lastFailure,
          originalStatus: 'rejected',
          startedAt,
          onProgress: args.onProgress,
          candidates: candidateRecords,
          rejectedCandidates: rejectedCandidateRecords,
          visionReview,
        });
      }
    }

    args.onProgress?.({ stage: 'accepted', status: 'accepted', frameId: args.frame.id, message: '真实素材已通过文件与元数据筛选' });
    return {
      ...result(args.frame.id, 'accepted', selectedAssets, attemptedQueries, candidateCount, '真实素材已验收', startedAt),
      selection: createSelection(
        args.plan,
        'accepted',
        '候选已完成质量筛选并保存到本地，可在编辑器中直接切换',
        candidateRecords,
        rejectedCandidateRecords,
        attemptedQueries,
        selectedAssets,
        visionReview,
      ),
    };
  } catch (error) {
    if (args.abortSignal.aborted) {
      assertNotAborted(args.abortSignal, error);
    }
    if (timeoutSignal.aborted || (error instanceof Error && error.name === 'TimeoutError')) {
      const reason = '素材准备超时，已自动使用动画设计';
      args.onProgress?.({ stage: 'fallback', status: 'timed-out', frameId: args.frame.id, message: reason });
      return generateFallbackImage({
        projectId: args.projectId, frame: args.frame, plan: args.plan, abortSignal: args.abortSignal,
        attemptedQueries, candidateCount, pexelsReason: reason, originalStatus: 'timed-out', startedAt,
        onProgress: args.onProgress,
        candidates: candidateRecords,
        rejectedCandidates: rejectedCandidateRecords,
        visionReview,
      });
    }
    if (error instanceof PexelsError && error.status === 429) {
      args.onProgress?.({ stage: 'fallback', status: 'unavailable', frameId: args.frame.id, message: UNAVAILABLE_REASON });
      const fallback = await generateFallbackImage({
        projectId: args.projectId, frame: args.frame, plan: args.plan, abortSignal: args.abortSignal,
        attemptedQueries, candidateCount, pexelsReason: UNAVAILABLE_REASON, originalStatus: 'unavailable', startedAt,
        onProgress: args.onProgress,
        candidates: candidateRecords,
        rejectedCandidates: rejectedCandidateRecords,
        visionReview,
      });
      return { ...fallback, rateLimited: true };
    }
    const reason = messageOf(error, UNAVAILABLE_REASON);
    args.onProgress?.({ stage: 'fallback', status: 'unavailable', frameId: args.frame.id, message: reason });
    return generateFallbackImage({
      projectId: args.projectId, frame: args.frame, plan: args.plan, abortSignal: args.abortSignal,
      attemptedQueries, candidateCount, pexelsReason: reason, originalStatus: 'unavailable', startedAt,
      onProgress: args.onProgress,
      candidates: candidateRecords,
      rejectedCandidates: rejectedCandidateRecords,
      visionReview,
    });
  }
}

export async function preparePexelsFallback(args: {
  projectId: string;
  frame: FrameOutline;
  plan: SmartImagePlan;
  abortSignal: AbortSignal;
  reason: string;
  onProgress?: (event: SmartImageProgressEvent) => void;
  canvasPreset?: CanvasPresetId;
}): Promise<SmartImageFrameResult> {
  return generateFallbackImage({
    projectId: args.projectId,
    frame: args.frame,
    plan: args.plan,
    abortSignal: args.abortSignal,
    attemptedQueries: [],
    candidateCount: 0,
    pexelsReason: args.reason,
    originalStatus: 'unavailable',
    startedAt: Date.now(),
    onProgress: args.onProgress,
    candidates: [],
    rejectedCandidates: [],
  });
}

async function generateFallbackImage(args: {
  projectId: string;
  frame: FrameOutline;
  plan: SmartImagePlan;
  abortSignal: AbortSignal;
  attemptedQueries: string[];
  candidateCount: number;
  pexelsReason: string;
  originalStatus: SmartImageFrameStatus;
  startedAt: number;
  onProgress?: (event: SmartImageProgressEvent) => void;
  candidates: SmartImageCandidate[];
  rejectedCandidates: SmartImageCandidate[];
  visionReview?: VisionImageReview;
}): Promise<SmartImageFrameResult> {
  const createdAt = new Date().toISOString();
  const pexelsFallback: VisualFallbackRecord = {
    from: 'pexels',
    to: 'html',
    reason: args.pexelsReason,
    createdAt,
  };
  const settings = getCurrentGPTOptimizationSettings();
  const required = args.plan.requirement?.attempt === 'required' || args.plan.assetRequest?.imageRequired === true;
  if (settings?.enabled && required && args.plan.requirement?.failurePolicy === 'block') {
    throw new Error(`required 素材搜索失败且策略为 block：${args.pexelsReason}`);
  }
  const status: SmartImageFrameStatus = settings?.enabled && required
    && args.plan.requirement?.failurePolicy !== 'allow-native'
    ? 'needs-review'
    : args.originalStatus;
  const reason = required
    ? status === 'needs-review'
      ? `required 素材未找到，已进入待审核，未静默降级：${args.pexelsReason}`
      : `required 素材未找到，按明确的 allow-native 策略降级：${args.pexelsReason}`
    : `preferred 素材未找到，已记录原因并使用原生 HTML 图解：${args.pexelsReason}`;
  args.onProgress?.({ stage: 'fallback', status, frameId: args.frame.id, message: reason });
  return {
    ...result(args.frame.id, status, [], args.attemptedQueries, args.candidateCount, reason, args.startedAt),
    fallbacks: [pexelsFallback],
    selection: createSelection(
      args.plan,
      status,
      reason,
      args.candidates,
      args.rejectedCandidates,
      args.attemptedQueries,
      [],
      args.visionReview,
    ),
  };
}

/**
 * Backward-compatible whole-film wrapper. New generation code should plan once
 * and call prepareSmartImageForFrame from each frame pipeline instead.
 */
export async function prepareSmartImages(args: {
  projectId: string;
  outline: Outline;
  targetFrameIds: string[];
  sources: FrameSource[];
  abortSignal: AbortSignal;
  mode?: SmartImageMode;
  onProgress?: (event: SmartImageProgressEvent) => void;
  canvasPreset?: CanvasPresetId;
}): Promise<SmartImagePreparationResult> {
  const targetIds = new Set(args.targetFrameIds);
  const targetFrames = args.outline.frames.filter(frame => targetIds.has(frame.id));
  const sources = args.sources.map(source => ({ ...source }));
  const skipped: SmartImagePreparationResult['skipped'] = [];
  const failed: SmartImagePreparationResult['failed'] = [];
  const mode = args.mode || 'balanced';
  let downloaded = 0;
  let rateLimited = false;

  args.onProgress?.({ stage: 'planning', current: 0, total: targetFrames.length, message: '正在规划智能配图' });
  const plans = await planRealImages({ ...args.outline, frames: targetFrames }, sources, args.abortSignal, mode);
  const plansByFrame = new Map(plans.map(plan => [plan.frameId, plan]));
  const context: SmartImageSelectionContext = {
    usedPhotoIds: new Set(sources.flatMap(source => assetsOf(source).map(asset => asset.photoId))),
    previousPhotographer: sources.flatMap(assetsOf).at(-1)?.photographer,
    previousColor: sources.flatMap(assetsOf).at(-1)?.avgColor,
  };

  for (let index = 0; index < targetFrames.length; index++) {
    assertNotAborted(args.abortSignal);
    const frame = targetFrames[index];
    const sourceIndex = sources.findIndex(source => source.id === frame.id);
    const existingSource = sourceIndex >= 0 ? sources[sourceIndex] : undefined;
    const plan = plansByFrame.get(frame.id);
    if (rateLimited && plan?.useRealImage) {
      const selection = createSelection(plan, 'unavailable', UNAVAILABLE_REASON, [], [], []);
      if (sourceIndex >= 0 && selection) {
        sources[sourceIndex] = { ...sources[sourceIndex], imageSelection: selection };
      }
      skipped.push({ frameId: frame.id, reason: UNAVAILABLE_REASON });
      continue;
    }
    const frameResult = await prepareSmartImageForFrame({
      projectId: args.projectId,
      frame,
      plan,
      existingSource,
      abortSignal: args.abortSignal,
      selectionContext: context,
      canvasPreset: args.canvasPreset,
      onProgress(event) { args.onProgress?.({ ...event, current: index + 1, total: targetFrames.length }); },
    });
    if (frameResult.rateLimited) rateLimited = true;
    if (sourceIndex >= 0 && (frameResult.selection || frameResult.fallbacks?.length)) {
      sources[sourceIndex] = {
        ...sources[sourceIndex],
        ...(frameResult.selection ? { imageSelection: frameResult.selection } : {}),
        ...(frameResult.fallbacks?.length ? { visualFallbacks: frameResult.fallbacks } : {}),
      };
    }
    if (frameResult.status === 'accepted') {
      if (assetsOf(existingSource).length) {
        skipped.push({ frameId: frame.id, reason: '该分镜已有真实素材' });
      } else if (sourceIndex >= 0) {
        sources[sourceIndex] = {
          ...sources[sourceIndex],
          realImage: frameResult.assets[0],
          realImages: frameResult.assets,
        };
        downloaded += frameResult.selection?.candidates.filter(candidate => candidate.localPath).length
          || frameResult.assets.length;
      }
    } else if (frameResult.status === 'not-planned' || frameResult.status === 'unavailable') {
      skipped.push({ frameId: frame.id, reason: frameResult.reason });
    } else {
      failed.push({ frameId: frame.id, reason: frameResult.reason });
    }
  }

  return {
    sources,
    planned: plans.filter(plan => plan.useRealImage).length,
    downloaded,
    skipped,
    failed,
  };
}

function toCandidate(
  candidate: ScoredPexelsPhoto,
  query: string,
  slotIndex: number,
  subject: string,
  status: NonNullable<SmartImageCandidate['status']>,
): SmartImageCandidate {
  const photo = candidate.photo;
  return {
    photoId: photo.id, query, slotIndex, subject, alt: photo.alt || '', width: photo.width, height: photo.height,
    previewUrl: photo.src.medium || photo.src.large || photo.src.large2x || photo.src.original,
    pexelsUrl: photo.url, photographer: photo.photographer, photographerUrl: photo.photographer_url,
    avgColor: photo.avg_color, score: candidate.score, layout: candidate.layout, fitMode: candidate.fitMode,
    matchedTerms: candidate.matchedTerms, missingTerms: candidate.missingTerms, rejectedTerms: candidate.rejectedTerms,
    status, rejectionCode: candidate.rejectionCode, reason: candidate.reason,
    verificationLevel: status === 'accepted' ? 'metadata-matched' : 'file-valid',
  };
}

function assetsOf(source?: Pick<FrameSource, 'realImage' | 'realImages'>): RealImageAsset[] {
  return source?.realImages?.length ? source.realImages : source?.realImage ? [source.realImage] : [];
}

async function toAsset(
  candidate: ScoredPexelsPhoto,
  localPath: string,
  query: string,
  subject: string,
  plan: SmartImagePlan,
  localFileHash: string,
  verificationLevel: RealImageAsset['verificationLevel'] = 'metadata-matched',
): Promise<RealImageAsset> {
  const photo = candidate.photo;
  const acceptedAt = new Date().toISOString();
  return {
    provider: 'pexels',
    photoId: photo.id,
    localPath,
    localFileHash,
    query,
    alt: photo.alt || subject,
    width: photo.width,
    height: photo.height,
    avgColor: photo.avg_color,
    photographer: photo.photographer,
    photographerUrl: photo.photographer_url,
    pexelsUrl: photo.url,
    fitMode: candidate.fitMode,
    position: 'center',
    layout: candidate.layout,
    scaleFrom: plan.imageMotion === 'static' ? 1 : 1.02,
    scaleTo: plan.imageMotion === 'slow-push-in' ? 1.06 : 1.02,
    downloadedAt: acceptedAt,
    acceptedAt,
    purpose: plan.purpose,
    imageMotion: plan.imageMotion,
    visualGroup: plan.visualGroup,
    license: 'Pexels License',
    verificationLevel,
    crop: { fitMode: candidate.fitMode, position: 'center' },
    motion: {
      kind: plan.imageMotion,
      scaleFrom: plan.imageMotion === 'static' ? 1 : 1.02,
      scaleTo: plan.imageMotion === 'slow-push-in' ? 1.06 : 1.02,
    },
  };
}

function result(
  frameId: string,
  status: SmartImageFrameStatus,
  assets: RealImageAsset[],
  attemptedQueries: string[],
  candidateCount: number,
  reason: string,
  startedAt: number,
): SmartImageFrameResult {
  return { frameId, status, assets, attemptedQueries, candidateCount, reason, elapsedMs: Date.now() - startedAt };
}

function assertNotAborted(signal: AbortSignal, cause?: unknown): void {
  if (!signal.aborted) return;
  if (cause instanceof Error && cause.name === 'AbortError') throw cause;
  throw new DOMException('The operation was aborted.', 'AbortError');
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function subjectKindForAssetRequest(subjectType?: AssetRequest['subjectType']): ImageSubjectPlan['kind'] {
  if (subjectType === 'person') return 'person';
  if (subjectType === 'place') return 'place';
  if (subjectType === 'equipment') return 'product';
  return 'context';
}

function queryTerms(value: string): string[] {
  const stop = new Set(['close', 'view', 'detail', 'driving', 'drive', 'open', 'modern', 'professional']);
  return [...new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) || [])]
    .filter(term => !stop.has(term));
}

function createSelection(
  plan: SmartImagePlan | undefined,
  status: SmartImageFrameStatus,
  reason: string,
  candidates: SmartImageCandidate[],
  rejectedCandidates: SmartImageCandidate[],
  attemptedQueries: string[],
  selectedAssets: RealImageAsset[] = [],
  visionReview?: VisionImageReview,
): SmartImageSelection | undefined {
  if (!plan?.assetRequest) return undefined;
  const verificationLevel = selectedAssets[0]?.verificationLevel;
  const minimumVerification = plan.minimumVerification || 'metadata-matched';
  const requiresHumanReview = status === 'needs-review' || (selectedAssets.length > 0
    && !meetsAssetVerificationLevel(verificationLevel, minimumVerification));
  return {
    request: plan.assetRequest,
    candidates,
    rejectedCandidates: rejectedCandidates.slice(0, 12),
    attemptedQueries: [...new Set(attemptedQueries)],
    selectedPhotoId: selectedAssets[0]?.photoId,
    selectedPhotoIds: selectedAssets.map(asset => asset.photoId),
    status: requiresHumanReview ? 'needs-review' : status,
    reason: requiresHumanReview ? `${reason}；该素材涉及具体身份或外观，需要视觉或人工确认` : reason,
    updatedAt: new Date().toISOString(),
    verificationLevel,
    requiresHumanReview,
    ...(visionReview ? { visionReview } : {}),
  };
}
