import { describe, expect, it } from 'vitest';
import { buildIntentUserPrompt, INTENT_SYSTEM_PROMPT } from '@/lib/prompts/intent';
import { normalizeOutline, OUTLINE_SYSTEM_HTML, OUTLINE_SYSTEM_IMAGE } from '@/lib/prompts/outline';

describe('buildIntentUserPrompt', () => {
  it('无大纲时正确提示', () => {
    const prompt = buildIntentUserPrompt({
      userInput: '帮我做一个视频',
      hasOutline: false,
      frameCount: 0,
      frameTitles: [],
    });
    expect(prompt).toContain('还没有大纲');
    expect(prompt).toContain('帮我做一个视频');
  });

  it('有大纲时列出分镜标题', () => {
    const prompt = buildIntentUserPrompt({
      userInput: '重新生成',
      hasOutline: true,
      frameCount: 2,
      frameTitles: ['介绍', '总结'],
    });
    expect(prompt).toContain('介绍');
    expect(prompt).toContain('总结');
    expect(prompt).toContain('重新生成');
  });
});

describe('INTENT_SYSTEM_PROMPT', () => {
  it('distinguishes local tune requests from larger frame regeneration', () => {
    expect(INTENT_SYSTEM_PROMPT).toContain('"tune_frame"');
    expect(INTENT_SYSTEM_PROMPT).toContain('第 9 镜钟摆往上一点');
    expect(INTENT_SYSTEM_PROMPT).toContain('第 4 镜字幕下移一点');
    expect(INTENT_SYSTEM_PROMPT).toContain('第 3 镜旁白加年份');
    expect(INTENT_SYSTEM_PROMPT).toContain('第 9 镜改成爱因斯坦照片墙');
  });
});

describe('normalizeOutline', () => {
  it('补齐缺失字段', () => {
    const out = normalizeOutline({ title: '', frames: [] });
    expect(out.title).toBe('未命名视频');
    expect(out.totalDuration).toBe(60);
    expect(out.frames).toEqual([]);
  });

  it('给分镜补 uuid 和 index', () => {
    const out = normalizeOutline({
      title: '测试',
      totalDuration: 30,
      frames: [{ title: 'A', narration: '旁白' }] as any,
    });
    expect(out.frames).toHaveLength(1);
    expect(out.frames[0].id).toBeTruthy();
    expect(out.frames[0].index).toBe(1);
    expect(out.frames[0].title).toBe('测试');
  });

  it('把纯编导标签替换为旁白中的观众标题', () => {
    const out = normalizeOutline({
      title: 'AI 转型',
      frames: [{
        title: '认知冲突开场',
        narration: '今年所有老板都在谈 AI 转型，但多数公司一开始就做错了。',
      }] as any,
    });

    expect(out.frames[0].title).toBe('AI 转型');
  });

  it('保留包含结构词但实际描述内容的标题', () => {
    const out = normalizeOutline({
      title: '测试',
      frames: [
        { title: '首镜', narration: '旁白' },
        { title: '转折之后，AI预算去了哪里', narration: '旁白' },
      ] as any,
    });

    expect(out.frames[1].title).toBe('转折之后，AI预算去了哪里');
  });
});

describe('nested chapter beat recovery', () => {
  it('recovers frames when a model nests beats inside chapters', () => {
    const out = normalizeOutline({
      title: '手机怎么工作',
      chapters: [{
        id: 'chapter-1', title: '通信', narrativeFunction: '解释通信原理',
        beats: [{ id: 'beat-1', duration: 8, voiceover: '手机先处理通信数据。', visual: '基带处理数据流', onScreenText: '通信数据' }],
      }] as any,
      beats: [],
      frames: [],
    });

    expect(out.frames).toHaveLength(1);
    expect(out.frames[0]).toMatchObject({ index: 1, title: '手机怎么工作', narration: '手机先处理通信数据。', htmlPrompt: '基带处理数据流' });
    expect(out.beats).toMatchObject([{ chapterId: 'chapter-1', frameId: out.frames[0].id }]);
    expect(out.chapters).toMatchObject([{ id: 'chapter-1', beatIds: ['beat-1'] }]);
  });

  it('normalizes object-shaped creative brief text fields from compatible models', () => {
    const out = normalizeOutline({
      title: '测试', frames: [{ narration: '旁白' }] as any,
      creativeBrief: {
        targetAudience: '普通观众', viewerPainPoint: '不了解原理', valuePromise: '了解原理', coreMessage: '核心信息',
        hook: { type: 'question', text: '为什么？' }, proofPlan: '用例子说明', cta: { text: '检查一次设置' },
      } as any,
    });

    expect(out.creativeBrief?.cta).toBe('检查一次设置');
  });
});

describe('outline title contract', () => {
  it('要求两种模式都生成面向观众的标题', () => {
    for (const prompt of [OUTLINE_SYSTEM_IMAGE, OUTLINE_SYSTEM_HTML]) {
      expect(prompt).toContain('面向观众的内容标题');
      expect(prompt).toContain('编导标签');
      expect(prompt).toContain('beat purpose');
      expect(prompt).toContain('frames[0].title');
    }
  });
});
