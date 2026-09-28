import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isSupportedProjectWorkflow, RETIRED_WORKFLOW_MESSAGE } from '@/lib/project-workflow';
import { removeProjectPrivateStorage } from '@/lib/projects/storage-paths';

interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/projects/[id]
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const project = await prisma.project.findUnique({
      where: { uuid: params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (project && !isSupportedProjectWorkflow(project.workflow)) {
      return NextResponse.json({ error: RETIRED_WORKFLOW_MESSAGE }, { status: 410 });
    }
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    return NextResponse.json({
      uuid: project.uuid,
      title: project.title,
      type: project.type,
      canvasPreset: project.canvasPreset,
      styleId: project.styleId,
      contentStyle: project.contentStyle,
      gptOptimization: project.gptOptimization,
      workflow: project.workflow,
      outline: project.outline,
      videoSource: project.videoSource,
      projectBrief: project.projectBrief,
      briefStatus: project.briefStatus,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      messages: project.messages.map(m => ({
        id: m.id,
        projectId: project.uuid,
        role: m.role,
        content: m.content,
        metadata: m.metadata,
        createdAt: m.createdAt.toISOString(),
      })),
      hasOutline: Boolean(project.outline),
    });
  } catch (err) {
    console.error('[GET /api/projects/[id]]', err);
    return NextResponse.json({ error: '获取项目失败' }, { status: 500 });
  }
}

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  outline: z.any().optional(),
  videoSource: z.any().optional(),
  styleId: z.string().nullable().optional(),
  contentStyle: z.object({
    mode: z.enum(['inherit', 'override']),
    presetId: z.string().min(1).optional(),
    customInstruction: z.string().max(20_000).optional(),
  }).nullable().optional(),
  gptOptimization: z.object({
    mode: z.enum(['inherit', 'override']),
    reasoningProfile: z.enum(['auto', 'fast', 'balanced', 'quality']).optional(),
    creativeFreedom: z.enum(['conservative', 'balanced', 'open']).optional(),
    internalImageSearch: z.boolean().optional(),
    confirmFirstFrame: z.boolean().optional(),
  }).nullable().optional(),
});

/**
 * PATCH /api/projects/[id]
 * 部分更新项目
 */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && 'canvasPreset' in body) {
      return NextResponse.json({ error: '项目画幅在创建后不可切换' }, { status: 409 });
    }
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }
    const existing = await prisma.project.findUnique({ where: { uuid: params.id }, select: { workflow: true } });
    if (existing && !isSupportedProjectWorkflow(existing.workflow)) {
      return NextResponse.json({ error: RETIRED_WORKFLOW_MESSAGE }, { status: 410 });
    }
    const { contentStyle, gptOptimization, ...projectFields } = parsed.data;
    const project = await prisma.project.update({
      where: { uuid: params.id },
      data: {
        ...projectFields,
        ...(contentStyle !== undefined ? { contentStyle: contentStyle as any } : {}),
        ...(gptOptimization !== undefined ? { gptOptimization: gptOptimization as any } : {}),
      },
    });
    return NextResponse.json({ uuid: project.uuid });
  } catch (err) {
    console.error('[PATCH /api/projects/[id]]', err);
    return NextResponse.json({ error: '更新项目失败' }, { status: 500 });
  }
}

/**
 * DELETE /api/projects/[id]
 */
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    await prisma.project.delete({ where: { uuid: params.id } });
    await removeProjectPrivateStorage(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/projects/[id]]', err);
    return NextResponse.json({ error: '删除项目失败' }, { status: 500 });
  }
}
