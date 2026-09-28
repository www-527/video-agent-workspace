import type { GPTVisualBible, Outline, StylePreset, VisualContract } from '@/types';

export const VISUAL_CONTRACT_VERSION = 'visual-contract-v1' as const;
export const GPT_VISUAL_BIBLE_VERSION = 'gpt-visual-bible-v1' as const;

/**
 * The model may choose a scene relationship and focal object, but never a new
 * palette, type system, or coordinate system for each scene.
 */
export function createVisualContract(style: StylePreset): VisualContract {
  const tokens = style.tokens;
  if (!tokens) throw new Error(`Visual style ${style.id} is missing required theme tokens.`);
  return {
    version: VISUAL_CONTRACT_VERSION,
    themeId: style.id,
    tokens,
    allowedLayouts: ['split', 'stack'],
    visualLanguage: tokens.signature,
    componentFamilies: ['focal', 'comparison', 'process', 'hierarchy', 'data', 'conclusion'],
    prohibitedPatterns: style.prohibitedPatterns || [
      'card wall',
      'long on-screen transcript',
      'emoji',
      'purple-pink gradient',
      'random decoration',
      'meaningless floating shapes',
    ],
    maxSemanticObjects: 4,
  };
}

/** A stale contract never overrides the style selected for this generation. */
export function ensureVisualContract(
  current: VisualContract | undefined,
  style: StylePreset,
): VisualContract {
  if (current?.version === VISUAL_CONTRACT_VERSION && current.themeId === style.id) return current;
  return createVisualContract(style);
}

/** Persist a verifiable contract marker through later manual layout edits. */
export function stampVisualContract(html: string, contract: VisualContract): string {
  const themeId = contract.themeId.replace(/[^a-z0-9_-]/gi, '');
  return html.replace(/<main\b([^>]*)>/i, (_full, attributes: string) => {
    const withoutExisting = attributes.replace(/\sdata-visual-contract=(['"]).*?\1/i, '');
    return `<main${withoutExisting} data-visual-contract="${themeId}">`;
  });
}

export function hasVisualContractMarker(html: string, contract: VisualContract | undefined): boolean {
  if (!contract) return true;
  const themeId = contract.themeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\bdata-visual-contract=["']${themeId}["']`, 'i').test(html);
}

/**
 * GPT-free receives artistic continuity only. Layout families, object budgets,
 * and editor DOM roles remain exclusive to the standard VisualContract.
 */
export function createGPTVisualBible(style: StylePreset, outline: Outline): GPTVisualBible {
  const tokens = style.tokens;
  if (!tokens) throw new Error(`Visual style ${style.id} is missing required theme tokens.`);
  const brief = outline.freeCreativeBrief;
  const motifs = [brief?.visualMotif, tokens.signature]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(value => value.trim());
  return {
    version: GPT_VISUAL_BIBLE_VERSION,
    themeId: style.id,
    tokens,
    visualLanguage: [style.prompt, brief?.visualMotif].filter(Boolean).join('\n'),
    motifs: [...new Set(motifs)].slice(0, 3),
    rhythm: brief?.rhythm || '开场建立张力，中段递进，转折提高能量，结尾克制收束。',
    prohibitedProblems: style.prohibitedPatterns || [
      '无意义浮动图形',
      '无语义连接线',
      '长段文字上屏',
      '低对比文字',
      '关键内容进入字幕区',
    ],
  };
}

export function ensureGPTVisualBible(
  current: GPTVisualBible | undefined,
  style: StylePreset,
  outline: Outline,
): GPTVisualBible {
  if (current?.version === GPT_VISUAL_BIBLE_VERSION && current.themeId === style.id) return current;
  return createGPTVisualBible(style, outline);
}

/** Provenance marker only; it is never a structural acceptance condition. */
export function stampGPTVisualBible(html: string, bible: GPTVisualBible): string {
  const themeId = bible.themeId.replace(/[^a-z0-9_-]/gi, '');
  const stamped = html.replace(/<main\b([^>]*)>/i, (_full, attributes: string) => {
    const withoutExisting = attributes.replace(/\sdata-gpt-visual-bible=(['"]).*?\1/i, '');
    return `<main${withoutExisting} data-gpt-visual-bible="${themeId}">`;
  });
  if (stamped !== html) return stamped;
  return html.replace(/<body\b([^>]*)>/i, (_full, attributes: string) => {
    const withoutExisting = attributes.replace(/\sdata-gpt-visual-bible=(['"]).*?\1/i, '');
    return `<body${withoutExisting} data-gpt-visual-bible="${themeId}">`;
  });
}
