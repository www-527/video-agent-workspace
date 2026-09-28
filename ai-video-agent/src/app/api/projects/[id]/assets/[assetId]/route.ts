import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AssetServiceError, deleteProjectAsset, updateProjectAssetUsage } from '@/lib/assets/service';

interface RouteContext {
  params: { id: string; assetId: string };
}

const patchSchema = z.object({
  usage: z.enum(['must', 'optional', 'reference', 'excluded']),
}).strict();

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: '附件用途参数错误' }, { status: 400 });
    const asset = await updateProjectAssetUsage({
      projectId: params.id,
      assetId: params.assetId,
      usage: parsed.data.usage,
    });
    return NextResponse.json({ asset });
  } catch (error) {
    return errorResponse(error, '更新附件失败');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    await deleteProjectAsset(params.id, params.assetId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, '删除附件失败');
  }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof AssetServiceError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error('[project asset]', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
