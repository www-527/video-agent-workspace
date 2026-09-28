import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  responsesCreate: vi.fn(),
  chatCreate: vi.fn(),
  publishAITrace: vi.fn(),
}));

vi.mock('@/lib/ai-key-store', () => ({ aiKeyStore: { getSnapshot: mocks.getSnapshot } }));
vi.mock('@/lib/ai/trace', () => ({ publishAITrace: mocks.publishAITrace }));
vi.mock('openai', () => ({
  default: class OpenAI {
    responses = { create: mocks.responsesCreate };
    chat = { completions: { create: mocks.chatCreate } };
  },
}));

import { chatWithAIKey } from '@/lib/ai/api-chat';

const credential = {
  id: 'relay', name: 'Relay', apiKey: 'sk-relay', model: 'gpt-5.6-terra', baseURL: 'https://relay.example/v1', source: 'saved' as const,
  apiProtocol: 'auto' as 'auto' | 'responses' | 'chat.completions',
  gptOptimization: { enabled: true, useResponsesAPI: true, allowChatFallback: true, reasoningProfile: 'balanced' as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  credential.apiProtocol = 'auto';
  credential.gptOptimization.enabled = true;
  mocks.getSnapshot.mockResolvedValue(credential);
  mocks.responsesCreate.mockResolvedValue({
    id: 'resp_chat', model: 'gpt-5.6-terra-real', status: 'completed', output_text: '第二次回答',
    usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
  });
  mocks.chatCreate.mockResolvedValue({
    id: 'chat_fallback', model: 'gpt-chat-route',
    choices: [{ message: { content: '回退回答' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
  });
});

describe('API chat', () => {
  it('forwards a 200,000-character message without truncating it', async () => {
    const content = 'a'.repeat(200_000);

    await chatWithAIKey('relay', [{ role: 'user', content }]);

    expect(mocks.responsesCreate.mock.calls[0][0]).toMatchObject({
      input: [{ role: 'user', content }],
    });
  });

  it('keeps conversation roles and returns Responses metadata', async () => {
    const result = await chatWithAIKey('relay', [
      { role: 'user', content: '第一次问题' },
      { role: 'assistant', content: '第一次回答' },
      { role: 'user', content: '继续回答' },
    ]);

    expect(mocks.responsesCreate.mock.calls[0][0]).toMatchObject({
      model: 'gpt-5.6-terra',
      input: [
        { role: 'user', content: '第一次问题' },
        { role: 'assistant', content: '第一次回答' },
        { role: 'user', content: '继续回答' },
      ],
    });
    expect(result).toMatchObject({
      message: '第二次回答', apiMode: 'responses', actualModel: 'gpt-5.6-terra-real', responseId: 'resp_chat',
      tokens: { prompt: 20, completion: 8, total: 28 },
    });
    expect(mocks.chatCreate).not.toHaveBeenCalled();
  });

  it('retries a temporarily unavailable Responses upstream before changing protocol', async () => {
    mocks.responsesCreate.mockRejectedValueOnce(Object.assign(new Error('503 Service temporarily unavailable'), { status: 503 }));
    const result = await chatWithAIKey('relay', [{ role: 'user', content: '你好' }]);

    expect(result).toMatchObject({
      message: '第二次回答', apiMode: 'responses',
    });
    expect(mocks.responsesCreate).toHaveBeenCalledTimes(2);
    expect(mocks.chatCreate).not.toHaveBeenCalled();
    expect(mocks.publishAITrace.mock.calls.map(call => [call[0].attempt, call[0].maxAttempts]))
      .toEqual([[1, 3], [2, 3]]);
  });

  it('falls back to Chat Completions after transient Responses attempts are exhausted', async () => {
    mocks.responsesCreate.mockRejectedValue(Object.assign(new Error('503 Service temporarily unavailable'), { status: 503 }));

    const result = await chatWithAIKey('relay', [{ role: 'user', content: '你好' }]);

    expect(result).toMatchObject({
      message: '回退回答', apiMode: 'chat.completions', fallbackReason: 'responses_temporarily_unavailable',
    });
    expect(mocks.responsesCreate).toHaveBeenCalledTimes(3);
    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
  });

  it('falls back to Chat Completions when Responses reports an upstream 400', async () => {
    mocks.responsesCreate.mockRejectedValueOnce(Object.assign(new Error('400 Upstream request failed'), { status: 400 }));

    const result = await chatWithAIKey('relay', [{ role: 'user', content: '你好' }]);

    expect(result).toMatchObject({
      message: '回退回答', apiMode: 'chat.completions', fallbackReason: 'responses_upstream_request_failed',
    });
    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
    expect(mocks.publishAITrace).toHaveBeenCalledTimes(2);
    expect(mocks.publishAITrace.mock.calls[1][0]).toMatchObject({
      apiMode: 'chat.completions',
      downgradeReason: 'responses_upstream_request_failed',
    });
  });

  it('retries GPT Chat Completions without a token limit when the relay rejects it', async () => {
    mocks.responsesCreate.mockRejectedValueOnce(Object.assign(new Error('400 Upstream request failed'), { status: 400 }));
    mocks.chatCreate
      .mockRejectedValueOnce(Object.assign(new Error('Unsupported parameter: max_output_tokens'), { status: 400 }))
      .mockResolvedValueOnce({
        id: 'chat_recovered', model: 'gpt-5.6-terra',
        choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

    const result = await chatWithAIKey('relay', [{ role: 'user', content: 'ping' }]);

    expect(mocks.chatCreate).toHaveBeenCalledTimes(2);
    expect(mocks.chatCreate.mock.calls[0][0]).toMatchObject({ max_tokens: 1_500 });
    expect(mocks.chatCreate.mock.calls[1][0]).not.toHaveProperty('max_tokens');
    expect(result).toMatchObject({
      message: 'OK',
      apiMode: 'chat.completions',
      fallbackReason: 'responses_upstream_request_failed;chat_token_limit_removed',
    });
  });

  it('uses the legacy Chat path directly when GPT optimization is disabled', async () => {
    mocks.getSnapshot.mockResolvedValueOnce({
      ...credential,
      gptOptimization: { ...credential.gptOptimization, enabled: false },
    });
    await expect(chatWithAIKey('relay', [{ role: 'user', content: '你好' }]))
      .resolves.toMatchObject({ apiMode: 'chat.completions', fallbackReason: undefined });
    expect(mocks.responsesCreate).not.toHaveBeenCalled();
  });

  it('uses an explicitly configured Responses protocol even when GPT optimization is disabled', async () => {
    credential.apiProtocol = 'responses';
    mocks.getSnapshot.mockResolvedValueOnce({
      ...credential,
      gptOptimization: { ...credential.gptOptimization, enabled: false },
    });

    await expect(chatWithAIKey('relay', [{ role: 'user', content: 'ping' }]))
      .resolves.toMatchObject({ apiMode: 'responses', message: '第二次回答' });
    expect(mocks.responsesCreate).toHaveBeenCalledTimes(1);
    expect(mocks.chatCreate).not.toHaveBeenCalled();
  });

  it('auto-recovers a Chat upstream-forbidden response through Responses without retrying Chat', async () => {
    mocks.getSnapshot.mockResolvedValueOnce({
      ...credential,
      gptOptimization: { ...credential.gptOptimization, enabled: false },
    });
    mocks.chatCreate.mockRejectedValueOnce(Object.assign(new Error('502 Upstream access forbidden'), {
      status: 502,
      error: { message: 'Upstream access forbidden, please contact administrator' },
    }));

    const result = await chatWithAIKey('relay', [{ role: 'user', content: 'ping' }]);

    expect(result).toMatchObject({
      apiMode: 'responses',
      fallbackReason: 'chat_upstream_forbidden;responses_auto_recovery',
    });
    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
    expect(mocks.responsesCreate).toHaveBeenCalledTimes(1);
  });

  it('retries transient Chat failures but not deterministic client errors', async () => {
    mocks.getSnapshot.mockResolvedValue({
      ...credential,
      apiProtocol: 'chat.completions',
      gptOptimization: { ...credential.gptOptimization, enabled: false },
    });
    mocks.chatCreate
      .mockRejectedValueOnce(Object.assign(new Error('503 unavailable'), { status: 503 }))
      .mockResolvedValueOnce({
        id: 'chat_recovered', model: 'gpt-chat-route',
        choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
      });
    await expect(chatWithAIKey('relay', [{ role: 'user', content: 'ping' }]))
      .resolves.toMatchObject({ message: 'recovered', apiMode: 'chat.completions' });
    expect(mocks.chatCreate).toHaveBeenCalledTimes(2);

    mocks.chatCreate.mockReset();
    mocks.chatCreate.mockRejectedValueOnce(Object.assign(new Error('400 invalid request'), { status: 400 }));
    await expect(chatWithAIKey('relay', [{ role: 'user', content: 'ping' }]))
      .rejects.toThrow('400 invalid request');
    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
  });

  it('does not apply GPT token compatibility retries when GPT optimization is disabled', async () => {
    mocks.getSnapshot.mockResolvedValueOnce({
      ...credential,
      gptOptimization: { ...credential.gptOptimization, enabled: false },
    });
    mocks.chatCreate.mockRejectedValueOnce(Object.assign(new Error('Unsupported parameter: max_output_tokens'), { status: 400 }));

    await expect(chatWithAIKey('relay', [{ role: 'user', content: '你好' }]))
      .rejects.toThrow('Unsupported parameter: max_output_tokens');
    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
  });
});
