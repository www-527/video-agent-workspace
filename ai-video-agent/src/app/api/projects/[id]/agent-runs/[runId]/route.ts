import { NextRequest, NextResponse } from 'next/server';
import { AgentRunRequestError, getAgentRunView } from '@/lib/agents/chat-run';

interface RouteContext {
  params: { id: string; runId: string };
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    return NextResponse.json({ run: await getAgentRunView(params.id, params.runId) });
  } catch (error) {
    if (error instanceof AgentRunRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: '读取任务失败' }, { status: 500 });
  }
}
