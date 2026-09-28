import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AIKeyStoreError } from '@/lib/ai-key-store';
import { chatWithAIKey, getAPIChatUpstreamError, sanitizeAPIChatError } from '@/lib/ai/api-chat';

const requestSchema = z.object({
  keyId: z.string().trim().min(1),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(200_000),
  })).min(1).max(12),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    return NextResponse.json(await chatWithAIKey(input.keyId, input.messages, request.signal));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || '对话参数无效', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (error instanceof AIKeyStoreError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    const upstream = getAPIChatUpstreamError(error);
    if (upstream) {
      return new Response(JSON.stringify(upstream.error), {
        status: upstream.status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return NextResponse.json({ error: sanitizeAPIChatError(error), code: 'AI_CHAT_FAILED' }, { status: 502 });
  }
}
