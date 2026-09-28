import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { runWithActiveAIKey } from '@/lib/ai-key-context';
import { AIKeyStoreError } from '@/lib/ai-key-store';
import { generateOutline } from '@/lib/ai/outline';
import { contentStyleErrorResponse } from '@/lib/content-style/api';
import { compileAgentSystemPrompt, formatContentStyleUserContext, resolveContentStyle } from '@/lib/content-style/compiler';
import { buildPlannerFixedContract, QUALITY_FIXED_CONTRACT } from '@/lib/content-style/contracts';
import type { ProjectContentStyleConfig } from '@/lib/content-style/types';
import type { CanvasPresetId, ProjectType } from '@/types';

const schema = z.object({
  topic: z.string().trim().min(1).max(20_000),
  projectId: z.string().uuid().optional(),
  projectInstruction: z.string().max(20_000).optional(),
  compileOnly: z.boolean().default(true),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const project = input.projectId
      ? await prisma.project.findUnique({ where: { uuid: input.projectId } })
      : null;
    if (input.projectId && !project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    const storedConfig = project?.contentStyle as unknown as ProjectContentStyleConfig | null;
    const contentStyle: ProjectContentStyleConfig | null = input.projectInstruction
      ? {
        mode: 'override',
        presetId: storedConfig?.mode === 'override' ? storedConfig.presetId : undefined,
        customInstruction: input.projectInstruction,
      }
      : storedConfig;
    const resolved = await resolveContentStyle(contentStyle);
    const type = (project?.type || 'html') as ProjectType;
    const canvasPreset = project?.canvasPreset as CanvasPresetId | undefined;
    const planner = compileAgentSystemPrompt({
      agent: 'planner',
      fixedContract: buildPlannerFixedContract(type, canvasPreset),
      resolved,
    });
    const quality = compileAgentSystemPrompt({ agent: 'quality', fixedContract: QUALITY_FIXED_CONTRACT, resolved });
    const prompt = {
      planner,
      quality,
      instructionContext: formatContentStyleUserContext(resolved),
      runtimeUserInput: input.topic,
    };
    if (input.compileOnly) return NextResponse.json({ compileOnly: true, prompt });

    try {
      const outline = await runWithActiveAIKey(() => generateOutline(type, input.topic, {
        canvasPreset,
        contentStyle,
        abortSignal: request.signal,
      }));
      return NextResponse.json({ compileOnly: false, prompt, outline });
    } catch (error) {
      if (error instanceof AIKeyStoreError && error.code === 'NOT_FOUND') {
        return NextResponse.json({ error: '请先在 Key 管理中添加并选择 API Key', code: 'AI_KEY_NOT_CONFIGURED' }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    return contentStyleErrorResponse(error);
  }
}

