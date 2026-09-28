import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { DATA_ROOT } from '@/lib/render/paths';
import { getOrRestoreRenderJob } from '@/lib/render/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { jobId: string };
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const job = await getOrRestoreRenderJob(params.jobId);
  if (!job) return NextResponse.json({ error: '渲染任务不存在。' }, { status: 404 });
  const sceneId = request.nextUrl.searchParams.get('sceneId');
  const scene = job.scenes.find(item => item.id === sceneId);
  if (!scene?.error?.logPath) return NextResponse.json({ error: '该分镜没有错误日志。' }, { status: 404 });
  const path = resolve(scene.error.logPath);
  if (path !== DATA_ROOT && !path.startsWith(`${DATA_ROOT}${sep}`)) {
    return NextResponse.json({ error: '日志路径无效。' }, { status: 400 });
  }
  try {
    const log = await readFile(path, 'utf8');
    return new NextResponse(log, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `inline; filename="scene-${scene.index + 1}-render.log"`,
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: '日志文件不存在。' }, { status: 404 });
  }
}
