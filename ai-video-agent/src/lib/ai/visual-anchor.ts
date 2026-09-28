import type { Outline, StylePreset, ThemeTokens, VisualAnchor } from '@/types';

const MAX_FREE_VISUAL_ANCHOR_LENGTH = 220;

export function createVisualAnchor(style: StylePreset, approvedFrameIds: string[] = []): VisualAnchor {
  const tokens = style.tokens || fallbackTokens();
  return {
    themeId: style.id,
    colors: Object.values(tokens.colors),
    fontFamilies: [tokens.typography.display, tokens.typography.body, tokens.typography.mono],
    titleTreatment: `${tokens.typography.display} / ${tokens.typography.titleSize} / 强调色只用于关键字`,
    numberTreatment: `${tokens.typography.mono} / tabular-nums / 数字作为视觉主角`,
    labelTreatment: `${tokens.typography.mono} / 短标签 / 克制字距`,
    whitespaceRatio: 0.38,
    motionTempo: Number.parseInt(tokens.motion.duration, 10) > 750 ? 'restrained' : 'balanced',
    prohibitedPatterns: style.prohibitedPatterns || ['卡片墙', '大段字幕', 'emoji', '紫粉渐变', '随机装饰'],
    approvedFrameIds,
  };
}

export function isAnchorApproved(anchor?: VisualAnchor): boolean {
  return Boolean(anchor?.approvedFrameIds.length);
}

/**
 * Keep the GPT-free first-frame reference to one short visual cue. It gives
 * later scenes continuity without asking them to repeat the first composition.
 */
export function createFreeFirstFrameVisualAnchor(
  outline: Pick<Outline, 'frames' | 'freeFirstChapterAnchor'>,
): NonNullable<Outline['freeFirstChapterAnchor']> | undefined {
  const firstFrame = outline.frames[0];
  if (!firstFrame) return undefined;
  const existing = outline.freeFirstChapterAnchor;
  if (existing?.frameId === firstFrame.id && existing.summary?.trim()) {
    return { frameId: existing.frameId, summary: compactFreeVisualAnchor(existing.summary) };
  }
  const visualCue = firstFrame.sceneSpec?.visualIntent
    || firstFrame.sceneSpec?.focalElement
    || firstFrame.htmlPrompt
    || firstFrame.narration;
  return {
    frameId: firstFrame.id,
    summary: compactFreeVisualAnchor([firstFrame.title, visualCue].filter(Boolean).join('：')),
  };
}

function compactFreeVisualAnchor(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_FREE_VISUAL_ANCHOR_LENGTH);
}

function fallbackTokens(): ThemeTokens {
  return {
    colors: { background: '#f4f0e8', surface: '#fffdf8', foreground: '#171714', muted: '#706c63', accent: '#b43924', accentSecondary: '#d7cdbd' },
    typography: { display: "'Songti SC', serif", body: "'Microsoft YaHei', sans-serif", mono: 'Consolas, monospace', titleSize: '104px', bodySize: '28px' },
    spacing: { safeArea: '72px', gap: '24px' }, shape: { radius: '2px', borderWidth: '1px' },
    motion: { duration: '700ms', easing: 'cubic-bezier(.22,.8,.22,1)', stagger: '140ms' }, signature: '编辑式留白与单一视觉焦点',
  };
}
