import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { normalizeVideoSourceForFrames } from '@/lib/video-source';
import { applyRealImageGallery, removeRealImageAssets, replaceRealImageSlot, sanitizeHtml, validateGeneratedHtml, validateRealImageUsage } from '@/lib/ai/html';
import { verifyLocalPexelsAsset } from '@/lib/pexels/local-asset';
import { AgentCommitConflictError, commitFrameSourcePatch } from '@/lib/agents/committer';
import type { FrameOutline, Outline, ProjectDetail, ProjectType, RealImageAsset, SmartImageCandidate, VideoSource } from '@/types';
import { resolveSceneContract } from '@/lib/scene-contract';
import { meetsAssetVerificationLevel } from '@/lib/ai/visual-asset-policy';

const schema = z.object({
  frameId: z.string().min(1),
  photoId: z.number().int().positive(),
  slotIndex: z.number().int().min(0).max(3).optional(),
  targetPhotoId: z.number().int().positive().optional(),
});

const removeSchema = z.object({
  frameId: z.string().min(1),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 });
    const project = await prisma.project.findUnique({ where: { uuid: params.id } });
    if (!project?.outline || project.type !== 'html') return NextResponse.json({ error: 'HTML 项目不存在' }, { status: 404 });
    const outline = project.outline as unknown as Outline;
    const frameIndex = outline.frames.findIndex(frame => frame.id === parsed.data.frameId);
    if (frameIndex < 0) return NextResponse.json({ error: '分镜不存在' }, { status: 404 });
    const videoSource = normalizeVideoSourceForFrames(project.videoSource as unknown as VideoSource | null, outline.frames);
    const source = videoSource.frames[frameIndex];
    const contract = resolveSceneContract(project.type as ProjectType, outline.frames[frameIndex]);
    if (contract.mode === 'ui-scene') return NextResponse.json({ error: '结构化 UI 镜头不使用图片候选' }, { status: 409 });
    const selection = source.imageSelection;
    const candidate = selection?.candidates.find(item => item.photoId === parsed.data.photoId);
    const assets = source.realImages?.length ? source.realImages : source.realImage ? [source.realImage] : [];
    const targetIndex = parsed.data.slotIndex
      ?? candidate?.slotIndex
      ?? (parsed.data.targetPhotoId ? assets.findIndex(item => item.photoId === parsed.data.targetPhotoId) : 0);
    if (!candidate || targetIndex < 0) return NextResponse.json({ error: '候选素材已失效，请重新搜索图片' }, { status: 409 });
    if (contract.mode === 'html' && !source.htmlCode) return NextResponse.json({ error: 'HTML 画面已失效，请重新生成当前镜头' }, { status: 409 });
    if ((candidate.slotIndex ?? 0) !== targetIndex) return NextResponse.json({ error: '候选图片与画面素材槽位不匹配，请刷新后重试' }, { status: 409 });
    if (candidate.status && candidate.status !== 'accepted') return NextResponse.json({ error: '该图片未通过候选验收' }, { status: 409 });
    if (!candidate.localPath) return NextResponse.json({ error: '该候选尚未本地化，请重新搜索图片' }, { status: 409 });
    const frame = outline.frames[frameIndex];
    const slotCount = Math.max(
      assets.length,
      targetIndex + 1,
      ...((selection?.candidates || []).map(item => (item.slotIndex ?? 0) + 1)),
    );
    const now = new Date().toISOString();
    const nextAssets = await Promise.all(Array.from({ length: slotCount }, async (_, slotIndex) => {
      const previous = assets[slotIndex];
      const accepted = (selection?.candidates || []).filter(item => (
        (item.slotIndex ?? 0) === slotIndex && item.status !== 'rejected' && item.status !== 'download-failed' && item.localPath
      ));
      const selected = slotIndex === targetIndex
        ? candidate
        : accepted.find(item => item.photoId === previous?.photoId) || accepted[0];
      if (!selected?.localPath) {
        if (previous) return previous;
        throw new Error(`图片槽位 ${slotIndex + 1} 没有可用的本地候选`);
      }
      const localFileHash = await verifyLocalPexelsAsset(selected.localPath, selected.localFileHash);
      return candidateToAsset(selected, previous, frame, localFileHash, now, slotIndex === targetIndex);
    }));
    const previous = assets[targetIndex];
    const replacement = nextAssets[targetIndex];
    const htmlCode = contract.mode === 'html'
      ? sanitizeHtml(previous && source.htmlCode!.includes(previous.localPath) && assets.length === nextAssets.length
        ? replaceRealImageSlot(source.htmlCode!, targetIndex, previous.localPath, replacement)
        : applyRealImageGallery(source.htmlCode!, nextAssets), project.canvasPreset as ProjectDetail['canvasPreset'])
      : undefined;
    if (htmlCode) {
      validateGeneratedHtml(htmlCode);
      for (const asset of nextAssets) validateRealImageUsage(htmlCode, asset);
    }
    const selectedPhotoIds = nextAssets.map(asset => asset.photoId);
    const allSelectedConfirmed = nextAssets.every(asset => meetsAssetVerificationLevel(asset.verificationLevel, 'vision-confirmed'));
    const nextCandidates = selection?.candidates.map(item => (
      item.photoId === candidate.photoId && (item.slotIndex ?? 0) === targetIndex
        ? { ...item, verificationLevel: 'human-confirmed' as const }
        : item
    ));
    await commitFrameSourcePatch({
      projectId: project.uuid,
      frameId: parsed.data.frameId,
      fallbackFrames: outline.frames,
      expected: {
        ...(contract.mode === 'html' ? { htmlCode: source.htmlCode } : {}),
        imageSelectionUpdatedAt: selection?.updatedAt,
      },
      patch: {
        realImage: nextAssets[0],
        realImages: nextAssets,
        ...(contract.mode === 'html' ? { htmlCode } : { imagePath: replacement.localPath, imageAsset: undefined }),
        imageSelection: selection ? {
          ...selection,
          candidates: nextCandidates || selection.candidates,
          selectedPhotoId: selectedPhotoIds[0],
          selectedPhotoIds,
          status: allSelectedConfirmed ? 'completed' : 'needs-review',
          reason: allSelectedConfirmed
            ? '用户已确认当前所有素材，画面布局和动画保持不变'
            : '当前槽位已由用户确认，仍有其他素材槽位需要确认',
          verificationLevel: allSelectedConfirmed ? 'human-confirmed' : 'metadata-matched',
          requiresHumanReview: !allSelectedConfirmed,
          updatedAt: new Date().toISOString(),
        } : undefined,
      },
    });
    const updated = await prisma.project.findUnique({ where: { uuid: project.uuid } });
    if (!updated) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    return NextResponse.json({ project: toProjectDetail(updated) });
  } catch (error) {
    const status = error instanceof AgentCommitConflictError ? 409 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : '替换候选图片失败' }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsed = removeSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 });
    const project = await prisma.project.findUnique({ where: { uuid: params.id } });
    if (!project?.outline || project.type !== 'html') return NextResponse.json({ error: 'HTML 项目不存在' }, { status: 404 });
    const outline = project.outline as unknown as Outline;
    const frameIndex = outline.frames.findIndex(frame => frame.id === parsed.data.frameId);
    if (frameIndex < 0) return NextResponse.json({ error: '分镜不存在' }, { status: 404 });
    const videoSource = normalizeVideoSourceForFrames(project.videoSource as unknown as VideoSource | null, outline.frames);
    const source = videoSource.frames[frameIndex];
    const assets = source.realImages?.length ? source.realImages : source.realImage ? [source.realImage] : [];
    if (!assets.length) return NextResponse.json({ error: '当前分镜没有已应用的候选图片' }, { status: 409 });
    if (!source.htmlCode) return NextResponse.json({ error: 'HTML 画面已失效，请重新生成当前镜头' }, { status: 409 });

    const htmlCode = sanitizeHtml(
      removeRealImageAssets(source.htmlCode, assets),
      project.canvasPreset as ProjectDetail['canvasPreset'],
    );
    validateGeneratedHtml(htmlCode);
    const selection = source.imageSelection;
    const hasReusableCandidates = Boolean(selection?.candidates.some(candidate => candidate.localPath));
    await commitFrameSourcePatch({
      projectId: project.uuid,
      frameId: parsed.data.frameId,
      fallbackFrames: outline.frames,
      expected: {
        htmlCode: source.htmlCode,
        imageSelectionUpdatedAt: selection?.updatedAt,
      },
      patch: {
        htmlCode,
        realImage: undefined,
        realImages: undefined,
        imageSelection: selection ? {
          ...selection,
          selectedPhotoId: undefined,
          selectedPhotoIds: [],
          status: hasReusableCandidates ? 'candidate-ready' : 'planned',
          reason: hasReusableCandidates
            ? '已取消当前配图并恢复原生画面；候选图片仍保留，可随时重新应用'
            : '已取消当前配图并恢复原生画面',
          verificationLevel: undefined,
          requiresHumanReview: false,
          updatedAt: new Date().toISOString(),
        } : undefined,
      },
    });
    const updated = await prisma.project.findUnique({ where: { uuid: project.uuid } });
    if (!updated) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    return NextResponse.json({ project: toProjectDetail(updated) });
  } catch (error) {
    const status = error instanceof AgentCommitConflictError ? 409 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : '取消候选图片失败' }, { status });
  }
}

