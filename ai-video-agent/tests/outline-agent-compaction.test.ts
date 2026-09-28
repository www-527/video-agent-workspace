import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callAIJson: vi.fn(),
  planResearchForPrompt: vi.fn(async () => ({
    shouldSearch: false,
    riskLevel: 'low',
    reason: '测试跳过研究',
    queries: [],
  })),
  executeResearchPlan: vi.fn(async () => null),
}));

vi.mock('@/lib/ai/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ai/client')>();
  return { ...actual, callAIJson: mocks.callAIJson };
});

vi.mock('@/lib/research', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/research')>();
  return {
    ...actual,
    planResearchForPrompt: mocks.planResearchForPrompt,
    executeResearchPlan: mocks.executeResearchPlan,
  };
});

import { generateOutline } from '@/lib/ai/outline';

const plannerOutline = {
  title: '精简链路',
  totalDuration: 8,
  script: '不是所有效率工具都能减少切换。先用这个方法找出真正拖慢你的步骤。现在就拿它检查一次流程。',
  creativeBrief: {
    targetAudience: '频繁切换工具的知识工作者',
    viewerPainPoint: '工作流被无效切换拖慢',
    valuePromise: '找出真正拖慢你的步骤',
    coreMessage: '先定位瓶颈，再选择工具',
    hook: { type: 'counterintuitive', text: '不是所有效率工具都能减少切换' },
    proofPlan: '用工作流检查步骤演示',
    cta: '现在就拿它检查一次流程',
  },
  frames: [{
    id: 'frame-1',
    index: 1,
    title: '第一镜',
    narration: '不是所有效率工具都能减少切换。先用这个方法找出真正拖慢你的步骤。现在就拿它检查一次流程。',
    imagePrompt: 'clean editorial illustration',
  }],
};

