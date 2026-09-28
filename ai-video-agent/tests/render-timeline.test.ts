import { describe, expect, it } from 'vitest';
import { buildSceneTimeline, buildSrt, formatSrtTime } from '@/lib/render/timeline';

describe('offline render timeline', () => {
  it('quantizes every scene to the nearest frame and keeps one shared cursor', () => {
    const timeline = buildSceneTimeline([
      { id: 'a', durationMs: 1_010 },
      { id: 'b', durationMs: 2_040 },
    ], 30);
    expect(timeline[0]).toMatchObject({ frameCount: 30, startMs: 0, endMs: 1_000 });
    expect(timeline[1].frameCount).toBe(61);
    expect(timeline[1].startMs).toBe(timeline[0].endMs);
    expect(Math.abs(timeline[1].durationMs - 2_033.333)).toBeLessThan(0.01);
  });

  it('generates global SRT cues from the exact same scene boundaries', () => {
    const timeline = buildSceneTimeline([
      { id: 'a', durationMs: 1_000 },
      { id: 'b', durationMs: 2_000 },
    ]);
    const srt = buildSrt([
      { id: 'a', narration: '第一句。' },
      { id: 'b', narration: '第二句。' },
    ], timeline);
    expect(srt).toContain('00:00:00,000 --> 00:00:01,000');
    expect(srt).toContain('00:00:01,000 --> 00:00:03,000');
    expect(formatSrtTime(3_723_045)).toBe('01:02:03,045');
  });
});

