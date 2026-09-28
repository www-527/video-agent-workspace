import { env } from '@/lib/env';
import { getPexelsCache, normalizePexelsQuery, setPexelsCache } from './cache';

export interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  avg_color?: string;
  alt?: string;
  src: { original?: string; large2x?: string; large?: string; medium?: string };
}

export interface PexelsSearchResult {
  photos: PexelsPhoto[];
  total_results: number;
  page: number;
  per_page: number;
  rateLimit?: { limit?: string | null; remaining?: string | null; reset?: string | null };
}

export class PexelsError extends Error {
  constructor(message: string, public readonly status?: number, public readonly rateLimit?: PexelsSearchResult['rateLimit']) {
    super(message);
    this.name = 'PexelsError';
  }
}

const MAX_SEARCH_ATTEMPTS = 2;
const RETRY_DELAY_MS = 250;
const RETRYABLE_STATUSES = new Set([408, 425, 500, 502, 503, 504]);

export async function searchPexels(query: string, abortSignal?: AbortSignal, orientation: 'landscape' | 'portrait' = 'landscape'): Promise<PexelsSearchResult> {
  if (!env.PEXELS_API_KEY) throw new PexelsError('尚未配置 Pexels API。');
  const normalized = normalizePexelsQuery(query);
  if (!normalized) throw new PexelsError('图片搜索词不能为空。');
  const cacheKey = `${orientation}:${normalized}`;
  const cached = await getPexelsCache<PexelsSearchResult>(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ query: normalized, orientation, size: 'large', locale: 'en-US', per_page: '15' });
  const timeout = AbortSignal.timeout(env.PEXELS_SEARCH_TIMEOUT_MS);
  const signal = abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetchWithTransientRetry(`https://api.pexels.com/v1/search?${params}`, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new PexelsError(`Pexels 图片搜索网络异常：${error instanceof Error ? error.message : '未知错误'}`);
  }
  const rateLimit = {
    limit: response.headers.get('x-ratelimit-limit'),
    remaining: response.headers.get('x-ratelimit-remaining'),
    reset: response.headers.get('x-ratelimit-reset'),
  };
  if (!response.ok) {
    if (response.status === 401) throw new PexelsError('Pexels API Key 无效。', 401, rateLimit);
    if (response.status === 429) throw new PexelsError(`Pexels API 配额已耗尽${rateLimit.reset ? `，重置时间：${rateLimit.reset}` : ''}。`, 429, rateLimit);
    throw new PexelsError(`Pexels 图片搜索失败（${response.status}）。`, response.status, rateLimit);
  }
  const payload = await response.json() as Omit<PexelsSearchResult, 'rateLimit'>;
  const result: PexelsSearchResult = { ...payload, photos: payload.photos || [], rateLimit };
  await setPexelsCache(cacheKey, result);
  return result;
}

async function fetchWithTransientRetry(url: string, signal: AbortSignal): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_SEARCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: env.PEXELS_API_KEY },
        signal,
        cache: 'no-store',
      });
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_SEARCH_ATTEMPTS) return response;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      lastError = error;
      if (signal.aborted || attempt === MAX_SEARCH_ATTEMPTS) throw error;
    }
    await abortableDelay(RETRY_DELAY_MS, signal);
  }
  throw lastError instanceof Error ? lastError : new Error('Pexels request failed');
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
