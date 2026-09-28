import { env } from '@/lib/env';
import { getTaskAIKeySnapshot } from '@/lib/ai-key-context';
import {
  callGPTFreeCodexHtml,
  callGPTFreeCodexJson,
  callGPTFreeCodexText,
  GPTFreeCodexOutputError,
} from './providers/gpt-free-codex';
import { selectReasoningEffort } from './providers/gpt-relay';
import type { CodexTestImageInput } from './codex-test-images';

/** All project-generation calls use the GPT-free Codex Responses transport. */
export const DEFAULT_MODEL = env.AI_MODEL;
export const GPT_FREE_JSON_TIMEOUT_MS = 240_000;
const GPT_FREE_TEXT_TIMEOUT_MS = 120_000;
const GPT_FREE_HTML_TIMEOUT_MS = 200_000;

export interface AIHtmlResult {
  output: string;
  finishReason: string | null;
  outputLength: number;
  reasoningLength: number;
  lengthLimited: boolean;
  emptyOutput: boolean;
}

export interface AIHtmlImageInput {
  dataUrl: string;
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  byteLength?: number;
  label?: string;
}

export class VisionUnavailableError extends Error {
  readonly code = 'vision_unavailable' as const;

  constructor(message = '当前模型不支持视觉输入。', options?: ErrorOptions) {
    super(message, options);
    this.name = 'VisionUnavailableError';
  }
}

export function isVisionUnavailableError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof VisionUnavailableError) return true;
    if (typeof current === 'object' && current && 'code' in current && (current as { code?: unknown }).code === 'vision_unavailable') return true;
    const message = current instanceof Error ? current.message : String(current);
    if (/(vision|multimodal|image input|image_url|input_image)/i.test(message)
      && /(unsupported|not supported|not available|does not support|unknown|unrecognized|invalid parameter)/i.test(message)) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

export class AIJsonParseError extends Error {
  constructor(
    message: string,
    readonly output: string,
    readonly finishReason: string | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AIJsonParseError';
  }
}

export async function callAIJson<T = unknown>(opts: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  noThinking?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  stage?: string;
  abortSignal?: AbortSignal;
  images?: AIHtmlImageInput[];
  requiresVision?: boolean;
  singleRequest?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
}): Promise<T> {
  const credential = await getTaskAIKeySnapshot();
  const model = opts.model ?? credential.model;
  const stage = opts.stage || '未标注调用';
  const requiresVision = opts.requiresVision === true || Boolean(opts.images?.length);
  if (requiresVision && isConfiguredTextOnlyModel(model)) throw new VisionUnavailableError();
  const system = withJsonObjectInstruction(withGPTSystemOverlay(opts.system, credential.gptOptimization.enabled, 'json'));
  try {
    return await callGPTFreeCodexJson<T>({
      credential,
      model,
      stage,
      system,
      user: opts.user,
      abortSignal: opts.abortSignal,
      timeoutMs: opts.timeoutMs ?? GPT_FREE_JSON_TIMEOUT_MS,
      maxRetries: requiresVision ? 0 : opts.maxRetries ?? 1,
      images: toCodexImages(opts.images),
      reasoningEffort: opts.reasoningEffort ?? selectReasoningEffort(credential.gptOptimization, stage),
    });
  } catch (error) {
    if (error instanceof GPTFreeCodexOutputError) {
      throw new AIJsonParseError(
        `${error.message} (finish_reason=${error.finishReason ?? 'unknown'}, output.length=${error.output.length})`,
        error.output,
        error.finishReason,
        { cause: error },
      );
    }
    throw error;
  }
}

export function callAIVisionJson<T = unknown>(opts: {
  system: string;
  user: string;
  images: AIHtmlImageInput[];
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  stage?: string;
  abortSignal?: AbortSignal;
}): Promise<T> {
  return callAIJson<T>({ ...opts, maxRetries: 0, requiresVision: true, singleRequest: true });
}

