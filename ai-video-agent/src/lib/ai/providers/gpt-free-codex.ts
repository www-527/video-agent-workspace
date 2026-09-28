import { randomUUID } from 'node:crypto';
import type { AIKeySnapshot } from '@/lib/ai-key-store';
import { publishAITrace } from '@/lib/ai/trace';
import {
  streamCodexResponses,
  type CodexResponsesStreamEvent,
  type CodexResponsesUsage,
  type CodexResponsesInputMessage,
  type CodexReasoningEffort,
  type CodexTerminationMode,
} from './codex-responses';
import type { CodexTestImageInput } from '@/lib/ai/codex-test-images';
import { parseModelJson } from '@/lib/ai/json-output';

interface GPTFreeCodexCallOptions {
  credential: AIKeySnapshot;
  model: string;
  system: string;
  user: string;
  stage: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  allowEmptyOutput?: boolean;
  images?: CodexTestImageInput[];
  reasoningEffort?: CodexReasoningEffort;
  traceAttempt?: number;
  traceMaxAttempts?: number;
}

export interface GPTFreeCodexTextResult {
  output: string;
  finishReason: string | null;
  outputLength: number;
  reasoningLength: number;
  lengthLimited: boolean;
  emptyOutput: boolean;
}

export class GPTFreeCodexOutputError extends Error {
  constructor(
    message: string,
    readonly output: string,
    readonly finishReason: string | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GPTFreeCodexOutputError';
  }
}

export async function callGPTFreeCodexJson<T>(options: GPTFreeCodexCallOptions): Promise<T> {
  let parsed: T | undefined;
  await executeGPTFreeCodexWithRetry(options, output => {
    try {
      parsed = parseModelJson<T>(stripJsonFence(output));
    } catch (error) {
      throw new GPTFreeCodexOutputError(
        error instanceof Error ? error.message : String(error),
        output,
        'completed',
        { cause: error instanceof Error ? error : undefined },
      );
    }
  });
  return parsed as T;
}

export async function callGPTFreeCodexText(options: GPTFreeCodexCallOptions): Promise<string> {
  return (await executeGPTFreeCodex(options, undefined, options.traceAttempt ?? 1, options.traceMaxAttempts ?? 1)).output;
}

export async function callGPTFreeCodexHtml(options: GPTFreeCodexCallOptions): Promise<GPTFreeCodexTextResult> {
  return executeGPTFreeCodex(options, undefined, options.traceAttempt ?? 1, options.traceMaxAttempts ?? 1);
}

