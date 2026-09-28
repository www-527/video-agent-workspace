import { NextRequest, NextResponse } from 'next/server';
import { AgentRunRequestError, requestAgentRunCancellation } from '@/lib/agents/chat-run';

interface RouteContext {
  params: { id: string; runId: string };
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  try {
    return NextResponse.json({ run: await requestAgentRunCancellation(params.id, params.runId) });
  } catch (error) {
    if (error instanceof AgentRunRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: '停止任务失败' }, { status: 500 });
  }
}
