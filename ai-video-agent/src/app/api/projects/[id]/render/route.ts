import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listProjectRenderJobs, startRenderJob } from '@/lib/render/runner';
import { ExportQualityGateError } from '@/lib/quality/export-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

const optionsSchema = z.object({
  subtitles: z.boolean().optional(),
  subtitleHorizontal: z.number().min(15).max(85).optional(),
  subtitleVertical: z.number().min(5).max(80).optional(),
  allowRealtimeFallback: z.boolean().optional(),
  bypassQualityGate: z.boolean().optional(),
  forceSceneIds: z.array(z.string().min(1)).max(200).optional(),
  maxConcurrentScenes: z.number().int().min(1).max(4).optional(),
  useGpuEncoding: z.boolean().optional(),
}).strict();

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = await request.json().catch(() => ({}));
    const parsed = optionsSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: '导出参数无效。', details: parsed.error.flatten() }, { status: 400 });
    }
    const job = await startRenderJob(params.id, parsed.data);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const status = error instanceof ExportQualityGateError ? 409 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : '无法创建本地渲染任务。' }, { status });
  }
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  return NextResponse.json({ jobs: listProjectRenderJobs(params.id) });
}
