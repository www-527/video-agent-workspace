import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { normalizeVideoSourceForFrames } from '@/lib/video-source';
import { abortRepairJob, getRepairJob } from '@/lib/quality/repair-jobs';
import { commitRepairJobState } from '@/lib/quality/repair-job-store';
import type { Outline, VideoSource } from '@/types';

interface RouteContext {
  params: { id: string; jobId: string };
}

const schema = z.object({ frameId: z.string().min(1).max(160) });

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: '停止修复参数错误' }, { status: 400 });

    const project = await prisma.project.findUnique({ where: { uuid: params.id } });
    if (!project?.outline || project.type !== 'html') return NextResponse.json({ error: '项目不存在或不支持修复' }, { status: 404 });

    const outline = project.outline as unknown as Outline;
    if (!outline.frames.some(frame => frame.id === parsed.data.frameId)) return NextResponse.json({ error: '当前分镜不存在' }, { status: 404 });
    const source = normalizeVideoSourceForFrames(project.videoSource as unknown as VideoSource | null, outline.frames);
    const existingJob = getRepairJob(source, params.jobId);
    if (existingJob && existingJob.frameId !== parsed.data.frameId) {
      return NextResponse.json({ error: '修复任务与分镜不匹配' }, { status: 409 });
    }

    await commitRepairJobState({
      projectId: params.id,
      frameId: parsed.data.frameId,
      jobId: params.jobId,
      status: 'cancelled',
    });
    abortRepairJob(params.jobId);
    return NextResponse.json({ jobId: params.jobId, status: 'cancelled' });
  } catch (error) {
    console.error('[POST /api/projects/[id]/frame-quality/repair/[jobId]/cancel]', error);
    return NextResponse.json({ error: (error as Error).message || '停止修复失败' }, { status: 500 });
  }
}
