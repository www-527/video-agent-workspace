import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';

interface RouteContext {
  params: { id: string };
}

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(20_000),
  metadata: z.any().optional(),
});

const schema = z.object({
  messages: z.array(messageSchema).min(1).max(10),
});

/**
 * POST /api/projects/[id]/messages
 * Append persisted chat messages for local UI actions that do not need AI routing.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { uuid: params.id },
      select: { uuid: true },
    });
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

    const created = [];
    for (const message of parsed.data.messages) {
      created.push(
        await prisma.message.create({
          data: {
            projectId: project.uuid,
            role: message.role,
            content: message.content,
            metadata: message.metadata ?? { kind: 'text' },
          },
        }),
      );
    }

    return NextResponse.json({
      messages: created.map(message => ({
        id: message.id,
        projectId: message.projectId,
        role: message.role,
        content: message.content,
        metadata: message.metadata,
        createdAt: message.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[POST /api/projects/[id]/messages]', err);
    return NextResponse.json({ error: '写入消息失败' }, { status: 500 });
  }
}
