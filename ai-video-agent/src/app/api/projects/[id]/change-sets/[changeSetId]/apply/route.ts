import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { applyProjectChangeSet, ChangeSetError } from '@/lib/changesets/service';

interface RouteContext {
  params: { id: string; changeSetId: string };
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  try {
    const result = await applyProjectChangeSet(params.id, params.changeSetId);
    const [userMessage, assistantMessage] = await prisma.$transaction([
      prisma.message.create({
        data: { projectId: params.id, role: 'user', content: '确认并应用修改方案', metadata: { kind: 'text' } },
      }),
      prisma.message.create({
        data: {
          projectId: params.id,
          role: 'assistant',
          content: '修改已安全应用，应用前状态已保存。需要时可以撤销这次修改。',
          metadata: {
            kind: 'checkpoint',
            checkpointId: result.changeSet.checkpointId,
            canRevert: true,
            actions: [{
              id: 'change_set_revert',
              label: '撤销这次修改',
              changeSetId: result.changeSet.id,
              checkpointId: result.changeSet.checkpointId,
              variant: 'outline',
            }],
          } as any,
        },
      }),
    ]);
    return NextResponse.json({
      ...result,
      messages: [userMessage, assistantMessage].map(message => ({ ...message, createdAt: message.createdAt.toISOString() })),
    });
  } catch (error) {
    if (error instanceof ChangeSetError) {
      return NextResponse.json({ error: error.message, code: error.code, requiresConfirmation: error.requiresConfirmation }, { status: error.status });
    }
    console.error('[apply change set]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '应用修改方案失败，项目检查点已保留' }, { status: 500 });
  }
}
