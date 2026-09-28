import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { ensureEditableElementIds } from '@/lib/editor-command';
import { sanitizeAiHtml, wrapHtmlWithWatchdog } from '@/lib/iframe-utils';
import { getCanvasPreset } from '@/lib/canvas-presets';
import { findChromiumExecutable, resolveDataUrlPath } from '@/lib/render/paths';
import type { CanvasPresetId, LayoutIssue } from '@/types';
import { mergeLayoutIssues } from './quality-vector';

export const VISUAL_REPAIR_SAMPLE_POINTS = [0.35, 0.7, 1] as const;
export const VISUAL_REPAIR_SAMPLE_LABELS = ['35%', '70%', '100%'] as const;
export const VISUAL_REPAIR_SINGLE_SAMPLE_POINT = [1] as const;
export const VISUAL_REPAIR_SIMPLE_ISSUE_LIMIT = 5;
export const VISUAL_REPAIR_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const VISUAL_REPAIR_MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;
export const VISUAL_REPAIR_SAMPLE_TIMEOUT_MS = 30_000;

export type VisualRepairFailureCode =
  | 'cancelled'
  | 'sampling_timeout'
  | 'invalid_image'
  | 'renderer_unavailable'
  | 'render_failed';

export class VisualRepairError extends Error {
  constructor(
    message: string,
    readonly code: VisualRepairFailureCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'VisualRepairError';
  }
}

export interface VisualRepairImage {
  /** The image data exists only for the active request and must never be persisted. */
  dataUrl: string;
  mimeType: 'image/png';
  byteLength: number;
  width: number;
  height: number;
}

export interface VisualRepairSample {
  progress: number;
  label: string;
  issues: LayoutIssue[];
  image?: VisualRepairImage;
}

export interface VisualRepairSamplingSummary {
  nonce: string;
  samplePoints: number[];
  issueCounts: number[];
  pointsWithIssues: number[];
  imageCount: number;
  totalImageBytes: number;
  durationMs: number;
}

export interface VisualRepairSamples {
  nonce: string;
  samples: VisualRepairSample[];
  summary: VisualRepairSamplingSummary;
}

export interface VisualRepairRenderedSample {
  image: Uint8Array | Buffer | string;
  issues: LayoutIssue[];
  width?: number;
  height?: number;
}

export interface VisualRepairSampleRenderer {
  renderSample(input: {
    htmlCode: string;
    durationSeconds: number;
    progress: number;
    canvasPreset?: CanvasPresetId;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    nonce: string;
  }): Promise<VisualRepairRenderedSample>;
  close?: () => Promise<void>;
}

export interface CaptureVisualRepairSamplesOptions {
  htmlCode: string;
  durationSeconds?: number;
  canvasPreset?: CanvasPresetId;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  samplePoints?: readonly number[];
  includeImages?: boolean;
  maxImageBytes?: number;
  maxTotalImageBytes?: number;
  renderer?: VisualRepairSampleRenderer;
}

const THREE_POINT_ISSUE_CODES = new Set<LayoutIssue['code']>([
  'clipped',
  'out_of_bounds',
  'platform_safe_area',
  'subtitle_safe_area',
  'text_occluded',
  'semantic_overlap',
  'invisible',
  'audit_timeout',
]);

/**
 * Every frame receives visual review. Simple, static frames need only the final
 * state; temporal or structural faults retain the full three-point evidence.
 */
export function selectVisualRepairSamplePoints(issues: readonly LayoutIssue[]): readonly number[] {
  if (issues.length > VISUAL_REPAIR_SIMPLE_ISSUE_LIMIT) return VISUAL_REPAIR_SAMPLE_POINTS;
  if (issues.some(issue => issue.severity === 'critical' || THREE_POINT_ISSUE_CODES.has(issue.code))) {
    return VISUAL_REPAIR_SAMPLE_POINTS;
  }
  if (issues.some(issue => /\[(?:animation\s+)?progress\s+(?:35|70)%\]|过程|动画|入场|出场|时序/i.test(issue.detail))) {
    return VISUAL_REPAIR_SAMPLE_POINTS;
  }
  return VISUAL_REPAIR_SINGLE_SAMPLE_POINT;
}

/**
 * Capture one final-state image or three ordered animation images for a repair
 * request. Images are kept in
 * the returned object only so the caller can immediately pass them to the
 * multimodal request; the summary contains no image data and is safe to log
 * or persist with a quality report.
 */
