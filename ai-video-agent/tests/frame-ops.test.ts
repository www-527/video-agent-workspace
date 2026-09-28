import { describe, it, expect } from 'vitest';
import { deleteFrameFromOutline, insertFrameIntoOutline, isCompleteHtmlFrameUpdate, isFreshFrameGenerationRequest, isMajorRewriteRequest, isSubstantiallyDifferentFrameUpdate, realignVideoSource } from '@/lib/ai/frame-ops';
import type { FrameOutline, Outline, VideoSource } from '@/types';

function makeFrame(id: string, index: number, title: string): FrameOutline {
  return { id, index, title, narration: `${title} 旁白` };
}

function makeOutline(frames: FrameOutline[]): Outline {
  return { title: 't', totalDuration: 30, frames };
}

describe('insertFrameIntoOutline', () => {
  it('在末尾插入（afterIndex = total）', () => {
    const outline = makeOutline([makeFrame('a', 1, 'A'), makeFrame('b', 2, 'B')]);
    const { outline: out, insertAt } = insertFrameIntoOutline(
      outline,
      makeFrame('c', 0, 'C'),
      2,
    );
    expect(insertAt).toBe(2);
    expect(out.frames.map(f => f.title)).toEqual(['A', 'B', 'C']);
    // 重新编号 1-based
    expect(out.frames.map(f => f.index)).toEqual([1, 2, 3]);
  });

  it('在中间插入（afterIndex = 1）', () => {
    const outline = makeOutline([makeFrame('a', 1, 'A'), makeFrame('b', 2, 'B')]);
    const { outline: out, insertAt } = insertFrameIntoOutline(
      outline,
      makeFrame('c', 0, 'C'),
      1,
    );
    expect(insertAt).toBe(1);
    expect(out.frames.map(f => f.title)).toEqual(['A', 'C', 'B']);
    expect(out.frames.map(f => f.index)).toEqual([1, 2, 3]);
  });

  it('在最前插入（afterIndex = 0）', () => {
    const outline = makeOutline([makeFrame('a', 1, 'A'), makeFrame('b', 2, 'B')]);
    const { outline: out, insertAt } = insertFrameIntoOutline(
      outline,
      makeFrame('c', 0, 'C'),
      0,
    );
    expect(insertAt).toBe(0);
    expect(out.frames.map(f => f.title)).toEqual(['C', 'A', 'B']);
    expect(out.frames.map(f => f.index)).toEqual([1, 2, 3]);
  });

  it('越界的 afterIndex 会被夹紧', () => {
    const outline = makeOutline([makeFrame('a', 1, 'A')]);
    const { insertAt } = insertFrameIntoOutline(
      outline,
      makeFrame('c', 0, 'C'),
      999,
    );
    expect(insertAt).toBe(1);
  });

  it('保留原有 frame 的 id / narration / prompt 字段', () => {
    const outline = makeOutline([makeFrame('a', 1, 'A'), makeFrame('b', 2, 'B')]);
    const { outline: out } = insertFrameIntoOutline(
      outline,
      { id: 'c', index: 0, title: 'C', narration: 'C 旁白', imagePrompt: 'img' },
      1,
    );
    expect(out.frames[1]).toMatchObject({ id: 'c', title: 'C', imagePrompt: 'img' });
  });
});

