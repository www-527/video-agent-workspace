import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  streamCodexTestChat: vi.fn(),
}));

vi.mock('@/lib/ai-key-store', () => {
  class AIKeyStoreError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message);
    }
  }
  return {
    AIKeyStoreError,
    aiKeyStore: { getSnapshot: mocks.getSnapshot },
  };
});

vi.mock('@/lib/ai/codex-test-chat', () => ({
  streamCodexTestChat: mocks.streamCodexTestChat,
}));

import { AIKeyStoreError } from '@/lib/ai-key-store';
import { POST } from '@/app/api/settings/codex-test-chat/route';

const credential = {
  id: 'key-id', name: 'Relay', apiKey: 'secret', model: 'gpt-test',
  baseURL: 'https://relay.example', apiProtocol: 'responses', source: 'saved',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSnapshot.mockResolvedValue(credential);
  mocks.streamCodexTestChat.mockReturnValue(streamOf(
    { type: 'meta', model: 'gpt-test', relayBaseURL: 'https://relay.example', requestCount: 1, stream: true, store: false, reasoningEffort: 'low', startedAt: '2026-08-04T00:00:00.000Z' },
    { type: 'response.output_text.delta', delta: 'hello', elapsedMs: 12 },
    { type: 'response.completed', status: 'completed', durationMs: 20, eventCount: 2 },
  ));
});

describe('POST /api/settings/codex-test-chat', () => {
  it('accepts a 200,000-character message and rejects a longer message', async () => {
    const accepted = await POST(jsonRequest({
      keyId: 'key-id', messages: [{ role: 'user', content: 'a'.repeat(200_000) }],
    }));
    const rejected = await POST(jsonRequest({
      keyId: 'key-id', messages: [{ role: 'user', content: 'a'.repeat(200_001) }],
    }));

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(400);
  });

  it('validates input before opening an SSE stream', async () => {
    const response = await POST(jsonRequest({
      keyId: 'key-id',
      messages: [{ role: 'assistant', content: 'not a final user message' }],
    }));

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      error: '对话必须以用户消息结束', code: 'INVALID_INPUT',
    });
    expect(mocks.streamCodexTestChat).not.toHaveBeenCalled();
  });

  it('returns a normal 404 response when the selected Key is missing', async () => {
    mocks.getSnapshot.mockRejectedValueOnce(new AIKeyStoreError('Key 不存在', 'NOT_FOUND'));

    const response = await POST(jsonRequest({
      keyId: 'missing', messages: [{ role: 'user', content: 'ping' }],
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Key 不存在', code: 'NOT_FOUND' });
    expect(mocks.streamCodexTestChat).not.toHaveBeenCalled();
  });

  it('returns normalized events with SSE headers and forwards the request signal', async () => {
    const request = jsonRequest({
      keyId: 'key-id', messages: [{ role: 'user', content: 'ping' }],
    });

    const response = await POST(request);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(mocks.streamCodexTestChat).toHaveBeenCalledWith({
      credential,
      messages: [{ role: 'user', content: 'ping' }],
      abortSignal: request.signal,
    });
    expect(text).toContain('data: {"type":"meta"');
    expect(text).toContain('data: {"type":"response.output_text.delta","delta":"hello"');
    expect(text).toContain('data: {"type":"response.completed"');
  });

  it('accepts a valid image data URL and rejects image metadata tampering', async () => {
    const valid = await POST(jsonRequest({
      keyId: 'key-id',
      messages: [{
        role: 'user', content: '',
        images: [{ dataUrl: 'data:image/png;base64,aGk=', mimeType: 'image/png', byteSize: 2 }],
      }],
    }));
    expect(valid.status).toBe(200);
    expect(mocks.streamCodexTestChat).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{
        role: 'user', content: '',
        images: [{ dataUrl: 'data:image/png;base64,aGk=', mimeType: 'image/png', byteSize: 2 }],
      }],
    }));

    const invalid = await POST(jsonRequest({
      keyId: 'key-id',
      messages: [{
        role: 'user', content: 'x',
        images: [{ dataUrl: 'data:image/png;base64,aGk=', mimeType: 'image/png', byteSize: 3 }],
      }],
    }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('calls iterator.return when the browser cancels the response stream', async () => {
    const returned = vi.fn(async () => ({ done: true, value: undefined }));
    let release: (() => void) | undefined;
    const pending = new Promise<IteratorResult<unknown>>(resolve => {
      release = () => resolve({ done: true, value: undefined });
    });
    mocks.streamCodexTestChat.mockReturnValue({
      [Symbol.asyncIterator]() {
        return { next: () => pending, return: returned };
      },
    });
    const response = await POST(jsonRequest({
      keyId: 'key-id', messages: [{ role: 'user', content: 'ping' }],
    }));

    await response.body?.cancel();
    release?.();

    expect(returned).toHaveBeenCalledTimes(1);
  });
});

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/settings/codex-test-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function streamOf(...events: unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    for (const event of events) yield event;
  })();
}
