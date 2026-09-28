import { describe, expect, it } from 'vitest';
import { applyLocalTextQualityRepairs } from '@/lib/quality/local-text-quality-repair';
import type { LayoutIssue } from '@/types';

describe('local text quality repair', () => {
  const html = '<!DOCTYPE html><html><head><style>.copy{color:#aaa}</style></head><body><main><p class="copy" data-editor-id="copy">正文</p></main></body></html>';
  const issues: LayoutIssue[] = [
    {
      code: 'font_too_small', severity: 'major', label: '正文', detail: '字号不足', elementId: 'copy',
      suggestedFix: { elementId: 'copy', changes: { fontSize: 24 } },
    },
    {
      code: 'low_contrast', severity: 'major', label: '正文', detail: '对比度不足', elementId: 'copy',
      suggestedFix: { elementId: 'copy', changes: { color: 'rgb(20, 24, 30)', opacity: 1 } },
    },
  ];

  it('consolidates deterministic font and contrast changes into one local style block', () => {
    const result = applyLocalTextQualityRepairs(html, issues);
    expect(result.appliedFixes).toEqual([{
      elementId: 'copy',
      changes: { fontSize: 24, color: 'rgb(20, 24, 30)', opacity: 1 },
    }]);
    expect(result.remainingIssues).toEqual([]);
    expect(result.htmlCode).toContain('data-ai-local-text-quality-repair');
    expect(result.htmlCode).toContain('font-size:24px !important');
    expect(result.htmlCode).toContain('color:rgb(20, 24, 30) !important');
  });

  it('is idempotent and does not duplicate its style block', () => {
    const once = applyLocalTextQualityRepairs(html, issues).htmlCode;
    const twice = applyLocalTextQualityRepairs(once, issues).htmlCode;
    expect(twice).toBe(once);
    expect(twice.match(/data-ai-local-text-quality-repair/g)).toHaveLength(1);
  });

  it('leaves unsafe or unsupported suggestions for visual repair', () => {
    const issue: LayoutIssue = {
      code: 'low_contrast', label: '正文', detail: '对比度不足', elementId: 'copy',
      suggestedFix: { elementId: 'copy', changes: { color: 'url(javascript:alert(1))' } },
    };
    const result = applyLocalTextQualityRepairs(html, [issue]);
    expect(result.htmlCode).toBe(html);
    expect(result.appliedFixes).toEqual([]);
    expect(result.remainingIssues).toEqual([issue]);
  });
});
