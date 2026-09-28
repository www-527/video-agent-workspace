import { env } from '@/lib/env';
import { persistFrameTuneHtml } from '@/lib/frame-tune-preview';
import { callAIJson } from './client';
import { sanitizeFreeHtml, sanitizeHtml } from './html';
import type { CanvasPresetId, FrameOutline, FrameQualityReport, FrameSource, FrameTuneDraft, FrameTuneElement, VideoSource } from '@/types';

const TUNE_ANALYSIS_SYSTEM = `你是视频 HTML 分镜的画面微调解析器。你的唯一任务是把用户的局部修改要求转换成简短、可执行的微调草稿。

只允许修改位置、缩放、透明度、层级、动效时长，或删除一个已存在的局部画面元素。不得修改标题、旁白、事实内容、屏幕文案、主题或视觉风格。

返回严格 JSON：
{
  "summary": "一句话总结",
  "elements": [{
    "label": "用户能理解的元素名称",
    "kind": "visual | text | decoration | motion",
    "selector": "元素清单中真实存在的稳定 CSS 选择器",
    "previewAnchor": "center | top | bottom | left | right",
    "current": { "x": "50%", "y": "48%", "scale": "1.00" },
    "proposed": { "x": "50%", "y": "43%", "scale": "1.00" },
    "reason": "简短原因"
  }]
}

规则：
- 默认只输出用户明确要求的 1 个元素。只有多个元素必须同步变化才能完成要求时才能增加，最多 4 个。
- 禁止为了丰富方案而附加字幕、安全区、装饰、层级或其他未被要求的修改。
- selector 必须来自元素清单，优先 id、data-role、aria-label 或唯一 class；禁止 html、body、:root、*、main、section、container、scene、stage、screen 等宽泛容器。
- current/proposed 只使用 x、y、scale、opacity、zIndex、duration 等预览支持的字段；没有变化的字段不要输出。
- 删除局部元素时，proposed 只输出 { "visibility": "removed" }；current 可输出 { "visibility": "visible" }。
- 用户说“删除整个/整体”且目标位于 data-role="composite" 时，selector 选组合根容器；用户明确说某个子部件时才选子元素。
- 禁止删除 html、body、main、text-zone、visual-zone、visual-content 和字幕层；无法找到安全的唯一 selector 时不得猜测宽泛容器。
- 无法精确判断 current 时可以给近似值，但 proposed 必须明确。
- “上移/下移/左移/右移一点”通常表示相对当前值变化 3% 到 5%，不要扩大为重新布局。
- 不要解释，不要输出 Markdown，只输出 JSON。`;

export async function analyzeFrameTune(opts: {
  frame: FrameOutline;
  source: FrameSource;
  userModification: string;
  baseUpdatedAt: string;
}): Promise<FrameTuneDraft> {
  const { frame, source, userModification, baseUpdatedAt } = opts;
  const result = await callAIJson<{ summary?: string; elements?: FrameTuneElement[] }>({
    stage: '画面微调分析',
    system: TUNE_ANALYSIS_SYSTEM,
    user: [
      `【用户微调要求】\n${userModification}`,
      `【当前分镜】\n标题：${frame.title}`,
      `【当前画面元素清单】\n${buildTuneHtmlSummary(source.htmlCode || '')}`,
    ].join('\n\n'),
    temperature: 0,
    maxTokens: env.AI_TUNE_MAX_TOKENS,
    noThinking: env.AI_TUNE_NO_THINKING,
    timeoutMs: env.AI_TUNE_TIMEOUT_MS,
    maxRetries: 0,
  });

  return normalizeTuneDraft({
    targetFrameId: frame.id,
    summary: result.summary || userModification || '微调当前画面布局',
    elements: result.elements || [],
    baseUpdatedAt,
  });
}

/** Persist exactly the CSS already shown in the tune preview; no second AI call. */
export async function applyFrameTuneToHtml(opts: {
  frame: FrameOutline;
  htmlCode: string;
  draft: FrameTuneDraft;
  canvasPreset?: CanvasPresetId;
  schemaFree?: boolean;
}): Promise<string> {
  const html = persistFrameTuneHtml(opts.htmlCode, opts.draft.elements, opts.canvasPreset);
  return opts.schemaFree ? sanitizeFreeHtml(html) : sanitizeHtml(html, opts.canvasPreset);
}

