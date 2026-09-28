import { describe, expect, it } from 'vitest';
import { classifyLocalFrameStructureIntent, classifyLocalFrameTuneIntent } from '@/lib/ai/intent';

describe('classifyLocalFrameStructureIntent', () => {
  it('recognizes a content-based split as two frames by default', () => {
    expect(classifyLocalFrameStructureIntent('把第4镜拆成误区2和3')).toMatchObject({
      action: 'split_frame',
      params: { frameIndex: 4, parts: 2 },
    });
  });

  it('recognizes explicit split counts', () => {
    expect(classifyLocalFrameStructureIntent('第 6 镜内容太多，拆成三镜')).toMatchObject({
      action: 'split_frame',
      params: { frameIndex: 6, parts: 3 },
    });
  });

  it('recognizes compact and ranged merge requests', () => {
    expect(classifyLocalFrameStructureIntent('把第4、5镜合并')).toMatchObject({
      action: 'merge_frames',
      params: { frameIndexes: [4, 5] },
    });
    expect(classifyLocalFrameStructureIntent('将第 7 镜到第 9 镜合成一镜')).toMatchObject({
      action: 'merge_frames',
      params: { frameIndexes: [7, 8, 9] },
    });
  });
});

describe('classifyLocalFrameTuneIntent', () => {
  it('routes local visual position changes to tune_frame', () => {
    expect(classifyLocalFrameTuneIntent('第 9 镜钟摆往上一点')).toMatchObject({
      action: 'tune_frame',
      params: { frameIndex: 9 },
    });
    expect(classifyLocalFrameTuneIntent('第 4 镜字幕下移一点')).toMatchObject({
      action: 'tune_frame',
      params: { frameIndex: 4 },
    });
  });

  it('does not route content changes to tune_frame', () => {
    expect(classifyLocalFrameTuneIntent('第 9 镜改成爱因斯坦照片墙')).toBeNull();
    expect(classifyLocalFrameTuneIntent('第 3 镜旁白加年份')).toBeNull();
  });

  it('routes deletion of one local element to tune_frame but keeps whole-frame deletion separate', () => {
    expect(classifyLocalFrameTuneIntent('删除第 3 镜右下角的橙色标签')).toMatchObject({
      action: 'tune_frame',
      params: { frameIndex: 3 },
    });
    expect(classifyLocalFrameTuneIntent('删除第 3 镜')).toBeNull();
  });
});
