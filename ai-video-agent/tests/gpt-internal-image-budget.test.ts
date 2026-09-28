import { describe, expect, it } from 'vitest';
import { runWithAIKeySnapshot } from '@/lib/ai-key-context';
import { applyGPTInternalSearchBudget } from '@/lib/ai/real-image-planner';
import type { AIKeySnapshot } from '@/lib/ai-key-store';
import type { SmartImagePlan } from '@/types';

const credential: AIKeySnapshot = {
  id: 'gpt', name: 'GPT', apiKey: 'secret', model: 'gpt', baseURL: 'https://relay.example/v1', source: 'saved',
  apiProtocol: 'auto',
  gptOptimization: {
    enabled: true, useResponsesAPI: true, allowChatFallback: true,
    reasoningProfile: 'auto', creativeFreedom: 'balanced', internalImageSearch: true,
  },
};

function plan(index: number): SmartImagePlan {
  return {
    frameId: `frame-${index}`, useRealImage: true, priority: 80, reason: 'requested', purpose: 'proof',
    query: `mcdonalds restaurant archive ${index}`, fallbackQueries: ['mcdonalds restaurant historical'],
    fallbackQuery: 'mcdonalds restaurant historical', subject: 'restaurant', composition: 'editorial-split',
    textPosition: 'left', imageMotion: 'static', visualGroup: 'archive', deadlineMs: 10_000,
    fidelity: index === 11 ? 'required' : 'preferred', fallbackPolicy: 'block',
    requirement: { attempt: index === 11 ? 'required' : 'optional', failurePolicy: index === 11 ? 'needs-review' : 'allow-native' },
    assetRequest: {
      query: `mcdonalds restaurant archive ${index}`, fallbackQueries: ['mcdonalds restaurant historical'],
      requiredTerms: ['mcdonalds'], optionalTerms: ['restaurant'], excludedTerms: [], subjectType: 'place',
      purpose: 'proof', imageRequired: index === 11,
    },
  };
}

describe('GPT internal image search budget', () => {
  it('limits each planned scene to two queries and the whole film to twenty', () => {
    const result = runWithAIKeySnapshot(credential, () => applyGPTInternalSearchBudget(Array.from({ length: 12 }, (_, index) => plan(index))));
    expect(result.filter(item => item.useRealImage)).toHaveLength(10);
    expect(result.slice(0, 10).every(item => item.fallbackQueries.length <= 1)).toBe(true);
    expect(result[11].useRealImage).toBe(false);
    expect(result[11].reason).toContain('待审核');
  });

  it('does not alter the same plans when GPT optimization is disabled', () => {
    const deepSeekCredential = { ...credential, gptOptimization: { ...credential.gptOptimization, enabled: false } };
    const input = Array.from({ length: 12 }, (_, index) => plan(index));
    const result = runWithAIKeySnapshot(deepSeekCredential, () => applyGPTInternalSearchBudget(input));
    expect(result).toBe(input);
    expect(result.every(item => item.useRealImage)).toBe(true);
  });
});
