import { callAIHtml, isVisionUnavailableError } from './client';
import {
  extractHtmlDocument,
  sanitizeFreeHtml,
  sanitizeHtml,
  validateFreeGeneratedHtml,
  validateGeneratedHtml,
} from './html';
import type { CanvasPresetId, FrameOutline, LayoutIssue } from '@/types';
import { getCanvasPreset } from '@/lib/canvas-presets';
import { buildPortraitVisualGuidance } from '@/lib/portrait-visual-system';
import {
  VISUAL_REPAIR_SAMPLE_LABELS,
  VISUAL_REPAIR_SAMPLE_POINTS,
  VISUAL_REPAIR_SINGLE_SAMPLE_POINT,
  type VisualRepairSample,
} from '@/lib/quality/visual-self-repair';

export const FRAME_QUALITY_REPAIR_SYSTEM = `你是视频 HTML 分镜的资深布局修复工程师。

你的任务不是重新设计页面，而是在保留现有视觉语言、信息、动画和结构关系的前提下，修复浏览器 DOM 自检明确报告的问题。

硬性规则：
- 只输出修复后的完整 HTML 文档，从 <!DOCTYPE html> 开始，到 </html> 结束。
- 不要输出 Markdown、解释、JSON、分析过程或代码围栏。
- 必须逐条解决输入的自检问题，不能只改无关字号来提高分数。
- 优先修复共同父级布局：流程链、时间线、图表、节点组等关系结构应整体调整宽度、间距、缩放或位置，避免拆散单个节点。
- 可以调整 CSS 布局、容器尺寸、gap、padding、transform、颜色和必要字号；不得修改标题、旁白事实、屏幕文字、数字、单位或语义顺序。
- 保留所有 data-editor-id、data-editor-label、data-role 和已有本地图片路径。语义相同的元素不得更换 ID。
- 保留现有动画语义与时长，不得删除所有动画，不得引入循环动画。
- 不得使用外部资源、CDN、网络请求、随机数或交互依赖。
- 不得用 overflow:hidden、降低 opacity、z-index 遮盖或删除内容来伪装修复成功。
- 标题至少 48px，正文至少 24px；辅助短标签可为 18px。低对比度文字应加深颜色，不要靠放大字号规避。
- 修复完成后自行检查：裁切、越界、字幕安全区、文字遮挡、语义重叠、字号和对比度。
- 必须审阅调用方提供的视觉证据：简单静态镜头为一张 100% 终态图；复杂或时序镜头按 35%、70%、100% 提供三张图。100% 始终是权重最高的终态主证据；提供三张图时，35% 与 70% 用于保留动画过程、入场次序和中间态。不得因为早期截图尚未出现某元素，就在终态中删除或改写它。
`;

export const FREE_FRAME_QUALITY_REPAIR_SYSTEM = `你是 GPT 自由创作视频的 HTML 故障修复工程师。

当前页面的媒介、构图、层级、视觉语言和动画意图已经由创作者确定。你的工作不是重新设计，而是只修复 DOM 自检明确报告的客观故障。

硬性规则：
- 只输出修复后的完整 HTML 文档，不输出解释、Markdown、JSON 或分析。
- 保留现有构图、媒介、屏幕文字、信息层级、动画语义和视觉气质。
- 优先修改产生故障的元素或最近共同父级；不得把页面改造成通用卡片模板。
- 必须保留现有 data-editor-id、data-editor-label、已有本地路径和全部可见事实。
- 不得通过删除内容、隐藏内容、降低透明度或裁掉内容伪装修复。
- 不得新增外部资源、网络请求、随机数、循环动画、弹窗或交互依赖。
- 动画必须在镜头时长内结束并保持终态。
- 必须审阅调用方提供的视觉证据：简单静态镜头为一张 100% 终态图；复杂或时序镜头按 35%、70%、100% 提供三张图。100% 始终是权重最高的终态主证据；提供三张图时，35% 与 70% 用于保留动画过程、入场次序和中间态。不得因为早期截图尚未出现某元素，就在终态中删除或改写它；只修复截图和 DOM 自检明确暴露的故障。
`;

const VISUAL_REPAIR_FREEDOM = `视觉证据优先于不精确的 DOM 定位。可调整故障元素及其最近共同父级的结构、尺寸、位置、层级、排版、图片裁切和动画时序，但必须保留事实、可见文字、编辑 ID 与本地素材路径；不要迁就已损坏的 CSS。若画面没有客观故障，应保持原有设计，不要为了证明修改而重做页面。若问题指向 main 全画布根节点，不得移动或缩小画布，应修复真正越界或遮挡的可见子元素。`;

