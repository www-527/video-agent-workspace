import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GPT_OPTIMIZATION } from '@/lib/gpt-optimization-settings';

const mocks = vi.hoisted(() => ({
  json: vi.fn(),
  text: vi.fn(),
  html: vi.fn(),
  getKey: vi.fn(),
}));

vi.mock('@/lib/ai-key-context', () => ({ getTaskAIKeySnapshot: mocks.getKey }));
vi.mock('@/lib/ai/providers/gpt-free-codex', () => ({
  callGPTFreeCodexJson: mocks.json,
  callGPTFreeCodexText: mocks.text,
  callGPTFreeCodexHtml: mocks.html,
  GPTFreeCodexOutputError: class GPTFreeCodexOutputError extends Error {},
}));

import { callAIHtml, callAIJson, callAIText } from '@/lib/ai/client';

describe('GPT-free stage reasoning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getKey.mockResolvedValue({
      id: 'test', name: 'test', apiKey: 'secret', model: 'gpt-test', baseURL: 'https://example.test',
      apiProtocol: 'responses', source: 'saved',
      gptOptimization: { ...DEFAULT_GPT_OPTIMIZATION, enabled: true, reasoningProfile: 'auto' },
    });
    mocks.json.mockResolvedValue({ ok: true });
    mocks.text.mockResolvedValue('ok');
    mocks.html.mockResolvedValue({ output: '<html></html>', finishReason: 'completed', outputLength: 13, reasoningLength: 0, lengthLimited: false, emptyOutput: false });
  });

  it('maps low, medium and high stages before calling the GPT-free transport', async () => {
    await callAIJson({ system: 's', user: 'u', stage: '意图识别' });
    await callAIText({ system: 's', user: 'u', stage: '研究规划' });
    await callAIHtml({ system: 's', user: 'u', stage: '编导规划' });
    expect(mocks.json.mock.calls[0][0].reasoningEffort).toBe('low');
    expect(mocks.text.mock.calls[0][0].reasoningEffort).toBe('medium');
    expect(mocks.html.mock.calls[0][0].reasoningEffort).toBe('high');
  });

  it('lets visual repair explicitly stay medium', async () => {
    await callAIHtml({ system: 's', user: 'u', stage: 'AI 画面自检修复', reasoningEffort: 'medium' });
    expect(mocks.html.mock.calls[0][0].reasoningEffort).toBe('medium');
  });
});
