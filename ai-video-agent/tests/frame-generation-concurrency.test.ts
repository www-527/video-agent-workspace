import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRAME_GENERATION_CONCURRENCY,
  resolveFrameGenerationConcurrency,
} from '@/lib/generation/frame-concurrency';

describe('frame generation concurrency', () => {
  it('uses two bounded workers for a full GPT-free generation by default', () => {
    expect(resolveFrameGenerationConcurrency({
      workflow: 'gpt-free', sampleOnly: false, targetFrameCount: 6,
    })).toBe(2);
  });

  it('never starts more workers than target frames', () => {
    expect(resolveFrameGenerationConcurrency({
      workflow: 'gpt-free', sampleOnly: false, targetFrameCount: 1,
    })).toBe(1);
    expect(resolveFrameGenerationConcurrency({
      workflow: 'gpt-free', sampleOnly: false, targetFrameCount: 0,
    })).toBe(0);
  });

  it('keeps first-frame samples serial even when five workers are configured', () => {
    expect(resolveFrameGenerationConcurrency({
      workflow: 'gpt-free', sampleOnly: true, targetFrameCount: 3, configuredGPTFreeConcurrency: '5',
    })).toBe(1);
  });

  it('supports every GPT-free concurrency setting from one to five', () => {
    const base = { workflow: 'gpt-free', sampleOnly: false, targetFrameCount: 8 };
    expect([1, 2, 3, 4, 5].map(configuredGPTFreeConcurrency => resolveFrameGenerationConcurrency({
      ...base,
      configuredGPTFreeConcurrency,
    }))).toEqual([1, 2, 3, 4, 5]);
  });

  it('never creates more workers than requested frames', () => {
    expect(resolveFrameGenerationConcurrency({
      workflow: 'gpt-free', sampleOnly: false, targetFrameCount: 3, configuredGPTFreeConcurrency: '5',
    })).toBe(3);
  });

  it('clamps unsafe GPT-free configuration and falls back for invalid values', () => {
    const base = { workflow: 'gpt-free', sampleOnly: false, targetFrameCount: 4 };
    expect(resolveFrameGenerationConcurrency({ ...base, configuredGPTFreeConcurrency: '9' })).toBe(4);
    expect(resolveFrameGenerationConcurrency({ ...base, configuredGPTFreeConcurrency: '0' })).toBe(1);
    expect(resolveFrameGenerationConcurrency({ ...base, configuredGPTFreeConcurrency: '-1' })).toBe(1);
    expect(resolveFrameGenerationConcurrency({ ...base, configuredGPTFreeConcurrency: 'two' }))
      .toBe(DEFAULT_FRAME_GENERATION_CONCURRENCY);
    expect(resolveFrameGenerationConcurrency({ ...base, configuredGPTFreeConcurrency: '   ' }))
      .toBe(DEFAULT_FRAME_GENERATION_CONCURRENCY);
    expect(resolveFrameGenerationConcurrency({ ...base, configuredGPTFreeConcurrency: '1.5' }))
      .toBe(DEFAULT_FRAME_GENERATION_CONCURRENCY);
  });
});
