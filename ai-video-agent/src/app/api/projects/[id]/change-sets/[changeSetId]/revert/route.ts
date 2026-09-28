import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ChangeSetError, revertProjectChangeSet } from '@/lib/changesets/service';

interface RouteContext {
  params: { id: string; changeSetId: string };
}

const schema = z.object({ force: z.boolean().optional() }).strict();

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: '撤销参数错误' }, { status: 400 });
    const result = await revertProjectChangeSet({
      projectId: params.id,
      changeSetId: params.changeSetId,
      force: parsed.data.force,
    });
    const [userMessage, assistantMessage] = await prisma.$transaction([
      prisma.message.create({ data: { projectId: params.id, role: 'user', content: '撤销这次修改', metadata: { kind: 'text' } } }),
      prisma.message.create({ data: { projectId: params.id, role: 'assistant', content: '已恢复到应用这次 AI 修改之前的状态。', metadata: { kind: 'text' } } }),
    ]);
    return NextResponse.json({
      ...result,
      messages: [userMessage, assistantMessage].map(message => ({ ...message, createdAt: message.createdAt.toISOString() })),
    });
  } catch (error) {
    if (error instanceof ChangeSetError) {
      return NextResponse.json({ error: error.message, code: error.code, requiresConfirmation: error.requiresConfirmation }, { status: error.status });
    }
    return NextResponse.json({ error: '撤销修改失败，当前项目没有被覆盖' }, { status: 500 });
  }
}
