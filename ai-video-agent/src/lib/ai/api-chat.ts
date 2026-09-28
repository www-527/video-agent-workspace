import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { aiKeyStore, type AIKeySnapshot } from '@/lib/ai-key-store';
import { createGPTClient } from './providers/gpt-relay';
import { publishAITrace } from './trace';
import { getUpstreamAIError, type UpstreamAIError } from './upstream-error';
import { isAutomaticAPIProtocol, resolvePreferredAPIProtocol } from './api-protocol';

export interface APIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface APIChatResult {
  message: string;
  configuredModel: string;
  actualModel?: string;
  apiMode: 'responses' | 'chat.completions';
  responseId?: string;
  responseStatus?: string;
  fallbackReason?: string;
  tokens?: { prompt?: number; completion?: number; total?: number };
}

export type { UpstreamAIError as APIChatUpstreamError } from './upstream-error';

const CHAT_SYSTEM = `你是 API 连接测试助手。直接回答用户问题，保持上下文一致。
这是独立的诊断对话：不要创建或修改视频项目，不要声称调用了未提供的工具，也不要输出隐藏推理过程。`;

export async function chatWithAIKey(
  keyId: string,
  messages: APIChatMessage[],
  abortSignal?: AbortSignal,
): Promise<APIChatResult> {
  const credential = await aiKeyStore.getSnapshot(keyId);
  const normalizedMessages = messages
    .slice(-12)
    .map(message => ({ role: message.role, content: message.content.trim().slice(0, 200_000) }))
    .filter(message => message.content);
  if (!normalizedMessages.length || normalizedMessages.at(-1)?.role !== 'user') {
    throw new Error('对话必须以用户消息结束');
  }

  const preferredProtocol = resolvePreferredAPIProtocol(credential);
  if (preferredProtocol === 'responses') {
    try {
      return await retryTransientChatRequest(
        (attempt, maxAttempts) => chatWithResponses(
          credential,
          normalizedMessages,
          abortSignal,
          attempt,
          maxAttempts,
        ),
        abortSignal,
      );
    } catch (error) {
      const fallbackReason = classifyResponsesFallback(error);
      if (!fallbackReason || !credential.gptOptimization.allowChatFallback) throw error;
      return retryTransientChatRequest(
        (attempt, maxAttempts) => chatWithCompletions(
          credential,
          normalizedMessages,
          abortSignal,
          fallbackReason,
          true,
          attempt,
          maxAttempts,
        ),
        abortSignal,
      );
    }
  }
  try {
    return await retryTransientChatRequest(
      (attempt, maxAttempts) => chatWithCompletions(
        credential,
        normalizedMessages,
        abortSignal,
        undefined,
        credential.gptOptimization.enabled,
        attempt,
        maxAttempts,
      ),
      abortSignal,
      error => !(isAutomaticAPIProtocol(credential) && isChatProtocolMismatch(error)),
    );
  } catch (error) {
    if (!isAutomaticAPIProtocol(credential) || !isChatProtocolMismatch(error)) throw error;
    return retryTransientChatRequest(
      (attempt, maxAttempts) => chatWithResponses(
        credential,
        normalizedMessages,
        abortSignal,
        attempt,
        maxAttempts,
        'chat_upstream_forbidden;responses_auto_recovery',
      ),
      abortSignal,
    );
  }
}

async function chatWithResponses(
  credential: AIKeySnapshot,
  messages: APIChatMessage[],
  abortSignal?: AbortSignal,
  attempt = 1,
  maxAttempts = 1,
  fallbackReason?: string,
): Promise<APIChatResult> {
  const id = randomUUID();
  const started = Date.now();
  let response: any;
  try {
    response = await createClient(credential).responses.create({
      model: credential.model,
      instructions: CHAT_SYSTEM,
      input: messages,
      reasoning: { effort: 'low' },
      max_output_tokens: 1_500,
    } as any, { signal: makeSignal(abortSignal) });
    const output = readOutputText(response);
    if (!output) throw new Error(`API 返回内容为空（status=${response.status || 'unknown'}）`);
    const tokens = response.usage ? {
      prompt: response.usage.input_tokens,
      completion: response.usage.output_tokens,
      total: response.usage.total_tokens,
    } : undefined;
    publishChatTrace({ id, started, credential, messages, output, response, apiMode: 'responses', tokens, fallbackReason, attempt, maxAttempts });
    return {
      message: output,
      configuredModel: credential.model,
      actualModel: typeof response.model === 'string' ? response.model : undefined,
      apiMode: 'responses',
      responseId: typeof response.id === 'string' ? response.id : undefined,
      responseStatus: typeof response.status === 'string' ? response.status : undefined,
      fallbackReason,
      tokens,
    };
  } catch (error) {
    publishChatTrace({ id, started, credential, messages, output: null, response, apiMode: 'responses', error, fallbackReason, attempt, maxAttempts });
    throw error;
  }
}

