import { describe, expect, it } from 'vitest';
import {
  auditRequirementAlignment,
  calibrateOutlineSceneDurations,
  estimateNarrationSeconds,
  extractDurationRequirement,
  formatDurationRequirement,
  needsNarrationDurationCalibration,
  resolveRequestedDuration,
} from '@/lib/ai/user-requirements';
import type { Outline } from '@/types';

describe('用户视频要求', () => {
  it('解析精确时长、复合时长和时长区间', () => {
    expect(extractDurationRequirement('做一个90秒的法律科普视频')).toMatchObject({
      kind: 'exact', targetSeconds: 90, minSeconds: 90, maxSeconds: 90,
    });
    expect(extractDurationRequirement('控制在1分30秒')).toMatchObject({ kind: 'exact', targetSeconds: 90 });
    expect(extractDurationRequirement('视频时长 2-3 分钟')).toMatchObject({
      kind: 'range', minSeconds: 120, maxSeconds: 180,
    });
  });

  it('不把数量要求误判成时长', () => {
    expect(extractDurationRequirement('讲清楚3个条件，做8个分镜')).toBeNull();
    expect(extractDurationRequirement('explain 3 steps in one flow')).toBeNull();
  });

  it('把明确时长确定性写回大纲并对区间做夹取', () => {
    expect(resolveRequestedDuration(120, extractDurationRequirement('严格60秒'))).toBe(60);
    expect(resolveRequestedDuration(220, extractDurationRequirement('2到3分钟'))).toBe(180);
    expect(formatDurationRequirement(extractDurationRequirement('严格60秒'))).toContain('硬约束');
  });

  it('按计划时长检查内容密度和分镜密度', () => {
    const short = auditRequirementAlignment({
      userInput: '做一个90秒视频', totalDuration: 90, script: '一句很短的话。', frameCount: 2,
    });
    expect(short.join(' ')).toContain('内容密度不足');
    expect(short.join(' ')).toContain('分镜过少');
    expect(estimateNarrationSeconds('这是一个包含事实、解释和例子的完整句子。')).toBeGreaterThan(3);
  });

  it('只在口播明显偏离目标时长时请求校准，并把分镜播放预算精确分配给目标时长', () => {
    expect(needsNarrationDurationCalibration('这是一段很长的口播。'.repeat(80), 120)).toBe(true);
    expect(needsNarrationDurationCalibration('这是一段适中的口播。'.repeat(40), 120)).toBe(false);

    const outline = {
      title: '时长校准',
      totalDuration: 120,
      frames: Array.from({ length: 12 }, (_, index) => ({
        id: `frame-${index + 1}`,
        index: index + 1,
        title: `镜头 ${index + 1}`,
        narration: '这是一段用于测试时长分配的口播。'.repeat(index % 3 + 1),
        sceneSpec: { durationHint: 3 },
      })),
    } as unknown as Outline;
    const calibrated = calibrateOutlineSceneDurations(outline);
    const durations = calibrated.frames.map(frame => frame.sceneSpec!.durationHint);

    expect(durations.reduce((sum, duration) => sum + duration, 0)).toBe(120);
    expect(durations.every(duration => duration >= 3 && duration <= 20)).toBe(true);
    expect(calibrated.frames[2].sceneSpec!.durationHint).toBeGreaterThan(calibrated.frames[0].sceneSpec!.durationHint);
  });
});
