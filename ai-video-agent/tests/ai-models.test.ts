import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
}));

vi.mock('@/lib/ai-key-store', () => ({
  aiKeyStore: mocks,
}));

vi.mock('@/lib/env', () => ({
  env: { AI_BASE_URL: 'https://api.deepseek.com' },
}));

import { listAvailableAIModels } from '@/lib/ai-models';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSnapshot.mockResolvedValue({
    id: 'saved-id',
    name: '工作账号',
    apiKey: 'sk-secret-value',
    model: 'deepseek-v4-flash',
    baseURL: 'https://api.deepseek.com',
    source: 'saved',
  });
});

describe('listAvailableAIModels', () => {
  it('returns a stable, deduplicated model list without exposing the key', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      object: 'list',
      data: [
        { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' },
        { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' },
        { id: 'deepseek-v4-pro', object: 'model', owned_by: 'duplicate' },
      ],
    }), { status: 200 })) as typeof fetch;

    const result = await listAvailableAIModels('saved-id', fetchImpl);

    expect(result).toEqual({
      count: 2,
      models: [
        { id: 'deepseek-v4-flash', ownedBy: 'deepseek' },
        { id: 'deepseek-v4-pro', ownedBy: 'deepseek' },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.deepseek.com/models', expect.objectContaining({
      headers: { authorization: 'Bearer sk-secret-value' },
    }));
    expect(JSON.stringify(result)).not.toContain('sk-secret-value');
  });

  it('returns safe messages for authorization and unsupported endpoint failures', async () => {
    const unauthorized = vi.fn(async () => new Response('secret echoed', { status: 401 })) as typeof fetch;
    await expect(listAvailableAIModels('saved-id', unauthorized))
      .rejects.toThrow('API Key 无权读取模型列表');

    const unsupported = vi.fn(async () => new Response('not found', { status: 404 })) as typeof fetch;
    await expect(listAvailableAIModels('saved-id', unsupported))
      .rejects.toThrow('当前接口不支持读取模型列表，可手动输入模型 ID');
  });

  it('rejects incompatible response bodies with a manual-entry fallback message', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })) as typeof fetch;
    await expect(listAvailableAIModels('saved-id', fetchImpl))
      .rejects.toThrow('模型列表响应格式不兼容，可手动输入模型 ID');
  });
});
