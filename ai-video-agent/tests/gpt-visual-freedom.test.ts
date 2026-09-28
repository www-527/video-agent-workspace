import { describe, expect, it } from 'vitest';
import {
  buildGPTVisualFreedomGuidance,
  withGPTVisualFreedom,
} from '@/lib/prompts/gpt-visual-freedom';

describe('GPT visual freedom overlay', () => {
  it('leaves the original prompt byte-for-byte unchanged when GPT optimization is disabled', () => {
    const original = 'DeepSeek 原始提示词\n- 外框 + 节点 + 连线';
    expect(withGPTVisualFreedom(original, 'director', false)).toBe(original);
  });

  it('adds high-priority creative freedom only when GPT optimization is enabled', () => {
    const result = withGPTVisualFreedom('原始提示词', 'director', true);
    expect(result).toContain('GPT 专项优化：开放式视觉创作层');
    expect(result).toContain('不要把“外框 + 节点 + 连线”当作默认答案');
    expect(result).toContain('程序内部搜图器');
    expect(result).toContain('assetRequest / assetSubjects');
  });

  it('keeps non-negotiable safety rules explicit while relaxing creative budgets', () => {
    const result = buildGPTVisualFreedomGuidance('html');
    expect(result).toContain('不覆盖事实准确性');
    expect(result).toContain('画布安全区');
    expect(result).toContain('软预算，不是创意禁令');
    expect(result).toContain('不要把 split 当成默认模板');
  });
});