export async function callAIText(opts: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxRetries?: number;
  timeoutMs?: number;
  stage?: string;
  abortSignal?: AbortSignal;
  reasoningEffort?: 'low' | 'medium' | 'high';
}): Promise<string> {
  const credential = await getTaskAIKeySnapshot();
  const stage = opts.stage || '未标注调用';
  return callGPTFreeCodexText({
    credential,
    model: opts.model ?? credential.model,
    stage,
    system: withGPTSystemOverlay(opts.system, credential.gptOptimization.enabled, 'text'),
    user: opts.user,
    abortSignal: opts.abortSignal,
    timeoutMs: opts.timeoutMs ?? GPT_FREE_TEXT_TIMEOUT_MS,
    reasoningEffort: opts.reasoningEffort ?? selectReasoningEffort(credential.gptOptimization, stage),
  });
}

export async function callAIHtml(opts: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  noThinking?: boolean;
  allowEmptyOutput?: boolean;
  traceAttempt?: number;
  traceMaxAttempts?: number;
  maxRetries?: number;
  timeoutMs?: number;
  stage?: string;
  abortSignal?: AbortSignal;
  images?: AIHtmlImageInput[];
  requiresVision?: boolean;
  singleRequest?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
}): Promise<AIHtmlResult> {
  const credential = await getTaskAIKeySnapshot();
  const model = opts.model ?? credential.model;
  const stage = opts.stage || 'HTML 生成';
  if (opts.requiresVision && isConfiguredTextOnlyModel(model)) throw new VisionUnavailableError();
  try {
    return await callGPTFreeCodexHtml({
      credential,
      model,
      stage,
      system: withGPTSystemOverlay(opts.system, credential.gptOptimization.enabled, 'html'),
      user: opts.user,
      abortSignal: opts.abortSignal,
      timeoutMs: opts.timeoutMs ?? GPT_FREE_HTML_TIMEOUT_MS,
      allowEmptyOutput: opts.allowEmptyOutput,
      images: toCodexImages(opts.images),
      reasoningEffort: opts.reasoningEffort ?? selectReasoningEffort(credential.gptOptimization, stage),
      traceAttempt: opts.traceAttempt,
      traceMaxAttempts: opts.traceMaxAttempts,
    });
  } catch (error) {
    if (opts.requiresVision && isVisionUnavailableError(error)) {
      throw new VisionUnavailableError('当前模型不支持视觉输入。', { cause: error });
    }
    throw error;
  }
}

function withGPTSystemOverlay(system: string, enabled: boolean, mode: 'json' | 'text' | 'html'): string {
  if (!enabled) return system;
  const formatRule = mode === 'json'
    ? '只输出合法 JSON 对象，不要使用 Markdown 代码围栏。'
    : mode === 'html'
      ? '只输出完整 HTML；不要输出解释或 Markdown 代码围栏。'
      : '直接输出任务结果。';
  return `${system}\n\n【GPT 创作约束】\n1. 用户明确指定的数量、标题、时长和范围是硬约束，未经用户同意不得擅自缩减或改写。\n2. 不要声称已经联网或已经获取图片；只有调用方提供的研究资料才可视为联网证据。\n3. 你不直接下载或生成图片，但在视觉规划任务中可以输出 assetRequest、assetSubjects 等结构化素材请求；程序会据此调用内部搜图并把结果交给后续阶段。\n4. ${formatRule}`;
}

function withJsonObjectInstruction(system: string): string {
  return `${system}\n\nReturn exactly one valid json object. Do not use markdown fences or prose outside the json object.`;
}

function isConfiguredTextOnlyModel(model: string): boolean {
  return /text[-_ ]?only|embedding|whisper|tts|speech[-_ ]?to[-_ ]?text|coder(?:[-_ ]?(?:base|instruct))?$/i.test(model);
}

function toCodexImages(images?: AIHtmlImageInput[]): CodexTestImageInput[] | undefined {
  if (!images?.length) return undefined;
  return images.map(image => ({
    dataUrl: image.dataUrl,
    mimeType: image.mimeType || 'image/png',
    byteSize: image.byteLength || estimateDataUrlBytes(image.dataUrl),
    label: image.label,
  }));
}

function estimateDataUrlBytes(dataUrl: string): number {
  const encoded = dataUrl.split(',', 2)[1] || '';
  return Math.floor(encoded.length * 0.75);
}
