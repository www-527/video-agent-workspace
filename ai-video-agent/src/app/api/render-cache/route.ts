import { NextRequest, NextResponse } from 'next/server';
import { clearRenderCache, getRenderCacheStats } from '@/lib/render/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId') || undefined;
  return NextResponse.json(await getRenderCacheStats(projectId));
}

export async function DELETE(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId') || undefined;
  const failedOnly = request.nextUrl.searchParams.get('failedOnly') === 'true';
  await clearRenderCache({ projectId, failedOnly });
  return NextResponse.json({ ok: true, stats: await getRenderCacheStats(projectId) });
}

