import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ChangeSetError, proposeChangeSetFromDiagnosis } from '@/lib/changesets/service';
import { isAIDialogFeatureEnabled } from '@/lib/feature-flags';
import type { DirectorDiagnosis } from '@/types';

interface RouteContext {
  params: { id: string };
}

const schema = z.object({
  sourceMessageId: z.string().uuid(),
  intensity: z.enum(['light', 'recommended', 'redesign']),
}).strict();

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isAIDialogFeatureEnabled('PROJECT_CHANGESET_V1')) {
    return NextResponse.json({ error: '安全修改功能未启用' }, { status: 404 });
  }
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: '修改方案参数错误' }, { status: 400 });
    const source = await prisma.message.findFirst({
      where: { id: parsed.data.sourceMessageId, projectId: params.id, role: 'assistant' },
    });
    const metadata = source?.metadata as unknown as { kind?: string; diagnosis?: DirectorDiagnosis } | null;
    if (metadata?.kind !== 'director_diagnosis' || metadata.diagnosis?.version !== 'director-diagnosis-v1') {
      return NextResponse.json({ error: '导演诊断不存在或已经失效' }, { status: 409 });
    }
    const changeSet = await proposeChangeSetFromDiagnosis({
      projectId: params.id,
      diagnosis: metadata.diagnosis,
      intensity: parsed.data.intensity,
    });
    const [userMessage, assistantMessage] = await prisma.$transaction([
      prisma.message.create({
        data: { projectId: params.id, role: 'user', content: intensityLabel(parsed.data.intensity), metadata: { kind: 'text' } },
      }),
      prisma.message.create({
        data: {
          projectId: params.id,
          role: 'assistant',
          content: '修改方案已准备好。确认后才会创建检查点并应用。',
          metadata: {
            kind: 'change_set',
            changeSet,
            actions: [{ id: 'change_set_apply', label: '确认并应用', changeSetId: changeSet.id, variant: 'default' }],
          } as any,
        },
      }),
    ]);
    return NextResponse.json({
      changeSet,
      messages: [userMessage, assistantMessage].map(message => ({ ...message, createdAt: message.createdAt.toISOString() })),
    });
  } catch (error) {
    return changeSetErrorResponse(error, '生成修改方案失败');
  }
}

function intensityLabel(intensity: 'light' | 'recommended' | 'redesign') {
  if (intensity === 'light') return '按轻微调整方案修改';
  if (intensity === 'redesign') return '按重新设计方案修改';
  return '按推荐方案修改';
}

function changeSetErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ChangeSetError) {
    return NextResponse.json({ error: error.message, code: error.code, requiresConfirmation: error.requiresConfirmation }, { status: error.status });
  }
  console.error('[change set]', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
