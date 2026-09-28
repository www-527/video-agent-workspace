import { NextRequest } from 'next/server';
import { withAIKeyRoute } from '@/lib/ai-key-route';
import { applyProjectAIContext, applyProjectGPTOptimizationOverride } from '@/lib/ai-key-context';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { findUnappliedRealImages, generateFrameHtml, generateFreeFrameHtml, validateFreeGeneratedHtml, validateGeneratedHtml, validateRealImageUsage } from '@/lib/ai/html';
import { generateAndSaveTTSWithRetry } from '@/lib/ai/tts';
import { getOrCreate, clear } from '@/lib/ai/abort-registry';
import { getStyleById, getDefaultStyle, recommendGPTStyle } from '@/lib/styles/presets';
import type {
  CanvasPresetId,
  FrameOutline,
  FrameSource,
  Outline,
  ProjectType,
  RealImageAsset,
  SmartImageFrameStatus,
  SmartImageMode,
  SmartImagePlan,
  VideoSource,
  VisualFallbackRecord,
} from '@/types';
import { createFreeFirstFrameVisualAnchor, createVisualAnchor, isAnchorApproved } from '@/lib/ai/visual-anchor';
import { areFramesApprovedForGeneration, getCollaborationState } from '@/lib/collaboration';
import { aggregateProgressPercent, phaseProgressWeight, type GenerationPhase } from '@/lib/generation-progress';
import { getTtsProviderFromRequest } from '@/lib/tts-provider';
import { normalizeVideoSourceForFrames } from '@/lib/video-source';
import { applyHtmlPromptOverride } from '@/lib/ai/visual-prompt';
import { env } from '@/lib/env';
import { planRealImages } from '@/lib/ai/real-image-planner';
import {
  preparePexelsFallback,
  prepareSmartImageForFrame,
  type SmartImageFrameResult,
  type SmartImageProgressEvent,
  type SmartImageSelectionContext,
} from '@/lib/pexels/smart-images';
import { startFramePrerequisites } from '@/lib/frame-prerequisites';
import { classifyVisualAsset } from '@/lib/ai/visual-asset-policy';
import { createAgentInputHash, createAgentTaskInputHash } from '@/lib/agents/hash';
import { runRecordedAgentTask } from '@/lib/agents/orchestrator';
import { AgentRunConflictError, artifact, startPersistentAgentRun } from '@/lib/agents/persistence';
import type { AgentRole } from '@/lib/agents/types';
import { commitFrameSourcePatch, commitVisualAnchor } from '@/lib/agents/committer';
import {
  isFrameComplete,
  isFrameVisualComplete,
  isUiSceneDocumentReady,
  resolveFrameImagePath,
  resolveSceneContract,
} from '@/lib/scene-contract';
import { auditGPTVideoQuality } from '@/lib/render/visual-audit';
import { ensureGPTVisualBible, ensureVisualContract, stampGPTVisualBible, stampVisualContract } from '@/lib/ai/visual-contract';
import { createFreeContentAnchor } from '@/lib/ai/content-anchor';
import { runWithAITraceProjectContext } from '@/lib/ai/trace';
import {
  MAX_GPT_FREE_FRAME_CONCURRENCY,
  MIN_GPT_FREE_FRAME_CONCURRENCY,
  resolveFrameGenerationConcurrency,
} from '@/lib/generation/frame-concurrency';

const IMAGE_CONCURRENCY = 2;
const schema = z.object({
  projectId: z.string().uuid(),
  frameIds: z.array(z.string()).optional(),
  sampleOnly: z.boolean().optional(),
  forceVisual: z.boolean().optional(),
  forceAudio: z.boolean().optional(),
  freshStart: z.boolean().optional(),
  promptOverride: z.string().trim().min(1).max(8000).optional(),
  smartImages: z.boolean().optional(),
  smartImageMode: z.enum(['fast', 'balanced', 'asset-priority']).optional(),
  frameConcurrency: z.number().int()
    .min(MIN_GPT_FREE_FRAME_CONCURRENCY)
    .max(MAX_GPT_FREE_FRAME_CONCURRENCY)
    .optional(),
});

