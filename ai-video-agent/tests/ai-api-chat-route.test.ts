import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chatWithAIKey: vi.fn(),
}));

vi.mock('@/lib/ai/api-chat', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/api-chat')>('@/lib/ai/api-chat');
  return { ...actual, chatWithAIKey: mocks.chatWithAIKey };
});

vi.mock('@/lib/ai-key-store', () => {
  class AIKeyStoreError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message);
    }
  }
  return { AIKeyStoreError };
});

import { POST } from '@/app/api/settings/ai-chat/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/settings/ai-chat', () => {
  it('accepts a 200,000-character message and rejects a longer message', async () => {
    mocks.chatWithAIKey.mockResolvedValueOnce({ message: 'ok' });

    const accepted = await POST(jsonRequest({
      keyId: 'key-id',
      messages: [{ role: 'user', content: 'a'.repeat(200_000) }],
    }));
    const rejected = await POST(jsonRequest({
      keyId: 'key-id',
      messages: [{ role: 'user', content: 'a'.repeat(200_001) }],
    }));

    expect(accepted.status).toBe(200);
    expect(mocks.chatWithAIKey).toHaveBeenCalledWith('key-id', [{ role: 'user', content: 'a'.repeat(200_000) }], expect.any(AbortSignal));
    expect(rejected.status).toBe(400);
  });

  it('preserves an upstream HTTP status and returns its error payload without wrapping it', async () => {
    mocks.chatWithAIKey.mockRejectedValueOnce(Object.assign(new Error('429 rate limit'), {
      status: 429,
      error: {
        message: 'Rate limit reached for this model',
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded',
      },
    }));

    const response = await POST(jsonRequest({
      keyId: 'key-id',
      messages: [{ role: 'user', content: 'ping' }],
    }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      message: 'Rate limit reached for this model',
      type: 'rate_limit_error',
      code: 'rate_limit_exceeded',
    });
  });

  it('keeps the generic response for local failures that have no upstream HTTP response', async () => {
    mocks.chatWithAIKey.mockRejectedValueOnce(new Error('local connection failure'));

    const response = await POST(jsonRequest({
      keyId: 'key-id',
      messages: [{ role: 'user', content: 'ping' }],
    }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'local connection failure', code: 'AI_CHAT_FAILED' });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/settings/ai-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
