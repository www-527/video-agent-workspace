export interface UpstreamAIError {
  status: number;
  error: Record<string, unknown>;
}

/** Returns the nearest OpenAI-compatible HTTP error, including wrapped causes. */
export function getUpstreamAIError(error: unknown): UpstreamAIError | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 6; depth++) {
    if (isRecord(current) && Number.isInteger(current.status)) {
      const status = Number(current.status);
      if (status >= 400 && status <= 599 && isRecord(current.error)) {
        return { status, error: redactUpstreamValue(current.error) };
      }
    }
    current = current instanceof Error && 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

/** Preserves an upstream HTTP failure when the shared client finishes retrying. */
export function preserveUpstreamAIError(error: unknown, fallbackMessage: string): Error {
  const upstream = getUpstreamAIError(error);
  if (!upstream) return new Error(fallbackMessage, { cause: error instanceof Error ? error : undefined });
  const preserved = new Error(fallbackMessage, { cause: error instanceof Error ? error : undefined }) as Error & UpstreamAIError;
  preserved.status = upstream.status;
  preserved.error = upstream.error;
  return preserved;
}

/** Redacts credential-like values from a bounded user-visible error message. */
export function sanitizeUpstreamAIMessage(error: unknown, apiKey?: string): string {
  const upstream = getUpstreamAIError(error);
  const upstreamMessage = typeof upstream?.error.message === 'string' ? upstream.error.message : '';
  let message = upstreamMessage || (error instanceof Error ? error.message : String(error));
  if (apiKey) message = message.replaceAll(apiKey, '[REDACTED]');
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
    .slice(0, 800);
}

function redactUpstreamValue(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value, (_key, current) => {
    if (typeof current !== 'string') return current;
    return current
      .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]');
  })) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