/** POST /api/frames/html - streams HTML frame generation progress over SSE. */
async function handlePost(req: NextRequest) {
  const ttsProvider = getTtsProviderFromRequest(req);
  const requiresAudio = ttsProvider !== 'none';
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: '参数错误' }, { status: 400 });

  const {
    projectId,
    frameIds,
    sampleOnly,
    forceVisual,
    forceAudio,
    freshStart,
    promptOverride,
    smartImages,
    smartImageMode: requestedSmartImageMode,
    frameConcurrency,
  } = parsed.data;
  const project = await prisma.project.findUnique({ where: { uuid: projectId } });
  if (!project?.outline) return Response.json({ error: '项目或大纲不存在' }, { status: 404 });
  await applyProjectAIContext(project.workflow);
  applyProjectGPTOptimizationOverride(project.gptOptimization as any);

  let outline = project.outline as unknown as Outline;
  const collaboration = getCollaborationState(outline);
  const isSingleExistingFrame = Boolean(frameIds?.length === 1 && outline.frames.some(frame => frame.id === frameIds[0]));
  const areApprovedFramesRequested = areFramesApprovedForGeneration(outline, frameIds);
  const isSingleFrameRegeneration = Boolean((forceVisual || forceAudio) && isSingleExistingFrame);
  const canGenerateTargetedFrames = isSingleFrameRegeneration || areApprovedFramesRequested;
  if (!collaboration.planApproved && !canGenerateTargetedFrames) {
    return Response.json({ error: '请先确认内容计划' }, { status: 409 });
  }
  if (promptOverride) {
    if (frameIds?.length !== 1 || !outline.frames.some(frame => frame.id === frameIds[0])) {
      return Response.json({ error: '画面提示词只能用于单个有效分镜' }, { status: 400 });
    }
    outline = {
      ...outline,
      frames: outline.frames.map(frame => frame.id === frameIds[0]
        ? applyHtmlPromptOverride(frame, promptOverride)
        : frame),
    };
    await prisma.project.update({ where: { uuid: projectId }, data: { outline: outline as any } });
  }

  const initialVideoSource = normalizeVideoSourceForFrames(project.videoSource as unknown as VideoSource | null, outline.frames);
  const selectedFrames = frameIds?.length ? outline.frames.filter(frame => frameIds.includes(frame.id)) : outline.frames;
  const targetFrames = sampleOnly ? selectedFrames.slice(0, 1) : selectedFrames;
  // The first-frame sample must be able to establish the visual language with
  // a real image too. Use the asset-priority budget for a one-frame sample so
  // the planner does not normalize its image quota down to zero.
  const smartImageMode: SmartImageMode | undefined = smartImages
    ? (sampleOnly ? 'asset-priority' : requestedSmartImageMode || 'balanced')
    : undefined;
  const shouldUseSmartImages = Boolean(smartImageMode && env.PEXELS_API_KEY);
  const generationMode = project.type as ProjectType;
  const abortController = getOrCreate(projectId, generationMode);
  const signal = abortController.signal;
  req.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  let agentRun;
  try {
    agentRun = await startPersistentAgentRun({
      projectId,
      kind: 'frame-generation',
      inputHash: createAgentInputHash({
        projectUpdatedAt: project.updatedAt.toISOString(),
        frameIds: targetFrames.map(frame => frame.id),
        forceVisual,
        forceAudio,
        freshStart,
        promptOverride,
        smartImageMode,
      }),
    });
  } catch (error) {
    if (error instanceof AgentRunConflictError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const stylePreset = getStyleById(project.styleId)
    || (project.workflow === 'gpt-free'
      ? recommendGPTStyle(`${outline.title} ${outline.frames.map(frame => `${frame.title} ${frame.narration}`).join(' ')}`)
      : getDefaultStyle());
  const visualContract = project.workflow === 'gpt-free' ? undefined : ensureVisualContract(outline.visualContract, stylePreset);
  const gptVisualBible = project.workflow === 'gpt-free' ? ensureGPTVisualBible(outline.gptVisualBible, stylePreset, outline) : undefined;
  const freeContentAnchor = project.workflow === 'gpt-free' ? createFreeContentAnchor(outline) : undefined;
  const freeFirstFrameVisualAnchor = project.workflow === 'gpt-free' ? createFreeFirstFrameVisualAnchor(outline) : undefined;
  if ((visualContract && outline.visualContract !== visualContract)
    || (gptVisualBible && (
      outline.gptVisualBible !== gptVisualBible
      || Boolean(outline.visualContract)
      || outline.freeContentAnchor?.topic !== freeContentAnchor?.topic
      || outline.freeContentAnchor?.coreMessage !== freeContentAnchor?.coreMessage
      || outline.freeFirstChapterAnchor?.frameId !== freeFirstFrameVisualAnchor?.frameId
      || outline.freeFirstChapterAnchor?.summary !== freeFirstFrameVisualAnchor?.summary
    ))) {
    if (gptVisualBible) {
      const gptOutline = { ...outline, gptVisualBible, freeContentAnchor, freeFirstChapterAnchor: freeFirstFrameVisualAnchor };
      delete gptOutline.visualContract;
      outline = gptOutline;
    } else if (visualContract) {
      outline = { ...outline, visualContract };
    }
    await prisma.project.update({ where: { uuid: projectId }, data: { outline: outline as any } });
  }
  const globalScript = outline.frames.map(frame => `[#${frame.index}] ${frame.title}: ${frame.narration}`).join('\n');

  const stream = new ReadableStream({
    async start(streamController) {
      const encoder = new TextEncoder();
      const startedAt = new Date().toISOString();
      const frameProgress = Array<number>(targetFrames.length).fill(0);
      const newSources = [...initialVideoSource.frames];
      const successfulFrameIds = new Set<string>();
      const failedFrameIds = new Set<string>();
      const plansByFrame = new Map<string, SmartImagePlan>();
      const imageSemaphore = new Semaphore(IMAGE_CONCURRENCY);
      const selectionContext: SmartImageSelectionContext = {
        usedPhotoIds: new Set(newSources.flatMap(source => assetsOf(source).map(asset => asset.photoId))),
        previousPhotographer: newSources.flatMap(assetsOf).at(-1)?.photographer,
        previousColor: newSources.flatMap(assetsOf).at(-1)?.avgColor,
      };
      const imageStats = {
        planned: 0,
        downloaded: 0,
        accepted: 0,
        applied: 0,
        fallback: 0,
        failed: 0,
        decisions: [] as Array<{ frameId: string; status: SmartImageFrameStatus; reason: string }>,
      };
      let pexelsRateLimited = false;
      const recordedArtifacts = new Map<string, import('@/lib/agents/types').AgentArtifact>();
      let lastPercent = 0;
      let completed = 0;
      let saveQueue: Promise<void> = Promise.resolve();
      let agentRunFinished = false;
      const workerConcurrency = resolveFrameGenerationConcurrency({
        workflow: project.workflow,
        sampleOnly: Boolean(sampleOnly),
        targetFrameCount: targetFrames.length,
        configuredGPTFreeConcurrency: frameConcurrency ?? process.env.GPT_FREE_FRAME_CONCURRENCY,
      });

      const percent = () => {
        lastPercent = Math.max(lastPercent, aggregateProgressPercent(frameProgress, targetFrames.length));
        return lastPercent;
      };
      const emit = (event: string, data: Record<string, unknown>) => {
        if (signal.aborted && event !== 'aborted') return;
        streamController.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const serializeSave = <T,>(operation: () => Promise<T>): Promise<T> => {
        const run = saveQueue.then(operation, operation);
        saveQueue = run.then(() => undefined, () => undefined);
        return run;
      };
      const persistSource = (sourceIndex: number, patch: Partial<FrameSource>) => serializeSave(async () => {
        const committed = await commitFrameSourcePatch({
          projectId,
          frameId: outline.frames[sourceIndex].id,
          patch,
          fallbackFrames: outline.frames,
        });
        newSources.splice(0, newSources.length, ...committed);
      });
      const finishAgentRun = async (
        status: 'completed' | 'partial_failed' | 'failed' | 'cancelled',
        summary?: unknown,
      ) => {
        if (agentRunFinished) return;
        agentRunFinished = true;
        await agentRun.finish(status, summary);
      };
      const runAgentStage = async <T,>(options: {
        taskId: string;
        role: AgentRole;
        dependencies?: string[];
        frameId?: string;
        input: unknown;
        execute: () => Promise<T>;
        allowReuse?: boolean;
      }): Promise<T> => {
        const dependencies = options.dependencies || [];
        const result = await runWithAITraceProjectContext(projectId, () => runRecordedAgentTask<T>({
          runId: agentRun.id,
          task: {
            id: options.taskId,
            role: options.role,
            dependencies,
            frameId: options.frameId,
            inputHash: createAgentTaskInputHash({
              role: options.role,
              input: options.input,
              dependencyArtifacts: dependencies.map(id => recordedArtifacts.get(id)),
            }),
            maxAttempts: 1,
            allowReuse: options.allowReuse,
          },
          abortSignal: signal,
          hooks: agentRun.hooks,
          artifacts: recordedArtifacts,
          execute: async () => artifact(options.role, await options.execute()),
        }));
        return result.artifact!.data;
      };

      emit('start', {
        mode: generationMode, total: targetFrames.length, current: 0, phase: 'prepare',
        status: 'preparing', percent: 0, startedAt, workerConcurrency,
      });

      if (smartImageMode && !env.PEXELS_API_KEY) {
        emit('message', {
          mode: generationMode, total: targetFrames.length, current: 0, phase: 'prepare',
          status: 'preparing', percent: 0, startedAt,
          message: '未配置素材服务，将按场景契约使用原生动画或等待搜图素材。',
        });
      }

      // One lightweight whole-film decision. No network image search/download
      // happens here, so frame production is not blocked on all assets.
      const projectType = project.type as ProjectType;
      const visualTargetFrames = targetFrames.filter(frame => {
        const sourceIndex = outline.frames.findIndex(candidate => candidate.id === frame.id);
        return forceVisual || !isFrameVisualComplete(newSources[sourceIndex], projectType, frame);
      });
      if (shouldUseSmartImages && visualTargetFrames.length && !signal.aborted) {
        const phaseStartedAt = new Date().toISOString();
        emit('phase_start', {
          mode: generationMode, total: targetFrames.length, current: 0, phase: 'image_plan',
          status: 'generating', percent: percent(), startedAt, phaseStartedAt,
        });
        try {
          const plans = await runAgentStage({
            taskId: 'asset-plan',
            role: 'asset-planner',
            input: {
              frames: visualTargetFrames,
              smartImageMode,
              existingAssets: newSources.map(source => assetsOf(source)),
            },
            execute: () => planRealImages(
              { ...outline, frames: visualTargetFrames },
              newSources,
              signal,
              smartImageMode,
            ),
            allowReuse: true,
          });
          for (const plan of plans) plansByFrame.set(plan.frameId, plan);
          imageStats.planned = plans.filter(plan => plan.useRealImage).length;
        } catch (error) {
          if (!signal.aborted) {
            console.warn('[smart images] planning failed; using native HTML', error);
            emit('message', {
              mode: generationMode, total: targetFrames.length, current: 0, phase: 'image_plan',
              status: 'generating', percent: percent(), startedAt,
              message: '智能配图规划失败，已自动使用动画设计。',
            });
            recordedArtifacts.set('asset-plan', artifact('asset-plan-fallback', []));
          }
        }
        for (let index = 0; index < frameProgress.length; index++) {
          frameProgress[index] = Math.max(frameProgress[index], phaseProgressWeight(generationMode, 'image_plan', true));
        }
        emit('phase_end', {
          mode: generationMode, total: targetFrames.length, current: 0, phase: 'image_plan',
          status: 'generating', percent: percent(), startedAt, phaseStartedAt,
          phaseEndedAt: new Date().toISOString(),
        });
      } else {
        for (let index = 0; index < frameProgress.length; index++) {
          frameProgress[index] = Math.max(frameProgress[index], phaseProgressWeight(generationMode, 'image_plan', true));
        }
      }

      const processFrame = async (frameIndex: number) => {
        const frame = targetFrames[frameIndex];
        const current = frameIndex + 1;
        const contract = project.workflow === 'gpt-free'
          ? { mode: 'html' as const }
          : resolveSceneContract(projectType, frame);
        const visualPhase: GenerationPhase = contract.mode === 'image' ? 'image' : 'html';
        let activePhase: GenerationPhase = 'prepare';
        let phaseStartedAt = '';

        const eventBase = (phase: GenerationPhase) => ({
          mode: generationMode, frameId: frame.id, current, total: targetFrames.length,
          phase, status: phase === 'save' ? 'saving' : 'generating', percent: percent(), startedAt,
        });
        const beginPhase = (phase: GenerationPhase) => {
          activePhase = phase;
          phaseStartedAt = new Date().toISOString();
          frameProgress[frameIndex] = Math.max(frameProgress[frameIndex], phaseProgressWeight(generationMode, phase));
          emit('phase_start', { ...eventBase(phase), phaseStartedAt });
        };
        const endPhase = (phase: GenerationPhase) => {
          frameProgress[frameIndex] = Math.max(frameProgress[frameIndex], phaseProgressWeight(generationMode, phase, true));
          emit('phase_end', { ...eventBase(phase), phaseStartedAt, phaseEndedAt: new Date().toISOString() });
        };
        const emitImageProgress = (event: SmartImageProgressEvent) => {
          const phase: GenerationPhase = event.stage === 'downloading' || event.stage === 'accepted'
            ? 'image_download'
            : 'image_search';
          frameProgress[frameIndex] = Math.max(
            frameProgress[frameIndex],
            phaseProgressWeight(generationMode, phase, event.stage === 'accepted' || event.stage === 'fallback'),
          );
          const eventName = event.stage === 'downloading'
            ? 'image_download'
            : event.stage === 'accepted'
              ? 'image_accepted'
              : event.stage === 'fallback'
                ? 'image_fallback'
                : 'image_search';
          emit(eventName, { ...eventBase(phase), imageStatus: event.status, message: event.message });
        };

        if (signal.aborted) return;
        const sourceIndex = outline.frames.findIndex(candidate => candidate.id === frame.id);
        const existing = newSources[sourceIndex];
        if (!forceVisual && !forceAudio && isFrameComplete(existing, projectType, frame, { requiresAudio })) {
          frameProgress[frameIndex] = 1;
          completed++;
          successfulFrameIds.add(frame.id);
          emit('skip', { ...eventBase('save'), skipped: true });
          return;
        }

        try {
          // Start both promises before awaiting either. This is the core
          // per-frame pipeline: slow Pexels work cannot delay TTS startup.
          const prerequisites = startFramePrerequisites(async () => {
            let audioUrl = existing?.audioPath;
            let audioDuration = existing?.audioPath ? existing.audioDuration : undefined;
            let error: Error | null = null;
            if (requiresAudio && (forceAudio || !audioUrl)) {
              beginPhase('tts');
              try {
                const tts = await runAgentStage({
                  taskId: `audio:${frame.id}`,
                  role: 'tts',
                  frameId: frame.id,
                  input: {
                    narration: frame.narration,
                    provider: ttsProvider,
                    forceAudio,
                  },
                  execute: () => generateAndSaveTTSWithRetry({
                    projectId, frameId: frame.id, text: frame.narration,
                    provider: ttsProvider, abortSignal: signal,
                  }),
                  allowReuse: !forceAudio,
                });
                audioUrl = tts.url;
                audioDuration = tts.duration;
                await persistSource(sourceIndex, { audioPath: audioUrl, audioDuration });
                endPhase('tts');
              } catch (caught) {
                if (signal.aborted) return { audioUrl, audioDuration, error: caught as Error };
                error = caught as Error;
                failedFrameIds.add(frame.id);
                emit('phase_error', {
                  ...eventBase('tts'), phaseStartedAt, phaseEndedAt: new Date().toISOString(),
                  failed: true, message: `语音生成失败：${error.message}`,
                });
              }
            } else {
              frameProgress[frameIndex] = Math.max(frameProgress[frameIndex], phaseProgressWeight(generationMode, 'tts', true));
            }
            return { audioUrl, audioDuration, error };
          }, async (): Promise<SmartImageFrameResult> => {
            return runAgentStage({
              taskId: `asset:${frame.id}`,
              role: 'asset',
              dependencies: shouldUseSmartImages ? ['asset-plan'] : [],
              frameId: frame.id,
              input: {
                frame,
                forceVisual,
                smartImageMode,
                existingAssets: assetsOf(existing),
              },
              execute: async () => {
                const existingAssets = forceVisual ? [] : assetsOf(existing);
                const needsVisual = forceVisual || !isFrameVisualComplete(existing, projectType, frame);
                if (!needsVisual) return nativeImageResult(frame.id, '画面已存在，无需准备素材');
                if (contract.mode === 'ui-scene') return nativeImageResult(frame.id, '结构化 UI 镜头无需准备外部图片');
                const plan = plansByFrame.get(frame.id);
                if (!existingAssets.length && (!shouldUseSmartImages || !plan?.useRealImage)) {
                  const native = nativeImageResult(frame.id, plan?.reason || '该分镜采用 HTML 原生视觉');
                  imageStats.decisions.push({ frameId: frame.id, status: native.status, reason: native.reason });
                  return native;
                }
                if (!existingAssets.length && pexelsRateLimited) {
                  const fallback = await preparePexelsFallback({
                    projectId, frame, plan: plan!, abortSignal: signal,
                    reason: 'Pexels 素材服务已限流',
                    onProgress: emitImageProgress,
                  });
                  imageStats.fallback++;
                  if (fallback.status === 'accepted') imageStats.accepted++;
                  imageStats.decisions.push({ frameId: frame.id, status: fallback.status, reason: fallback.reason });
                  return fallback;
                }

                return imageSemaphore.run(async () => {
              if (!existingAssets.length && pexelsRateLimited) {
                const fallback = await preparePexelsFallback({
                  projectId, frame, plan: plan!, abortSignal: signal,
                  reason: 'Pexels 素材服务已限流',
                  onProgress: emitImageProgress,
                });
                imageStats.fallback++;
                if (fallback.status === 'accepted') imageStats.accepted++;
                imageStats.decisions.push({ frameId: frame.id, status: fallback.status, reason: fallback.reason });
                return fallback;
              }
              const prepared = await prepareSmartImageForFrame({
                projectId,
                frame,
                plan,
                existingSource: existing,
                abortSignal: signal,
                deadlineMs: plan?.deadlineMs,
                selectionContext,
                canvasPreset: project.canvasPreset as 'landscape-16-9' | 'douyin-portrait-9-16',
                onProgress: emitImageProgress,
              });
              if (prepared.rateLimited) pexelsRateLimited = true;
              const reused = existingAssets.length > 0;
              if (prepared.status === 'accepted') {
                imageStats.accepted++;
                if (!reused) imageStats.downloaded += prepared.assets.length;
              } else if (prepared.status !== 'not-planned') {
                imageStats.fallback++;
                if (prepared.status === 'rejected') imageStats.failed++;
              }
              imageStats.decisions.push({ frameId: frame.id, status: prepared.status, reason: prepared.reason });
              return prepared;
                }, signal);
              },
              allowReuse: !forceVisual,
            });
          });

          const [ttsResult, imageResult] = await prerequisites.settled;
          if (signal.aborted) return;
          const visualDuration = ttsResult.audioUrl && ttsResult.audioDuration
            ? ttsResult.audioDuration
            : frame.sceneSpec?.durationHint;

          const resolvedFallbacks = resolveVisualFallbacks(imageResult);
          // Persist the complete search decision before rendering. If a later
          // renderer fails, the editor still retains queries and diagnostics.
          if (imageResult.selection || resolvedFallbacks.length) {
            await persistSource(sourceIndex, {
              ...(imageResult.selection ? { imageSelection: imageResult.selection } : {}),
              ...(resolvedFallbacks.length ? { visualFallbacks: resolvedFallbacks } : {}),
            });
          }

          const assetPolicy = classifyVisualAsset(frame);
          if (assetPolicy.fidelity === 'required' && imageResult.status !== 'accepted') {
            emit('image_fallback', {
              ...eventBase('image_search'),
              imageStatus: imageResult.status,
              message: contract.mode === 'image'
                ? `未找到合适的${assetPolicy.assetClass}素材；AI 生图已禁用，请先通过搜图获取素材。`
                : `未找到合适的${assetPolicy.assetClass}素材，继续生成原生动画，避免整镜缺失。`,
            });
          }

          const preparedAssets = imageResult.status === 'accepted' ? imageResult.assets : [];
          let html = contract.mode === 'html' && !forceVisual ? existing?.htmlCode : undefined;
          let imagePath = contract.mode === 'image' && !forceVisual ? resolveFrameImagePath(existing) : undefined;
          let appliedAssets: RealImageAsset[] = [];
          let visualTaskExecuted = false;
          const dependencies = [
            requiresAudio && (forceAudio || !existing?.audioPath) && !ttsResult.error ? `audio:${frame.id}` : null,
            `asset:${frame.id}`,
          ].filter((value): value is string => Boolean(value));

          if (contract.mode === 'html') {
            // A blank replacement forgets the old shot, not the film it belongs
            // to. GPT-free projects retain project-level narrative and visual
            // context while deliberately omitting prior visual anchors.
            const composeFreshHtml = project.workflow === 'gpt-free'
              ? async () => stampGPTVisualBible(await generateFreeFrameHtml({
                  globalScript,
                  frame,
                  directorPlan: outline.directorPlan,
                  visualBible: gptVisualBible!,
                  contentAnchor: freeContentAnchor,
                  sourceMaterial: outline.sourceMaterial,
                  creativeBrief: outline.freeCreativeBrief,
                  neighboringScenes: outline.frames
                    .filter(candidate => Math.abs(candidate.index - frame.index) === 1)
                    .map(candidate => ({ index: candidate.index, title: candidate.title, visualIntent: candidate.sceneSpec?.visualIntent })),
                  durationSeconds: visualDuration,
                  canvasPreset: project.canvasPreset as CanvasPresetId,
                  realImages: preparedAssets,
                  visionReview: imageResult.selection?.visionReview,
                  abortSignal: signal,
                }), gptVisualBible!)
              : async () => generateFrameHtml({
                  globalScript: '',
                  stylePrompt: '',
                  frame,
                  durationSeconds: visualDuration,
                  canvasPreset: project.canvasPreset as CanvasPresetId,
                  realImages: preparedAssets,
                  visionReview: imageResult.selection?.visionReview,
                  allowNativeImageFallback: true,
                  abortSignal: signal,
                });
            const composeHtml = freshStart
              ? composeFreshHtml
              : project.workflow === 'gpt-free'
              ? async () => stampGPTVisualBible(await generateFreeFrameHtml({
                  globalScript,
                  frame,
                  directorPlan: outline.directorPlan,
                  visualBible: gptVisualBible!,
                  contentAnchor: freeContentAnchor,
                  firstFrameVisualAnchor: freeFirstFrameVisualAnchor,
                  sourceMaterial: outline.sourceMaterial,
                  creativeBrief: outline.freeCreativeBrief,
                  visualAnchor: isAnchorApproved(outline.visualAnchor) ? outline.visualAnchor : undefined,
                  neighboringScenes: outline.frames
                    .filter(candidate => Math.abs(candidate.index - frame.index) === 1)
                    .map(candidate => ({ index: candidate.index, title: candidate.title, visualIntent: candidate.sceneSpec?.visualIntent })),
                  durationSeconds: visualDuration,
                  canvasPreset: project.canvasPreset as CanvasPresetId,
                  realImages: preparedAssets,
                  visionReview: imageResult.selection?.visionReview,
                  abortSignal: signal,
                }), gptVisualBible!)
              : async () => stampVisualContract(await generateFrameHtml({
                  globalScript,
                  stylePrompt: `${stylePreset.prompt}\n\n【全片视觉契约】\n${JSON.stringify(visualContract, null, 2)}\n只允许使用本契约的 Token、构图和禁用规则。`,
                  frame,
                  directorPlan: outline.directorPlan,
                  durationSeconds: visualDuration,
                  themeTokens: stylePreset.tokens,
                  visualAnchor: isAnchorApproved(outline.visualAnchor) ? outline.visualAnchor : undefined,
                  visualContract: visualContract!,
                  canvasPreset: project.canvasPreset as CanvasPresetId,
                  realImage: preparedAssets[0],
                  realImages: preparedAssets,
                  visionReview: imageResult.selection?.visionReview,
                  allowNativeImageFallback: true,
                  abortSignal: signal,
                }), visualContract!);
            if (!html) {
              beginPhase(visualPhase);
              emit('html', {
                ...eventBase(visualPhase),
                imageStatus: preparedAssets.length ? 'rendering-with-image' : 'rendering-native',
                message: preparedAssets.length ? '正在生成带真实素材的 HTML 画面' : '正在生成原生动画画面',
              });
              html = await runAgentStage({
                taskId: `visual:${frame.id}`,
                role: 'visual-composer',
                dependencies,
                frameId: frame.id,
                input: {
                  frame,
                  directorPlan: outline.directorPlan,
                  durationSeconds: visualDuration,
                  ...(freeContentAnchor ? { contentAnchor: freeContentAnchor } : {}),
                  ...(freeFirstFrameVisualAnchor ? { firstFrameVisualAnchor: freeFirstFrameVisualAnchor } : {}),
                  assets: preparedAssets,
                  styleId: stylePreset.id,
                },
                execute: composeHtml,
                allowReuse: !forceVisual,
              });
              visualTaskExecuted = true;
              endPhase(visualPhase);
            }
            const unappliedAssets = findUnappliedRealImages(html, preparedAssets);
            appliedAssets = preparedAssets.length && !unappliedAssets.length ? preparedAssets : [];
            if (preparedAssets.length && unappliedAssets.length) {
              const assetPaths = unappliedAssets.map(asset => asset.localPath);
              const reason = '真实图片已通过元数据筛选，但最终 HTML 未引用指定的本地素材路径；该镜头已降级为原生 HTML 画面。';
              console.warn('[smart images] accepted assets were not applied', { projectId, frameId: frame.id, assetPaths, reason });
              emit('image_fallback', {
                ...eventBase(visualPhase), failed: true, imageStatus: 'rejected', message: reason,
                imageUsageFailure: { reason, assetPaths },
              });
            }
          } else if (contract.mode === 'image') {
            if (preparedAssets.length) {
              imagePath = await runAgentStage({
                taskId: `visual:${frame.id}`,
                role: 'image-resolver',
                dependencies,
                frameId: frame.id,
                input: { frameId: frame.id, assets: preparedAssets },
                execute: async () => preparedAssets[0].localPath,
                allowReuse: !forceVisual,
              });
              visualTaskExecuted = true;
              appliedAssets = preparedAssets;
            } else if (!imagePath) {
              throw new Error('图片分镜缺少本地图片；AI 生图已禁用，请先通过 Pexels 搜图或改用 HTML 视觉。');
            }
          } else {
            await runAgentStage({
              taskId: `visual:${frame.id}`,
              role: 'ui-scene-renderer',
              dependencies,
              frameId: frame.id,
              input: { frameId: frame.id, sceneSpec: frame.sceneSpec },
              execute: async () => reviewUiSceneArtifact(frame),
              allowReuse: true,
            });
            visualTaskExecuted = true;
          }
          if (signal.aborted) return;

          await runAgentStage({
            taskId: `validate:${frame.id}`,
            role: 'validator',
            dependencies: visualTaskExecuted ? [`visual:${frame.id}`] : [],
            frameId: frame.id,
            input: { frameId: frame.id, mode: contract.mode, html, imagePath, assets: appliedAssets, sceneSpec: frame.sceneSpec },
            execute: async () => reviewResolvedFrameArtifact({ mode: contract.mode, frame, html, imagePath, assets: appliedAssets, workflow: project.workflow }),
          });

          beginPhase('save');
          const finalSelection = imageResult.selection ? {
            ...imageResult.selection,
            selectedPhotoId: appliedAssets[0]?.photoId,
            selectedPhotoIds: appliedAssets.map(asset => asset.photoId),
            status: appliedAssets.length
              ? imageResult.selection.requiresHumanReview
                ? 'needs-review' as const
                : 'completed' as const
              : imageResult.status === 'accepted'
                ? 'rejected' as const
                : imageResult.status,
            reason: appliedAssets.length
              ? imageResult.selection.requiresHumanReview
                ? '元数据匹配候选已应用，但具体身份或外观仍需人工确认'
                : '元数据匹配候选已应用到画面，可在编辑器中直接切换'
              : preparedAssets.length
                ? '候选图片已保留，但最终 HTML 未引用指定素材，当前使用原生画面'
                : imageResult.reason,
            updatedAt: new Date().toISOString(),
          } : undefined;
          await persistSource(sourceIndex, {
            ...(contract.mode === 'html' ? { htmlCode: html } : {}),
            ...(contract.mode === 'image' ? {
              imagePath,
            } : {}),
            ...(appliedAssets.length ? { realImage: appliedAssets[0], realImages: appliedAssets } : {}),
            ...(finalSelection ? { imageSelection: finalSelection } : {}),
            ...(resolvedFallbacks.length ? { visualFallbacks: resolvedFallbacks } : {}),
            ...(ttsResult.audioUrl
              ? { audioPath: ttsResult.audioUrl, audioDuration: ttsResult.audioDuration }
              : {}),
          });
          if (appliedAssets.length) imageStats.applied++;
          endPhase('save');

          if (!ttsResult.error) completed++;
          successfulFrameIds.add(frame.id);
          emit('frame_done', {
            ...eventBase('save'),
            audioPath: ttsResult.audioUrl,
            audioDuration: ttsResult.audioUrl ? ttsResult.audioDuration : undefined,
            partial: Boolean(ttsResult.error),
            imageStatus: appliedAssets.length ? 'completed' : imageResult.status,
            imageReason: imageResult.reason,
          });
        } catch (error) {
          if (signal.aborted) return;
          console.error(`[frame ${frame.id}] HTML generation failed`, error);
          failedFrameIds.add(frame.id);
          frameProgress[frameIndex] = 1;
          emit('frame_error', {
            ...eventBase(activePhase), failed: true, message: (error as Error).message,
          });
        }
      };

      try {
        let nextFrameIndex = 0;
        const worker = async () => {
          while (!signal.aborted) {
            const frameIndex = nextFrameIndex++;
            if (frameIndex >= targetFrames.length) return;
            await processFrame(frameIndex);
          }
        };
        await Promise.all(Array.from({ length: workerConcurrency }, worker));
        await saveQueue;

        if (sampleOnly && successfulFrameIds.size > 0 && !signal.aborted) {
          const visualAnchor = createVisualAnchor(stylePreset);
          await serializeSave(() => commitVisualAnchor({ projectId, visualAnchor }));
          emit('sample_ready', {
            frameIds: targetFrames.filter(frame => successfulFrameIds.has(frame.id)).map(frame => frame.id),
            visualAnchor,
            requiresConfirmation: true,
          });
        }

        if (signal.aborted) {
          await finishAgentRun('cancelled', {
            completed,
            failed: failedFrameIds.size,
            total: targetFrames.length,
            workerConcurrency,
          });
          emit('aborted', {
            mode: generationMode, current: completed, total: targetFrames.length, phase: 'done',
            status: 'aborted', percent: lastPercent, startedAt, workerConcurrency, reason: '用户中断',
          });
        } else {
          const failed = failedFrameIds.size;
          let gptQualityReport: ReturnType<typeof auditGPTVideoQuality> | undefined;
          // GPT Free is the workflow that most needs a whole-film audit: it
          // deliberately grants more visual freedom, so do not exclude it from
          // the narrative, visual-rhythm and asset checks at completion.
          if (project.workflow === 'gpt-free') {
            try {
              const latestProject = await prisma.project.findUnique({
                where: { uuid: projectId },
                select: { videoSource: true },
              });
              const latestVideoSource = normalizeVideoSourceForFrames(
                latestProject?.videoSource as unknown as VideoSource | null,
                outline.frames,
              );
              gptQualityReport = auditGPTVideoQuality(outline, latestVideoSource);
              await prisma.project.update({
                where: { uuid: projectId },
                data: { videoSource: { ...latestVideoSource, gptQualityReport } as any },
              });
              emit('quality_report', { report: gptQualityReport });
            } catch (qualityError) {
              console.warn('[frames/html] GPT whole-film quality audit failed', qualityError);
            }
          }
          await finishAgentRun(failed ? 'partial_failed' : 'completed', {
            completed,
            failed,
            total: targetFrames.length,
            workerConcurrency,
            smartImages: imageStats,
            ...(gptQualityReport ? { gptQualityReport } : {}),
          });
          emit('done', {
            mode: generationMode, completed, current: targetFrames.length, total: targetFrames.length,
            phase: 'done', status: failed ? 'partial_failed' : 'completed', percent: 100, startedAt, failed,
            sampleOnly: Boolean(sampleOnly), workerConcurrency,
            message: failed ? `${failed} 个分镜经过自动重试后仍未完整生成，可再次点击生成以继续修复。` : undefined,
            smartImages: {
              enabled: Boolean(smartImageMode),
              mode: smartImageMode,
              ...imageStats,
              skipped: imageStats.decisions.filter(item => item.status !== 'accepted').length,
            },
            ...(gptQualityReport ? { gptQualityReport } : {}),
          });
        }
      } catch (error) {
        console.error('[frames/html] multi-agent run failed', error);
        await finishAgentRun(signal.aborted ? 'cancelled' : 'failed', {
          completed,
          failed: failedFrameIds.size,
          total: targetFrames.length,
          workerConcurrency,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => {});
        if (!signal.aborted) {
          emit('done', {
            mode: generationMode, completed, current: completed, total: targetFrames.length,
            phase: 'done', status: 'partial_failed', percent: percent(), startedAt,
            failed: Math.max(1, targetFrames.length - completed),
            workerConcurrency,
            message: '生成任务意外中断，已完成分镜会保留，可再次点击生成以继续。',
          });
        }
      } finally {
        if (!agentRunFinished) {
          await finishAgentRun(signal.aborted ? 'cancelled' : 'failed', {
            completed,
            failed: failedFrameIds.size,
            total: targetFrames.length,
            workerConcurrency,
          }).catch(() => {});
        }
        clear(projectId, generationMode);
        try { streamController.close(); } catch { /* client disconnected */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

export const POST = withAIKeyRoute(handlePost);

function reviewFrameArtifact(html: string, assets: RealImageAsset[], workflow?: string) {
  if (workflow === 'gpt-free') validateFreeGeneratedHtml(html);
  else validateGeneratedHtml(html);
  for (const asset of assets) validateRealImageUsage(html, asset);
  return {
    valid: true,
    htmlLength: html.length,
    assetCount: assets.length,
  };
}

function reviewUiSceneArtifact(frame: FrameOutline) {
  if (!isUiSceneDocumentReady(frame)) {
    throw new Error('ui-scene 缺少 uiArchetype 或 uiSchemaVersion=1');
  }
  return {
    valid: true,
    archetype: frame.sceneSpec!.uiArchetype,
    interactionCount: frame.sceneSpec!.interactionSequence?.length || 0,
  };
}

function reviewResolvedFrameArtifact(options: {
  mode: 'html' | 'image' | 'ui-scene';
  frame: FrameOutline;
  html?: string;
  imagePath?: string;
  assets: RealImageAsset[];
  workflow?: string;
}) {
  if (options.mode === 'html') {
    if (!options.html) throw new Error('HTML 镜头缺少 htmlCode');
    return reviewFrameArtifact(options.html, options.assets, options.workflow);
  }
  if (options.mode === 'image') {
    if (!options.imagePath || !/^\/api\/data\/(?:images|pexels)\//.test(options.imagePath)) {
      throw new Error('图片镜头缺少受信任的本地图片');
    }
    return { valid: true, imagePath: options.imagePath, assetCount: options.assets.length };
  }
  return reviewUiSceneArtifact(options.frame);
}

function resolveVisualFallbacks(imageResult: SmartImageFrameResult): VisualFallbackRecord[] {
  return imageResult.fallbacks || [];
}

function assetsOf(source?: Pick<FrameSource, 'realImage' | 'realImages'>): RealImageAsset[] {
  return source?.realImages?.length ? source.realImages : source?.realImage ? [source.realImage] : [];
}

function nativeImageResult(
  frameId: string,
  reason: string,
  status: Extract<SmartImageFrameStatus, 'not-planned' | 'unavailable'> = 'not-planned',
): SmartImageFrameResult {
  return { frameId, status, assets: [], attemptedQueries: [], candidateCount: 0, reason, elapsedMs: 0 };
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const start = () => {
        signal.removeEventListener('abort', onAbort);
        this.active++;
        resolve();
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(start);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      };
      this.waiters.push(start);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private release() {
    this.active--;
    this.waiters.shift()?.();
  }
}