export function applyFrameTuneSource(opts: {
  videoSource: VideoSource;
  frameIndex: number;
  frameId: string;
  htmlCode: string;
  qualityReport?: FrameQualityReport;
}): VideoSource {
  const frames = [...(opts.videoSource.frames || [])];
  const existing = frames[opts.frameIndex] || { id: opts.frameId };
  const existingWithoutQualityReport = { ...existing };
  delete existingWithoutQualityReport.qualityReport;
  frames[opts.frameIndex] = {
    ...existingWithoutQualityReport,
    id: opts.frameId,
    htmlCode: opts.htmlCode,
    ...(opts.qualityReport ? { qualityReport: opts.qualityReport } : {}),
  };
  return { ...opts.videoSource, frames };
}

export function normalizeTuneDraft(draft: FrameTuneDraft): FrameTuneDraft {
  const elements = draft.elements
    .filter(element => element && element.label && element.kind)
    .slice(0, 4)
    .map(element => ({
      label: String(element.label).slice(0, 40),
      kind: normalizeKind(element.kind),
      selector: typeof element.selector === 'string' ? element.selector.slice(0, 160) : undefined,
      previewAnchor: normalizeAnchor(element.previewAnchor),
      current: stringifyRecord(element.current),
      proposed: stringifyRecord(element.proposed),
      reason: String(element.reason || '保持原画面，只做用户要求的局部微调。').slice(0, 120),
    }));

  return {
    targetFrameId: draft.targetFrameId,
    summary: String(draft.summary || '微调当前画面布局').slice(0, 120),
    elements: elements.length ? elements : [{
      label: '主要视觉元素',
      kind: 'visual',
      current: { position: '当前画面位置' },
      proposed: { position: '按用户要求微调' },
      reason: '保持原画面，只调整用户提到的局部参数。',
    }],
    baseUpdatedAt: draft.baseUpdatedAt,
  };
}

export function buildTuneHtmlSummary(htmlCode: string): string {
  if (!htmlCode.trim()) return '（无可用 HTML）';

  const styleText = Array.from(htmlCode.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    .map(match => match[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2800);

  const markup = htmlCode
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const elements: string[] = [];
  const tagPattern = /<([a-z][\w-]*)([^>]*)>([^<]{0,60})/gi;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(markup)) && elements.length < 40) {
    const tag = match[1].toLowerCase();
    if (['html', 'head', 'body', 'meta', 'link', 'title'].includes(tag)) continue;
    const attributes = extractUsefulAttributes(match[2]);
    const text = match[3].replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!attributes && !text) continue;
    elements.push(`<${tag}${attributes ? ` ${attributes}` : ''}>${text ? ` ${text}` : ''}`);
  }

  return [
    elements.length ? `元素：\n${elements.join('\n')}` : '元素：（未提取到带标识的元素）',
    styleText ? `相关 CSS（已截断）：\n${styleText}` : '相关 CSS：（无内联样式表）',
  ].join('\n\n').slice(0, 6000);
}

function extractUsefulAttributes(rawAttributes: string): string {
  const attributes: string[] = [];
  const pattern = /\b(id|class|data-role|data-element-id|data-element-label|aria-label|role)\s*=\s*(["'])(.*?)\2/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rawAttributes)) && attributes.length < 4) {
    const value = match[3].replace(/\s+/g, ' ').trim().slice(0, 100);
    if (value) attributes.push(`${match[1].toLowerCase()}="${value}"`);
  }
  return attributes.join(' ');
}

function normalizeKind(kind: unknown): FrameTuneElement['kind'] {
  if (kind === 'text' || kind === 'decoration' || kind === 'motion') return kind;
  return 'visual';
}

function normalizeAnchor(anchor: unknown): FrameTuneElement['previewAnchor'] {
  if (anchor === 'top' || anchor === 'bottom' || anchor === 'left' || anchor === 'right') return anchor;
  return 'center';
}

function stringifyRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowedKeys = new Set(['x', 'y', 'left', 'top', 'scale', 'size', 'opacity', 'zIndex', 'layer', 'duration', 'speed', 'visibility']);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => allowedKeys.has(key))
      .slice(0, 6)
      .map(([key, item]) => [key, String(item).slice(0, 40)]),
  );
}
