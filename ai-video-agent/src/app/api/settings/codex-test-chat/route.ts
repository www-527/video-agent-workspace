import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiKeyStore, AIKeyStoreError } from '@/lib/ai-key-store';
import {
  parseCodexTestImageDataUrl,
  validateCodexTestRequestImages,
  type CodexTestInputMessage,
} from '@/lib/ai/codex-test-images';
import {
  streamCodexTestChat,
  type CodexTestStreamEvent,
} from '@/lib/ai/codex-test-chat';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().max(200_000),
  images: z.array(z.object({
    dataUrl: z.string().max(21_000_000),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    byteSize: z.number().int().positive().max(15 * 1024 * 1024),
  })).max(10).optional(),
}).superRefine((message, context) => {
  if (message.role === 'assistant' && (!message.content || message.images?.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '助手消息必须只包含文本。' });
  }
  if (message.role === 'user' && !message.content && !message.images?.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '请至少输入文字或添加一张图片。' });
  }
});

const requestSchema = z.object({
  keyId: z.string().trim().min(1),
  messages: z.array(messageSchema).min(1).max(12),
}).refine(input => input.messages.at(-1)?.role === 'user', {
  message: '对话必须以用户消息结束',
  path: ['messages'],
});

const encoder = new TextEncoder();

export async function POST(request: Request): Promise<Response> {
  try {
    const input = requestSchema.parse(await request.json());
    const messages = normalizeMessages(input.messages);
    const credential = await aiKeyStore.getSnapshot(input.keyId);
    const iterator = streamCodexTestChat({
      credential,
      messages,
      abortSignal: request.signal,
    })[Symbol.asyncIterator]();

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await iterator.next();
          if (result.done) {
            controller.close();
            return;
          }
          controller.enqueue(encodeSSE(result.value));
        } catch (error) {
          if (request.signal.aborted || isAbortError(error)) {
            controller.close();
            return;
          }
          controller.enqueue(encodeSSE({
            type: 'error',
            message: 'Codex 测试流意外中断',
            durationMs: 0,
            eventCount: 0,
            responseBytes: 0,
            unknownEventCount: 0,
            terminationMode: 'failed',
            diagnosticsTruncated: false,
            doneReceived: false,
          }));
          controller.close();
        }
      },
      async cancel() {
        await iterator.return?.(undefined);
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: error.issues[0]?.message || 'Codex API 测试参数无效',
        code: 'INVALID_INPUT',
      }, { status: 400 });
    }
    if (error instanceof InvalidImageInputError) {
      return NextResponse.json({ error: error.message, code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (error instanceof AIKeyStoreError) {
      return NextResponse.json({ error: error.message, code: error.code }, {
        status: error.code === 'NOT_FOUND' ? 404 : 500,
      });
    }
    return NextResponse.json({ error: 'Codex API 测试启动失败', code: 'CODEX_TEST_FAILED' }, { status: 500 });
  }
}

class InvalidImageInputError extends Error {}

function normalizeMessages(messages: Array<z.infer<typeof messageSchema>>): CodexTestInputMessage[] {
  try {
    const normalized = messages.map(message => ({
      role: message.role,
      content: message.content,
      images: message.images?.map(image => {
        const parsed = parseCodexTestImageDataUrl(image.dataUrl);
        if (parsed.mimeType !== image.mimeType || parsed.byteSize !== image.byteSize) {
          throw new Error('图片元数据与实际内容不一致。');
        }
        return parsed;
      }),
    }));
    validateCodexTestRequestImages(normalized);
    return normalized;
  } catch (error) {
    throw new InvalidImageInputError(error instanceof Error ? error.message : '图片数据无效。');
  }
}

function encodeSSE(event: CodexTestStreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
