import { NextResponse } from 'next/server';
import { z } from 'zod';
import { contentStyleErrorResponse } from '@/lib/content-style/api';
import { contentStyleStore } from '@/lib/content-style/store';

export const dynamic = 'force-dynamic';

const agentSchema = z.enum(['planner', 'quality']);

export async function GET(request: Request) {
  try {
    const rawAgent = new URL(request.url).searchParams.get('agent');
    const agent = rawAgent ? agentSchema.parse(rawAgent) : undefined;
    return NextResponse.json({ versions: await contentStyleStore.listVersions(agent) });
  } catch (error) {
    return contentStyleErrorResponse(error);
  }
}