export function buildFrameQualityRepairSystem(canvasPreset?: CanvasPresetId): string {
  const canvas = getCanvasPreset(canvasPreset);
  return `${FRAME_QUALITY_REPAIR_SYSTEM}
- 所有普通内容必须位于 ${canvas.design.width}×${canvas.design.height} 画布内，并结束在 y=${canvas.contentArea.bottom} 以上。
- 字幕区域为 y=${canvas.subtitleArea.top}–${canvas.subtitleArea.bottom}，不得把普通内容放入字幕区域。${buildPortraitVisualGuidance(canvasPreset)}`;
}

function buildFrameQualityRepairPromptLegacy(opts: {
  frame: FrameOutline;
  htmlCode: string;
  issues: LayoutIssue[];
  visualSamples?: Pick<VisualRepairSample, 'progress' | 'label' | 'issues'>[];
  previousError?: string;
}): string {
  const issues = opts.issues.map((issue, index) => ({
    index: index + 1,
    code: issue.code,
    severity: issue.severity || 'major',
    label: issue.label,
    detail: issue.detail,
    elementId: issue.elementId,
    relatedElementId: issue.relatedElementId,
    suggestedFix: issue.suggestedFix,
  }));
  const previous = opts.previousError
    ? `\n\n【上一次修复未通过本地保护】\n${opts.previousError}\n请重新修复，不要重复同一错误。`
    : '';
  const visualEvidence = opts.visualSamples?.length
    ? `\n\n【视觉证据（已作为独立图片输入）】\n${opts.visualSamples.map((sample, index) => (
      `- 图 ${index + 1}：${sample.label}（${Math.round(sample.progress * 100)}%），${sample.issues.length} 项 DOM 问题${sample.label === '100%' ? '；终态主证据，权重最高' : ''}`
    )).join('\n')}\n${buildVisualEvidenceInstruction(opts.visualSamples)}`
    : '';
  return `【当前分镜重要信息】
标题：${opts.frame.title}
旁白：${opts.frame.narration || ''}
画面提示：${opts.frame.htmlPrompt || ''}
SceneSpec：${JSON.stringify(opts.frame.sceneSpec || {}, null, 2)}

【DOM 自检问题】
${JSON.stringify(issues, null, 2)}${visualEvidence}

问题中的 elementId / relatedElementId 对应 HTML 的 data-editor-id。suggestedFix 只是几何参考，不是强制答案；请结合完整父子布局选择正确修复对象。

【当前完整 HTML】
${stripApplicationLayoutGuard(opts.htmlCode)}${previous}

请直接输出修复后的完整 HTML。`;
}

export function buildFrameQualityRepairPrompt(opts: {
  frame: FrameOutline;
  htmlCode: string;
  issues: LayoutIssue[];
  visualSamples?: Pick<VisualRepairSample, 'progress' | 'label' | 'issues'>[];
  previousError?: string;
}): string {
  const rootCanvasId = findRootCanvasElementId(opts.htmlCode);
  const rootCanvasIssue = rootCanvasId && opts.issues.some(issue => issue.elementId === rootCanvasId);
  const issues = opts.issues.map((issue, index) => ({
    index: index + 1,
    code: issue.code,
    severity: issue.severity || 'major',
    label: issue.label,
    detail: issue.detail,
    elementId: issue.elementId,
    relatedElementId: issue.relatedElementId,
    suggestedFix: issue.suggestedFix,
  }));
  const evidenceSummary = (opts.visualSamples || []).map((sample, index) => (
    `图${index + 1}=${sample.label}/${sample.issues.length}项${sample.label === '100%' ? '/终态主证据' : ''}`
  )).join('；');
  const sceneSpec = opts.frame.sceneSpec;
  const visualInstruction = buildVisualEvidenceInstruction(opts.visualSamples || []);
  const frameContext = [
    `标题=${compactRepairText(opts.frame.title)}`,
    opts.frame.htmlPrompt ? `意图=${compactRepairText(opts.frame.htmlPrompt)}` : '',
    sceneSpec?.relationship ? `关系=${sceneSpec.relationship}` : '',
    sceneSpec?.actionSemantics ? `动作=${compactRepairText(sceneSpec.actionSemantics)}` : '',
  ].filter(Boolean).join('；');
  return `${VISUAL_REPAIR_FREEDOM}

${visualInstruction} DOM 问题只用于定位，截图中真实可见的遮挡、裁切、越界和不可读内容才是修复目标。

${rootCanvasIssue
    ? `特别注意：${rootCanvasId} 是全画布根节点，不得移动；请修复造成问题的可见子元素。`
    : '从问题元素 ID 出发，同时检查它的父级和可见相邻元素。'}

【镜头】${frameContext}
【截图】${evidenceSummary || '图1=100%/终态主证据'}
【DOM 问题】${JSON.stringify(issues)}

只输出修复后的完整 HTML。必须保留全部可见事实、文字、编辑 ID、标签和本地素材路径；存在可见故障时不得近乎原样返回，没有客观故障时不得任意重做。

【当前 HTML】
${stripApplicationLayoutGuard(opts.htmlCode)}${opts.previousError ? `\n\n【上次失败】${compactRepairText(opts.previousError, 500)}` : ''}`;
}

