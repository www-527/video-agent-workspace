import { randomUUID } from 'node:crypto';
import type { AIKeySnapshot } from '@/lib/ai-key-store';
import {
  parseCodexTestImageDataUrl,
  summarizeCodexTestImage,
  type CodexTestImageInput,
} from '@/lib/ai/codex-test-images';
import { sanitizeUpstreamAIMessage } from '@/lib/ai/upstream-error';

export interface CodexResponsesInputMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: CodexTestImageInput[];
}

export type CodexResponsesUsage = { input?: number; output?: number; total?: number };
export type CodexReasoningEffort = 'low' | 'medium' | 'high';
export type CodexTerminationMode = 'response.completed' | 'done' | 'eof' | 'failed' | 'aborted';
export type CodexDiagnosticHeaders = Record<string, string>;

export interface CodexRequestDiagnostic {
  endpoint: string;
  method: 'POST';
  headers: CodexDiagnosticHeaders;
  body: Record<string, unknown>;
  bodyBytes: number;
  correlation: {
    sessionId: string;
    threadId: string;
    turnId: string;
    clientRequestId: string;
  };
}

export interface CodexHTTPDiagnostic {
  status: number;
  statusText: string;
  headers: CodexDiagnosticHeaders;
  contentType?: string;
  elapsedMs: number;
}

export interface CodexRawEventDiagnostic {
  sequence: number;
  elapsedMs: number;
  eventType: string;
  bytes: number;
  known: boolean;
  payload: unknown;
  truncated: boolean;
  originalBytes: number;
  retainedBytes: number;
  parseError?: string;
}

interface CompletionDiagnostics {
  responseBytes: number;
  unknownEventCount: number;
  terminationMode: CodexTerminationMode;
  diagnosticsTruncated: boolean;
  doneReceived: boolean;
}

export type CodexResponsesStreamEvent =
  | {
    type: 'meta';
    model: string;
    relayBaseURL: string;
    requestCount: 1;
    stream: true;
    store: false;
    reasoningEffort: CodexReasoningEffort;
    startedAt: string;
    request: CodexRequestDiagnostic;
  }
  | ({ type: 'http.response' } & CodexHTTPDiagnostic)
  | ({ type: 'upstream.event' } & CodexRawEventDiagnostic)
  | { type: 'stream.done'; sequence: number; elapsedMs: number; bytes: number }
  | { type: 'response.created'; responseId?: string; status?: string; elapsedMs: number }
  | { type: 'response.output_text.delta'; delta: string; elapsedMs: number }
  | ({
    type: 'response.completed';
    responseId?: string;
    status?: string;
    usage?: CodexResponsesUsage;
    firstEventMs?: number;
    firstTextMs?: number;
    durationMs: number;
    eventCount: number;
  } & CompletionDiagnostics)
  | ({
    type: 'error';
    message: string;
    status?: number;
    durationMs: number;
    eventCount: number;
  } & CompletionDiagnostics);

export type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CodexResponsesStreamOptions {
  credential: AIKeySnapshot;
  instructions: string;
  messages: CodexResponsesInputMessage[];
  reasoningEffort?: CodexReasoningEffort;
  abortSignal?: AbortSignal;
  fetchImpl?: FetchImplementation;
}

const CODEX_ORIGINATOR = 'codex_cli_rs';
const CODEX_USER_AGENT = 'codex_cli_rs/0.0.0 (Windows; x86_64)';
const INSTALLATION_ID = randomUUID();
const MAX_RAW_EVENT_BYTES = 32 * 1024;
const MAX_DIAGNOSTIC_BYTES = 512 * 1024;
const KNOWN_EVENT_TYPES = new Set([
  'response.created', 'response.in_progress', 'response.output_item.added',
  'response.content_part.added', 'response.output_text.delta', 'response.output_text.done',
  'response.content_part.done', 'response.output_item.done', 'response.completed',
  'response.failed', 'response.incomplete', 'response.reasoning_summary_text.delta',
  'response.reasoning_summary_text.done', 'error',
]);
const encoder = new TextEncoder();