describe('compact outline agents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses one content planner call and one quality call on pass', async () => {
    mocks.callAIJson
      .mockResolvedValueOnce(plannerOutline)
      .mockResolvedValueOnce({ decision: 'pass', issues: [] });

    const result = await generateOutline('image', '生成一个简短视频');

    expect(result.frames[0].narration).toContain('不是所有效率工具');
    expect(result.creativeBrief?.valuePromise).toBe('找出真正拖慢你的步骤');
    expect(result.contentAudit?.hasActionableCta).toBe(true);
    expect(mocks.callAIJson).toHaveBeenCalledTimes(2);
    expect(mocks.callAIJson.mock.calls.map(call => call[0].stage))
      .toEqual(['内容规划 Agent', '内容质量 Agent']);
    expect(mocks.callAIJson.mock.calls[0][0]).toMatchObject({ timeoutMs: 240_000 });
    expect(mocks.callAIJson.mock.calls[0][0].system).toContain('强留存口播的内容规划方式');
    expect(mocks.callAIJson.mock.calls[1][0].system).toContain('结尾是否只有一个具体 CTA');
    expect(result.contentStyleTrace?.presetId).toBe('strong-retention');
  });

  it('accepts the corrected outline from the same quality response', async () => {
    mocks.callAIJson
      .mockResolvedValueOnce(plannerOutline)
      .mockResolvedValueOnce({
        decision: 'revise',
        issues: [{ code: 'REPETITION', severity: 'error', message: '旁白重复' }],
        correctedOutline: {
          ...plannerOutline,
          script: '修订旁白',
          frames: [{ ...plannerOutline.frames[0], narration: '修订旁白' }],
        },
      });

    const result = await generateOutline('image', '生成一个简短视频');

    expect(result.frames[0].narration).toBe('修订旁白');
    expect(mocks.callAIJson).toHaveBeenCalledTimes(2);
  });

  it('uses a project preset override in both agent prompts', async () => {
    mocks.callAIJson
      .mockResolvedValueOnce(plannerOutline)
      .mockResolvedValueOnce({ decision: 'pass', issues: [] });

    const result = await generateOutline('image', '讲一个创业故事', {
      contentStyle: { mode: 'override', presetId: 'story-narrative', customInstruction: '保留失败后的余味' },
    });

    expect(mocks.callAIJson.mock.calls[0][0].system).toContain('故事叙事的内容规划方式');
    expect(mocks.callAIJson.mock.calls[0][0].user).toContain('保留失败后的余味');
    expect(mocks.callAIJson.mock.calls[1][0].system).toContain('转折是否有铺垫');
    expect(result.contentStyleTrace?.presetId).toBe('story-narrative');
  });

  it('gives GPT-free planning the persisted Outline schema instead of a shots dialect', async () => {
    mocks.callAIJson
      .mockResolvedValueOnce(plannerOutline)
      .mockResolvedValueOnce({ decision: 'pass', issues: [] });

    await generateOutline('image', '生成一个简短视频', { workflow: 'gpt-free' });

    const plannerSystem = mocks.callAIJson.mock.calls[0][0].system as string;
    expect(plannerSystem).toContain('"frames"');
    expect(plannerSystem).toContain('"beats"');
    expect(plannerSystem).toContain('不要使用 chapters[].shots');
  });

  it('propagates cancellation instead of degrading to a successful outline', async () => {
    const controller = new AbortController();
    mocks.callAIJson.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });

    await expect(generateOutline('image', '生成一个简短视频', {
      abortSignal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.callAIJson).toHaveBeenCalledTimes(1);
  });

  it('retries a transient upstream abort before failing content planning', async () => {
    mocks.callAIJson
      .mockRejectedValueOnce(new Error('Request was aborted.'))
      .mockResolvedValueOnce(plannerOutline)
      .mockResolvedValueOnce({ decision: 'pass', issues: [] });

    const result = await generateOutline('image', '生成一个简短视频');

    expect(result.frames).toHaveLength(1);
    expect(mocks.callAIJson).toHaveBeenCalledTimes(3);
  });

  it('rejects an empty outline instead of saving a project with no next generation step', async () => {
    mocks.callAIJson.mockResolvedValueOnce({ title: '空大纲', totalDuration: 120, frames: [] });

    await expect(generateOutline('html', '做一个两分钟的视频'))
      .rejects.toThrow('内容规划未返回任何可用分镜');
  });

  it('repairs blank HTML visual prompts before returning the outline', async () => {
    const missingPromptOutline = {
      ...plannerOutline,
      frames: plannerOutline.frames.map(frame => ({ ...frame, imagePrompt: undefined, htmlPrompt: '' })),
    };
    mocks.callAIJson
      .mockResolvedValueOnce(missingPromptOutline)
      .mockResolvedValueOnce({ decision: 'pass', issues: [] })
      .mockResolvedValueOnce({ frames: [] })
      .mockResolvedValueOnce({
        frames: [{ index: 1, htmlPrompt: '画面中央是一条清晰的工作流，低效步骤以灰色堆叠。关键瓶颈被高亮并收束为一个可执行的检查动作。' }],
      });

    const result = await generateOutline('html', '生成一个简短的视频');

    expect(result.frames[0].htmlPrompt).toContain('工作流');
    expect(mocks.callAIJson.mock.calls.map(call => call[0].stage)).toEqual([
      '内容规划 Agent', '内容质量 Agent', '编导规划', '画面提示词补全',
    ]);
  });

  it('uses the prompt repair retry when the visual-director request fails', async () => {
    const missingPromptOutline = {
      ...plannerOutline,
      frames: plannerOutline.frames.map(frame => ({ ...frame, imagePrompt: undefined, htmlPrompt: '' })),
    };
    mocks.callAIJson
      .mockResolvedValueOnce(missingPromptOutline)
      .mockResolvedValueOnce({ decision: 'pass', issues: [] })
      .mockRejectedValueOnce(new Error('visual director timed out'))
      .mockResolvedValueOnce({
        frames: [{ index: 1, htmlPrompt: '整屏先呈现一个触控路径，触点变化沿着路径被依次读取。最终把感知信号收束为明确的位置结果。' }],
      });

    const result = await generateOutline('html', '生成一个简短的视频');

    expect(result.frames[0].htmlPrompt).toContain('触控路径');
    expect(mocks.callAIJson.mock.calls.map(call => call[0].stage)).toEqual([
      '内容规划 Agent', '内容质量 Agent', '编导规划', '画面提示词补全',
    ]);
  });

  it('rejects an HTML outline when prompt repair is still blank after its retry', async () => {
    const missingPromptOutline = {
      ...plannerOutline,
      frames: plannerOutline.frames.map(frame => ({ ...frame, imagePrompt: undefined, htmlPrompt: '' })),
    };
    mocks.callAIJson
      .mockResolvedValueOnce(missingPromptOutline)
      .mockResolvedValueOnce({ decision: 'pass', issues: [] })
      .mockResolvedValueOnce({ frames: [] })
      .mockResolvedValueOnce({ frames: [{ index: 1, htmlPrompt: '' }] })
      .mockResolvedValueOnce({ frames: [] });

    await expect(generateOutline('html', '生成一个简短的视频'))
      .rejects.toThrow('HTML 大纲画面提示词补全失败');
    expect(mocks.callAIJson.mock.calls.map(call => call[0].stage)).toEqual([
      '内容规划 Agent', '内容质量 Agent', '编导规划', '画面提示词补全', '画面提示词补全重试',
    ]);
  });
});