export async function repairFrameHtmlWithAI(opts: {
  frame: FrameOutline;
  htmlCode: string;
  issues: LayoutIssue[];
  abortSignal?: AbortSignal;
  canvasPreset?: CanvasPresetId;
  visualSamples: VisualRepairSample[];
}): Promise<string> {
  return runVisualRepairWithRetry({
    ...opts,
    stage: 'AI 画面自检修复',
    system: buildFrameQualityRepairSystem(opts.canvasPreset),
    temperature: 0.15,
    prepare: output => {
      const extracted = extractHtmlDocument(output);
      validateGeneratedHtml(extracted);
      const repaired = sanitizeHtml(extracted, opts.canvasPreset);
      validateGeneratedHtml(repaired);
      return repaired;
    },
  });
}

export async function repairFreeFrameHtmlWithAI(opts: {
  frame: FrameOutline;
  htmlCode: string;
  issues: LayoutIssue[];
  abortSignal?: AbortSignal;
  canvasPreset?: CanvasPresetId;
  visualSamples: VisualRepairSample[];
}): Promise<string> {
  const canvas = getCanvasPreset(opts.canvasPreset);
  return runVisualRepairWithRetry({
    ...opts,
    stage: 'GPT 自由画面故障修复',
    system: `${FREE_FRAME_QUALITY_REPAIR_SYSTEM}\n- 画布为 ${canvas.design.width}×${canvas.design.height}。普通内容必须结束在 y=${canvas.contentArea.bottom} 之前；字幕区为 y=${canvas.subtitleArea.top}–${canvas.subtitleArea.bottom}。`,
    temperature: 0.1,
    prepare: output => {
      const extracted = extractHtmlDocument(output);
      validateFreeGeneratedHtml(extracted);
      const repaired = sanitizeFreeHtml(extracted);
      validateFreeGeneratedHtml(repaired);
      return repaired;
    },
  });
}

async function runVisualRepairWithRetry(opts: {
  frame: FrameOutline;
  htmlCode: string;
  issues: LayoutIssue[];
  abortSignal?: AbortSignal;
  visualSamples: VisualRepairSample[];
  stage: string;
  system: string;
  temperature: number;
  prepare: (output: string) => string;
}): Promise<string> {
  const images = buildRequiredVisualRepairInputs(opts.visualSamples);
  let previousError = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await callAIHtml({
        stage: opts.stage,
        system: opts.system,
        user: buildFrameQualityRepairPrompt({ ...opts, previousError: previousError || undefined }),
        temperature: opts.temperature,
        maxRetries: 0,
        singleRequest: true,
        requiresVision: true,
        reasoningEffort: 'medium',
        traceAttempt: attempt,
        traceMaxAttempts: 2,
        images,
        abortSignal: opts.abortSignal,
      });
      const repaired = opts.prepare(result.output);
      assertRepairPreservesImportantInformation(opts.htmlCode, repaired);
      return repaired;
    } catch (error) {
      if (attempt >= 2 || !shouldRetryFrameQualityRepair(error, opts.abortSignal)) throw error;
      previousError = compactRepairText(error instanceof Error ? error.message : String(error), 500);
      await waitForVisualRepairRetry(opts.abortSignal);
    }
  }
  throw new Error('视觉修复请求失败');
}

