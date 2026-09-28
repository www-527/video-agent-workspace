import { describe, expect, it } from 'vitest';
import { createFreeContentAnchor } from '@/lib/ai/content-anchor';

describe('GPT-free content anchor', () => {
  it('uses the existing title and core message without introducing a new story template', () => {
    expect(createFreeContentAnchor({
      title: '一款 AI 学习助手，如何从一个想法做到 10 万用户？',
      creativeBrief: {
        targetAudience: '学习者',
        viewerPainPoint: '学习计划难以坚持',
        valuePromise: '理解增长路径',
        coreMessage: '从真实痛点出发、快速验证并持续复盘，才会形成增长。',
        hook: { type: 'question', text: '它如何做到 10 万用户？' },
        proofPlan: '案例',
        cta: '复盘',
      },
    })).toEqual({
      topic: '一款 AI 学习助手，如何从一个想法做到 10 万用户？',
      coreMessage: '从真实痛点出发、快速验证并持续复盘，才会形成增长。',
    });
  });

  it('honors an existing anchor and falls back to the title when the brief is unavailable', () => {
    expect(createFreeContentAnchor({
      title: 'LLM 怎样学会完成任务',
      freeContentAnchor: { topic: 'LLM 学习任务', coreMessage: '从反馈中改善下一次输出。' },
    })).toEqual({ topic: 'LLM 学习任务', coreMessage: '从反馈中改善下一次输出。' });

    expect(createFreeContentAnchor({ title: 'LLM 怎样学会完成任务' })).toEqual({
      topic: 'LLM 怎样学会完成任务',
      coreMessage: 'LLM 怎样学会完成任务',
    });
  });
});
