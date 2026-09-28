const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 100;

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();

export async function getPexelsCache<T>(query: string): Promise<T | null> {
  const entry = cache.get(query);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(query);
    return null;
  }
  // Refresh insertion order so active queries survive bounded eviction.
  cache.delete(query);
  cache.set(query, entry);
  return entry.value as T;
}

export async function setPexelsCache<T>(query: string, value: T): Promise<void> {
  cache.delete(query);
  cache.set(query, { expiresAt: Date.now() + TTL_MS, value });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export function clearPexelsCache(): void {
  cache.clear();
}

export function normalizePexelsQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
}