export async function* streamCodexResponses(
  options: CodexResponsesStreamOptions,
): AsyncGenerator<CodexResponsesStreamEvent> {
  const { credential, abortSignal, fetchImpl = fetch } = options;
  const reasoningEffort = options.reasoningEffort ?? 'low';
  const started = Date.now();
  const identity = createRequestIdentity(started);
  const endpoint = buildResponsesURL(credential.baseURL);
  const headers = createCodexHeaders(credential.apiKey, identity);
  const requestBody = createCodexRequest(credential, options.instructions, options.messages, identity, reasoningEffort);
  const serializedBody = JSON.stringify(requestBody);
  const request: CodexRequestDiagnostic = {
    endpoint,
    method: 'POST',
    headers: sanitizeHeaders(headers, credential.apiKey),
    body: sanitizeValue(requestBody, credential.apiKey) as Record<string, unknown>,
    bodyBytes: byteLength(serializedBody),
    correlation: {
      sessionId: identity.sessionId,
      threadId: identity.threadId,
      turnId: identity.turnId,
      clientRequestId: identity.threadId,
    },
  };

  let eventCount = 0;
  let responseBytes = 0;
  let unknownEventCount = 0;
  let firstEventMs: number | undefined;
  let firstTextMs: number | undefined;
  let responseId: string | undefined;
  let responseStatus: string | undefined;
  let completedUsage: CodexResponsesUsage | undefined;
  let sawCompleted = false;
  let doneReceived = false;
  let diagnosticsTruncated = false;
  let retainedDiagnosticBytes = 0;

  yield {
    type: 'meta',
    model: credential.model,
    relayBaseURL: fingerprintBaseURL(credential.baseURL),
    requestCount: 1,
    stream: true,
    store: false,
    reasoningEffort,
    startedAt: new Date(started).toISOString(),
    request,
  };

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: serializedBody,
      signal: abortSignal,
    });
    const httpDiagnostic: CodexHTTPDiagnostic = {
      status: response.status,
      statusText: response.statusText,
      headers: sanitizeHeaders(response.headers, credential.apiKey),
      contentType: response.headers.get('content-type') ?? undefined,
      elapsedMs: Date.now() - started,
    };
    yield { type: 'http.response', ...httpDiagnostic };

    if (!response.ok) {
      const failure = await readHTTPFailure(response, credential.apiKey);
      responseBytes = failure.bytes;
      yield createErrorEvent(failure.message, response.status, started, eventCount, {
        responseBytes, unknownEventCount, terminationMode: 'failed', diagnosticsTruncated, doneReceived,
      });
      return;
    }
    if (!response.body) {
      yield createErrorEvent('Responses 返回了空响应体', response.status, started, eventCount, {
        responseBytes, unknownEventCount, terminationMode: 'failed', diagnosticsTruncated, doneReceived,
      });
      return;
    }

    for await (const observation of parseSSE(response.body, abortSignal)) {
      const elapsedMs = Date.now() - started;
      responseBytes += observation.bytes;
      if (observation.kind === 'done') {
        doneReceived = true;
        yield { type: 'stream.done', sequence: eventCount + 1, elapsedMs, bytes: observation.bytes };
        continue;
      }

      eventCount += 1;
      firstEventMs ??= elapsedMs;
      const eventType = stringValue(observation.parsed?.type) ?? (observation.parseError ? 'parse.error' : 'unknown');
      const known = KNOWN_EVENT_TYPES.has(eventType);
      if (!known) unknownEventCount += 1;
      const retained = retainDiagnosticPayload(
        sanitizeValue(observation.parsed ?? observation.data, credential.apiKey),
        retainedDiagnosticBytes,
      );
      retainedDiagnosticBytes += retained.retainedBytes;
      diagnosticsTruncated ||= retained.truncated;
      yield {
        type: 'upstream.event',
        sequence: eventCount,
        elapsedMs,
        eventType,
        bytes: observation.bytes,
        known,
        payload: retained.payload,
        truncated: retained.truncated,
        originalBytes: retained.originalBytes,
        retainedBytes: retained.retainedBytes,
        parseError: observation.parseError,
      };

      if (observation.parseError || !observation.parsed) {
        yield createErrorEvent(`SSE JSON 解析失败：${observation.parseError ?? '未知错误'}`, response.status, started, eventCount, {
          responseBytes, unknownEventCount, terminationMode: 'failed', diagnosticsTruncated, doneReceived,
        });
        return;
      }
      const rawEvent = observation.parsed;
      if (rawEvent.type === 'response.created') {
        responseId = stringValue(rawEvent.response?.id) ?? responseId;
        responseStatus = stringValue(rawEvent.response?.status) ?? responseStatus;
        yield { type: 'response.created', responseId, status: responseStatus, elapsedMs };
      } else if (rawEvent.type === 'response.output_text.delta' && typeof rawEvent.delta === 'string') {
        firstTextMs ??= elapsedMs;
        yield { type: 'response.output_text.delta', delta: rawEvent.delta, elapsedMs };
      } else if (rawEvent.type === 'response.completed') {
        responseId = stringValue(rawEvent.response?.id) ?? responseId;
        responseStatus = stringValue(rawEvent.response?.status) ?? 'completed';
        completedUsage = normalizeUsage(rawEvent.response?.usage);
        sawCompleted = true;
      } else if (rawEvent.type === 'response.failed' || rawEvent.type === 'error') {
        const failure = nestedString(rawEvent, ['response', 'error', 'message'])
          ?? stringValue(rawEvent.message)
          ?? nestedString(rawEvent, ['error', 'message'])
          ?? 'Responses 流返回失败';
        yield createErrorEvent(sanitizeUpstreamAIMessage(failure, credential.apiKey), response.status, started, eventCount, {
          responseBytes, unknownEventCount, terminationMode: 'failed', diagnosticsTruncated, doneReceived,
        });
        return;
      }
    }

    if (sawCompleted) {
      yield {
        type: 'response.completed',
        responseId,
        status: responseStatus,
        usage: completedUsage,
        firstEventMs,
        firstTextMs,
        durationMs: Date.now() - started,
        eventCount,
        responseBytes,
        unknownEventCount,
        terminationMode: 'response.completed',
        diagnosticsTruncated,
        doneReceived,
      };
      return;
    }

    yield createErrorEvent(
      doneReceived ? 'Responses 流收到 [DONE]，但没有 response.completed' : 'Responses 流在完成事件前结束',
      response.status,
      started,
      eventCount,
      { responseBytes, unknownEventCount, terminationMode: doneReceived ? 'done' : 'eof', diagnosticsTruncated, doneReceived },
    );
  } catch (error) {
    if (abortSignal?.aborted) throw abortSignal.reason ?? error;
    yield createErrorEvent(sanitizeUpstreamAIMessage(error, credential.apiKey), undefined, started, eventCount, {
      responseBytes, unknownEventCount, terminationMode: 'failed', diagnosticsTruncated, doneReceived,
    });
  }
}

