import type { FrameQualityRunState, LayoutIssue } from '@/types';

export type QualitySeverity = 'blocking' | 'attention' | 'info';

const ACTIVE_QUALITY_REPAIR_STATUSES: ReadonlySet<FrameQualityRunState['status']> = new Set([
  'auditing',
  'sampling',
  'optimizing',
  'visual_repairing',
  'terminal_verifying',
  'sampling_recheck',
  'saving',
  'cancelling',
]);

export function isQualityRepairRunActive(
  status: FrameQualityRunState['status'] | undefined,
): boolean {
  return status !== undefined && ACTIVE_QUALITY_REPAIR_STATUSES.has(status);
}

export function getQualitySeverity(issue: LayoutIssue): QualitySeverity {
  if (issue.severity === 'critical') return 'blocking';
  if (!issue.severity || issue.severity === 'major') return 'attention';
  return 'info';
}

export function isBlockingQualityIssue(issue: LayoutIssue): boolean {
  return getQualitySeverity(issue) === 'blocking';
}
