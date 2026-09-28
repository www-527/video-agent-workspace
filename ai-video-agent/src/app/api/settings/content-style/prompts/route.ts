import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { contentStyleErrorResponse } from '@/lib/content-style/api';
import {
  compileAgentSystemPrompt,
  formatContentStyleUserContext,
  hashContent,
  resolveContentStyle,
  resolvePlannerPromptForPreset,
} from '@/lib/content-style/compiler';
import { buildPlannerFixedContract, QUALITY_FIXED_CONTRACT } from '@/lib/content-style/contracts';
import {
  DEFAULT_PLANNER_CORE_PROMPT,
  DEFAULT_QUALITY_CORE_PROMPT,
  PLANNER_DEFAULT_VERSION,
  QUALITY_DEFAULT_VERSION,
} from '@/lib/content-style/defaults';
import { mergeContentStylePresets } from '@/lib/content-style/presets';
import { contentStyleStore } from '@/lib/content-style/store';
import type { ProjectContentStyleConfig } from '@/lib/content-style/types';
import type { CanvasPresetId, ProjectType } from '@/types';

export const dynamic = 'force-dynamic';

const saveSchema = z.object({
  agent: z.enum(['planner', 'quality']),
  presetId: z.string().optional(),
  content: z.string(),
  expectedRevision: z.number().int().min(0),
  confirmWarnings: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get('projectId');
    const project = projectId ? await prisma.project.findUnique({ where: { uuid: projectId } }) : null;
    if (projectId && !project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    const [resolved, settings] = await Promise.all([
      resolveContentStyle(project?.contentStyle as unknown as ProjectContentStyleConfig | null),
      contentStyleStore.getSettings(),
    ]);
    const plannerPresets = Object.fromEntries(mergeContentStylePresets(settings.customPresets).map(preset => {
      const prompt = resolvePlannerPromptForPreset(settings, preset);
      return [preset.id, {
        defaultContent: prompt.defaultContent,
        effectiveContent: prompt.content,
        versionId: prompt.versionId,
        source: prompt.source,
        updatedAt: prompt.updatedAt,
      }];
    }));
    const selectedPlannerPrompt = plannerPresets[resolved.preset.id];
    const type = (project?.type || 'html') as ProjectType;
    const planner = compileAgentSystemPrompt({
      agent: 'planner',
      fixedContract: buildPlannerFixedContract(type, project?.canvasPreset as CanvasPresetId | undefined),
      resolved,
    });
    const quality = compileAgentSystemPrompt({ agent: 'quality', fixedContract: QUALITY_FIXED_CONTRACT, resolved });
    return NextResponse.json({
      defaults: {
        planner: { content: DEFAULT_PLANNER_CORE_PROMPT, versionId: PLANNER_DEFAULT_VERSION },
        quality: { content: DEFAULT_QUALITY_CORE_PROMPT, versionId: QUALITY_DEFAULT_VERSION },
      },
      effective: {
        plannerCore: resolved.plannerCorePrompt,
        qualityCore: resolved.qualityCorePrompt,
        plannerPromptVersionId: resolved.plannerPromptVersionId,
        qualityPromptVersionId: resolved.qualityPromptVersionId,
        plannerSource: selectedPlannerPrompt.source,
        qualitySource: resolved.qualityPromptVersionId === QUALITY_DEFAULT_VERSION ? 'official' : 'custom',
      },
      plannerPresets,
      preset: resolved.preset,
      instructionContext: formatContentStyleUserContext(resolved),
      compiled: { planner, quality },
      promptHashes: {
        planner: hashContent(planner.system),
        quality: hashContent(quality.system),
      },
    });
  } catch (error) {
    return contentStyleErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const input = saveSchema.parse(await request.json());
    return NextResponse.json(await contentStyleStore.savePrompt(input));
  } catch (error) {
    return contentStyleErrorResponse(error);
  }
}
