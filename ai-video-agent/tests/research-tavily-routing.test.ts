import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ searchTavily: vi.fn() }));

vi.mock('@/lib/env', () => ({
  env: {
    TAVILY_API_KEY: 'tvly-test',
    TAVILY_MAX_RESULTS: 3,
    TAVILY_MAX_QUERIES: 3,
  },
}));

vi.mock('@/lib/research/tavily', () => ({
  searchTavily: mocks.searchTavily,
}));

import { executeResearchPlan } from '@/lib/research';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchTavily.mockResolvedValue({
    answer: 'Tavily answer',
    sources: [{
      title: 'Official source',
      url: 'https://example.gov/report',
      content: 'Verified source content',
      score: 0.9,
    }],
  });
});

describe('research provider routing', () => {
  it('always uses Tavily for web research', async () => {
    const result = await executeResearchPlan('latest report', {
      shouldSearch: true,
      riskLevel: 'high',
      reason: 'verify current facts',
      queries: ['latest official report'],
    });

    expect(mocks.searchTavily).toHaveBeenCalledWith('latest official report', expect.objectContaining({
      searchDepth: 'advanced',
      maxResults: 3,
    }));
    expect(result).toMatchObject({
      provider: 'tavily',
      status: 'completed',
    });
  });
});
