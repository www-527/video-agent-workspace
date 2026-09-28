import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GPT_OPTIMIZATION,
  resolveProjectGPTOptimization,
} from '@/lib/gpt-optimization-settings';
import { selectReasoningEffort } from '@/lib/ai/providers/gpt-relay';

describe('GPT specialized optimization settings', () => {
  it('uses the recommended defaults and permits project override without enabling GPT', () => {
    expect(DEFAULT_GPT_OPTIMIZATION).toMatchObject({
      reasoningProfile: 'auto',
      creativeFreedom: 'balanced',
      internalImageSearch: true,
    });
    const disabled = resolveProjectGPTOptimization(
      { ...DEFAULT_GPT_OPTIMIZATION, enabled: false },
      { mode: 'override', reasoningProfile: 'quality', creativeFreedom: 'open', internalImageSearch: false },
    );
    expect(disabled.enabled).toBe(false);
    expect(disabled.reasoningProfile).toBe('auto');

    const enabled = resolveProjectGPTOptimization(
      { ...DEFAULT_GPT_OPTIMIZATION, enabled: true },
      { mode: 'override', reasoningProfile: 'quality', creativeFreedom: 'open', internalImageSearch: false },
    );
    expect(enabled).toMatchObject({ enabled: true, reasoningProfile: 'quality', creativeFreedom: 'open', internalImageSearch: false });
  });

  it('maps automatic reasoning by stage while fast and deep remain explicit', () => {
    const auto = { ...DEFAULT_GPT_OPTIMIZATION, enabled: true };
    expect(selectReasoningEffort(auto, '意图识别')).toBe('low');
    expect(selectReasoningEffort(auto, '研究规划')).toBe('medium');
    expect(selectReasoningEffort(auto, '编导规划')).toBe('high');
    expect(selectReasoningEffort(auto, 'HTML 视觉合成')).toBe('medium');
    expect(selectReasoningEffort(auto, '质量审校')).toBe('high');
    expect(selectReasoningEffort(auto, '简单格式修复')).toBe('low');
    expect(selectReasoningEffort({ ...auto, reasoningProfile: 'fast' }, '质量审校')).toBe('low');
    expect(selectReasoningEffort({ ...auto, reasoningProfile: 'quality' }, '简单格式修复')).toBe('high');
  });
});
