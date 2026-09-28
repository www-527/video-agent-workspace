import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { applyFrameDraft, isDraftStale } from '@/lib/ai/frame-drafts';
import type { FrameReviewDraft, Outline, ProjectDetail, ProjectType, VideoSource } from '@/types';

interface RouteContext {
  params: { id: string };
}

const draftSchema = z.object({
  operation: z.enum(['add', 'modify', 'delete']),
  targetFrameId: z.string().optional(),
  insertAfterIndex: z.number().int().min(0).optional(),
  freshStart: z.boolean().optional(),
  title: z.string().trim().min(1).max(120),
  narration: z.string().trim().max(2000),
  visualPrompt: z.string().trim().max(8000).optional(),
  imagePrompt: z.string().trim().max(8000).optional(),
  htmlPrompt: z.string().trim().max(8000).optional(),
  sceneSpec: z.any().optional(),
  baseUpdatedAt: z.string().min(1),
});

const schema = z.object({
  draft: draftSchema,
  approveForGeneration: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    const project = await prisma.project.findUnique({ where: { uuid: params.id } });
    if (!project?.outline) {
      return NextResponse.json({ error: '项目或大纲不存在' }, { status: 404 });
    }
    if (isDraftStale(parsed.data.draft.baseUpdatedAt, project.updatedAt)) {
      return NextResponse.json({ error: '项目已发生变化，请重新生成分镜草稿' }, { status: 409 });
    }

    const outline = project.outline as unknown as Outline;
    const videoSource = (project.videoSource as unknown as VideoSource | null) ?? { frames: [] };
    const result = applyFrameDraft({
      type: project.type as ProjectType,
      outline,
      videoSource,
      draft: parsed.data.draft as FrameReviewDraft,
      approveForGeneration: parsed.data.approveForGeneration,
    });

    const updatedProject = await prisma.project.update({
      where: { uuid: params.id },
      data: {
        outline: result.outline as any,
        videoSource: result.videoSource as any,
      },
    });

    return NextResponse.json({
      project: toProjectDetail(updatedProject),
      frameId: result.frameId,
    });
  } catch (error) {
    console.error('[POST /api/projects/[id]/frame-drafts/apply]', error);
    return NextResponse.json({ error: (error as Error).message || '应用分镜草稿失败' }, { status: 500 });
  }
}

function toProjectDetail(project: Awaited<ReturnType<typeof prisma.project.update>>): ProjectDetail {
  return {
    uuid: project.uuid,
    title: project.title,
    type: project.type as ProjectType,
    canvasPreset: project.canvasPreset as ProjectDetail['canvasPreset'],
    styleId: project.styleId,
    workflow: project.workflow as ProjectDetail['workflow'],
    contentStyle: project.contentStyle as ProjectDetail['contentStyle'],
    gptOptimization: project.gptOptimization as ProjectDetail['gptOptimization'],
    outline: (project.outline as unknown as Outline) ?? null,
    videoSource: (project.videoSource as unknown as VideoSource) ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    hasOutline: Boolean(project.outline),
  };
}