async function chatWithCompletions(
  credential: AIKeySnapshot,
  messages: APIChatMessage[],
  abortSignal?: AbortSignal,
  fallbackReason?: string,
  allowGPTParameterRecovery = false,
  attempt = 1,
  maxAttempts = 1,
): Promise<APIChatResult> {
  const id = randomUUID();
  const started = Date.now();
  let completion: any;
  let appliedFallbackReason = fallbackReason;
  try {
    const client = createClient(credential);
    const request = {
      model: credential.model,
      messages: [{ role: 'system', content: CHAT_SYSTEM }, ...messages],
      max_tokens: 1_500,
    };
    try {
      completion = await client.chat.completions.create(request as any, { signal: makeSignal(abortSignal) });
    } catch (error) {
      if (!allowGPTParameterRecovery || !isUnsupportedTokenLimitError(error)) throw error;
      const requestWithoutTokenLimit = { ...request } as Partial<typeof request>;
      delete requestWithoutTokenLimit.max_tokens;
      appliedFallbackReason = appendFallbackReason(appliedFallbackReason, 'chat_token_limit_removed');
      completion = await client.chat.completions.create(requestWithoutTokenLimit as any, { signal: makeSignal(abortSignal) });
    }
    const choice = completion.choices?.[0];
    const output = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
    if (!output) throw new Error('API 返回内容为空');
    const tokens = completion.usage ? {
      prompt: completion.usage.prompt_tokens,
      completion: completion.usage.completion_tokens,
      total: completion.usage.total_tokens,
    } : undefined;
    publishChatTrace({ id, started, credential, messages, output, response: completion, apiMode: 'chat.completions', tokens, fallbackReason: appliedFallbackReason, attempt, maxAttempts });
    return {
      message: output,
      configuredModel: credential.model,
      actualModel: typeof completion.model === 'string' ? completion.model : undefined,
      apiMode: 'chat.completions',
      responseId: typeof completion.id === 'string' ? completion.id : undefined,
      responseStatus: choice?.finish_reason || undefined,
      fallbackReason: appliedFallbackReason,
      tokens,
    };
  } catch (error) {
    publishChatTrace({ id, started, credential, messages, output: null, response: completion, apiMode: 'chat.completions', error, fallbackReason: appliedFallbackReason, attempt, maxAttempts });
    throw error;
  }
}

function publishChatTrace(input: {
  id: string;
  started: number;
  credential: AIKeySnapshot;
  messages: APIChatMessage[];
  output: string | null;
  response?: any;
  apiMode: 'responses' | 'chat.completions';
  tokens?: { prompt?: number; completion?: number; total?: number };
  fallbackReason?: string;
  error?: unknown;
  attempt?: number;
  maxAttempts?: number;
}): void {
  const response = input.response;
  publishAITrace({
    id: input.id,
    stage: 'API 对话',
    model: input.credential.model,
    configuredModel: input.credential.model,
    actualModel: typeof response?.model === 'string' ? response.model : undefined,
    apiMode: input.apiMode,
    relayBaseURL: fingerprintBaseURL(input.credential.baseURL),
    reasoningEffort: input.apiMode === 'responses' ? 'low' : undefined,
    responseId: typeof response?.id === 'string' ? response.id : undefined,
    responseStatus: input.apiMode === 'responses' ? response?.status : response?.choices?.[0]?.finish_reason,
    downgradeReason: input.fallbackReason,
    system: CHAT_SYSTEM,
    user: input.messages.map(message => `${message.role}: ${message.content}`).join('\n'),
    reasoning: null,
    output: input.output,
    startedAt: new Date(input.started).toISOString(),
    durationMs: Date.now() - input.started,
    attempt: input.attempt ?? 1,
    maxAttempts: input.maxAttempts ?? 1,
    tokens: input.tokens,
    finishReason: input.apiMode === 'responses' ? response?.status || null : response?.choices?.[0]?.finish_reason || null,
    outputLength: input.output?.length || 0,
    reasoningLength: 0,
    error: input.error ? sanitizeError(input.error, input.credential.apiKey) : undefined,
  });
}

