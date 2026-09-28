import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { createVisualAnchor } from '@/lib/ai/visual-anchor';
import { getDefaultStyle, getStyleById } from '@/lib/styles/presets';
import type { Outline } from '@/types';
import { approveFrames, getCollaborationState } from '@/lib/collaboration';

const schema = z.object({ projectId: z.string().uuid(), frameIds: z.array(z.string()).length(1) });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 });
  const project = await prisma.project.findUnique({ where: { uuid: parsed.data.projectId } });
  if (!project?.outline) return NextResponse.json({ error: '项目或大纲不存在' }, { status: 404 });
  const outline = project.outline as unknown as Outline;
  if (!getCollaborationState(outline).planApproved) {
    return NextResponse.json({ error: '请先确认内容计划' }, { status: 409 });
  }
  const validFrameIds = parsed.data.frameIds.filter(id => outline.frames.some(frame => frame.id === id));
  if (!validFrameIds.length) return NextResponse.json({ error: '样片分镜不存在' }, { status: 400 });
  const style = getStyleById(project.styleId) || getDefaultStyle();
  const visualAnchor = createVisualAnchor(style, validFrameIds);
  const nextOutline = approveFrames({ ...outline, visualAnchor }, validFrameIds);
  await prisma.project.update({ where: { uuid: project.uuid }, data: { outline: nextOutline as any } });
  return NextResponse.json({ visualAnchor, outline: nextOutline });
}
