import { validateFreeGeneratedHtml, validateGeneratedHtml } from '@/lib/ai/html';
import { getFrameSourceForOutlineFrame } from '@/lib/video-source';
import { QUALITY_AUDIT_VERSION } from '@/lib/quality/audit-version';
import type { FrameQualityReport, ProjectDetail } from '@/types';

export const EXPORT_QUALITY_AUDIT_VERSION = QUALITY_AUDIT_VERSION;

export class ExportQualityGateError extends Error {
  constructor(public readonly failures: string[]) {
    super(`导出已拦截：${failures.join('；')}`);
    this.name = 'ExportQualityGateError';
  }
}

export function exportQualityHtmlHash(html: string): string {
  let hash = 2166136261;
  for (let index = 0; index < html.length; index += 1) {
    hash ^= html.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function isCurrentPassingReport(report: FrameQualityReport | null | undefined, html: string): boolean {
  if (!report || report.status !== 'passed') return false;
  if (report.auditVersion !== EXPORT_QUALITY_AUDIT_VERSION) return false;
  if (report.htmlHash !== exportQualityHtmlHash(html)) return false;
  return !report.issues.some(issue => issue.severity === 'critical' || !issue.severity || issue.severity === 'major');
}

/**
 * Server-side quality gate. It intentionally relies only on deterministic
 * document, layout-report, and whole-film semantic checks; no image-recognition
 * model is required or called.
 */
export function assertProjectQualityForExport(project: Pick<ProjectDetail, 'type' | 'workflow' | 'outline' | 'videoSource'>): void {
  if (project.type !== 'html' || !project.outline || !project.videoSource) return;
  const failures: string[] = [];

  project.outline.frames.forEach((frame, index) => {
    const source = getFrameSourceForOutlineFrame(project.videoSource!, frame.id, index);
    if (!source?.htmlCode) {
      failures.push(`第 ${index + 1} 镜缺少 HTML 画面`);
      return;
    }
    try {
      if (project.workflow === 'gpt-free') validateFreeGeneratedHtml(source.htmlCode);
      else validateGeneratedHtml(source.htmlCode);
    } catch (error) {
      failures.push(`第 ${index + 1} 镜不符合${project.workflow === 'gpt-free' ? '自由画面运行安全' : '受控布局'}：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!isCurrentPassingReport(source.qualityReport, source.htmlCode)) {
      failures.push(`第 ${index + 1} 镜尚未通过当前版本的质量审计`);
    }
  });

  if (failures.length) throw new ExportQualityGateError(failures);
}