interface RequestIdentity {
  sessionId: string;
  threadId: string;
  turnId: string;
  windowId: string;
  turnMetadata: string;
}

function createRequestIdentity(started: number): RequestIdentity {
  const sessionId = randomUUID();
  const threadId = randomUUID();
  const turnId = randomUUID();
  const windowId = `${threadId}:0`;
  const turnMetadata = JSON.stringify({
    installation_id: INSTALLATION_ID,
    session_id: sessionId,
    thread_id: threadId,
    turn_id: turnId,
    window_id: windowId,
    request_kind: 'turn',
    turn_started_at_unix_ms: started,
  });
  return { sessionId, threadId, turnId, windowId, turnMetadata };
}

function createCodexHeaders(apiKey: string, identity: RequestIdentity): Headers {
  return new Headers({
    accept: 'text/event-stream',
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    originator: CODEX_ORIGINATOR,
    'user-agent': CODEX_USER_AGENT,
    'session-id': identity.sessionId,
    'thread-id': identity.threadId,
    'x-client-request-id': identity.threadId,
    'x-codex-installation-id': INSTALLATION_ID,
    'x-codex-window-id': identity.windowId,
    'x-codex-turn-metadata': identity.turnMetadata,
  });
}

function createCodexRequest(
  credential: AIKeySnapshot,
  instructions: string,
  messages: CodexResponsesInputMessage[],
  identity: RequestIdentity,
  reasoningEffort: CodexReasoningEffort,
): Record<string, unknown> {
  return {
    model: credential.model,
    instructions,
    input: messages.slice(-12).map(message => ({
      type: 'message',
      role: message.role,
      content: message.role === 'assistant'
        ? [{ type: 'output_text', text: message.content }]
        : [
          ...(message.content ? [{ type: 'input_text', text: message.content }] : []),
          ...(message.images ?? []).map(image => ({ type: 'input_image', image_url: image.dataUrl })),
        ],
    })),
    tools: [],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    reasoning: { effort: reasoningEffort, summary: 'auto' },
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content'],
    prompt_cache_key: identity.sessionId,
    text: { verbosity: 'medium' },
    client_metadata: {
      'x-codex-installation-id': INSTALLATION_ID,
      session_id: identity.sessionId,
      thread_id: identity.threadId,
      turn_id: identity.turnId,
      'x-codex-window-id': identity.windowId,
      'x-codex-turn-metadata': identity.turnMetadata,
    },
  };
}

export function buildResponsesURL(baseURL: string): string {
  const url = new URL(baseURL);
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/responses$/i.test(path)) return url.toString();
  url.pathname = /\/v1$/i.test(path) ? `${path}/responses` : `${path}/v1/responses`;
  return url.toString();
}

type SSEObservation =
  | { kind: 'done'; bytes: number }
  | { kind: 'event'; bytes: number; data: string; parsed?: Record<string, any>; parseError?: string };

