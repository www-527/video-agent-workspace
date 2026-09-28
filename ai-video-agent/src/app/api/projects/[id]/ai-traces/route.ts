import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getProjectAITraceHistory } from '@/lib/ai/trace';

interface RouteContext {
  params: { id: string };
}

/** Latest model calls for this project in the current local server session. */
export async function GET(_request: Request, { params }: RouteContext) {
  const project = await prisma.project.findUnique({
    where: { uuid: params.id },
    select: { uuid: true },
  });

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  return NextResponse.json({ traces: getProjectAITraceHistory(project.uuid) });
}
