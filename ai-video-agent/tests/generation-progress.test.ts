import { describe, expect, it } from 'vitest';
import { aggregateProgressPercent, estimateRemainingSeconds, phaseProgressWeight, progressPercent, updateDurationHistory } from '@/lib/generation-progress';

describe('generation progress', () => {
  it('is monotonic across image phases and frames', () => {
    const values = [
      progressPercent('image', 2, 0, 'image'),
      progressPercent('image', 2, 0, 'image', true),
      progressPercent('image', 2, 0, 'tts', true),
      progressPercent('image', 2, 0, 'save', true),
      progressPercent('image', 2, 1, 'image'),
      progressPercent('image', 2, 1, 'save', true),
    ];
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('uses conservative defaults and converges with smoothed history', () => {
    const initial = estimateRemainingSeconds({ mode: 'html', total: 2, currentFrame: 1, phase: 'tts' });
    let history = updateDurationHistory({}, 'html', 'tts', 4);
    history = updateDurationHistory(history, 'html', 'tts', 6);
    expect(history.html?.tts).toBe(4.5);
    expect(estimateRemainingSeconds({ mode: 'html', total: 2, currentFrame: 1, phase: 'tts', history })).toBeLessThan(initial);
  });

  it('never returns a negative ETA', () => {
    expect(estimateRemainingSeconds({ mode: 'image', total: 1, currentFrame: 1, phase: 'image', phaseElapsedSeconds: 999 })).toBeGreaterThanOrEqual(0);
  });

  it('aggregates concurrent frame weights without depending on event order', () => {
    const progress = [phaseProgressWeight('html', 'html', true), phaseProgressWeight('html', 'tts', true)];
    const before = aggregateProgressPercent(progress, 2);
    progress[1] = phaseProgressWeight('html', 'save', true);
    expect(aggregateProgressPercent(progress, 2)).toBeGreaterThanOrEqual(before);
  });
});
