import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isAIDialogFeatureEnabled } from '@/lib/feature-flags';
import { DEFAULT_CANVAS_PRESET } from '@/lib/canvas-presets';
import { PROJECT_WORKFLOW } from '@/lib/project-workflow';

const createSchema = z.object({
  type: z.literal('html').optional(),
  workflow: z.literal(PROJECT_WORKFLOW).optional(),
  canvasPreset: z.enum(['landscape-16-9', 'douyin-portrait-9-16']).optional(),
  contentStyle: z.object({
    mode: z.enum(['inherit', 'override']),
    presetId: z.string().min(1).optional(),
    customInstruction: z.string().max(20_000).optional(),
  }).optional(),
  gptOptimization: z.object({
    mode: z.enum(['inherit', 'override']),
    confirmFirstFrame: z.boolean().optional(),
  }).optional(),
});

/**
 * POST /api/projects
 * 创建项目
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '项目类型必须是 html 或 image。' }, { status: 400 });
    }
    const workflow = PROJECT_WORKFLOW;
    const type = 'html';
    const canvasPreset = parsed.data.canvasPreset || DEFAULT_CANVAS_PRESET;
    const title = 'GPT 自由创作项目';

    const project = await prisma.project.create({
      data: {
        title,
        type,
        canvasPreset,
        contentStyle: parsed.data.contentStyle as any,
        gptOptimization: parsed.data.gptOptimization as any,
        workflow,
        briefStatus: isAIDialogFeatureEnabled('NOVICE_AGENT_V2') && isAIDialogFeatureEnabled('PROJECT_BRIEF_V1')
          ? 'collecting'
          : 'empty',
        outline: undefined,
        videoSource: undefined,
      },
    });

    return NextResponse.json({
      uuid: project.uuid,
      title: project.title,
      type: project.type,
      canvasPreset: project.canvasPreset,
      contentStyle: project.contentStyle,
      gptOptimization: project.gptOptimization,
      workflow: project.workflow,
      briefStatus: project.briefStatus,
    });
  } catch (err) {
    console.error('[POST /api/projects]', err);
    return NextResponse.json({ error: '创建项目失败' }, { status: 500 });
  }
}

/**
 * GET /api/projects
 * 获取项目列表（按创建时间倒序）
 */
export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      where: { workflow: PROJECT_WORKFLOW },
      orderBy: { createdAt: 'desc' },
      select: {
        uuid: true,
        title: true,
        type: true,
        canvasPreset: true,
        createdAt: true,
        updatedAt: true,
        outline: true,
        workflow: true,
      },
    });
    const list = projects.map(p => ({
      uuid: p.uuid,
      title: p.title,
      type: p.type,
      canvasPreset: p.canvasPreset,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      hasOutline: Boolean(p.outline),
      workflow: PROJECT_WORKFLOW,
    }));
    return NextResponse.json(list);
  } catch (err) {
    console.error('[GET /api/projects]', err);
    return NextResponse.json({ error: '获取项目列表失败' }, { status: 500 });
  }
}
