import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyProjectAIContext,
  applyProjectGPTOptimizationOverride,
  getCurrentAIKeySnapshot,
  getCurrentAITransportPolicy,
  runWithAIKeySnapshot,
} from '@/lib/ai-key-context';
import type { AIKeySnapshot } from '@/lib/ai-key-store';

const first: AIKeySnapshot = {
  id: 'first',
  name: '第一条',
  apiKey: 'sk-first',
  model: 'model-first',
  baseURL: 'https://first.example/v1',
  apiProtocol: 'auto',
  source: 'saved',
  gptOptimization: { enabled: false, useResponsesAPI: true, allowChatFallback: true, reasoningProfile: 'balanced', creativeFreedom: 'balanced', internalImageSearch: true },
};
const second: AIKeySnapshot = {
  id: 'second',
  name: '第二条',
  apiKey: 'sk-second',
  model: 'model-second',
  baseURL: 'https://second.example/v1',
  apiProtocol: 'auto',
  source: 'saved',
  gptOptimization: { enabled: false, useResponsesAPI: true, allowChatFallback: true, reasoningProfile: 'balanced', creativeFreedom: 'balanced', internalImageSearch: true },
};

afterEach(() => vi.restoreAllMocks());

describe('AI key task context', () => {
  it('keeps the same snapshot throughout an asynchronous task', async () => {
    await runWithAIKeySnapshot(first, async () => {
      expect(getCurrentAIKeySnapshot()).toBe(first);
      expect(getCurrentAITransportPolicy()).toBe('gpt-free-codex');
      await Promise.resolve();
      expect(getCurrentAIKeySnapshot()).toBe(first);
    });
    expect(getCurrentAIKeySnapshot()).toBeUndefined();
  });

  it('isolates concurrent tasks using different keys', async () => {
    const [firstResult, secondResult] = await Promise.all([
      runWithAIKeySnapshot(first, async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return getCurrentAIKeySnapshot()?.apiKey;
      }),
      runWithAIKeySnapshot(second, async () => {
        await Promise.resolve();
        return getCurrentAIKeySnapshot()?.apiKey;
      }),
    ]);

    expect(firstResult).toBe('sk-first');
    expect(secondResult).toBe('sk-second');
  });

  it('uses the active Key Manager configuration for GPT-free project requests', async () => {
    await runWithAIKeySnapshot(second, async () => {
      const configured = await applyProjectAIContext('gpt-free');

      expect(configured).toEqual(expect.objectContaining({
        id: second.id,
        model: second.model,
        gptOptimization: expect.objectContaining({ enabled: true, creativeFreedom: 'open' }),
      }));
      expect(getCurrentAIKeySnapshot()).toBe(configured);
      expect(getCurrentAITransportPolicy()).toBe('gpt-free-codex');
    });

    expect(getCurrentAITransportPolicy()).toBe('gpt-free-codex');
  });

  it('preserves GPT-free policy when applying a project optimization override', async () => {
    await runWithAIKeySnapshot(second, async () => {
      await applyProjectAIContext('gpt-free');
      const updated = applyProjectGPTOptimizationOverride({ mode: 'override', reasoningProfile: 'fast' });

      expect(updated?.gptOptimization.reasoningProfile).toBe('fast');
      expect(getCurrentAITransportPolicy()).toBe('gpt-free-codex');
    });
  });
});