async function* parseSSE(body: ReadableStream<Uint8Array>, abortSignal?: AbortSignal): AsyncGenerator<SSEObservation> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (abortSignal?.aborted) throw abortSignal.reason ?? new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const observation = decodeSSEBlock(block);
        if (observation) yield observation;
      }
      if (done) break;
    }
    const trailing = decodeSSEBlock(buffer);
    if (trailing) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

function decodeSSEBlock(block: string): SSEObservation | undefined {
  const data = block.split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')
    .trim();
  if (!data) return undefined;
  const bytes = byteLength(data);
  if (data === '[DONE]') return { kind: 'done', bytes };
  try {
    const parsed: unknown = JSON.parse(data);
    return isRecord(parsed) ? { kind: 'event', bytes, data, parsed } : {
      kind: 'event', bytes, data, parseError: '事件 JSON 不是对象',
    };
  } catch (error) {
    return { kind: 'event', bytes, data, parseError: error instanceof Error ? error.message : String(error) };
  }
}

async function readHTTPFailure(response: Response, apiKey: string): Promise<{ message: string; bytes: number }> {
  const raw = await response.text();
  const bytes = byteLength(raw);
  const bounded = raw.slice(0, 16_000);
  let message = `HTTP ${response.status} ${response.statusText}`.trim();
  try {
    const value: unknown = JSON.parse(bounded);
    if (isRecord(value)) message = nestedString(value, ['error', 'message']) ?? stringValue(value.message) ?? message;
  } catch {
    const htmlMessage = bounded.match(/<(?:title|h1)[^>]*>([^<]+)<\/(?:title|h1)>/i)?.[1];
    const plainMessage = bounded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    message = htmlMessage?.trim() || plainMessage || message;
  }
  return { message: sanitizeUpstreamAIMessage(message, apiKey), bytes };
}

function createErrorEvent(
  message: string,
  status: number | undefined,
  started: number,
  eventCount: number,
  diagnostics: CompletionDiagnostics,
): Extract<CodexResponsesStreamEvent, { type: 'error' }> {
  return { type: 'error', message, status, durationMs: Date.now() - started, eventCount, ...diagnostics };
}

function sanitizeHeaders(headers: Headers, apiKey: string): CodexDiagnosticHeaders {
  const output: CodexDiagnosticHeaders = {};
  headers.forEach((value, key) => {
    output[key] = isSensitiveKey(key) ? '[REDACTED]' : sanitizeString(value, apiKey);
  });
  return output;
}

function sanitizeValue(value: unknown, apiKey: string, key = ''): unknown {
  if (key.toLowerCase() === 'encrypted_content') {
    return { redacted: true, encodedBytes: typeof value === 'string' ? byteLength(value) : byteLength(JSON.stringify(value ?? null)) };
  }
  if (key.toLowerCase() === 'image_url' && typeof value === 'string') {
    try {
      return summarizeCodexTestImage(parseCodexTestImageDataUrl(value));
    } catch {
      return '[REDACTED]';
    }
  }
  if (isSensitiveKey(key)) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeString(value, apiKey);
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, apiKey));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
    childKey, sanitizeValue(child, apiKey, childKey),
  ]));
  return value;
}

function isSensitiveKey(key: string): boolean {
  return /^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|password|secret)$/i.test(key);
}

function sanitizeString(value: string, apiKey: string): string {
  return value
    .replaceAll(apiKey, '[REDACTED]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]');
}

function retainDiagnosticPayload(value: unknown, alreadyRetained: number): {
  payload: unknown;
  truncated: boolean;
  originalBytes: number;
  retainedBytes: number;
} {
  const serialized = JSON.stringify(value);
  const originalBytes = byteLength(serialized);
  const remaining = Math.max(0, MAX_DIAGNOSTIC_BYTES - alreadyRetained);
  const allowed = Math.min(MAX_RAW_EVENT_BYTES, remaining);
  if (originalBytes <= allowed) return { payload: value, truncated: false, originalBytes, retainedBytes: originalBytes };
  const preview = truncateUTF8(serialized, allowed);
  return {
    payload: { truncated: true, preview },
    truncated: true,
    originalBytes,
    retainedBytes: byteLength(preview),
  };
}

function truncateUTF8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (byteLength(value.slice(0, middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low);
}

function normalizeUsage(value: unknown): CodexResponsesUsage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    input: numberValue(value.input_tokens),
    output: numberValue(value.output_tokens),
    total: numberValue(value.total_tokens),
  };
}

function fingerprintBaseURL(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'invalid-base-url';
  }
}

function nestedString(value: unknown, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return stringValue(current);
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
