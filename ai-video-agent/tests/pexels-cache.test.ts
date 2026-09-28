import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: { PEXELS_API_KEY: 'test-key', PEXELS_SEARCH_TIMEOUT_MS: 1_000 },
}));

import { searchPexels } from '@/lib/pexels/client';
import { clearPexelsCache } from '@/lib/pexels/cache';

describe('Pexels candidate cache', () => {
  beforeEach(() => {
    clearPexelsCache();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      photos: [], total_results: 0, page: 1, per_page: 15,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });

  it('reuses query candidates within TTL but keeps orientations separate', async () => {
    await searchPexels('  Office   Worker  ', undefined, 'landscape');
    await searchPexels('office worker', undefined, 'landscape');
    await searchPexels('office worker', undefined, 'portrait');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries one transient provider failure and then caches the result', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('temporary failure', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        photos: [], total_results: 0, page: 1, per_page: 15,
      }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await searchPexels('resilient wind turbine');
    await searchPexels('resilient wind turbine');

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
