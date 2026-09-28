import { NextRequest, NextResponse } from 'next/server';
import { createProjectAssetFromFile, AssetServiceError, listProjectAssets } from '@/lib/assets/service';
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_UPLOAD_BATCH_BYTES } from '@/lib/assets/constants';
import { isAIDialogFeatureEnabled } from '@/lib/feature-flags';

export const runtime = 'nodejs';

interface RouteContext {
  params: { id: string };
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  if (!isAIDialogFeatureEnabled('PROJECT_ASSETS_V1')) {
    return NextResponse.json({ error: '项目附件功能未启用' }, { status: 404 });
  }
  try {
    return NextResponse.json({ assets: await listProjectAssets(params.id) });
  } catch (error) {
    return assetErrorResponse(error, '读取附件失败');
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isAIDialogFeatureEnabled('PROJECT_ASSETS_V1')) {
    return NextResponse.json({ error: '项目附件功能未启用' }, { status: 404 });
  }
  try {
    const form = await request.formData();
    const files = [...form.getAll('files'), ...form.getAll('file')].filter((value): value is File => value instanceof File);
    if (!files.length) return NextResponse.json({ error: '请选择要上传的文件' }, { status: 400 });
    if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      return NextResponse.json({ error: '每次最多上传 10 个附件' }, { status: 413 });
    }
    const batchBytes = files.reduce((total, file) => total + file.size, 0);
    if (batchBytes > MAX_UPLOAD_BATCH_BYTES) {
      return NextResponse.json({ error: '一次上传的附件总大小不能超过 100 MB' }, { status: 413 });
    }
    const results = [];
    for (const file of files) {
      results.push(await createProjectAssetFromFile({ projectId: params.id, file, abortSignal: request.signal }));
    }
    return NextResponse.json({
      assets: results.map(result => result.asset),
      deduplicatedAssetIds: results.filter(result => result.deduplicated).map(result => result.asset.id),
    });
  } catch (error) {
    return assetErrorResponse(error, '上传附件失败');
  }
}

function assetErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AssetServiceError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return NextResponse.json({ error: '上传已停止' }, { status: 499 });
  }
  console.error('[project assets]', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
