import { NextRequest, NextResponse } from 'next/server';
import { cancelRenderJob, getOrRestoreRenderJob, startRenderJob } from '@/lib/render/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { jobId: string };
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const job = await getOrRestoreRenderJob(params.jobId);
  if (!job) return NextResponse.json({ error: '渲染任务不存在或本地服务已重启。' }, { status: 404 });
  return NextResponse.json({ job }, {
    headers: { 'cache-control': 'no-store' },
  });
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  await getOrRestoreRenderJob(params.jobId);
  const job = cancelRenderJob(params.jobId);
  if (!job) return NextResponse.json({ error: '渲染任务不存在。' }, { status: 404 });
  return NextResponse.json({ job });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const previous = await getOrRestoreRenderJob(params.jobId);
  if (!previous) return NextResponse.json({ error: '原渲染任务不存在。' }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { sceneId?: string };
  const failedSceneIds = previous.scenes.filter(scene => scene.stage === 'failed').map(scene => scene.id);
  const forceSceneIds = body.sceneId ? [body.sceneId] : failedSceneIds;
  if (!forceSceneIds.length) {
    return NextResponse.json({ error: '没有可重试的失败分镜。' }, { status: 400 });
  }
  const job = await startRenderJob(previous.projectId, { forceSceneIds });
  return NextResponse.json({ job }, { status: 202 });
}
