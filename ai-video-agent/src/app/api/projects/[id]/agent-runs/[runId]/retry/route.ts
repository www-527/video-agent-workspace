import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AgentRunConflictError } from '@/lib/agents/persistence';
import { AgentRunRequestError, redispatchAgentRun } from '@/lib/agents/chat-run';
import { withAIKeyRoute } from '@/lib/ai-key-route';

interface RouteContext {
  params: { id: string; runId: string };
}

const schema = z.object({ clientRequestId: z.string().min(8).max(200).optional() }).strict();

async function handlePost(request: NextRequest, { params }: RouteContext) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: '重试参数错误' }, { status: 400 });
  try {
    const run = await redispatchAgentRun({
      projectId: params.id,
      runId: params.runId,
      mode: 'retry',
      clientRequestId: parsed.data.clientRequestId,
      origin: request.url,
    });
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    if (error instanceof AgentRunConflictError) {
      return NextResponse.json({ error: error.message, code: error.code, activeRunId: error.activeRunId }, { status: error.status });
    }
    if (error instanceof AgentRunRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: '重试任务失败' }, { status: 500 });
  }
}

export const POST = withAIKeyRoute(handlePost);
