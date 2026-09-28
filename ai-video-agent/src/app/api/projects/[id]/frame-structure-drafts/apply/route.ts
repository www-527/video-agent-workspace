import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { applyFrameStructureDraft, isDraftStale } from '@/lib/ai/frame-drafts';
import type { FrameStructureDraft, Outline, ProjectDetail, ProjectType, VideoSource } from '@/types';

interface RouteContext {
  params: { id: string };
}

const itemSchema = z.object({
  title: z.string().trim().min(1).max(120),
  narration: z.string().trim().max(2000),
  visualPrompt: z.string().trim().max(8000).optional(),
  imagePrompt: z.string().trim().max(8000).optional(),
  htmlPrompt: z.string().trim().max(8000).optional(),
  sceneSpec: z.any().optional(),
});

const draftSchema = z.object({
  operation: z.enum(['split', 'merge']),
  targetFrameIds: z.array(z.string().min(1)).min(1).max(20),
  frames: z.array(itemSchema).min(1).max(4),
  baseUpdatedAt: z.string().min(1),
});

const schema = z.object({
  draft: draftSchema,
  approveForGeneration: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 });

    const project = await prisma.project.findUnique({ where: { uuid: params.id } });
    if (!project?.outline) return NextResponse.json({ error: '项目或大纲不存在' }, { status: 404 });
    if (isDraftStale(parsed.data.draft.baseUpdatedAt, project.updatedAt)) {
      return NextResponse.json({ error: '项目已发生变化，请重新生成拆分/合并草稿' }, { status: 409 });
    }

    const result = applyFrameStructureDraft({
      type: project.type as ProjectType,
      outline: project.outline as unknown as Outline,
      videoSource: (project.videoSource as unknown as VideoSource | null) ?? { frames: [] },
      draft: parsed.data.draft as FrameStructureDraft,
      approveForGeneration: parsed.data.approveForGeneration,
    });

    const updated = await prisma.project.updateMany({
      where: { uuid: params.id, updatedAt: project.updatedAt },
      data: { outline: result.outline as any, videoSource: result.videoSource as any },
    });
    if (updated.count !== 1) {
      return NextResponse.json({ error: '项目已发生变化，请重新生成拆分/合并草稿' }, { status: 409 });
    }
    const updatedProject = await prisma.project.findUnique({ where: { uuid: params.id } });
    if (!updatedProject) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    const detail: ProjectDetail = {
      uuid: updatedProject.uuid,
      title: updatedProject.title,
      type: updatedProject.type as ProjectType,
      canvasPreset: updatedProject.canvasPreset as ProjectDetail['canvasPreset'],
      styleId: updatedProject.styleId,
      outline: updatedProject.outline as unknown as Outline,
      videoSource: updatedProject.videoSource as unknown as VideoSource,
      createdAt: updatedProject.createdAt.toISOString(),
      updatedAt: updatedProject.updatedAt.toISOString(),
      hasOutline: Boolean(updatedProject.outline),
    };
    return NextResponse.json({ project: detail, frameIds: result.frameIds });
  } catch (error) {
    console.error('[POST /api/projects/[id]/frame-structure-drafts/apply]', error);
    return NextResponse.json({ error: (error as Error).message || '应用分镜结构草稿失败' }, { status: 500 });
  }
}
