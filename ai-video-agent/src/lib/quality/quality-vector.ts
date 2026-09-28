import type { FrameQualityReport, LayoutIssue } from '@/types';
import { QUALITY_AUDIT_VERSION } from './audit-version';

export type QualityVector = readonly [
  outOfBounds: number,
  subtitleIntrusions: number,
  textOcclusions: number,
  criticalOverlaps: number,
  clipped: number,
  otherCritical: number,
  major: number,
  minor: number,
  mutationCost: number,
];

export function qualityHtmlHash(html: string): string {
  let hash = 2166136261;
  for (let index = 0; index < html.length; index += 1) {
    hash ^= html.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

export function isAuditTimeout(issues: readonly LayoutIssue[]): boolean {
  return issues.some(issue => issue.code === 'audit_timeout');
}

export function qualityReportNeedsAudit(report: FrameQualityReport | null | undefined, html: string): boolean {
  const hash = qualityHtmlHash(html);
  return !report
    || report.auditVersion !== QUALITY_AUDIT_VERSION
    || report.htmlHash !== hash
    || isAuditTimeout(report.issues);
}

function normalizedPair(issue: LayoutIssue): string | null {
  if (!issue.elementId || !issue.relatedElementId) return null;
  return [issue.elementId, issue.relatedElementId].sort().join('::');
}

export function issueConflictKey(issue: LayoutIssue): string {
  const pair = normalizedPair(issue);
  if (pair && (issue.code === 'text_occluded' || issue.code === 'semantic_overlap')) return `collision:${pair}`;
  return `${issue.code}:${issue.elementId || issue.label}`;
}

/** Collapse two descriptions of the same collision into one actionable issue. */
export function mergeLayoutIssues(issues: LayoutIssue[]): LayoutIssue[] {
  const groups = new Map<string, LayoutIssue[]>();
  issues.forEach(issue => {
    const key = issueConflictKey(issue);
    groups.set(key, [...(groups.get(key) || []), issue]);
  });
  return Array.from(groups.values()).map(group => {
    if (group.length === 1) return group[0];
    const primary = group.find(issue => issue.code === 'text_occluded') || group.find(issue => issue.severity === 'critical') || group[0];
    const overlap = group.find(issue => issue.code === 'semantic_overlap');
    if (!overlap || primary === overlap) return primary;
    return { ...primary, detail: `${primary.detail} ${overlap.detail}` };
  });
}

export function qualityScore(rawIssues: LayoutIssue[]): number {
  const issues = mergeLayoutIssues(rawIssues);
  return Math.max(0, 100 - issues.reduce((sum, issue) => {
    if (issue.severity === 'critical') return sum + 35;
    if (issue.severity === 'minor') return sum + 3;
    return sum + 12;
  }, 0));
}

export function qualityVector(rawIssues: LayoutIssue[], mutationCost = 0): QualityVector {
  const issues = mergeLayoutIssues(rawIssues);
  const count = (predicate: (issue: LayoutIssue) => boolean) => issues.filter(predicate).length;
  return [
    count(issue => issue.code === 'out_of_bounds'),
    count(issue => issue.code === 'subtitle_safe_area'),
    count(issue => issue.code === 'text_occluded'),
    count(issue => issue.code === 'semantic_overlap' && issue.severity === 'critical'),
    count(issue => issue.code === 'clipped'),
    count(issue => issue.severity === 'critical' && !['out_of_bounds', 'subtitle_safe_area', 'text_occluded', 'semantic_overlap', 'clipped'].includes(issue.code)),
    count(issue => !issue.severity || issue.severity === 'major'),
    count(issue => issue.severity === 'minor'),
    mutationCost,
  ];
}

export function compareQualityVectors(left: QualityVector, right: QualityVector): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function qualityPassed(rawIssues: LayoutIssue[]): boolean {
  const issues = mergeLayoutIssues(rawIssues);
  const critical = issues.some(issue => issue.severity === 'critical');
  const major = issues.filter(issue => !issue.severity || issue.severity === 'major').length;
  return !critical && major <= 1 && qualityScore(issues) >= 90;
}

