import { NextRequest, NextResponse } from 'next/server';
import { AssetServiceError, retryProjectAsset } from '@/lib/assets/service';

export const runtime = 'nodejs';

interface RouteContext {
  params: { id: string; assetId: string };
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const asset = await retryProjectAsset(params.id, params.assetId, request.signal);
    return NextResponse.json({ asset });
  } catch (error) {
    if (error instanceof AssetServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: '重试已停止' }, { status: 499 });
    }
    return NextResponse.json({ error: '重试附件处理失败' }, { status: 500 });
  }
}
