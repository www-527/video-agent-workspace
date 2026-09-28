import type { FrameQualityReport, LayoutIssue } from '@/types';

const LOCAL_REPAIR_STYLE_PATTERN = /<style\b[^>]*\bdata-ai-local-text-quality-repair\b[^>]*>[\s\S]*?<\/style>\s*/gi;
const LOCAL_TEXT_CODES = new Set<LayoutIssue['code']>(['font_too_small', 'low_contrast']);

const CSS_PROPERTY_BY_CHANGE = {
  fontSize: 'font-size',
  color: 'color',
  opacity: 'opacity',
  backgroundColor: 'background-color',
  padding: 'padding',
  borderRadius: 'border-radius',
  boxDecorationBreak: 'box-decoration-break',
} as const;

type LocalChangeKey = keyof typeof CSS_PROPERTY_BY_CHANGE;
type LocalAppliedFix = Pick<FrameQualityReport['appliedFixes'][number], 'elementId' | 'changes'>;

export interface LocalTextQualityRepairResult {
  htmlCode: string;
  appliedFixes: LocalAppliedFix[];
  remainingIssues: LayoutIssue[];
}

/**
 * Apply only deterministic typography repairs. Geometry and semantic changes
 * remain visual-model decisions because choosing the correct parent or item is
 * contextual. The generated style block is replaced on every pass, so running
 * the repair repeatedly is idempotent.
 */
export function applyLocalTextQualityRepairs(
  htmlCode: string,
  issues: readonly LayoutIssue[],
): LocalTextQualityRepairResult {
  const baseHtml = htmlCode.replace(LOCAL_REPAIR_STYLE_PATTERN, '');
  const changesByElement = new Map<string, Record<string, string | number | boolean>>();
  const repairedIssues = new Set<LayoutIssue>();

  for (const issue of issues) {
    if (!LOCAL_TEXT_CODES.has(issue.code)) continue;
    const fix = issue.suggestedFix;
    if (!fix?.elementId) continue;
    const changes = sanitizeLocalChanges(issue.code, fix.changes);
    if (!Object.keys(changes).length) continue;
    changesByElement.set(fix.elementId, {
      ...(changesByElement.get(fix.elementId) || {}),
      ...changes,
    });
    repairedIssues.add(issue);
  }

  const appliedFixes: LocalAppliedFix[] = [...changesByElement].map(([elementId, changes]) => ({ elementId, changes }));
  if (!appliedFixes.length) {
    return { htmlCode: baseHtml, appliedFixes, remainingIssues: [...issues] };
  }

  const rules = appliedFixes.map(fix => {
    const escapedId = escapeCssAttributeValue(fix.elementId);
    const selector = `[data-editor-id="${escapedId}"],[data-element-id="${escapedId}"]`;
    const declarations = Object.entries(fix.changes).flatMap(([key, value]) => {
      const property = CSS_PROPERTY_BY_CHANGE[key as LocalChangeKey];
      if (!property) return [];
      const serialized = key === 'fontSize' && typeof value === 'number' ? `${value}px` : String(value);
      return `${property}:${serialized} !important`;
    });
    return `${selector}{${declarations.join(';')}}`;
  }).join('');
  const style = `<style data-ai-local-text-quality-repair>${rules}</style>`;
  const repairedHtml = /<\/head>/i.test(baseHtml)
    ? baseHtml.replace(/<\/head>/i, `${style}</head>`)
    : `${style}${baseHtml}`;

  return {
    htmlCode: repairedHtml,
    appliedFixes,
    remainingIssues: issues.filter(issue => !repairedIssues.has(issue)),
  };
}

function sanitizeLocalChanges(
  code: LayoutIssue['code'],
  changes: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  if (code === 'font_too_small') {
    const fontSize = Number(changes.fontSize);
    return Number.isFinite(fontSize) && fontSize >= 8 && fontSize <= 256
      ? { fontSize: Math.round(fontSize * 10) / 10 }
      : {};
  }
  if (code !== 'low_contrast') return {};

  const sanitized: Record<string, string | number | boolean> = {};
  if (typeof changes.color === 'string' && isSafeColor(changes.color)) sanitized.color = changes.color.trim();
  if (typeof changes.backgroundColor === 'string' && isSafeColor(changes.backgroundColor)) {
    sanitized.backgroundColor = changes.backgroundColor.trim();
  }
  if (typeof changes.opacity === 'number' && Number.isFinite(changes.opacity)) {
    sanitized.opacity = Math.max(0, Math.min(1, changes.opacity));
  }
  if (typeof changes.padding === 'string' && isSafeBoxValue(changes.padding)) sanitized.padding = changes.padding.trim();
  if (typeof changes.borderRadius === 'string' && isSafeBoxValue(changes.borderRadius)) {
    sanitized.borderRadius = changes.borderRadius.trim();
  }
  if (changes.boxDecorationBreak === 'clone') sanitized.boxDecorationBreak = 'clone';
  return sanitized;
}

function isSafeColor(value: string): boolean {
  return /^(?:#[\da-f]{3,8}|rgba?\([\d\s.,/%+-]+\)|hsla?\([\d\s.,/%+-]+\))$/i.test(value.trim());
}

function isSafeBoxValue(value: string): boolean {
  return /^(?:\d*\.?\d+(?:px|em|rem|%)?\s*){1,4}$/i.test(value.trim());
}

function escapeCssAttributeValue(value: string): string {
  return value.replace(/["\\\n\r\f]/g, character => `\\${character}`);
}