export async function captureVisualRepairSamples(
  options: CaptureVisualRepairSamplesOptions,
): Promise<VisualRepairSamples> {
  const startedAt = Date.now();
  const nonce = randomUUID();
  const samplePoints = normalizeSamplePoints(options.samplePoints ?? VISUAL_REPAIR_SAMPLE_POINTS);
  const durationSeconds = Math.max(0.1, options.durationSeconds ?? 3);
  const timeoutMs = Math.max(500, options.timeoutMs ?? VISUAL_REPAIR_SAMPLE_TIMEOUT_MS);
  const includeImages = options.includeImages !== false;
  const maxImageBytes = options.maxImageBytes ?? VISUAL_REPAIR_MAX_IMAGE_BYTES;
  const maxTotalImageBytes = options.maxTotalImageBytes ?? VISUAL_REPAIR_MAX_TOTAL_IMAGE_BYTES;
  const samples: VisualRepairSample[] = [];
  let totalImageBytes = 0;
  let renderer = options.renderer;
  let ownsRenderer = false;

  try {
    throwIfAborted(options.abortSignal);
    if (!renderer) {
      renderer = await createPlaywrightSampleRenderer(options.canvasPreset);
      ownsRenderer = true;
    }

    for (const progress of samplePoints) {
      throwIfAborted(options.abortSignal);
      const rendered = await withSampleDeadline(
        renderer.renderSample({
          htmlCode: options.htmlCode,
          durationSeconds,
          progress,
          canvasPreset: options.canvasPreset,
          timeoutMs,
          abortSignal: options.abortSignal,
          nonce,
        }),
        timeoutMs,
        options.abortSignal,
      );
      throwIfAborted(options.abortSignal);

      const issues = annotateSampleIssues(rendered.issues, progress);
      let image: VisualRepairImage | undefined;
      if (includeImages) {
        const validated = validateVisualRepairImage(rendered.image, {
          maxBytes: maxImageBytes,
          expectedWidth: rendered.width,
          expectedHeight: rendered.height,
        });
        totalImageBytes += validated.byteLength;
        if (totalImageBytes > maxTotalImageBytes) {
          throw new VisualRepairError('视觉采样截图总大小超过限制。', 'invalid_image');
        }
        image = validated;
      }
      samples.push({
        progress,
        label: labelForProgress(progress),
        issues,
        ...(image ? { image } : {}),
      });
    }

    return {
      nonce,
      samples,
      summary: {
        nonce,
        samplePoints: samples.map(sample => sample.progress),
        issueCounts: samples.map(sample => sample.issues.length),
        pointsWithIssues: samples.filter(sample => sample.issues.length).map(sample => sample.progress),
        imageCount: samples.filter(sample => sample.image).length,
        totalImageBytes,
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    if (error instanceof VisualRepairError) throw error;
    if (isAbortError(error) || options.abortSignal?.aborted) {
      throw new VisualRepairError('视觉采样已取消。', 'cancelled', { cause: error });
    }
    throw new VisualRepairError('视觉采样失败。', 'render_failed', { cause: error });
  } finally {
    if (ownsRenderer) await renderer?.close?.().catch(() => undefined);
  }
}

/** Run the same controlled renderer without retaining screenshots. */
export async function auditVisualRepairHtml(options: Omit<CaptureVisualRepairSamplesOptions, 'includeImages'> & {
  samplePoints: readonly number[];
}): Promise<VisualRepairSamples> {
  return captureVisualRepairSamples({ ...options, includeImages: false });
}

export function shouldRunThreePointVerification(options: {
  originalIssues: readonly LayoutIssue[];
  sampledIssues?: ReadonlyArray<{ progress: number; issues: readonly LayoutIssue[] }>;
  beforeHtml: string;
  afterHtml?: string;
}): boolean {
  const sampledIssues = options.sampledIssues ?? [];
  if (sampledIssues.some(sample => sample.progress < 0.999 && sample.issues.length > 0)) return true;
  if (options.originalIssues.some(issue => (
    /\[(?:animation\s+)?progress\s+(?:35|70)%\]/i.test(issue.detail)
    || /(过程|动画|入场|出场|时序)/i.test(issue.detail)
  ))) return true;
  if (!options.afterHtml) return false;
  return hasTimingMutation(options.beforeHtml, options.afterHtml);
}

export function hasTimingMutation(beforeHtml: string, afterHtml: string): boolean {
  const timingPattern = /@keyframes\b|animation(?:-[\w-]+)?\s*:|transition(?:-[\w-]+)?\s*:|transform\s*:/i;
  return timingPattern.test(beforeHtml) !== timingPattern.test(afterHtml)
    || extractTimingDeclarations(beforeHtml) !== extractTimingDeclarations(afterHtml);
}

export function validateVisualRepairImage(
  value: Uint8Array | Buffer | string,
  options: {
    maxBytes?: number;
    expectedWidth?: number;
    expectedHeight?: number;
  } = {},
): VisualRepairImage {
  const maxBytes = options.maxBytes ?? VISUAL_REPAIR_MAX_IMAGE_BYTES;
  const parsed = typeof value === 'string'
    ? parsePngDataUrl(value)
    : parsePngBytes(value);
  if (!parsed || parsed.byteLength < 1 || parsed.byteLength > maxBytes) {
    throw new VisualRepairError('采样截图不是有效的 PNG 或超过大小限制。', 'invalid_image');
  }
  if (options.expectedWidth && parsed.width !== options.expectedWidth) {
    throw new VisualRepairError('采样截图尺寸与画布不一致。', 'invalid_image');
  }
  if (options.expectedHeight && parsed.height !== options.expectedHeight) {
    throw new VisualRepairError('采样截图尺寸与画布不一致。', 'invalid_image');
  }
  return {
    dataUrl: parsed.dataUrl,
    mimeType: 'image/png',
    byteLength: parsed.byteLength,
    width: parsed.width,
    height: parsed.height,
  };
}

export function safeVisualRepairSummary(error: unknown): string {
  if (error instanceof VisualRepairError) {
    if (error.code === 'cancelled') return '视觉修复已取消，保留当前画面。';
    if (error.code === 'sampling_timeout') return '视觉采样超时，保留当前画面。';
    if (error.code === 'invalid_image') return '视觉采样图片无效，保留当前画面。';
    if (error.code === 'renderer_unavailable') return '当前环境无法启动受控渲染器，保留当前画面。';
    return '视觉采样失败，保留当前画面。';
  }
  return '视觉修复未完成，保留当前画面。';
}

async function createPlaywrightSampleRenderer(canvasPreset?: CanvasPresetId): Promise<VisualRepairSampleRenderer> {
  let executablePath: string;
  try {
    executablePath = await findChromiumExecutable();
  } catch (error) {
    throw new VisualRepairError('未找到受控 Chromium/Edge。', 'renderer_unavailable', { cause: error });
  }

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--allow-file-access-from-files', '--disable-dev-shm-usage', '--hide-scrollbars'],
    });
    const canvas = getCanvasPreset(canvasPreset);
    context = await browser.newContext({
      viewport: { width: canvas.design.width, height: canvas.design.height },
      deviceScaleFactor: 1,
    });
    page = await context.newPage();
    await page.addInitScript(() => {
      const state = window as typeof window & {
        __visualRepairAudit?: LayoutIssue[];
        __ai_video_layout_audit?: LayoutIssue[];
      };
      state.__visualRepairAudit = undefined;
      state.__ai_video_layout_audit = undefined;
    });
  } catch (error) {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    throw new VisualRepairError('受控渲染器启动失败。', 'renderer_unavailable', { cause: error });
  }

  const activeBrowser = browser;
  const activePage = page;
  return {
    async renderSample(input) {
      if (!activePage) throw new VisualRepairError('受控渲染页面不可用。', 'renderer_unavailable');
      throwIfAborted(input.abortSignal);
      const canvas = getCanvasPreset(input.canvasPreset ?? canvasPreset);
      const auditToken = `${input.nonce}:${Math.round(input.progress * 1000)}`;
      const selfContainedHtml = await inlineLocalDataUrls(input.htmlCode);
      const html = wrapHtmlWithWatchdog(
        sanitizeAiHtml(ensureEditableElementIds(selfContainedHtml), input.canvasPreset ?? canvasPreset),
        Math.max(8_000, Math.ceil(input.durationSeconds * 1000) + 1_500),
        {
          settleAnimationsBeforeAudit: true,
          auditAnimationProgress: input.progress,
          auditToken,
          canvasPreset: input.canvasPreset ?? canvasPreset,
        },
      );
      try {
        await activePage.setContent(html, { waitUntil: 'domcontentloaded', timeout: input.timeoutMs });
        await activePage.waitForFunction(
          expectedAuditToken => {
            const state = window as typeof window & {
              __visualRepairAudit?: LayoutIssue[];
              __ai_video_layout_audit?: LayoutIssue[];
              __ai_video_layout_audit_token?: string;
            };
            return state.__ai_video_layout_audit_token === expectedAuditToken
              && Array.isArray(state.__ai_video_layout_audit);
          },
          auditToken,
          { timeout: input.timeoutMs },
        );
        throwIfAborted(input.abortSignal);
        const issues = await activePage.evaluate(() => (
          (window as typeof window & {
            __visualRepairAudit?: LayoutIssue[];
            __ai_video_layout_audit?: LayoutIssue[];
          }).__ai_video_layout_audit || []
        ));
        const image = await activePage.screenshot({ type: 'png', animations: 'allow' });
        return { image, issues, width: canvas.design.width, height: canvas.design.height };
      } catch (error) {
        if (isAbortError(error) || input.abortSignal?.aborted) {
          throw new VisualRepairError('视觉采样已取消。', 'cancelled', { cause: error });
        }
        if (error instanceof Error && /timeout/i.test(error.message)) {
          throw new VisualRepairError('受控渲染采样超时。', 'sampling_timeout', { cause: error });
        }
        throw new VisualRepairError('受控渲染采样失败。', 'render_failed', { cause: error });
      }
    },
    async close() {
      await activePage?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
      await activeBrowser?.close().catch(() => undefined);
    },
  };
}

