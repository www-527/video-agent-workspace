import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AIKeyStoreError } from '@/lib/ai-key-store';
import { AIModelListError, listAvailableAIModels } from '@/lib/ai-models';

const querySchema = z.string().trim().min(1);

export async function GET(request: Request) {
  try {
    const keyId = querySchema.parse(new URL(request.url).searchParams.get('keyId'));
    return NextResponse.json(await listAvailableAIModels(keyId));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: '缺少有效的 keyId', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (error instanceof AIKeyStoreError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    if (error instanceof AIModelListError) {
      return NextResponse.json({ error: error.message, code: 'MODEL_LIST_FAILED' }, { status: error.status });
    }
    return NextResponse.json({ error: '读取模型列表失败', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
