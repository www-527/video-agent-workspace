import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  rename: vi.fn(),
  activate: vi.fn(),
  selectModel: vi.fn(),
  updateBaseURL: vi.fn(),
  updateAPIProtocol: vi.fn(),
  updateGPTOptimization: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/lib/ai-key-store', () => {
  class AIKeyStoreError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message);
    }
  }
  return {
    aiKeyStore: mocks,
    AIKeyStoreError,
  };
});

import { DELETE, GET, PATCH, POST } from '@/app/api/settings/ai-keys/route';
import { AIKeyStoreError } from '@/lib/ai-key-store';

const safeList = {
  items: [{
    id: 'saved-id',
    name: '工作账号',
    maskedKey: 'sk-****3456',
    source: 'saved',
    active: true,
    deletable: true,
    selectedModel: 'deepseek-v4-flash',
    baseURL: 'https://api.deepseek.com',
    apiProtocol: 'auto',
  }],
  activeId: 'saved-id',
  activeName: '工作账号',
  activeModel: 'deepseek-v4-flash',
  activeBaseURL: 'https://api.deepseek.com',
  activeAPIProtocol: 'auto',
  configured: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(safeList);
  mocks.add.mockResolvedValue(safeList);
  mocks.rename.mockResolvedValue(safeList);
  mocks.activate.mockResolvedValue(safeList);
  mocks.selectModel.mockResolvedValue(safeList);
  mocks.updateBaseURL.mockResolvedValue(safeList);
  mocks.updateAPIProtocol.mockResolvedValue(safeList);
  mocks.updateGPTOptimization.mockResolvedValue(safeList);
  mocks.remove.mockResolvedValue(safeList);
});

describe('/api/settings/ai-keys', () => {
  it('returns only masked metadata from GET', async () => {
    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain('sk-****3456');
    expect(text).not.toContain('sk-work-123456');
  });

  it('adds, renames, activates, and deletes through validated actions', async () => {
    const addResponse = await POST(jsonRequest('POST', {
      name: '工作账号',
      apiKey: 'sk-work-123456',
      baseURL: 'https://api.deepseek.com',
    }));
    expect(addResponse.status).toBe(201);
    expect(mocks.add).toHaveBeenCalledWith('工作账号', 'sk-work-123456', 'https://api.deepseek.com');

    await PATCH(jsonRequest('PATCH', { action: 'rename', id: 'saved-id', name: '新名称' }));
    expect(mocks.rename).toHaveBeenCalledWith('saved-id', '新名称');

    await PATCH(jsonRequest('PATCH', { action: 'activate', id: 'saved-id' }));
    expect(mocks.activate).toHaveBeenCalledWith('saved-id');

    await PATCH(jsonRequest('PATCH', { action: 'select-model', id: 'saved-id', model: 'deepseek-v4-pro' }));
    expect(mocks.selectModel).toHaveBeenCalledWith('saved-id', 'deepseek-v4-pro');

    await PATCH(jsonRequest('PATCH', { action: 'update-base-url', id: 'saved-id', baseURL: 'https://gateway.example/v1' }));
    expect(mocks.updateBaseURL).toHaveBeenCalledWith('saved-id', 'https://gateway.example/v1');

    await PATCH(jsonRequest('PATCH', { action: 'update-api-protocol', id: 'saved-id', apiProtocol: 'responses' }));
    expect(mocks.updateAPIProtocol).toHaveBeenCalledWith('saved-id', 'responses');

    await PATCH(jsonRequest('PATCH', { action: 'update-gpt-optimization', id: 'saved-id', enabled: true }));
    expect(mocks.updateGPTOptimization).toHaveBeenCalledWith('saved-id', { enabled: true });

    await DELETE(jsonRequest('DELETE', { id: 'saved-id' }));
    expect(mocks.remove).toHaveBeenCalledWith('saved-id');
  });

  it('returns stable validation and conflict errors', async () => {
    const invalid = await PATCH(jsonRequest('PATCH', { action: 'unknown', id: 'saved-id' }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_INPUT' });

    mocks.add.mockRejectedValueOnce(new AIKeyStoreError('Key 名称已存在', 'DUPLICATE_NAME' as never));
    const duplicate = await POST(jsonRequest('POST', {
      name: '工作账号',
      apiKey: 'sk-other',
      baseURL: 'https://api.deepseek.com',
    }));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: 'Key 名称已存在', code: 'DUPLICATE_NAME' });
  });
});

function jsonRequest(method: string, body: unknown): Request {
  return new Request('http://localhost/api/settings/ai-keys', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
