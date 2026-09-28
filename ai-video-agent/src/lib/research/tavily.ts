import { env } from '@/lib/env';
import type { ResearchSource } from '@/types';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

export interface TavilySearchResult {
  answer: string;
  sources: ResearchSource[];
}

const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const searchCache = new Map<string, { expiresAt: number; value: TavilySearchResult }>();

export async function searchTavily(
  query: string,
  options: {
    apiKey?: string;
    maxResults?: number;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    searchDepth?: 'basic' | 'advanced';
    useCache?: boolean;
    abortSignal?: AbortSignal;
  } = {},
): Promise<TavilySearchResult> {
  const apiKey = options.apiKey || env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('未配置 TAVILY_API_KEY');

  const maxResults = clamp(options.maxResults || env.TAVILY_MAX_RESULTS, 1, 10);
  const searchDepth = options.searchDepth || 'basic';
  const useCache = options.useCache ?? !options.fetchImpl;
  const cacheKey = `${searchDepth}:${maxResults}:${query.trim().toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (useCache && cached && cached.expiresAt > Date.now()) return cached.value;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 8_000);
  const signal = options.abortSignal
    ? AbortSignal.any([options.abortSignal, controller.signal])
    : controller.signal;

  try {
    const response = await (options.fetchImpl || fetch)(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: 'basic',
        include_raw_content: false,
        include_images: false,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Tavily 搜索失败（HTTP ${response.status}）`);
    }

    const data = await response.json() as TavilyResponse;
    const result = {
      answer: cleanText(data.answer, 2_000),
      sources: (data.results || [])
        .filter(item => isHttpUrl(item.url))
        .map(item => ({
          title: cleanText(item.title, 200) || '未命名来源',
          url: item.url!,
          content: cleanText(item.content, 1_200),
          score: Number.isFinite(item.score) ? item.score : undefined,
        }))
        .filter(item => item.content),
    };
    if (useCache) {
      searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, value: result });
      pruneExpiredCache();
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function pruneExpiredCache(): void {
  if (searchCache.size < 100) return;
  const now = Date.now();
  searchCache.forEach((entry, key) => {
    if (entry.expiresAt <= now) searchCache.delete(key);
  });
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : min;
}