function candidateToAsset(
  candidate: SmartImageCandidate,
  previous: RealImageAsset | undefined,
  frame: FrameOutline,
  localFileHash: string,
  now: string,
  humanConfirmed: boolean,
): RealImageAsset {
  return {
    ...previous,
    provider: 'pexels',
    photoId: candidate.photoId,
    localPath: candidate.localPath!,
    localFileHash,
    query: candidate.query,
    alt: candidate.alt || candidate.subject || frame.title,
    width: candidate.width,
    height: candidate.height,
    avgColor: candidate.avgColor,
    photographer: candidate.photographer,
    photographerUrl: candidate.photographerUrl,
    pexelsUrl: candidate.pexelsUrl,
    fitMode: candidate.fitMode,
    position: 'center',
    layout: candidate.layout,
    scaleFrom: previous?.scaleFrom ?? 1.02,
    scaleTo: previous?.scaleTo ?? 1.06,
    downloadedAt: previous?.downloadedAt || now,
    acceptedAt: humanConfirmed ? now : previous?.acceptedAt,
    purpose: previous?.purpose || frame.sceneSpec?.imagePurpose || candidate.subject || frame.title,
    imageMotion: previous?.imageMotion || 'slow-push-in',
    visualGroup: previous?.visualGroup || frame.sceneSpec?.relationship || 'general',
    license: previous?.license || 'Pexels License',
    verificationLevel: humanConfirmed ? 'human-confirmed' : candidate.verificationLevel || previous?.verificationLevel || 'metadata-matched',
    crop: { fitMode: candidate.fitMode, position: 'center' },
    motion: previous?.motion || { kind: 'slow-push-in', scaleFrom: 1.02, scaleTo: 1.06 },
  };
}

function toProjectDetail(project: NonNullable<Awaited<ReturnType<typeof prisma.project.findUnique>>>): ProjectDetail {
  return { uuid: project.uuid, title: project.title, type: project.type as ProjectType, canvasPreset: project.canvasPreset as ProjectDetail['canvasPreset'], styleId: project.styleId, outline: project.outline as unknown as Outline, videoSource: project.videoSource as unknown as VideoSource, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString(), hasOutline: Boolean(project.outline) };
}
