import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AIKeyStoreError } from '@/lib/ai-key-store';
import { probeGPTCapabilities } from '@/lib/ai/gpt-capabilities';

const querySchema = z.string().trim().min(1);

export async function GET(request: Request) {
  try {
    const keyId = querySchema.parse(new URL(request.url).searchParams.get('keyId'));
    return NextResponse.json(await probeGPTCapabilities(keyId));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: '缺少有效的 keyId', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (error instanceof AIKeyStoreError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    return NextResponse.json({ error: 'GPT 能力检测失败', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