describe('realignVideoSource', () => {
  it('缺失的 frame 位置补 {id}', () => {
    const outline = makeOutline([makeFrame('a', 1, 'A'), makeFrame('b', 2, 'B'), makeFrame('c', 3, 'C')]);
    const vs: VideoSource = { frames: [{ id: 'a', imagePath: '/a.png' }] };
    const aligned = realignVideoSource(outline, vs);
    expect(aligned.frames.length).toBe(3);
    expect(aligned.frames[0]).toEqual({ id: 'a', imagePath: '/a.png' });
    expect(aligned.frames[1]).toEqual({ id: 'b' });
    expect(aligned.frames[2]).toEqual({ id: 'c' });
  });

  it('多余的 frame 被丢弃', () => {
    const outline = makeOutline([makeFrame('a', 1, 'A')]);
    const vs: VideoSource = { frames: [{ id: 'a' }, { id: 'x' }, { id: 'y' }] };
    const aligned = realignVideoSource(outline, vs);
    expect(aligned.frames.length).toBe(1);
    expect(aligned.frames[0]).toEqual({ id: 'a' });
  });

  it('按 outline 顺序排列', () => {
    const outline = makeOutline([makeFrame('a', 1, 'A'), makeFrame('b', 2, 'B'), makeFrame('c', 3, 'C')]);
    const vs: VideoSource = { frames: [{ id: 'b' }, { id: 'a' }, { id: 'c' }] };
    const aligned = realignVideoSource(outline, vs);
    expect(aligned.frames.map(f => f.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('deleteFrameFromOutline', () => {
  it('删除指定分镜并重新编号', () => {
    const outline = makeOutline([makeFrame('a', 1, 'A'), makeFrame('b', 2, 'B'), makeFrame('c', 3, 'C')]);
    const { outline: out, deletedFrame, deleteAt } = deleteFrameFromOutline(outline, 2);

    expect(deleteAt).toBe(1);
    expect(deletedFrame.id).toBe('b');
    expect(out.frames.map(f => f.id)).toEqual(['a', 'c']);
    expect(out.frames.map(f => f.index)).toEqual([1, 2]);
  });

  it('同步 script / beats / chapters', () => {
    const outline: Outline = {
      ...makeOutline([makeFrame('a', 1, 'A'), makeFrame('b', 2, 'B'), makeFrame('c', 3, 'C')]),
      chapters: [{ id: 'chapter-1', title: '章节', purpose: '测试', beatIds: ['beat-a', 'beat-b', 'beat-c'] }],
      beats: [
        { id: 'beat-a', chapterId: 'chapter-1', order: 1, narration: 'A 旁白', purpose: 'A', frameId: 'a' },
        { id: 'beat-b', chapterId: 'chapter-1', order: 2, narration: 'B 旁白', purpose: 'B', frameId: 'b' },
        { id: 'beat-c', chapterId: 'chapter-1', order: 3, narration: 'C 旁白', purpose: 'C', frameId: 'c' },
      ],
    };

    const { outline: out } = deleteFrameFromOutline(outline, 2);

    expect(out.script).toBe('A 旁白\nC 旁白');
    expect(out.beats?.map(beat => ({ id: beat.id, order: beat.order, frameId: beat.frameId }))).toEqual([
      { id: 'beat-a', order: 1, frameId: 'a' },
      { id: 'beat-c', order: 2, frameId: 'c' },
    ]);
    expect(out.chapters?.[0].beatIds).toEqual(['beat-a', 'beat-c']);
  });

  it('配合 realignVideoSource 清理被删除分镜媒体', () => {
    const outline = makeOutline([makeFrame('a', 1, 'A'), makeFrame('b', 2, 'B'), makeFrame('c', 3, 'C')]);
    const vs: VideoSource = {
      frames: [
        { id: 'a', imagePath: '/a.png' },
        { id: 'b', imagePath: '/b.png' },
        { id: 'c', imagePath: '/c.png' },
      ],
    };

    const { outline: out } = deleteFrameFromOutline(outline, 2);
    const aligned = realignVideoSource(out, vs);

    expect(aligned.frames).toEqual([
      { id: 'a', imagePath: '/a.png' },
      { id: 'c', imagePath: '/c.png' },
    ]);
  });
});

describe('isCompleteHtmlFrameUpdate', () => {
  it('rejects a truncated visual intent and empty scene spec', () => {
    expect(isCompleteHtmlFrameUpdate({
      htmlPrompt: '主角：一个红色禁止符覆盖的',
      sceneSpec: {} as any,
    })).toBe(false);
  });

  it('accepts a complete html-native visual plan', () => {
    expect(isCompleteHtmlFrameUpdate({
      htmlPrompt: '先展示从业务痛点出发的一条单向路径，路径经过流程重塑后连接匹配的 AI 能力，最后稳定停在结果节点；标题显示“场景先行，技术后置”。',
      sceneSpec: {
        relationship: 'process',
        focus: '场景先行而非系统先行',
        revealStrategy: 'sequence',
        focalElement: '业务痛点到AI能力的单向路径',
        composition: 'turn',
        actionSemantics: '业务痛点经过流程重塑后连接匹配的AI能力',
        assetStrategy: 'css-svg',
        informationPool: ['先梳理业务痛点', '先重塑流程', '最后匹配AI能力'],
        visualIntent: '观众理解AI落地必须从场景和流程出发',
        screenText: ['场景先行', '技术后置'],
        assetHints: [],
        durationHint: 7,
        prohibitedPatterns: ['卡片墙', 'emoji'],
      },
    })).toBe(true);
  });
});

describe('major rewrite protection', () => {
  const current: FrameOutline = {
    id: '5', index: 5, title: '误区三：先买系统再落地',
    narration: '以为采购AI系统就能自动转型，结果系统堆成山，业务纹丝不动。正确做法是先诊断业务痛点，再设计流程，最后匹配AI能力。',
    htmlPrompt: '主角：写有采购AI系统的盒子被红叉覆盖；关系：业务痛点到流程重塑再到匹配AI的绿色箭头；屏幕短词：买系统≠转型 / 场景先行',
  };

  it('recognizes the UI major-rewrite request', () => {
    expect(isMajorRewriteRequest('请基于当前草稿大改一版，不要只做轻微润色。')).toBe(true);
  });

  it('recognizes a blank replacement request', () => {
    expect(isFreshFrameGenerationRequest('请将第 3 镜作为一片空白的新镜头重新生成，并复用首次生成链路。')).toBe(true);
  });

  it('rejects a cosmetic rewrite that retains the old narration and visual structure', () => {
    expect(isSubstantiallyDifferentFrameUpdate(current, {
      narration: '第三个致命误区：以为采购AI系统就能自动转型，结果系统堆成山，业务纹丝不动。正确做法是先诊断业务痛点，再设计流程，最后匹配AI能力。',
      htmlPrompt: '主角：写有采购AI系统的盒子被红叉覆盖；关系：业务痛点到流程重塑再到匹配AI的绿色箭头；屏幕短词：买系统≠转型 / 场景先行 / 流程重塑',
    }, 'html')).toBe(false);
  });

  it('accepts a new narrative angle and a new HTML visual metaphor', () => {
    expect(isSubstantiallyDifferentFrameUpdate(current, {
      title: '流程先行而非工具先行',
      narration: 'AI项目最常见的浪费，是把预算先投进工具清单。只有先跑通一个具体业务环节、量化结果，系统选择才有意义。',
      htmlPrompt: '主角：卡住的客户投诉处理传送带；关系：工具弹窗淡出后，团队先清除流程堵点，再把AI模块嵌入关键节点；屏幕短词：先解业务题 / 再选AI',
    }, 'html')).toBe(true);
  });

  it('rejects the same focal subject even when the wording changes', () => {
    const withSpec: FrameOutline = {
      ...current,
      sceneSpec: {
        relationship: 'metric', focus: '采购投入', revealStrategy: 'single',
        focalElement: '采购 AI 系统的方盒', composition: 'establish',
        actionSemantics: '方盒从底部升起并被强调', assetStrategy: 'css-svg',
        informationPool: ['采购不等于转型'], visualIntent: '说明采购误区', screenText: [],
        assetHints: ['盒子'], durationHint: 6, prohibitedPatterns: [],
      },
    };
    expect(isSubstantiallyDifferentFrameUpdate(withSpec, {
      title: '工具采购并非答案',
      narration: '预算花在软件清单上，并不会自动改变业务；真正的起点是先验证流程中的具体结果。',
      htmlPrompt: '主角：承载 AI 系统的盒体；关系：容器向上抬升后停在焦点；屏幕文字：仅标题',
      sceneSpec: {
        ...withSpec.sceneSpec!,
        focalElement: '承载 AI 系统的盒体',
        actionSemantics: '容器向上抬升后停在焦点',
        composition: 'resolve',
        assetStrategy: 'icon',
      },
    }, 'html')).toBe(false);
  });
});
