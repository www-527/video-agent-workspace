import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  responsesCreate: vi.fn(),
  getSnapshot: vi.fn(),
}));

vi.mock('@/lib/ai-key-store', () => ({
  aiKeyStore: { getSnapshot: mocks.getSnapshot },
}));

vi.mock('@/lib/ai/providers/gpt-relay', () => ({
  createGPTClient: () => ({ responses: { create: mocks.responsesCreate } }),
}));

import { probeGPTCapabilities } from '@/lib/ai/gpt-capabilities';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSnapshot.mockResolvedValue({
    apiKey: 'sk-relay',
    model: 'gpt-5.6-terra',
  });
  mocks.responsesCreate
    .mockResolvedValueOnce({ model: 'gpt-5.6-terra', output_text: 'OK' })
    .mockResolvedValueOnce({ output_text: '{"ok":true}' });
});

describe('GPT relay capability probe', () => {
  it('checks text and structured output without registering search tools', async () => {
    const result = await probeGPTCapabilities('relay-id');

    expect(mocks.responsesCreate).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.responsesCreate.mock.calls) {
      expect(request.tools).toBeUndefined();
    }
    expect(result).toMatchObject({
      responses: { supported: true },
      structuredOutput: { supported: true },
    });
    expect(result).not.toHaveProperty('webSearch');
  });
});
