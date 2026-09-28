import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { approveFrames, approvePlan } from '@/lib/collaboration';
import type { Outline } from '@/types';

const schema = z.object({
  projectId: z.string().uuid(),
  action: z.enum(['approve-plan', 'approve-frame']),
  frameId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 });

  const project = await prisma.project.findUnique({ where: { uuid: parsed.data.projectId } });
  if (!project?.outline) return NextResponse.json({ error: '项目或大纲不存在' }, { status: 404 });

  const outline = project.outline as unknown as Outline;
  let nextOutline = outline;

  if (parsed.data.action === 'approve-plan') {
    nextOutline = approvePlan(outline);
  } else {
    const frameId = parsed.data.frameId;
    const frameIndex = outline.frames.findIndex(frame => frame.id === frameId);
    if (frameIndex < 0) return NextResponse.json({ error: '分镜不存在' }, { status: 400 });
    nextOutline = approveFrames(outline, [frameId!]);
  }

  await prisma.project.update({ where: { uuid: project.uuid }, data: { outline: nextOutline as any } });
  return NextResponse.json({ outline: nextOutline });
}
