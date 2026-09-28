import { describe, expect, it } from 'vitest';
import { appendFrameRepairHistory } from '@/lib/frame-repair-history';
import { getQualitySeverity, isBlockingQualityIssue, isQualityRepairRunActive } from '@/lib/quality/quality-ui';
import type { FrameRepairHistoryEntry, VideoSource } from '@/types';

describe('quality severity and repair history', () => {
  it.each([
    'auditing',
    'sampling',
    'optimizing',
    'visual_repairing',
    'terminal_verifying',
    'sampling_recheck',
    'saving',
    'cancelling',
  ] as const)('treats %s as an active repair run', status => {
    expect(isQualityRepairRunActive(status)).toBe(true);
  });

  it.each([
    'passed',
    'saved',
    'needs_review',
    'unchanged',
    'unavailable',
    'cancelled',
    'failed',
  ] as const)('treats %s as a terminal repair run', status => {
    expect(isQualityRepairRunActive(status)).toBe(false);
  });

  it('treats an absent repair run as inactive', () => {
    expect(isQualityRepairRunActive(undefined)).toBe(false);
  });

  it('treats only critical issues as export blockers', () => {
    expect(isBlockingQualityIssue({ code: 'low_contrast', label: 'Contrast', detail: 'Low', severity: 'major' })).toBe(false);
    expect(getQualitySeverity({ code: 'clipped', label: 'Clip', detail: 'Outside', severity: 'critical' })).toBe('blocking');
  });

  it('appends restores without deleting the audit chain', () => {
    const first: FrameRepairHistoryEntry = {
      id: 'repair-1', frameId: 'f1', beforeHtml: '<div>a</div>', afterHtml: '<div>b</div>',
      summary: 'auto repair', source: 'auto-repair', createdAt: '2026-01-01T00:00:00.000Z',
    };
    const restored: FrameRepairHistoryEntry = {
      id: 'restore-1', frameId: 'f1', beforeHtml: '<div>b</div>', afterHtml: '<div>a</div>',
      summary: 'restore', source: 'restore', restoreOfId: 'repair-1', createdAt: '2026-01-01T00:01:00.000Z',
    };
    const source: VideoSource = { frames: [], repairHistory: [first] };
    expect(appendFrameRepairHistory(source, restored).repairHistory).toEqual([first, restored]);
  });
});
