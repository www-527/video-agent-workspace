import { NextRequest, NextResponse } from 'next/server';
import { withAIKeyRoute } from '@/lib/ai-key-route';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { generateOutline } from '@/lib/ai/outline';
import type { CanvasPresetId } from '@/types';
import type { ProjectContentStyleConfig } from '@/lib/content-style/types';
import { applyProjectAIContext, applyProjectGPTOptimizationOverride } from '@/lib/ai-key-context';
import { runWithAITraceProjectContext } from '@/lib/ai/trace';

const schema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1).max(200_000),
});

/**
 * POST /api/outline
 * 单独暴露大纲生成（便于直接调用、调试）。
 */
async function handlePost(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 });
    const { projectId, prompt } = parsed.data;

    const project = await prisma.project.findUnique({ where: { uuid: projectId } });
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    await applyProjectAIContext(project.workflow);
    applyProjectGPTOptimizationOverride(project.gptOptimization as any);

    const outline = await runWithAITraceProjectContext(projectId, () => generateOutline(project.type as 'image' | 'html', prompt, {
      projectId,
      canvasPreset: project.canvasPreset as CanvasPresetId,
      contentStyle: project.contentStyle as unknown as ProjectContentStyleConfig | null,
      abortSignal: req.signal,
      workflow: project.workflow as 'gpt-free',
    }));
    const updated = await prisma.project.update({
      where: { uuid: projectId },
      data: {
        outline: outline as any,
        videoSource: { frames: outline.frames.map(f => ({ id: f.id })) } as any,
        title: outline.title,
      },
    });

    return NextResponse.json({ outline, uuid: updated.uuid });
  } catch (err) {
    console.error('[POST /api/outline]', err);
    return NextResponse.json({ error: '大纲生成失败' }, { status: 500 });
  }
}

export const POST = withAIKeyRoute(handlePost);