async function executeGPTFreeCodex(
  options: GPTFreeCodexCallOptions,
  validateOutput?: (output: string) => void,
  attempt = 1,
  maxAttempts = 1,
): Promise<GPTFreeCodexTextResult> {
  const id = randomUUID();
  const started = Date.now();
  let output = '';
  let responseId: string | undefined;
  let responseStatus: string | undefined;
  let usage: CodexResponsesUsage | undefined;
  let finalDurationMs: number | undefined;
  let terminationMode: CodexTerminationMode | undefined;
  let finishReason: string | null = null;
  let tracePublished = false;
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const timeoutSignal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  const requestSignal = timeoutSignal
    ? options.abortSignal
      ? AbortSignal.any([options.abortSignal, timeoutSignal])
      : timeoutSignal
    : options.abortSignal;

  try {
    for await (const event of streamCodexResponses({
      credential: { ...options.credential, model: options.model },
      instructions: options.system,
      messages: [{ role: 'user', content: options.user, images: options.images } satisfies CodexResponsesInputMessage],
      reasoningEffort: options.reasoningEffort,
      abortSignal: requestSignal,
    })) {
      if (event.type === 'response.created') {
        responseId = event.responseId ?? responseId;
        responseStatus = event.status ?? responseStatus;
      } else if (event.type === 'response.output_text.delta') {
        output += event.delta;
      } else if (event.type === 'response.completed') {
        responseId = event.responseId ?? responseId;
        responseStatus = event.status ?? 'completed';
        finishReason = event.status ?? 'completed';
        usage = event.usage;
        finalDurationMs = event.durationMs;
        terminationMode = event.terminationMode;
      } else if (event.type === 'error') {
        finalDurationMs = event.durationMs;
        terminationMode = event.terminationMode;
        throw createUpstreamError(event);
      }
    }

    if (responseStatus !== 'completed') {
      terminationMode ??= 'eof';
      throw new Error('Codex Responses 调用没有完成事件');
    }
    if (!output && !options.allowEmptyOutput) {
      throw new GPTFreeCodexOutputError('Codex Responses 返回内容为空', output, responseStatus);
    }
    validateOutput?.(output);

    publishAITrace(makeTrace());
    tracePublished = true;
    return {
      output,
      finishReason: responseStatus,
      outputLength: output.length,
      reasoningLength: 0,
      lengthLimited: false,
      emptyOutput: output.length === 0,
    };
  } catch (error) {
    if (requestSignal?.aborted) terminationMode = 'aborted';
    const normalizedError = timeoutSignal?.aborted && !options.abortSignal?.aborted
      ? new Error(`GPT Responses request exceeded ${timeoutMs}ms and was aborted`, { cause: error })
      : error;
    if (!tracePublished) publishAITrace(makeTrace(normalizedError instanceof Error ? normalizedError.message : String(normalizedError)));
    throw normalizedError;
  }

  function makeTrace(error?: string) {
    return {
      id,
      stage: options.stage,
      model: options.model,
      configuredModel: options.model,
      actualModel: options.model,
      apiMode: 'responses' as const,
      relayBaseURL: fingerprintBaseURL(options.credential.baseURL),
        requestedReasoningEffort: options.reasoningEffort ?? 'low',
        reasoningEffort: options.reasoningEffort ?? 'low',
      responseId,
      responseStatus,
      terminationMode,
      system: options.system,
      user: options.user,
      reasoning: null,
      output,
      startedAt: new Date(started).toISOString(),
      durationMs: finalDurationMs ?? Date.now() - started,
      attempt,
      maxAttempts,
      tokens: usage ? { prompt: usage.input, completion: usage.output, total: usage.total } : undefined,
      finishReason,
      outputLength: output.length,
      reasoningLength: 0,
      error,
      visualInputs: summarizeVisualInputs(options.images),
    };
  }
}

/** JSON planning calls are cheap to retry; only retry errors that indicate a transient relay outage. */
async function executeGPTFreeCodexWithRetry(
  options: GPTFreeCodexCallOptions,
  validateOutput?: (output: string) => void,
): Promise<GPTFreeCodexTextResult> {
  // Keep retries bounded, but let high-priority conversational routing make
  // four total attempts before surfacing a transient relay failure.
  const maxAttempts = Math.max(1, Math.min(4, (options.maxRetries ?? 0) + 1));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await executeGPTFreeCodex(options, validateOutput, attempt, maxAttempts);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryableGPTFreeCodexError(error, options.abortSignal)) throw error;
      await waitForGPTFreeCodexRetry(attempt, options.abortSignal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Codex Responses 调用失败');
}

function isRetryableGPTFreeCodexError(error: unknown, abortSignal?: AbortSignal): boolean {
  if (abortSignal?.aborted || error instanceof GPTFreeCodexOutputError) return false;
  const details = error as { name?: unknown; message?: unknown; status?: unknown; cause?: unknown };
  if (details?.name === 'AbortError') return false;
  const status = typeof details?.status === 'number' ? details.status : Number(details?.status);
  if (Number.isInteger(status) && (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /overload|rate.?limit|temporar|try again|gateway|service unavailable|network|socket|fetch failed|econnreset|etimedout/i.test(message);
}

function waitForGPTFreeCodexRetry(attempt: number, abortSignal?: AbortSignal): Promise<void> {
  const delayMs = 400 * attempt;
  return new Promise((resolve, reject) => {
    const cleanup = () => abortSignal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortSignal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

function summarizeVisualInputs(images?: CodexTestImageInput[]) {
  if (!images?.length) return undefined;
  return images.map(image => ({
    label: image.label,
    mimeType: image.mimeType,
    byteLength: image.byteSize,
    thumbnailDataUrl: image.dataUrl,
  }));
}

function normalizeTimeout(value: number | undefined): number | undefined {
  if (!value || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.ceil(value);
}

function createUpstreamError(event: Extract<CodexResponsesStreamEvent, { type: 'error' }>): Error {
  const error = new Error(event.message) as Error & { status?: number; error?: Record<string, unknown> };
  if (event.status) {
    error.status = event.status;
    error.error = { message: event.message, type: 'upstream_error' };
  }
  return error;
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function fingerprintBaseURL(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'invalid-base-url';
  }
}
