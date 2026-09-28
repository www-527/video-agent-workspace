import { buildProtectedLayoutGuard } from '@/lib/layout-geometry';
import type { CanvasPresetId } from '@/types';

const LAYOUT_GUARD_PATTERN = /<style\b[^>]*\bdata-ai-layout-guard\b[^>]*>[\s\S]*?<\/style>/gi;

/**
 * Remove the retired visual auto-fit runtime from frames saved before the
 * layout contract became strict. A runtime fallback must never change an
 * authored composition's scale after generation or manual editing.
 */
export function stripLegacyAutoFitGuard(html: string): string {
  return normalizeEditorPositionTransforms(stripUnsafeInlinePositionPatches(html))
    .replace(/<script\b[^>]*\bdata-ai-fit-guard\b[^>]*>[\s\S]*?<\/script>\s*/gi, '')
    .replace(
      /transform-origin\s*:\s*0\s+0\s*!important\s*;\s*transform\s*:\s*translate\(\s*var\(\s*--ai-fit-x\s*,\s*0px\s*\)\s*,\s*var\(\s*--ai-fit-y\s*,\s*0px\s*\)\s*\)\s*scale\(\s*var\(\s*--ai-fit-scale\s*,\s*1\s*\)\s*\)\s*!important\s*;?/gi,
      'transform:none!important;',
    );
}

/** Always replace persisted guards with the current canvas contract. */
export function enforceProtectedLayout(html: string, canvasPreset?: CanvasPresetId): string {
  const cleaned = stripLegacyAutoFitGuard(html).replace(LAYOUT_GUARD_PATTERN, '');
  const guard = buildProtectedLayoutGuard(canvasPreset);
  if (/<\/head>/i.test(cleaned)) return cleaned.replace(/<\/head>/i, `${guard}</head>`);
  if (/<body\b/i.test(cleaned)) return cleaned.replace(/<body\b/i, `${guard}<body`);
  return `${guard}${cleaned}`;
}

/**
 * Editor builds before the canvas-offset model stored movement in `transform`.
 * Split those position functions into CSS `translate` so transform animations,
 * scale, and rotation can continue to work independently.
 */
export function normalizeEditorPositionTransforms(html: string): string {
  if (!/data-editor-patch/i.test(html) || !/transform\s*:/i.test(html)) return html;
  return html.replace(EDITOR_PATCH_PATTERN, (full, _attributes: string, _quote: string, css: string) => {
    const normalizedCss = css.replace(
      /transform\s*:\s*([^;!}]+)\s*!important\s*;?/gi,
      (declaration, rawValue: string) => {
        const centered = /translate\(\s*-50%\s*,\s*-50%\s*\)/i.test(rawValue);
        const x = Number(rawValue.match(/translateX\(\s*(-?[\d.]+)px\s*\)/i)?.[1] || 0);
        const y = Number(rawValue.match(/translateY\(\s*(-?[\d.]+)px\s*\)/i)?.[1] || 0);
        if (!centered && !x && !y) return declaration;

        const remaining = rawValue
          .replace(/translate\(\s*-50%\s*,\s*-50%\s*\)/gi, '')
          .replace(/translateX\(\s*-?[\d.]+px\s*\)/gi, '')
          .replace(/translateY\(\s*-?[\d.]+px\s*\)/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        const centeredValue = (value: number) => value === 0
          ? '-50%'
          : `calc(-50% ${value > 0 ? '+' : '-'} ${Math.abs(value)}px)`;
        const translateX = centered ? centeredValue(x) : `${x}px`;
        const translateY = centered ? centeredValue(y) : `${y}px`;
        const transform = remaining && remaining !== 'none' ? `transform: ${remaining} !important;` : '';
        return `translate: ${translateX} ${translateY} !important;${transform}`;
      },
    );
    return full.replace(css, normalizedCss);
  });
}

const INLINE_TEXT_TAGS = new Set([
  'a', 'b', 'code', 'em', 'i', 'mark', 'small', 'span', 'strong', 'sub', 'sup', 'u',
]);
const SAFE_POSITION_CONTAINER_TAGS = new Set([
  'article', 'aside', 'blockquote', 'div', 'figcaption', 'figure', 'footer', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'header', 'li', 'p', 'section', 'td', 'th',
]);
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param',
  'source', 'track', 'wbr',
]);
const EDITOR_ID_PATTERN = /\bdata-(?:editor|element)-id\s*=\s*(["'])(.*?)\1/i;
const DATA_ROLE_PATTERN = /\bdata-role\s*=\s*(["'])(.*?)\1/i;
const EDITOR_PATCH_PATTERN = /<style\b([^>]*\bdata-editor-patch\s*=\s*(["'])[^"']+\2[^>]*)>([\s\S]*?)<\/style>\s*/gi;

type OpenHtmlTag = {
  tag: string;
  id: string;
  role: string;
};

/**
 * Canvas coordinates must never be applied to a word inside a sentence.
 * Promote an inline text target to its nearest editable block container. When
 * no safe container exists, return null so the caller can reject the move.
 */
export function resolveCanvasPositionTargetId(html: string, elementId: string): string | null {
  const stack: OpenHtmlTag[] = [];
  const tagPattern = /<\/?([a-z][\w-]*)\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html))) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    if (full.startsWith('</')) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].tag !== tag) continue;
        stack.length = index;
        break;
      }
      continue;
    }

    const id = full.match(EDITOR_ID_PATTERN)?.[2] || '';
    const role = full.match(DATA_ROLE_PATTERN)?.[2] || '';
    if (id === elementId) {
      if (!INLINE_TEXT_TAGS.has(tag)) return elementId;
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const ancestor = stack[index];
        if (!ancestor.id || !SAFE_POSITION_CONTAINER_TAGS.has(ancestor.tag)) continue;
        if (/^(?:text-zone|visual-zone|visual-content)$/.test(ancestor.role)) continue;
        return ancestor.id;
      }
      return null;
    }

    if (!full.endsWith('/>') && !VOID_TAGS.has(tag)) stack.push({ tag, id, role });
  }

  return elementId;
}

/**
 * Old editor/optimizer builds could persist `position:fixed` on inline words.
 * Such a patch detaches the word from its sentence and can overlap sibling text.
 * Geometry patches are one command per style block, so discard the unsafe block
 * as a unit while preserving unrelated typography-only patches.
 */
export function stripUnsafeInlinePositionPatches(html: string): string {
  const inlineIds = new Set<string>();
  const inlinePattern = /<(a|b|code|em|i|mark|small|span|strong|sub|sup|u)\b[^>]*\bdata-(?:editor|element)-id\s*=\s*(["'])(.*?)\2[^>]*>/gi;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlinePattern.exec(html))) inlineIds.add(inlineMatch[3]);
  if (!inlineIds.size || !/data-editor-patch/i.test(html)) return html;

  return html.replace(EDITOR_PATCH_PATTERN, (full, _attributes: string, _quote: string, css: string) => {
    if (!/position\s*:\s*fixed\b/i.test(css)) return full;
    const targetsInlineText = Array.from(inlineIds).some(id => {
      const escaped = escapeRegExp(id);
      return new RegExp(`\\[data-(?:editor|element)-id=["']${escaped}["']\\]`, 'i').test(css);
    });
    return targetsInlineText ? '' : full;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
