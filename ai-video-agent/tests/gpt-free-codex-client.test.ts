import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const mocks = vi.hoisted(() => ({
  openAIConstructors: vi.fn(),
  publishAITrace: vi.fn(),
  credential: {
    id: 'gpt-free-relay',
    name: 'GPT-free relay',
    apiKey: 'sk-gpt-free-secret',
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
  },
}));

vi.mock('openai', () => ({
  default: class OpenAI {
    constructor() {
      mocks.openAIConstructors();
    }
  },
}));

vi.mock('@/lib/ai-key-context', () => ({
  getTaskAIKeySnapshot: vi.fn(async () => mocks.credential),
  getCurrentAIKeySnapshot: () => mocks.credential,
  getCurrentAITransportPolicy: () => 'gpt-free-codex',
}));

vi.mock('@/lib/ai/trace', () => ({ publishAITrace: mocks.publishAITrace }));

import {
  AIJsonParseError,
  callAIVisionJson,
  callAIHtml,
  callAIJson,
  callAIText,
  GPT_FREE_JSON_TIMEOUT_MS,
} from '@/lib/ai/client';

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => vi.restoreAllMocks());

describe('GPT-free Codex production client', () => {
  it('uses one raw Codex SSE request for JSON without constructing the OpenAI SDK', async () => {
    const fetchMock = vi.fn<FetchImplementation>(async () => completedResponse('{"ok":true}', 'resp_json'));
    vi.stubGlobal('fetch', fetchMock);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);

    await expect(callAIJson<{ ok: boolean }>({
      system: '内容规划 system',
      user: '内容规划 user',
      stage: '内容规划 Agent',
      maxTokens: 8_000,
      maxRetries: 4,
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.openAIConstructors).not.toHaveBeenCalled();
    const call = fetchMock.mock.calls[0];
    if (!call?.[1]) throw new Error('missing fetch init');
    const headers = new Headers(call[1].headers);
    const request = JSON.parse(String(call[1].body));
    expect(call[0]).toBe('https://relay.example/v1/responses');
    expect(headers.get('originator')).toBe('codex_cli_rs');
    expect(headers.get('authorization')).toBe(`Bearer ${mocks.credential.apiKey}`);
    expect(request.instructions).toContain('内容规划 system');
    expect(request.instructions).toContain('GPT 创作约束');
    expect(request.input).toEqual([{
      type: 'message', role: 'user', content: [{ type: 'input_text', text: '内容规划 user' }],
    }]);
    expect(request).toEqual(expect.objectContaining({
      stream: true,
      store: false,
      reasoning: { effort: 'high', summary: 'auto' },
      text: { verbosity: 'medium' },
      tools: [],
    }));
    expect(request).not.toHaveProperty('max_output_tokens');
    expect(request).not.toHaveProperty('temperature');
    expect(timeoutSpy).toHaveBeenCalledWith(GPT_FREE_JSON_TIMEOUT_MS);
    expect(GPT_FREE_JSON_TIMEOUT_MS).toBe(240_000);
    expect(mocks.publishAITrace).toHaveBeenCalledTimes(1);
    expect(mocks.publishAITrace).toHaveBeenCalledWith(expect.objectContaining({
      stage: '内容规划 Agent',
      apiMode: 'responses',
      attempt: 1,
      maxAttempts: 4,
      responseId: 'resp_json',
      output: '{"ok":true}',
    }));
  });

  it('passes visual candidates to the Codex Responses input in one request', async () => {
    const fetchMock = vi.fn<FetchImplementation>(async () => completedResponse('{"selectedPhotoId":11}', 'resp_visual'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAIVisionJson<{ selectedPhotoId: number }>({
      system: '视觉复选 system',
      user: '只比较候选 11 和 22',
      images: [
        { dataUrl: 'data:image/jpeg;base64,cGhvdG8x', label: '11' },
        { dataUrl: 'data:image/jpeg;base64,cGhvdG8y', label: '22' },
      ],
      stage: 'Pexels 视觉复选',
    })).resolves.toEqual({ selectedPhotoId: 11 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call?.[1]) throw new Error('missing fetch init');
    const request = JSON.parse(String(call[1].body));
    expect(request.input[0].content.map((item: { type: string }) => item.type))
      .toEqual(['input_text', 'input_image', 'input_image']);
    expect(request.input[0].content.slice(1).map((item: { input_image?: never; image_url?: string }) => item.image_url))
      .toEqual(['data:image/jpeg;base64,cGhvdG8x', 'data:image/jpeg;base64,cGhvdG8y']);
    expect(mocks.openAIConstructors).not.toHaveBeenCalled();
  });

  it('preserves text and HTML business return shapes', async () => {
    const fetchMock = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(completedResponse('普通文本', 'resp_text'))
      .mockResolvedValueOnce(completedResponse('<main>完整 HTML</main>', 'resp_html'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAIText({ system: 'text system', user: 'text user', maxRetries: 3 }))
      .resolves.toBe('普通文本');
    await expect(callAIHtml({
      system: 'html system', user: 'html user', maxTokens: 40_000, maxRetries: 3,
    })).resolves.toEqual({
      output: '<main>完整 HTML</main>',
      finishReason: 'completed',
      outputLength: '<main>完整 HTML</main>'.length,
      reasoningLength: 0,
      lengthLimited: false,
      emptyOutput: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.openAIConstructors).not.toHaveBeenCalled();
  });

  it('forwards high reasoning effort for visual HTML repair calls', async () => {
    const fetchMock = vi.fn<FetchImplementation>(async () => completedResponse('<main>repaired</main>', 'resp_high_reasoning'));
    vi.stubGlobal('fetch', fetchMock);

    await callAIHtml({
      system: 'visual repair system',
      user: 'repair the visual overlap',
      reasoningEffort: 'high',
    });

    const call = fetchMock.mock.calls[0];
    if (!call?.[1]) throw new Error('missing fetch init');
    const request = JSON.parse(String(call[1].body));
    expect(request.reasoning).toEqual({ effort: 'high', summary: 'auto' });
    expect(mocks.publishAITrace).toHaveBeenCalledWith(expect.objectContaining({
      requestedReasoningEffort: 'high',
      reasoningEffort: 'high',
    }));
  });

  it('uses a 200 second timeout for GPT-free HTML generation', async () => {
    const fetchMock = vi.fn<FetchImplementation>(async () => completedResponse('<main>HTML</main>', 'resp_html_timeout'));
    vi.stubGlobal('fetch', fetchMock);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);

    await expect(callAIHtml({ system: 'html system', user: 'html user', maxTokens: 40_000 })).resolves.toMatchObject({
      output: '<main>HTML</main>',
    });

    expect(timeoutSpy).toHaveBeenCalledWith(200_000);
  });

  it('stops after one upstream HTTP failure and preserves its status without Chat fallback', async () => {
    const fetchMock = vi.fn<FetchImplementation>(async () => new Response(JSON.stringify({
      error: { message: `Bad Gateway rejected ${mocks.credential.apiKey}` },
    }), { status: 502, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await callAIText({ system: 'system', user: 'user', maxRetries: 9 })
      .then(() => undefined, reason => reason as Error & { status?: number; error?: unknown });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.openAIConstructors).not.toHaveBeenCalled();
    expect(error).toMatchObject({
      status: 502,
      error: { message: 'Bad Gateway rejected [REDACTED]', type: 'upstream_error' },
    });
    expect(JSON.stringify(error)).not.toContain(mocks.credential.apiKey);
  });

  it('retries a transient Responses overload for JSON calls', async () => {
    const fetchMock = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(sseResponse({ type: 'error', message: 'Our servers are currently overloaded. Please try again later.' }))
      .mockResolvedValueOnce(completedResponse('{"ok":true}', 'resp_recovered'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAIJson<{ ok: boolean }>({
      system: 'system', user: 'user', stage: '分镜修改', maxRetries: 1,
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.publishAITrace).toHaveBeenCalledWith(expect.objectContaining({
      stage: '分镜修改', attempt: 1, maxAttempts: 2,
    }));
    expect(mocks.publishAITrace).toHaveBeenCalledWith(expect.objectContaining({
      stage: '分镜修改', attempt: 2, maxAttempts: 2, output: '{"ok":true}',
    }));
  });

  it('does not retry or switch transports when completed JSON is malformed', async () => {
    const fetchMock = vi.fn<FetchImplementation>(async () => completedResponse('{"broken":', 'resp_bad_json'));
    vi.stubGlobal('fetch', fetchMock);

    const pending = callAIJson({ system: 'system', user: 'user', maxRetries: 5 });
    await expect(pending).rejects.toBeInstanceOf(AIJsonParseError);
    await expect(pending).rejects.toMatchObject({ output: '{"broken":', finishReason: 'completed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.openAIConstructors).not.toHaveBeenCalled();
  });

  it('recovers literal control characters inside completed JSON strings', async () => {
    const output = '{"title":"控制字符","frames":[{"narration":"第一行\n第二行"}]}';
    const fetchMock = vi.fn<FetchImplementation>(async () => completedResponse(output, 'resp_controls'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAIJson<{ frames: Array<{ narration: string }> }>({
      system: 'system', user: 'user', maxRetries: 0,
    })).resolves.toEqual({
      title: '控制字符',
      frames: [{ narration: '第一行\n第二行' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recovers a missing separator between completed object fields', async () => {
    const output = '{"title":"缺少逗号","frames":[{"title":"第一镜" "narration":"正文"}]}';
    const fetchMock = vi.fn<FetchImplementation>(async () => completedResponse(output, 'resp_comma'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAIJson<{ frames: Array<{ title: string; narration: string }> }>({
      system: 'system', user: 'user', maxRetries: 0,
    })).resolves.toEqual({
      title: '缺少逗号',
      frames: [{ title: '第一镜', narration: '正文' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled Responses stream at the requested timeout without misreporting in_progress as finish_reason', async () => {
    const fetchMock = vi.fn<FetchImplementation>(async (_input, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
            type: 'response.created',
            response: { id: 'resp_stalled', status: 'in_progress' },
          })}\n\n`));
          init?.signal?.addEventListener('abort', () => {
            controller.error(init.signal?.reason ?? new Error('aborted'));
          }, { once: true });
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const error = await callAIJson({
      system: 'system', user: 'user', stage: '超时测试', timeoutMs: 25,
    }).then(() => undefined, reason => reason as Error);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error?.message).toContain('request exceeded 25ms');
    expect(mocks.publishAITrace).toHaveBeenCalledWith(expect.objectContaining({
      stage: '超时测试',
      responseId: 'resp_stalled',
      responseStatus: 'in_progress',
      terminationMode: 'aborted',
      finishReason: null,
      output: '',
    }));
  });

  it('propagates cancellation after one fetch', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Stopped', 'AbortError'));
    const fetchMock = vi.fn<FetchImplementation>(async (_input, init) => {
      if (init?.signal?.aborted) throw init.signal.reason;
      return completedResponse('unexpected', 'resp_unexpected');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAIText({
      system: 'system', user: 'user', maxRetries: 5, abortSignal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.openAIConstructors).not.toHaveBeenCalled();
  });
});

function completedResponse(output: string, responseId: string): Response {
  const midpoint = Math.max(1, Math.floor(output.length / 2));
  const events = [
    { type: 'response.created', response: { id: responseId, status: 'in_progress' } },
    { type: 'response.output_text.delta', delta: output.slice(0, midpoint) },
    { type: 'response.output_text.delta', delta: output.slice(midpoint) },
    { type: 'response.completed', response: {
      id: responseId,
      model: 'gpt-5.6-terra-actual',
      status: 'completed',
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    } },
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

function sseResponse(...events: Array<Record<string, unknown>>): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}
