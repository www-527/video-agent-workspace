import type { LayoutIssue } from '@/types';

export function layoutIssueKey(issue: LayoutIssue): string {
  return [issue.code, issue.elementId || issue.label, issue.relatedElementId || ''].join('::');
}

export function layoutIssueScope(projectId: string, frameId: string, htmlHash = ''): string {
  return `${projectId}::${frameId}::${htmlHash}`;
}

export function permanentLayoutIssueScope(projectId: string, frameId: string): string {
  return `${projectId}::${frameId}`;
}

export function filterIgnoredLayoutIssues(issues: LayoutIssue[], ignoredKeys: string[] = []): LayoutIssue[] {
  if (!ignoredKeys.length) return issues;
  const ignored = new Set(ignoredKeys);
  return issues.filter(issue => !ignored.has(layoutIssueKey(issue)));
}
