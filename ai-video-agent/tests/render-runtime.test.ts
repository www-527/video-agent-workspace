import { describe, expect, it } from 'vitest';
import { inferMaxConcurrentScenes } from '@/lib/render/runtime';
import { runBoundedTasks } from '@/lib/render/scheduler';

describe('render runtime policy', () => {
  it('uses conservative automatic concurrency', () => {
    expect(inferMaxConcurrentScenes({ logicalCores: 4, freeMemoryBytes: 16 * 1024 ** 3 })).toBe(1);
    expect(inferMaxConcurrentScenes({ logicalCores: 16, freeMemoryBytes: 4 * 1024 ** 3 })).toBe(1);
    expect(inferMaxConcurrentScenes({ logicalCores: 8, freeMemoryBytes: 8 * 1024 ** 3 })).toBe(2);
  });

  it('clamps explicit concurrency to the supported safety range', () => {
    expect(inferMaxConcurrentScenes({ logicalCores: 2, freeMemoryBytes: 1024, configured: 3 })).toBe(3);
    expect(inferMaxConcurrentScenes({ logicalCores: 64, freeMemoryBytes: 64 * 1024 ** 3, configured: 99 })).toBe(4);
  });
});

describe('bounded render scheduler', () => {
  it('never exceeds the requested concurrency and processes every item', async () => {
    let active = 0;
    let peak = 0;
    const completed: number[] = [];
    await runBoundedTasks({
      items: [0, 1, 2, 3, 4, 5],
      concurrency: 2,
      worker: async item => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 2));
        completed.push(item);
        active -= 1;
      },
    });
    expect(peak).toBe(2);
    expect(completed.sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