function normalizeSamplePoints(points: readonly number[]): number[] {
  const normalized = points
    .map(point => Number(point))
    .filter(point => Number.isFinite(point) && point >= 0 && point <= 1)
    .map(point => Number(point.toFixed(3)));
  const unique = [...new Set(normalized)];
  return unique.length ? unique : [...VISUAL_REPAIR_SAMPLE_POINTS];
}

function labelForProgress(progress: number): string {
  const defaultIndex = VISUAL_REPAIR_SAMPLE_POINTS.findIndex(point => point === progress);
  return defaultIndex >= 0 ? VISUAL_REPAIR_SAMPLE_LABELS[defaultIndex] : `${Math.round(progress * 100)}%`;
}

function annotateSampleIssues(issues: LayoutIssue[], progress: number): LayoutIssue[] {
  return mergeLayoutIssues(issues.map(issue => ({
    ...issue,
    detail: `[animation progress ${Math.round(progress * 100)}%] ${issue.detail}`,
  })));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new VisualRepairError('视觉采样已取消。', 'cancelled', { cause: signal.reason });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted|cancelled|取消|停止/i.test(error.message));
}

async function withSampleDeadline<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finishReject(new VisualRepairError('视觉采样超时。', 'sampling_timeout')), timeoutMs);
    const abort = () => finishReject(new VisualRepairError('视觉采样已取消。', 'cancelled', { cause: signal?.reason }));
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const finishResolve = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(finishResolve, finishReject);
  });
}

