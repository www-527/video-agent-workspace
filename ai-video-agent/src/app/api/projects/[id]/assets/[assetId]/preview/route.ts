import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { AssetServiceError, getProjectAssetFile } from '@/lib/assets/service';

export const runtime = 'nodejs';

interface RouteContext {
  params: { id: string; assetId: string };
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const asset = await getProjectAssetFile(params.id, params.assetId);
    const stream = createReadStream(asset.path);
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        'content-type': asset.mimeType,
        'content-length': String(asset.byteLength),
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof AssetServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: '附件预览失败' }, { status: 500 });
  }
}
