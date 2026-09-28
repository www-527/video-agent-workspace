import { NextRequest } from 'next/server';
import { withAIKeyRoute } from '@/lib/ai-key-route';
import { applyProjectAIContext, applyProjectGPTOptimizationOverride, getCurrentGPTOptimizationSettings } from '@/lib/ai-key-context';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { getOrCreate, clear } from '@/lib/ai/abort-registry';
import { getStyleById, getDefaultStyle, recommendGPTStyle } from '@/lib/styles/presets';
import { getCollaborationState } from '@/lib/collaboration';
import { isAnchorApproved } from '@/lib/ai/visual-anchor';
import { generateFrameHtml } from '@/lib/ai/html';
import { prepareSmartImages } from '@/lib/pexels/smart-images';
import { normalizeVideoSourceForFrames } from '@/lib/video-source';
import { commitFrameSourcePatch } from '@/lib/agents/committer';
import type { CanvasPresetId, Outline, VideoSource } from '@/types';

const schema = z.object({ projectId: z.string().uuid(), frameId: z.string().min(1).optional() });

/** Legacy compatibility endpoint. New generation requests use smartImages on /api/frames/html. */
async function handlePost(req: NextRequest) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: '参数错误' }, { status: 400 });
  if (!env.PEXELS_API_KEY) return Response.json({ error: '尚未配置 Pexels API。' }, { status: 409 });
  const project = await prisma.project.findUnique({ where: { uuid: parsed.data.projectId } });
  if (!project?.outline || project.type !== 'html') return Response.json({ error: '仅 HTML 动画项目支持图片搜索。' }, { status: 404 });
  await applyProjectAIContext(project.workflow);
  applyProjectGPTOptimizationOverride(project.gptOptimization as any);
  if (project.workflow !== 'gpt-free' && getCurrentGPTOptimizationSettings()?.enabled && !getCurrentGPTOptimizationSettings()?.internalImageSearch) {
    return Response.json({ error: '当前 GPT 专项设置已关闭内部搜图。' }, { status: 409 });
  }
  const outline = project.outline as unknown as Outline;
  if (!getCollaborationState(outline).planApproved) return Response.json({ error: '请先确认内容计划。' }, { status: 409 });
  if (!isAnchorApproved(outline.visualAnchor)) return Response.json({ error: '请先生成首镜样片并确认主题风格。' }, { status: 409 });
  if (parsed.data.frameId && !outline.frames.some(frame => frame.id === parsed.data.frameId)) return Response.json({ error: '分镜不存在。' }, { status: 404 });

  const abortController = getOrCreate(project.uuid, 'pexels');
  const signal = abortController.signal;
  req.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  const gptOptimization = getCurrentGPTOptimizationSettings();
  const style = getStyleById(project.styleId)
    || (gptOptimization?.enabled && gptOptimization.creativeFreedom !== 'conservative'
      ? recommendGPTStyle(`${outline.title} ${outline.frames.map(frame => `${frame.title} ${frame.narration}`).join(' ')}`)
      : getDefaultStyle());
  const globalScript = outline.frames.map(frame => `[#${frame.index}] ${frame.title}: ${frame.narration}`).join('\n');
  const initial = normalizeVideoSourceForFrames(project.videoSource as unknown as VideoSource | null, outline.frames);
  const targetFrameIds = parsed.data.frameId ? [parsed.data.frameId] : outline.frames.map(frame => frame.id);
  const targetIdSet = new Set(targetFrameIds);
  const planningSources = initial.frames.map(source => targetIdSet.has(source.id)
    ? { ...source, realImage: undefined, realImages: undefined }
    : source);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sources = [...initial.frames];
      const emit = (event: string, data: Record<string, unknown>) => {
        if (!signal.aborted || event === 'aborted') controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        emit('start', { stage: 'analyzing', label: '分析分镜', total: targetFrameIds.length });
        const result = await prepareSmartImages({
          projectId: project.uuid,
          outline,
          targetFrameIds,
          sources: planningSources,
          abortSignal: signal,
          canvasPreset: project.canvasPreset as 'landscape-16-9' | 'douyin-portrait-9-16',
          onProgress: event => emit('stage', {
            ...event,
            label: event.stage === 'planning' ? '规划真实素材' : event.stage === 'downloading' ? '下载真实素材' : '匹配真实素材',
          }),
        });
        sources.splice(0, sources.length, ...result.sources);
        let updated = 0;
        for (const frameId of targetFrameIds) {
          if (signal.aborted) break;
          const sourceIndex = outline.frames.findIndex(frame => frame.id === frameId);
          const prepared = result.sources[sourceIndex];
          if (prepared?.imageSelection || prepared?.visualFallbacks?.length) {
            await commitFrameSourcePatch({
              projectId: project.uuid,
              frameId,
              fallbackFrames: outline.frames,
              patch: {
                ...(prepared.imageSelection ? { imageSelection: prepared.imageSelection } : {}),
                ...(prepared.visualFallbacks?.length ? { visualFallbacks: prepared.visualFallbacks } : {}),
              },
            });
          }
          const assets = prepared?.realImages?.length ? prepared.realImages : prepared?.realImage ? [prepared.realImage] : [];
          if (!assets.length) continue;
          const frame = outline.frames[sourceIndex];
          emit('stage', { stage: 'updating', label: '更新 HTML', current: updated + 1, total: result.planned, frameId });
          try {
            const htmlCode = await generateHtmlWithImage({
              globalScript, stylePrompt: style.prompt, frame, directorPlan: outline.directorPlan,
              durationSeconds: sources[sourceIndex]?.audioPath
                ? sources[sourceIndex]?.audioDuration
                : frame.sceneSpec?.durationHint,
              themeTokens: style.tokens, visualAnchor: outline.visualAnchor, realImages: assets,
              visionReview: prepared.imageSelection?.visionReview,
              canvasPreset: project.canvasPreset as CanvasPresetId, abortSignal: signal,
            });
            const imageSelection = prepared.imageSelection ? {
              ...prepared.imageSelection,
              selectedPhotoId: assets[0]?.photoId,
              selectedPhotoIds: assets.map(asset => asset.photoId),
              status: 'completed' as const,
              reason: '可靠候选已应用到画面，可在编辑器中直接切换',
              updatedAt: new Date().toISOString(),
            } : undefined;
            sources[sourceIndex] = {
              ...sources[sourceIndex],
              id: frame.id,
              htmlCode,
              realImage: assets[0],
              realImages: assets,
              ...(imageSelection ? { imageSelection } : {}),
            };
            await commitFrameSourcePatch({
              projectId: project.uuid,
              frameId,
              fallbackFrames: outline.frames,
              patch: {
                htmlCode,
                realImage: assets[0],
                realImages: assets,
                ...(imageSelection ? { imageSelection } : {}),
              },
            });
            updated++;
            emit('frame_done', { frameId, current: updated, total: result.planned, assets });
          } catch (error) {
            if (signal.aborted) break;
            emit('frame_error', { frameId, message: 'HTML 更新失败，未应用本次下载的素材。' });
          }
        }
        if (signal.aborted) emit('aborted', { message: '用户已中断图片搜索。' });
        else emit('done', { stage: 'done', label: '完成', planned: result.planned, downloaded: result.downloaded, updated, failed: result.failed.length, skipped: result.skipped.length, message: `已规划 ${result.planned} 个分镜，下载 ${result.downloaded} 张素材，更新 ${updated} 个画面。` });
      } catch (error) {
        if (signal.aborted) emit('aborted', { message: '用户已中断图片搜索。' });
        else emit('error', { message: (error as Error).message || '图片搜索失败。' });
      } finally {
        clear(project.uuid, 'pexels');
        try { controller.close(); } catch { /* client disconnected */ }
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' } });
}

export const POST = withAIKeyRoute(handlePost);

async function generateHtmlWithImage(args: Parameters<typeof generateFrameHtml>[0]) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await generateFrameHtml(args); } catch (error) { lastError = error; if (args.abortSignal?.aborted) throw error; }
  }
  throw lastError instanceof Error ? lastError : new Error('HTML 更新失败。');
}
