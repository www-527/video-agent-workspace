import { NextRequest } from 'next/server';
import { isLocalDebugRequest, subscribeAITrace } from '@/lib/ai/trace';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isLocalDebugRequest(req.headers)) {
    return new Response('Not found', { status: 404 });
  }

  let unsubscribe = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.enqueue(encoder.encode(': ai-debug-ready\n\n'));
      unsubscribe = subscribeAITrace(send);
      req.signal.addEventListener('abort', () => {
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      }, { once: true });
    },
    cancel() { unsubscribe(); },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-content-type-options': 'nosniff',
    },
  });
}
