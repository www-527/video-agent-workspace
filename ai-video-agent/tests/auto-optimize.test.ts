import { describe, expect, it } from 'vitest';
import { applyEditCommand } from '@/lib/editor-command';
import {
  buildRepairPlans,
  compareQualityVectors,
  issueConflictKey,
  isAuditTimeout,
  mergeLayoutIssues,
  QUALITY_AUDIT_VERSION,
  qualityHtmlHash,
  qualityPassed,
  qualityReportNeedsAudit,
  qualityScore,
  qualityVector,
} from '@/lib/quality/auto-optimize';
import { wrapHtmlWithWatchdog } from '@/lib/iframe-utils';

describe('画面自动优化', () => {
  it('严重问题不能通过质量门', () => {
    const issues = [{ code: 'text_occluded' as const, severity: 'critical' as const, label: '标题', detail: '被遮挡' }];
    expect(qualityScore(issues)).toBe(65);
    expect(qualityPassed(issues)).toBe(false);
  });

  it('核心画面不可见时扣除严重问题分值且不能通过', () => {
    const issues = [{ code: 'invisible' as const, severity: 'critical' as const, label: '核心画面未显示', detail: '最终仍不可见' }];
    expect(qualityScore(issues)).toBe(65);
    expect(qualityPassed(issues)).toBe(false);
  });

  it('允许一个轻微问题且分数达到 90', () => {
    const issues = [{ code: 'edge_spacing' as const, severity: 'minor' as const, label: '标签', detail: '贴边' }];
    expect(qualityScore(issues)).toBe(97);
    expect(qualityPassed(issues)).toBe(true);
  });

  it('HTML hash 稳定且能识别修改', () => {
    expect(qualityHtmlHash('<p>A</p>')).toBe(qualityHtmlHash('<p>A</p>'));
    expect(qualityHtmlHash('<p>A</p>')).not.toBe(qualityHtmlHash('<p>B</p>'));
  });

  it('retries timeout reports instead of treating them as a fresh cached audit', () => {
    const html = '<main>frame</main>';
    const timeoutIssue = { code: 'audit_timeout' as const, severity: 'critical' as const, label: 'timeout', detail: 'timeout' };
    expect(isAuditTimeout([timeoutIssue])).toBe(true);
    expect(qualityReportNeedsAudit({
      frameId: 'f1', status: 'needs_review', scoreBefore: 65, scoreAfter: 65,
      iterations: 0, issues: [timeoutIssue], appliedFixes: [], auditedAt: Date.now(),
      auditVersion: QUALITY_AUDIT_VERSION, htmlHash: qualityHtmlHash(html),
    }, html)).toBe(true);
  });

  it('merges occlusion and overlap reports for the same element pair', () => {
    const issues = [
      { code: 'text_occluded' as const, severity: 'critical' as const, label: '署名', detail: '被罐子遮挡', elementId: 'copy', relatedElementId: 'can' },
      { code: 'semantic_overlap' as const, severity: 'major' as const, label: '罐子', detail: '与署名重叠', elementId: 'can', relatedElementId: 'copy' },
    ];
    expect(issueConflictKey(issues[0])).toBe(issueConflictKey(issues[1]));
    expect(mergeLayoutIssues(issues)).toHaveLength(1);
    expect(qualityScore(issues)).toBe(65);
  });

  it('prioritizes removing occlusion over unrelated score gains', () => {
    const occluded = qualityVector([{ code: 'text_occluded', severity: 'critical', label: '署名', detail: '遮挡' }]);
    const minorOnly = qualityVector([{ code: 'edge_spacing', severity: 'major', label: '标签', detail: '贴边' }], 200);
    expect(compareQualityVectors(minorOnly, occluded)).toBeLessThan(0);
  });

  it('builds move-and-scale plans for a collision', () => {
    const plans = buildRepairPlans([{
      code: 'text_occluded', severity: 'critical', label: '署名', detail: '被罐子遮挡',
      elementId: 'copy', relatedElementId: 'can',
      suggestedFix: { elementId: 'can', changes: { left: 1048, top: 392 } },
    }]);
    expect(plans.some(plan => plan.operations[0].changes.scale === 0.82)).toBe(true);
    expect(plans.every(plan => plan.targetKey === 'collision:can::copy')).toBe(true);
  });

  it('自动位置修复使用画布坐标并释放裁切容器', () => {
    const html = '<html><head></head><body><div data-role="visual-zone"><div data-editor-id="card">卡片</div></div></body></html>';
    const result = applyEditCommand(html, {
      id: 'auto-fix-1', operation: 'update_element', frameId: 'f1', elementId: 'card', scope: 'element',
      changes: { left: 80, top: 100 }, preserve: ['content'], source: 'auto', summary: '自动移回安全区',
    });
    expect(result).toContain('position: fixed !important');
    expect(result).toContain('left: 80px !important');
    expect(result).toContain('[data-role="visual-zone"]:has(');
  });

  it('运行时审计包含检测、修复和冲突去重信息', () => {
    const output = wrapHtmlWithWatchdog('<p data-editor-id="copy">正文</p>');
    expect(output).toContain("add('text_occluded'");
    expect(output).toContain("add('semantic_overlap'");
    expect(output).toContain("add('font_too_small'");
    expect(output).toContain("add('low_contrast'");
    expect(output).toContain('suggestedFix: suggestedFix || undefined');
    expect(output).toContain('/rgba?\\((\\d+)');
    expect(output).toContain('var clipTolerance = isText ? 6 : 2');
    expect(output).toContain('function effectiveOpacity(element)');
    expect(output).toContain('closestAccessibleTextColor(fg, bg, required, inheritedOpacity)');
    expect(output).toContain("add('excessive_micro_labels'");
    expect(output).toContain('collisionKeys');
  });
});
