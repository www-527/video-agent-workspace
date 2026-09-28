import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import type { AIKeySnapshot, GPTOptimizationSettings } from '@/lib/ai-key-store';
import { publishAITrace } from '@/lib/ai/trace';
import { parseModelJson } from '@/lib/ai/json-output';

export type GPTCallMode = 'json' | 'text' | 'html';
type ReasoningEffort = 'low' | 'medium' | 'high';

interface GPTCallOptions {
  credential: AIKeySnapshot;
  mode: GPTCallMode;
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  maxRetries?: number;
  stage: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  traceAttempt?: number;
  traceMaxAttempts?: number;
  allowEmptyOutput?: boolean;
  images?: GPTCallImageInput[];
  /** A visual repair is intentionally one upstream request, including no parameter fallback. */
  singleRequest?: boolean;
}

export interface GPTCallImageInput {
  dataUrl: string;
  label?: string;
}

export interface GPTTextResult {
  output: string;
  finishReason: string | null;
  outputLength: number;
  reasoningLength: number;
  lengthLimited: boolean;
  emptyOutput: boolean;
}

export class GPTResponsesUnsupportedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GPTResponsesUnsupportedError';
  }
}

export class GPTResponsesTemporaryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GPTResponsesTemporaryError';
  }
}

export async function callGPTRelayJson<T>(options: Omit<GPTCallOptions, 'mode'>): Promise<T> {
  const result = await callGPTRelay({ ...options, mode: 'json' });
  try {
    return parseModelJson<T>(stripJsonFence(result.output));
  } catch (error) {
    throw new Error(`GPT Responses 返回的 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export async function callGPTRelayText(options: Omit<GPTCallOptions, 'mode'>): Promise<string> {
  return (await callGPTRelay({ ...options, mode: 'text' })).output;
}

export async function callGPTRelayHtml(options: Omit<GPTCallOptions, 'mode'>): Promise<GPTTextResult> {
  return callGPTRelay({ ...options, mode: 'html' });
}

async function callGPTRelay(options: GPTCallOptions): Promise<GPTTextResult> {
  const client = createGPTClient(options.credential);
  const model = options.model || options.credential.model;
  // GPT 专项优化为不稳定中转站保留至少两次有界重试；非 GPT 路径不会进入本模块。
  const maxRetries = options.singleRequest ? 0 : Math.max(options.maxRetries ?? 0, 2);
  let lastError: unknown;
  let currentUser = options.user;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.abortSignal?.aborted) throw options.abortSignal.reason ?? new Error('AI request aborted');
    const id = randomUUID();
    const started = Date.now();
    let output: string | null = null;
    let actualModel: string | undefined;
    let responseId: string | undefined;
    let responseStatus: string | undefined;
    let finishReason: string | null = null;
    let tokens: { prompt?: number; completion?: number; total?: number } | undefined;
    let downgradeReason: string | undefined;
    const requestedReasoningEffort = selectReasoningEffort(options.credential.gptOptimization, options.stage);
    let appliedReasoningEffort = requestedReasoningEffort;

    try {
      const request = makeResponsesRequest({ ...options, model, user: currentUser });
      const signal = makeRequestSignal(
        options.abortSignal,
        options.timeoutMs ?? (options.mode === 'html' ? 120_000 : 75_000),
      );
      let response: any;
      try {
        const result = options.singleRequest
          ? {
              response: await client.responses.create(request as any, { signal }),
              appliedEffort: requestedReasoningEffort,
            }
          : await createResponsesWithParameterFallback(client, request, signal, requestedReasoningEffort);
        response = result.response;
        appliedReasoningEffort = result.appliedEffort;
        downgradeReason = result.downgradeReason;
      } catch (error) {
        // Vision selection is deliberately one upstream attempt. Do not remove
        // structured-output parameters and send a second image request when a
        // relay cannot satisfy the JSON contract; the caller must fall back to
        // deterministic rule ranking instead.
        if (options.singleRequest || options.mode !== 'json' || !isStructuredOutputUnsupported(error)) throw error;
        downgradeReason = 'relay_rejected_json_object_format';
        const fallbackRequest = { ...request } as Record<string, unknown>;
        delete fallbackRequest.text;
        const result = await createResponsesWithParameterFallback(client, fallbackRequest, signal, requestedReasoningEffort);
        response = result.response;
        appliedReasoningEffort = result.appliedEffort;
        if (result.downgradeReason) downgradeReason += `;${result.downgradeReason}`;
      }

      output = readOutputText(response);
      actualModel = typeof response.model === 'string' ? response.model : undefined;
      responseId = typeof response.id === 'string' ? response.id : undefined;
      responseStatus = typeof response.status === 'string' ? response.status : undefined;
      finishReason = response.status === 'incomplete'
        ? response.incomplete_details?.reason || 'incomplete'
        : response.status || null;
      tokens = response.usage ? {
        prompt: response.usage.input_tokens,
        completion: response.usage.output_tokens,
        total: response.usage.total_tokens,
      } : undefined;

      const emptyOutput = output.length === 0;
      if (emptyOutput && !options.allowEmptyOutput) throw new Error(`GPT Responses 返回内容为空（status=${responseStatus || 'unknown'}）`);
      if (options.mode === 'json') parseModelJson(stripJsonFence(output));

      publishAITrace({
        id,
        stage: options.stage,
        model,
        configuredModel: model,
        actualModel,
        apiMode: 'responses',
        relayBaseURL: fingerprintBaseURL(options.credential.baseURL),
        requestedReasoningEffort,
        reasoningEffort: appliedReasoningEffort,
        responseId,
        responseStatus,
        downgradeReason,
        visualInputs: summarizeVisualInputs(options.images),
        system: options.system,
        user: currentUser,
        reasoning: null,
        output,
        startedAt: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        attempt: options.traceAttempt ?? attempt + 1,
        maxAttempts: options.traceMaxAttempts ?? maxRetries + 1,
        tokens,
        finishReason,
        outputLength: output.length,
        reasoningLength: 0,
      });

      return {
        output,
        finishReason,
        outputLength: output.length,
        reasoningLength: 0,
        lengthLimited: finishReason === 'max_output_tokens',
        emptyOutput,
      };
    } catch (error) {
      // Log the unmodified SDK error on the server so the relay's response body,
      // status, and request ID are available while debugging upstream failures.
      console.error(`[GPT Responses] ${options.stage} attempt ${attempt + 1} raw API error:`, error);
      if (isResponsesUnsupported(error)) {
        throw new GPTResponsesUnsupportedError('当前中转站不支持 Responses API', { cause: error });
      }
      lastError = error;
      const message = sanitizeError(error, options.credential.apiKey);
      publishAITrace({
        id,
        stage: options.stage,
        model,
        configuredModel: model,
        actualModel,
        apiMode: 'responses',
        relayBaseURL: fingerprintBaseURL(options.credential.baseURL),
        requestedReasoningEffort,
        reasoningEffort: appliedReasoningEffort,
        responseId,
        responseStatus,
        downgradeReason,
        visualInputs: summarizeVisualInputs(options.images),
        system: options.system,
        user: currentUser,
        reasoning: null,
        output,
        startedAt: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        attempt: options.traceAttempt ?? attempt + 1,
        maxAttempts: options.traceMaxAttempts ?? maxRetries + 1,
        tokens,
        finishReason,
        outputLength: output?.length ?? 0,
        reasoningLength: 0,
        error: message,
      });
      if (attempt < maxRetries) {
        if (options.mode === 'json' && isOutputRecoveryError(error)) {
          currentUser += `\n\n上一次返回为空、截断或无法解析。请只返回一个完整合法的 JSON 对象，不要使用 Markdown 代码围栏。错误：${message}`;
        }
        if (isTemporaryRelayError(error)) {
          await waitForRetry(attempt, options.abortSignal);
        } else if (options.mode !== 'json' || !isOutputRecoveryError(error)) {
          break;
        }
      }
    }
  }

  if (lastError && isTemporaryRelayError(lastError)) {
    throw new GPTResponsesTemporaryError(
      `GPT Responses 中转暂时不可用：${sanitizeError(lastError, options.credential.apiKey)}`,
      { cause: lastError },
    );
  }
  throw new Error(lastError ? sanitizeError(lastError, options.credential.apiKey) : 'GPT Responses 调用失败');
}

export function createGPTClient(credential: AIKeySnapshot): OpenAI {
  return new OpenAI({
    apiKey: credential.apiKey,
    baseURL: credential.baseURL,
    // Some OpenAI-compatible relays serialize a valid /responses payload as
    // text/plain. The SDK relies on Content-Type before it reaches its
    // Responses parser, so normalize only confirmed JSON response payloads.
    fetch: normalizeResponsesJsonContentType(fetch),
  });
}

export function normalizeResponsesJsonContentType(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (!response.ok || !isResponsesEndpoint(input) || isJsonContentType(response.headers.get('content-type'))) {
      return response;
    }

    // Do not label an arbitrary text or HTML error page as JSON. Cloning keeps
    // the original response body readable by the OpenAI SDK afterwards.
    const body = await response.clone().text();
    if (!isResponseObjectJson(body)) return response;

    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

function isResponsesEndpoint(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  try {
    return new URL(url).pathname.replace(/\/+$/, '').endsWith('/responses');
  } catch {
    return false;
  }
}

function isJsonContentType(value: string | null): boolean {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true;
}

function isResponseObjectJson(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object'
      && parsed !== null
      && !Array.isArray(parsed)
      && (parsed as { object?: unknown }).object === 'response';
  } catch {
    return false;
  }
}

export function selectReasoningEffort(settings: GPTOptimizationSettings, stage: string): ReasoningEffort {
  if (settings.reasoningProfile === 'fast') return 'low';
  if (settings.reasoningProfile === 'quality') return 'high';
  const normalized = stage.toLocaleLowerCase();
  if (/(format|格式|schema|simple repair|简单修复)/i.test(normalized)) return 'low';
  if (/(quality|审校|质检|质量|audit|review)/i.test(normalized)) return 'high';
  if (/(director|编导|导演|storyboard|分镜规划|内容规划|content plan)/i.test(normalized)) return 'high';
  if (/(research|研究|检索|搜索|素材|asset|image selection|配图)/i.test(normalized)) return 'medium';
  if (/(html|视觉合成|visual generation|画面生成)/i.test(normalized)) return 'medium';
  if (settings.reasoningProfile === 'auto' && /(intent|意图|router|路由)/i.test(normalized)) return 'low';
  return 'medium';
}

async function createResponsesWithReasoningFallback(
  client: OpenAI,
  request: Record<string, unknown>,
  signal: AbortSignal | undefined,
  requestedEffort: ReasoningEffort,
): Promise<{ response: any; appliedEffort: ReasoningEffort; downgradeReason?: string }> {
  const order: ReasoningEffort[] = ['high', 'medium', 'low'];
  const attempts = order.slice(order.indexOf(requestedEffort));
  for (const effort of attempts) {
    try {
      const response = await client.responses.create({ ...request, reasoning: { effort } } as any, { signal });
      return {
        response,
        appliedEffort: effort,
        ...(effort !== requestedEffort
          ? { downgradeReason: `relay_rejected_reasoning_${requestedEffort}_applied_${effort}` }
          : {}),
      };
    } catch (error) {
      if (!isReasoningEffortUnsupported(error)) throw error;
    }
  }
  try {
    const withoutReasoning = { ...request };
    delete withoutReasoning.reasoning;
    const response = await client.responses.create(withoutReasoning as any, { signal });
    return {
      response,
      appliedEffort: 'low',
      downgradeReason: `relay_rejected_reasoning_${requestedEffort}_applied_default`,
    };
  } catch (error) {
    throw error;
  }
}

async function createResponsesWithParameterFallback(
  client: OpenAI,
  request: Record<string, unknown>,
  signal: AbortSignal | undefined,
  requestedEffort: ReasoningEffort,
): Promise<{ response: any; appliedEffort: ReasoningEffort; downgradeReason?: string }> {
  const compatibleRequest = { ...request };
  let tokenLimitRemoved = false;

  while (true) {
    try {
      const result = await createResponsesWithReasoningFallback(
        client,
        compatibleRequest,
        signal,
        requestedEffort,
      );
      return {
        ...result,
        downgradeReason: appendDowngradeReason(
          tokenLimitRemoved ? 'responses_token_limit_removed' : undefined,
          result.downgradeReason,
        ),
      };
    } catch (error) {
      if (!tokenLimitRemoved
        && 'max_output_tokens' in compatibleRequest
        && isUnsupportedTokenLimitError(error)) {
        delete compatibleRequest.max_output_tokens;
        tokenLimitRemoved = true;
        continue;
      }
      throw error;
    }
  }
}

function makeResponsesRequest(options: GPTCallOptions & { model: string; user: string }): Record<string, unknown> {
  const request: Record<string, unknown> = {
    model: options.model,
    instructions: options.system,
    input: options.images?.length
      ? [{
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: options.user },
            ...options.images.map(image => ({ type: 'input_image', image_url: image.dataUrl })),
          ],
        }]
      : options.user,
    reasoning: { effort: selectReasoningEffort(options.credential.gptOptimization, options.stage) },
  };
  if (options.maxTokens) request.max_output_tokens = options.maxTokens;
  if (options.mode === 'json') request.text = { format: { type: 'json_object' } };
  return request;
}

function summarizeVisualInputs(images?: GPTCallImageInput[]) {
  if (!images?.length) return undefined;
  return images.map(image => ({
    label: image.label,
    mimeType: image.dataUrl.match(/^data:([^;,]+)/i)?.[1],
    byteLength: estimateDataUrlBytes(image.dataUrl),
    thumbnailDataUrl: image.dataUrl,
  }));
}

function estimateDataUrlBytes(dataUrl: string): number {
  const encoded = dataUrl.split(',', 2)[1] || '';
  return Math.floor(encoded.length * 0.75);
}

function readOutputText(response: any): string {
  if (typeof response.output_text === 'string') return response.output_text.trim();
  return (Array.isArray(response.output) ? response.output : [])
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((item: any) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item: any) => item.text)
    .join('\n')
    .trim();
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function makeRequestSignal(signal?: AbortSignal, timeoutMs?: number): AbortSignal | undefined {
  if (!timeoutMs) return signal;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function isStructuredOutputUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(text\.format|json_object|response_format|structured)/i.test(message)
    && /(unknown|unsupported|unrecognized|invalid|extra|not\s+permitted)/i.test(message);
}

function isReasoningEffortUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(reasoning|effort)/i.test(message)
    && /(unknown|unsupported|unrecognized|invalid|extra|not\s+permitted|not\s+allowed)/i.test(message);
}

function isUnsupportedTokenLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unsupported parameter:\s*(?:max_output_tokens|max_tokens)/i.test(message)
    || /(?:max_output_tokens|max_tokens).*(?:unsupported|not supported|unknown|not allowed)/i.test(message);
}

function appendDowngradeReason(current: string | undefined, next: string | undefined): string | undefined {
  if (!current) return next;
  return next ? `${current};${next}` : current;
}

function isResponsesUnsupported(error: unknown): boolean {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : NaN;
  const message = error instanceof Error ? error.message : String(error);
  return [404, 405, 501].includes(status)
    || (/responses/i.test(message) && /(not found|unsupported|unknown endpoint|not implemented|invalid url)/i.test(message));
}

function isOutputRecoveryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /JSON|为空|empty|incomplete|truncat|parse|unexpected end|unterminated/i.test(message);
}

function isTemporaryRelayError(error: unknown): boolean {
  const status = typeof error === 'object' && error && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : NaN;
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|request was aborted|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|network|fetch failed|temporar|upstream|bad gateway|service unavailable|gateway timeout/i.test(message);
}

async function waitForRetry(attempt: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) throw abortSignal.reason ?? new Error('AI request aborted');
  const delayMs = attempt === 0 ? 150 : 450;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    abortSignal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abortSignal.reason ?? new Error('AI request aborted'));
    }, { once: true });
  });
}

function fingerprintBaseURL(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'invalid-base-url';
  }
}

function sanitizeError(error: unknown, apiKey: string): string {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(apiKey, '[REDACTED]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]');
}