function parsePngDataUrl(value: string): { dataUrl: string; byteLength: number; width: number; height: number } | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]*={0,2})$/.exec(value.trim());
  if (!match || !match[1] || match[1].length % 4 !== 0) return null;
  const buffer = Buffer.from(match[1], 'base64');
  const parsed = parsePngBytes(buffer);
  return parsed ? { ...parsed, dataUrl: value.trim() } : null;
}

function parsePngBytes(value: Uint8Array): { dataUrl: string; byteLength: number; width: number; height: number } | null {
  if (value.byteLength < 24) return null;
  const bytes = Buffer.from(value);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature) || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height) return null;
  return {
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    byteLength: bytes.byteLength,
    width,
    height,
  };
}

function extractTimingDeclarations(html: string): string {
  return html
    .match(/@keyframes[\s\S]*?|(?:animation|transition|transform)(?:-[\w-]+)?\s*:[^;}]+/gi)
    ?.join('|')
    .replace(/\s+/g, ' ')
    .trim() || '';
}

async function inlineLocalDataUrls(html: string): Promise<string> {
  const pattern = /(["'])\/api\/data\/([^"'?#]+)(?:[?#][^"']*)?\1/gi;
  const matches = Array.from(html.matchAll(pattern));
  const replacements = await Promise.all(matches.map(async match => {
    const localUrl = `/api/data/${match[2]}`;
    const localPath = resolveDataUrlPath(localUrl);
    if (!localPath) throw new VisualRepairError('无法解析本地素材地址。', 'render_failed');
    try {
      const content = await readFile(localPath);
      return {
        source: match[0],
        value: `${match[1]}data:${imageMimeType(localPath)};base64,${content.toString('base64')}${match[1]}`,
      };
    } catch (error) {
      throw new VisualRepairError('无法读取本地素材。', 'render_failed', { cause: error });
    }
  }));
  let index = 0;
  return html.replace(pattern, () => replacements[index++]?.value || '');
}

function imageMimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    default: return 'image/png';
  }
}