export function shouldRetryFrameQualityRepair(error: unknown, abortSignal?: AbortSignal): boolean {
  if (abortSignal?.aborted || isVisionUnavailableError(error)) return false;
  const details = error as { name?: unknown; status?: unknown };
  if (details?.name === 'AbortError') return false;
  const status = typeof details?.status === 'number' ? details.status : Number(details?.status);
  if (status === 401 || status === 403) return false;
  const message = error instanceof Error ? error.message : String(error);
  if (/api.?key|credential|unauthori[sz]ed|forbidden|凭据|密钥/i.test(message)) return false;
  return true;
}

function waitForVisualRepairRetry(abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => abortSignal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, 400);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortSignal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A quality repair always has visual evidence: either the final state alone
 * for a simple frame, or the full animation evidence for a complex frame.
 */
function buildRequiredVisualRepairInputs(samples: VisualRepairSample[]) {
  const expectedPoints = samples.length === VISUAL_REPAIR_SINGLE_SAMPLE_POINT.length
    ? VISUAL_REPAIR_SINGLE_SAMPLE_POINT
    : VISUAL_REPAIR_SAMPLE_POINTS;
  const expectedLabels = samples.length === VISUAL_REPAIR_SINGLE_SAMPLE_POINT.length
    ? ['100%']
    : VISUAL_REPAIR_SAMPLE_LABELS;
  if (samples.length !== expectedPoints.length) throw new Error('视觉修复必须携带一张 100% 终态图，或完整的 35%、70%、100% 三张分镜截图。');

  return samples.map((sample, index) => {
    const expectedProgress = expectedPoints[index];
    const expectedLabel = expectedLabels[index];
    if (sample.progress !== expectedProgress || sample.label !== expectedLabel || !sample.image) {
      throw new Error('视觉修复截图必须是单张 100% 终态图，或按 35%、70%、100% 顺序完整传入。');
    }
    return {
      dataUrl: sample.image.dataUrl,
      mimeType: sample.image.mimeType,
      byteLength: sample.image.byteLength,
      label: sample.label,
    };
  });
}

function buildVisualEvidenceInstruction(samples: ReadonlyArray<Pick<VisualRepairSample, 'progress' | 'label'>>): string {
  if (samples.length === 1 && samples[0]?.progress === 1 && samples[0]?.label === '100%') {
    return '当前只提供一张 100% 终态图；该镜头经本地复检判定为简单静态画面，请以这张图审核最终构图、层级和可读性。';
  }
  return '三张图片按 35%、70%、100% 排列，缺一不可；先用 100% 锁定终态，再用前两张检查入场过程。';
}

function findRootCanvasElementId(html: string): string | undefined {
  const root = html.match(/<main\b[^>]*\bdata-editor-id\s*=\s*["']([^"']+)["'][^>]*>/i);
  return root?.[1];
}

export function assertRepairPreservesImportantInformation(beforeHtml: string, afterHtml: string): void {
  const missingText = visibleTextChunks(beforeHtml).filter(text => !normalizeText(visibleMarkup(afterHtml)).includes(normalizeText(text)));
  if (missingText.length) throw new Error(`AI 修复删除或改写了原有屏幕文字：${missingText.slice(0, 5).join('、')}`);

  const beforeIds = new Set(Array.from(beforeHtml.matchAll(/\bdata-editor-id\s*=\s*["']([^"']+)["']/gi), match => match[1]));
  const afterIds = new Set(Array.from(afterHtml.matchAll(/\bdata-editor-id\s*=\s*["']([^"']+)["']/gi), match => match[1]));
  const missingIds = [...beforeIds].filter(id => !afterIds.has(id));
  if (missingIds.length) throw new Error(`AI 修复丢失了可编辑元素 ID：${missingIds.slice(0, 8).join('、')}`);

  const localAssets = new Set(Array.from(beforeHtml.matchAll(/["'](\/api\/data\/[^"']+)["']/gi), match => match[1]));
  const missingAssets = [...localAssets].filter(path => !afterHtml.includes(path));
  if (missingAssets.length) throw new Error(`AI 修复丢失了本地素材：${missingAssets.slice(0, 3).join('、')}`);
}

function stripApplicationLayoutGuard(html: string): string {
  return html.replace(/<style\b[^>]*\bdata-ai-layout-guard\b[^>]*>[\s\S]*?<\/style>\s*/gi, '');
}

function compactRepairText(value: string, maxChars = 240): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function visibleMarkup(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ');
}

function visibleTextChunks(html: string): string[] {
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  return [...new Set(markup.split(/<[^>]+>/g).map(normalizeText).filter(text => text.length >= 2))];
}

function normalizeText(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, '')
    .trim();
}
