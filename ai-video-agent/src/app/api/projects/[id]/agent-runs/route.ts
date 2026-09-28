import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AgentRunConflictError } from '@/lib/agents/persistence';
import { AgentRunRequestError, dispatchPersistentChatRun } from '@/lib/agents/chat-run';
import { getAgentRunView } from '@/lib/agents/chat-run';
import { withAIKeyRoute } from '@/lib/ai-key-route';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@/lib/assets/constants';
import { ContextValidationError } from '@/lib/context/chat-context';
import { isAIDialogFeatureEnabled } from '@/lib/feature-flags';

interface RouteContext {
  params: { id: string };
}

const schema = z.object({
  clientRequestId: z.string().min(8).max(200),
  content: z.string().trim().min(1).max(200_000),
  attachmentIds: z.array(z.string().uuid()).max(MAX_ATTACHMENTS_PER_MESSAGE).default([]),
  context: z.object({
    scopeHint: z.enum(['auto', 'project', 'frame', 'element']).optional(),
    selectedFrameId: z.string().optional(),
    selectedElementIds: z.array(z.string()).max(20).optional(),
    playbackTimeMs: z.number().finite().nonnegative().optional(),
    playbackRevision: z.number().int().nonnegative().optional(),
  }).default({}),
  sourceMessageId: z.string().uuid().optional(),
  rewriteDraft: z.unknown().optional(),
}).strict();

async function handlePost(request: NextRequest, { params }: RouteContext) {
  if (!isAIDialogFeatureEnabled('PERSISTENT_CHAT_RUNS_V1')) {
    return NextResponse.json({ error: '持久任务功能未启用' }, { status: 404 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '任务参数错误' }, { status: 400 });
  try {
    const run = await dispatchPersistentChatRun({
      request: { projectId: params.id, ...parsed.data },
      origin: request.url,
    });
    return NextResponse.json({ run }, { status: run.status === 'completed' ? 200 : 202 });
  } catch (error) {
    return agentRunErrorResponse(error);
  }
}

export const POST = withAIKeyRoute(handlePost);

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const latest = await prisma.agentRun.findFirst({
      where: { projectId: params.id },
      orderBy: { requestedAt: 'desc' },
      select: { id: true, status: true },
    });
    if (!latest || latest.status === 'completed') return NextResponse.json({ run: null });
    return NextResponse.json({ run: await getAgentRunView(params.id, latest.id) });
  } catch (error) {
    return agentRunErrorResponse(error);
  }
}

function agentRunErrorResponse(error: unknown) {
  if (error instanceof AgentRunConflictError) {
    return NextResponse.json({ error: error.message, code: error.code, activeRunId: error.activeRunId }, { status: error.status });
  }
  if (error instanceof AgentRunRequestError || error instanceof ContextValidationError) {
    return NextResponse.json({ error: error.message, code: 'code' in error ? error.code : 'context_invalid' }, { status: error.status });
  }
  console.error('[agent runs create]', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: '创建任务失败' }, { status: 500 });
}
