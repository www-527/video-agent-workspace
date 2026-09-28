import { describe, expect, it, vi } from 'vitest';

import { normalizeResponsesJsonContentType } from '@/lib/ai/providers/gpt-relay';

describe('GPT relay response compatibility', () => {
  it('corrects a text/plain Responses payload only when it is a valid response object', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ id: 'resp_123', object: 'response', status: 'completed' }),
      { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    ));

    const response = await normalizeResponsesJsonContentType(fetchImpl)('https://relay.example/v1/responses');

    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    await expect(response.json()).resolves.toMatchObject({ object: 'response', id: 'resp_123' });
  });

  it('does not relabel a non-JSON relay response', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>proxy error</html>', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));

    const response = await normalizeResponsesJsonContentType(fetchImpl)('https://relay.example/v1/responses');

    expect(response.headers.get('content-type')).toBe('text/plain');
    await expect(response.text()).resolves.toBe('<html>proxy error</html>');
  });

  it('does not alter non-Responses endpoints', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ object: 'response' }), {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));

    const response = await normalizeResponsesJsonContentType(fetchImpl)('https://relay.example/v1/chat/completions');

    expect(response.headers.get('content-type')).toBe('text/plain');
  });
});
