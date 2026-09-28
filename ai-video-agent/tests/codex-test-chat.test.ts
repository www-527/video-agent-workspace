import { describe, expect, it, vi } from 'vitest';
import { buildResponsesURL, streamCodexTestChat } from '@/lib/ai/codex-test-chat';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const credential = {
  id: 'relay-id',
  name: 'Relay',
  apiKey: 'sk-codex-test-secret',
  model: 'gpt-5.6-terra',
  baseURL: 'https://relay.example/v1',
  apiProtocol: 'responses' as const,
  source: 'saved' as const,
  gptOptimization: {
    enabled: false,
    useResponsesAPI: true,
    allowChatFallback: true,
    reasoningProfile: 'fast' as const,
    creativeFreedom: 'balanced' as const,
    internalImageSearch: false,
  },
};

describe('Codex-compatible test transport', () => {
  it('sends one direct request using the Codex Responses wire contract', async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () => sseResponse(
      { type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } },
      { type: 'response.output_text.delta', delta: '你' },
      { type: 'response.output_text.delta', delta: '好' },
      { type: 'response.completed', response: {
        id: 'resp_1', status: 'completed',
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      } },
    ));

    const events = await collect(streamCodexTestChat({
      credential,
      messages: [
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '第一答' },
        { role: 'user', content: '第二问' },
      ],
      fetchImpl,
    }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call;
    if (!init) throw new Error('fetch init was not provided');
    expect(url).toBe('https://relay.example/v1/responses');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${credential.apiKey}`);
    expect(headers.get('accept')).toBe('text/event-stream');
    expect(headers.get('originator')).toBe('codex_cli_rs');
    expect(headers.get('user-agent')).toMatch(/^codex_cli_rs\//);
    expect(headers.get('session-id')).toBeTruthy();
    expect(headers.get('thread-id')).toBe(headers.get('x-client-request-id'));
    expect(headers.get('x-codex-turn-metadata')).toContain('"request_kind":"turn"');

    const request = JSON.parse(String(init.body));
    expect(request).toEqual(expect.objectContaining({
      model: 'gpt-5.6-terra',
      stream: true,
      store: false,
      tools: [],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      reasoning: { effort: 'low', summary: 'auto' },
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: headers.get('session-id'),
      text: { verbosity: 'medium' },
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: '第一问' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '第一答' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: '第二问' }] },
      ],
    }));
    expect(request).not.toHaveProperty('max_output_tokens');
    expect(request.client_metadata.session_id).toBe(headers.get('session-id'));
    expect(request.client_metadata.thread_id).toBe(headers.get('thread-id'));

    expect(events.map(event => event.type)).toEqual([
      'meta', 'http.response', 'upstream.event', 'response.created',
      'upstream.event', 'response.output_text.delta', 'upstream.event',
      'response.output_text.delta', 'upstream.event', 'response.completed',
    ]);
    expect(events.at(-1)).toEqual(expect.objectContaining({
      responseId: 'resp_1', status: 'completed', eventCount: 4,
      usage: { input: 4, output: 2, total: 6 },
    }));
  });

  it('normalizes bare, versioned, and complete relay URLs', () => {
    expect(buildResponsesURL('https://relay.example')).toBe('https://relay.example/v1/responses');
    expect(buildResponsesURL('https://relay.example/v1/')).toBe('https://relay.example/v1/responses');
    expect(buildResponsesURL('https://relay.example/v1/responses')).toBe('https://relay.example/v1/responses');
  });

  it('encodes image inputs for Responses and keeps image data out of diagnostics', async () => {
    const imageUrl = 'data:image/png;base64,aGk=';
    const fetchImpl = vi.fn<FetchImplementation>(async () => sseResponse({
      type: 'response.completed', response: { id: 'resp_image', status: 'completed' },
    }));

    const events = await collect(streamCodexTestChat({
      credential,
      messages: [{
        role: 'user', content: 'describe this image',
        images: [{ dataUrl: imageUrl, mimeType: 'image/png', byteSize: 2 }],
      }],
      fetchImpl,
    }));

    const call = fetchImpl.mock.calls[0];
    if (!call?.[1]) throw new Error('fetch init was not provided');
    const request = JSON.parse(String(call[1].body));
    expect(request.input[0].content).toEqual([
      { type: 'input_text', text: 'describe this image' },
      { type: 'input_image', image_url: imageUrl },
    ]);
    const serializedDiagnostics = JSON.stringify(events);
    expect(serializedDiagnostics).not.toContain(imageUrl);
    expect(serializedDiagnostics).toContain('dataUrlBytes');
  });

  it('keeps only the latest twelve messages', async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () => sseResponse({
      type: 'response.completed', response: { id: 'resp_2', status: 'completed' },
    }));
    const messages = Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 ? 'assistant' as const : 'user' as const,
      content: `message-${index}`,
    }));

    await collect(streamCodexTestChat({ credential, messages, fetchImpl }));

    const call = fetchImpl.mock.calls[0];
    if (!call?.[1]) throw new Error('fetch init was not provided');
    const request = JSON.parse(String(call[1].body));
    expect(request.input).toHaveLength(12);
    expect(request.input[0].content[0].text).toBe('message-2');
  });

  it('sanitizes upstream credentials and preserves the HTTP status', async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () => new Response(JSON.stringify({
      error: { message: `Upstream rejected ${credential.apiKey}` },
    }), { status: 502, headers: { 'content-type': 'application/json' } }));

    const events = await collect(streamCodexTestChat({
      credential,
      messages: [{ role: 'user', content: 'ping' }],
      fetchImpl,
    }));

    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: 'error', status: 502, message: 'Upstream rejected [REDACTED]',
    }));
    expect(JSON.stringify(events)).not.toContain(credential.apiKey);
  });

  it('reduces an HTML gateway timeout to a readable error', async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () => new Response(
      '<html><head><title>504 Gateway Time-out</title></head><body></body></html>',
      { status: 504, statusText: 'Gateway Time-out' },
    ));
    const events = await collect(streamCodexTestChat({
      credential,
      messages: [{ role: 'user', content: 'ping' }],
      fetchImpl,
    }));

    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: 'error', status: 504, message: '504 Gateway Time-out',
    }));
  });

  it('exposes complete sanitized HTTP and raw SSE diagnostics', async () => {
    const encrypted = 'encrypted-secret-payload';
    const fetchImpl = vi.fn<FetchImplementation>(async () => new Response([
      `data: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_diag' } })}\n\n`,
      `data: ${JSON.stringify({ type: 'vendor.custom', api_key: credential.apiKey, encrypted_content: encrypted })}\n\n`,
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'ok' })}\n\n`,
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 } } })}\n\n`,
      'data: [DONE]\n\n',
    ].join(''), {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'x-request-id': 'gateway-request-1',
        'set-cookie': 'session=private-cookie',
      },
    }));

    const events = await collect(streamCodexTestChat({
      credential,
      messages: [{ role: 'user', content: 'diagnose this request' }],
      fetchImpl,
    }));
    const serialized = JSON.stringify(events);
    const meta = events.find(event => event.type === 'meta');
    const http = events.find(event => event.type === 'http.response');
    const rawEvents = events.filter(event => event.type === 'upstream.event');
    const completed = events.at(-1);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(meta).toEqual(expect.objectContaining({
      type: 'meta',
      request: expect.objectContaining({
        endpoint: 'https://relay.example/v1/responses',
        method: 'POST',
        headers: expect.objectContaining({ authorization: '[REDACTED]' }),
        body: expect.objectContaining({ model: credential.model }),
      }),
    }));
    expect(http).toEqual(expect.objectContaining({
      type: 'http.response', status: 200,
      headers: expect.objectContaining({ 'x-request-id': 'gateway-request-1', 'set-cookie': '[REDACTED]' }),
    }));
    expect(rawEvents).toHaveLength(4);
    expect(rawEvents[1]).toEqual(expect.objectContaining({
      eventType: 'vendor.custom', known: false,
      payload: expect.objectContaining({
        api_key: '[REDACTED]',
        encrypted_content: { redacted: true, encodedBytes: new TextEncoder().encode(encrypted).byteLength },
      }),
    }));
    expect(events.some(event => event.type === 'stream.done')).toBe(true);
    expect(completed).toEqual(expect.objectContaining({
      type: 'response.completed', unknownEventCount: 1, doneReceived: true,
      terminationMode: 'response.completed', usage: { input: 7, output: 2, total: 9 },
    }));
    expect(serialized).not.toContain(credential.apiKey);
    expect(serialized).not.toContain(encrypted);
    expect(serialized).not.toContain('private-cookie');
  });

  it('marks oversized raw diagnostics as truncated', async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () => sseResponse(
      { type: 'vendor.large', value: 'x'.repeat(40_000) },
      { type: 'response.completed', response: { status: 'completed' } },
    ));
    const events = await collect(streamCodexTestChat({
      credential,
      messages: [{ role: 'user', content: 'ping' }],
      fetchImpl,
    }));
    const raw = events.find(event => event.type === 'upstream.event');
    expect(raw).toEqual(expect.objectContaining({
      type: 'upstream.event', truncated: true, originalBytes: expect.any(Number),
    }));
    expect(events.at(-1)).toEqual(expect.objectContaining({ diagnosticsTruncated: true }));
  });

  it('propagates cancellation instead of emitting an error event', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<FetchImplementation>(async () => new Response(new ReadableStream<Uint8Array>({
      pull(streamController) {
        streamController.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_abort' } })}\n\n`,
        ));
        controller.abort(new DOMException('Stopped', 'AbortError'));
      },
    }), { status: 200 }));

    const iterator = streamCodexTestChat({
      credential,
      messages: [{ role: 'user', content: 'ping' }],
      abortSignal: controller.signal,
      fetchImpl,
    });

    await expect(collect(iterator)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

function sseResponse(...events: unknown[]): Response {
  const payload = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}