function classifyResponsesFallback(error: unknown): string | undefined {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : NaN;
  const message = error instanceof Error ? error.message : String(error);
  if ([404, 405, 501].includes(status)) return 'responses_api_unsupported';
  if (status === 400 && /upstream request failed/i.test(message)) return 'responses_upstream_request_failed';
  if (status === 502 && /upstream access forbidden/i.test(message)) return 'responses_upstream_forbidden';
  if ([502, 503, 504].includes(status)) return 'responses_temporarily_unavailable';
  return undefined;
}

async function retryTransientChatRequest<T>(
  request: (attempt: number, maxAttempts: number) => Promise<T>,
  abortSignal?: AbortSignal,
  shouldRetry: (error: unknown) => boolean = () => true,
): Promise<T> {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (abortSignal?.aborted) throw abortSignal.reason ?? new Error('AI request aborted');
    try {
      return await request(attempt, maxAttempts);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTemporaryRelayError(error) || !shouldRetry(error)) throw error;
      await waitForRetry(attempt, abortSignal);
    }
  }
  throw lastError;
}

function isTemporaryRelayError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  return /timeout|timed out|request was aborted|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|network|fetch failed|temporar|bad gateway|service unavailable|gateway timeout/i
    .test(getErrorMessage(error));
}

function isChatProtocolMismatch(error: unknown): boolean {
  return getErrorStatus(error) === 502 && /upstream access forbidden/i.test(getErrorMessage(error));
}

function getErrorStatus(error: unknown): number {
  return typeof error === 'object' && error && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : NaN;
}

function getErrorMessage(error: unknown): string {
  const direct = error instanceof Error ? error.message : String(error);
  const upstream = getUpstreamAIError(error);
  const upstreamMessage = typeof upstream?.error.message === 'string' ? upstream.error.message : '';
  return `${direct} ${upstreamMessage}`;
}

async function waitForRetry(attempt: number, abortSignal?: AbortSignal): Promise<void> {
  const delayMs = attempt === 1 ? 150 : 450;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortSignal?.reason ?? new Error('AI request aborted'));
    };
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isUnsupportedTokenLimitError(error: unknown): boolean {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : NaN;
  const message = error instanceof Error ? error.message : String(error);
  if (Number.isFinite(status) && status !== 400 && status !== 422) return false;
  return /unsupported parameter:\s*(?:max_output_tokens|max_tokens)/i.test(message)
    || /(?:max_output_tokens|max_tokens).*(?:unsupported|not supported|unknown|not allowed)/i.test(message);
}

function appendFallbackReason(current: string | undefined, next: string): string {
  return current ? `${current};${next}` : next;
}

function createClient(credential: AIKeySnapshot): OpenAI {
  return createGPTClient(credential);
}

function readOutputText(response: any): string {
  if (typeof response?.output_text === 'string') return response.output_text.trim();
  return (Array.isArray(response?.output) ? response.output : [])
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((item: any) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item: any) => item.text)
    .join('\n')
    .trim();
}

function makeSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(45_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function fingerprintBaseURL(value: string): string {
  try { const url = new URL(value); return `${url.protocol}//${url.host}`; } catch { return 'invalid-base-url'; }
}

export function sanitizeAPIChatError(error: unknown, apiKey?: string): string {
  let message = error instanceof Error ? error.message : String(error);
  if (apiKey) message = message.replaceAll(apiKey, '[REDACTED]');
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
    .slice(0, 800);
}

/**
 * Extracts an OpenAI-compatible relay error without converting its HTTP status
 * into the local route's generic 502. The caller deliberately returns the
 * original `error` object shape so browser devtools can show the relay's code
 * and message while still redacting credentials if a relay echoes one.
 */
export function getAPIChatUpstreamError(error: unknown): UpstreamAIError | undefined {
  return getUpstreamAIError(error);
}

function sanitizeError(error: unknown, apiKey: string): string {
  return sanitizeAPIChatError(error, apiKey);
}
