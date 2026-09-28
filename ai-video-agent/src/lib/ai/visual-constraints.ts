import type { SceneSpec } from '@/types';

/** HTML-rendered maps are fragile and distract from the actual data message. */
const MAP_VISUAL_PATTERN = /(?:地图|地理(?:轮廓|剪影)|国界|省份(?:轮廓|地图)|map(?:[-_\s]*(?:outline|shape|silhouette|chart))|geographic\s+silhouette)/i;
const BARE_MAP_PATTERN = /(?:^|[\s;:,，；：/|()[\]{}'"_-])map(?:$|[\s;:,，；：/|()[\]{}'"_-])/i;

export const NO_MAP_VISUAL_RULE = 'HTML 画面禁止使用地图、地图轮廓、国界、省份轮廓、地理剪影及 map/map-outline 等变体；涉及国家或地区的数据必须改用数字排版、刻度、条形、对比或流程等非地理图形。';

type VisualConstraintInput = {
  htmlPrompt?: unknown;
  sceneSpec?: Partial<SceneSpec> | null;
  focalElement?: unknown;
  actionSemantics?: unknown;
  assetHints?: unknown;
  visualIntent?: unknown;
};

/**
 * Only fields that can actually decide the picture are inspected. In particular,
 * informationPool, prohibitedPatterns, title and narration are deliberately ignored.
 */
export function hasForbiddenMapVisual(value: unknown): boolean {
  if (typeof value === 'string') return containsMapVisual(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const input = value as VisualConstraintInput;
  const spec = input.sceneSpec && typeof input.sceneSpec === 'object'
    ? input.sceneSpec
    : input as Partial<SceneSpec>;
  return [
    input.htmlPrompt,
    spec.focalElement,
    spec.actionSemantics,
    spec.assetHints,
    spec.visualIntent,
  ].some(containsMapVisualValue);
}

/** Final HTML validation scans visual markup and visual labels, not unrelated copy. */
export function hasForbiddenMapHtmlVisual(html: string): boolean {
  const visualRegions = extractElementRegions(html, /\bdata-role\s*=\s*["']visual-(?:zone|content)["']/i);
  const svgRegions = extractElementRegions(html, /^<svg\b/i);
  const visualAttributes = Array.from(html.matchAll(
    /\b(?:class|id|aria-label|alt|title|data-label|data-visual)\s*=\s*(["'])([\s\S]*?)\1/gi,
  )).map(match => match[2]);

  return [...visualRegions, ...svgRegions].some(region => MAP_VISUAL_PATTERN.test(region))
    || visualAttributes.some(value => containsMapVisual(value));
}

function containsMapVisualValue(value: unknown): boolean {
  if (typeof value === 'string') return containsMapVisual(value);
  return Array.isArray(value) && value.some(item => typeof item === 'string' && containsMapVisual(item));
}

function containsMapVisual(value: string): boolean {
  return MAP_VISUAL_PATTERN.test(value) || BARE_MAP_PATTERN.test(value);
}

function extractElementRegions(html: string, openingTagPattern: RegExp): string[] {
  const tags = Array.from(html.matchAll(/<\/?[a-z][^>]*>/gi));
  const regions: string[] = [];
  for (let index = 0; index < tags.length; index++) {
    const match = tags[index];
    const openingTag = match[0];
    if (openingTag.startsWith('</') || !openingTagPattern.test(openingTag)) continue;
    openingTagPattern.lastIndex = 0;
    const tagName = openingTag.match(/^<([a-z][\w:-]*)/i)?.[1].toLowerCase();
    if (!tagName) continue;

    let depth = 1;
    let end = (match.index || 0) + openingTag.length;
    for (let cursor = index + 1; cursor < tags.length; cursor++) {
      const token = tags[cursor];
      const tokenName = token[0].match(/^<\/?([a-z][\w:-]*)/i)?.[1].toLowerCase();
      if (tokenName !== tagName) continue;
      if (token[0].startsWith('</')) depth--;
      else if (!token[0].endsWith('/>')) depth++;
      if (depth === 0) {
        end = (token.index || 0) + token[0].length;
        index = cursor;
        break;
      }
    }
    regions.push(html.slice(match.index || 0, end));
  }
  return regions;
}
