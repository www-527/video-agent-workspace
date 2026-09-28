import { describe, expect, it, vi } from 'vitest';
import {
  streamCodexResponses,
  type FetchImplementation,
} from '@/lib/ai/providers/codex-responses';

const credential = {
  id: 'production-relay',
  name: 'Production relay',
  apiKey: 'sk-production-secret',
  model: 'gpt-5.6-terra',
  baseURL: 'https://relay.example/v1',
  apiProtocol: 'chat.completions' as const,
  source: 'saved' as const,
  gptOptimization: {
    enabled: true,
    useResponsesAPI: false,
    allowChatFallback: true,
    reasoningProfile: 'quality' as const,
    creativeFreedom: 'open' as const,
    internalImageSearch: false,
  },
};

describe('shared Codex Responses wire core', () => {
  it('uses caller instructions with the fixed single-request production contract', async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () => response([
      { type: 'response.output_text.delta', delta: '{"ok":' },
      { type: 'response.output_text.delta', delta: 'true}' },
      { type: 'response.completed', response: { id: 'resp_prod', status: 'completed' } },
    ]));

    const events = await collect(streamCodexResponses({
      credential,
      instructions: '原内容规划 Agent system prompt',
      messages: [{ role: 'user', content: '原内容规划 Agent user prompt' }],
      fetchImpl,
    }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    if (!call?.[1]) throw new Error('missing fetch init');
    const request = JSON.parse(String(call[1].body));
    expect(request).toEqual(expect.objectContaining({
      instructions: '原内容规划 Agent system prompt',
      input: [{
        type: 'message', role: 'user',
        content: [{ type: 'input_text', text: '原内容规划 Agent user prompt' }],
      }],
      tools: [],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      reasoning: { effort: 'low', summary: 'auto' },
      store: false,
      stream: true,
      include: ['reasoning.encrypted_content'],
      text: { verbosity: 'medium' },
    }));
    expect(request).not.toHaveProperty('max_output_tokens');
    expect(request).not.toHaveProperty('previous_response_id');
    expect(events.filter(event => event.type === 'response.output_text.delta'))
      .toEqual([
        expect.objectContaining({ delta: '{"ok":' }),
        expect.objectContaining({ delta: 'true}' }),
      ]);
    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: 'response.completed', responseId: 'resp_prod', terminationMode: 'response.completed',
    }));
  });

  it('parses CRLF and multiline data without duplicating text', async () => {
    const payload = [
      'data: {"type":"response.output_text.delta",',
      'data: "delta":"hello"}',
      '',
      'data: {"type":"response.completed","response":{"status":"completed"}}',
      '',
      '',
    ].join('\r\n');
    const fetchImpl = vi.fn<FetchImplementation>(async () => new Response(payload, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    const events = await collect(streamCodexResponses({
      credential,
      instructions: 'system',
      messages: [{ role: 'user', content: 'user' }],
      fetchImpl,
    }));

    expect(events.filter(event => event.type === 'response.output_text.delta'))
      .toEqual([expect.objectContaining({ delta: 'hello' })]);
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: 'response.completed', eventCount: 2 }));
  });

  it('fails an EOF without response.completed after one fetch', async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () => response([
      { type: 'response.output_text.delta', delta: 'partial' },
    ]));

    const events = await collect(streamCodexResponses({
      credential,
      instructions: 'system',
      messages: [{ role: 'user', content: 'user' }],
      fetchImpl,
    }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: 'error', terminationMode: 'eof', message: 'Responses 流在完成事件前结束',
    }));
  });
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

function response(events: unknown[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}
