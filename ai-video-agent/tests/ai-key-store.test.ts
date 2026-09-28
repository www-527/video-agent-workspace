import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AIKeyStore,
  ENVIRONMENT_KEY_ID,
  maskAIKey,
} from '@/lib/ai-key-store';

const temporaryDirectories: string[] = [];

async function makeStore(
  environmentKey = '',
  defaultModel = 'deepseek-v4-flash',
  environmentBaseURL = 'https://environment.example/v1',
) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-key-store-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    filePath: join(directory, 'ai-keys.json'),
    store: new AIKeyStore(
      join(directory, 'ai-keys.json'),
      () => environmentKey,
      () => defaultModel,
      () => environmentBaseURL,
    ),
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('AIKeyStore', () => {
  it('uses the environment key as a read-only default without exposing the secret', async () => {
    const { store } = await makeStore('sk-environment-secret');
    const result = await store.list();

    expect(result.activeId).toBe(ENVIRONMENT_KEY_ID);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: ENVIRONMENT_KEY_ID,
        maskedKey: 'sk-****cret',
        active: true,
        deletable: false,
        selectedModel: 'deepseek-v4-flash',
        baseURL: 'https://environment.example/v1',
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('sk-environment-secret');
  });

  it('adds and immediately activates a named key, then persists it locally', async () => {
    const { store, filePath } = await makeStore('sk-env');
    const result = await store.add('  工作账号  ', '  sk-work-123456  ', 'https://api.deepseek.com/');

    expect(result.activeName).toBe('工作账号');
    expect(result.activeModel).toBe('deepseek-v4-flash');
    expect(result.items.find(item => item.name === '工作账号')).toMatchObject({
      active: true,
      maskedKey: 'sk-****3456',
    });
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    expect(raw).toMatchObject({ version: 6, environmentModel: 'deepseek-v4-flash', environmentAPIProtocol: 'auto' });
    expect(raw.keys[0]).toMatchObject({
      name: '工作账号',
      apiKey: 'sk-work-123456',
      model: 'deepseek-v4-flash',
      baseURL: 'https://api.deepseek.com',
      apiProtocol: 'auto',
    });
    expect(raw.activeId).toBe(raw.keys[0].id);
  });

  it('rejects duplicate names case-insensitively and duplicate key values', async () => {
    const { store } = await makeStore();
    await store.add('Work', 'sk-first');

    await expect(store.add(' work ', 'sk-second')).rejects.toMatchObject({
      code: 'DUPLICATE_NAME',
    });
    await expect(store.add('Backup', 'sk-first')).rejects.toMatchObject({
      code: 'DUPLICATE_KEY',
    });
  });

  it('falls back to the environment key when deleting the active saved key', async () => {
    const { store } = await makeStore('sk-env');
    const added = await store.add('临时账号', 'sk-temporary');
    const saved = added.items.find(item => item.source === 'saved');
    await store.remove(saved!.id);

    const result = await store.list();
    expect(result.activeId).toBe(ENVIRONMENT_KEY_ID);
    expect((await store.getActiveSnapshot()).apiKey).toBe('sk-env');
  });

  it('falls back to the oldest remaining saved key when no environment key exists', async () => {
    const { store } = await makeStore();
    const first = await store.add('第一条', 'sk-first');
    const firstId = first.activeId!;
    const second = await store.add('第二条', 'sk-second');
    await store.remove(second.activeId!);

    expect((await store.list()).activeId).toBe(firstId);
  });

  it('stores a separate model for each saved key and the environment key', async () => {
    const { store } = await makeStore('sk-env');
    await store.selectModel(ENVIRONMENT_KEY_ID, 'deepseek-v4-pro');
    const added = await store.add('工作账号', 'sk-work');
    const savedId = added.activeId!;
    await store.selectModel(savedId, 'custom-model');

    expect((await store.getSnapshot(ENVIRONMENT_KEY_ID)).model).toBe('deepseek-v4-pro');
    expect((await store.getSnapshot(savedId)).model).toBe('custom-model');
  });

  it('stores and updates a separate Base URL for each saved key', async () => {
    const { store } = await makeStore('sk-env');
    const added = await store.add('DeepSeek', 'sk-deepseek', 'https://api.deepseek.com/');
    const savedId = added.activeId!;

    expect((await store.getSnapshot(savedId)).baseURL).toBe('https://api.deepseek.com');
    await store.updateBaseURL(savedId, 'https://gateway.example/v1/');
    expect((await store.getSnapshot(savedId)).baseURL).toBe('https://gateway.example/v1');
    expect((await store.getSnapshot(ENVIRONMENT_KEY_ID)).baseURL).toBe('https://environment.example/v1');
    await expect(store.updateBaseURL(ENVIRONMENT_KEY_ID, 'https://other.example/v1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('stores API protocol per key independently from GPT optimization', async () => {
    const { store } = await makeStore('sk-env');
    const added = await store.add('Responses relay', 'sk-responses', 'https://relay.example/v1');
    const savedId = added.activeId!;

    expect((await store.getSnapshot(savedId)).apiProtocol).toBe('auto');
    await store.updateAPIProtocol(savedId, 'responses');
    expect((await store.getSnapshot(savedId)).apiProtocol).toBe('responses');
    expect((await store.getSnapshot(savedId)).gptOptimization.enabled).toBe(false);

    await store.updateAPIProtocol(ENVIRONMENT_KEY_ID, 'chat.completions');
    expect((await store.getSnapshot(ENVIRONMENT_KEY_ID)).apiProtocol).toBe('chat.completions');
  });

  it('migrates a v2 settings file with the configured environment Base URL', async () => {
    const { store, filePath } = await makeStore('sk-env', 'fallback-model', 'https://gateway.example/v1');
    const id = '4b8382ec-bc4d-45a6-8b67-67437fc86bc1';
    const now = new Date().toISOString();
    await writeFile(filePath, JSON.stringify({
      version: 2,
      activeId: id,
      environmentModel: 'saved-model',
      keys: [{ id, name: '旧账号', apiKey: 'sk-legacy', model: 'saved-model', createdAt: now, updatedAt: now }],
    }), 'utf8');

    expect(await store.getSnapshot(id)).toMatchObject({
      model: 'saved-model',
      baseURL: 'https://gateway.example/v1',
    });
    await store.rename(id, '迁移后账号');
    const migrated = JSON.parse(await readFile(filePath, 'utf8'));
    expect(migrated).toMatchObject({
      version: 6,
      keys: [{ id, baseURL: 'https://gateway.example/v1' }],
    });
  });

  it('migrates a v1 settings file to v6 on the next mutation', async () => {
    const { store, filePath } = await makeStore('sk-env', 'fallback-model');
    const id = '4b8382ec-bc4d-45a6-8b67-67437fc86bc1';
    const now = new Date().toISOString();
    await writeFile(filePath, JSON.stringify({
      version: 1,
      activeId: id,
      keys: [{ id, name: '旧账号', apiKey: 'sk-legacy', createdAt: now, updatedAt: now }],
    }), 'utf8');

    expect((await store.getActiveSnapshot()).model).toBe('fallback-model');
    await store.rename(id, '迁移后账号');

    const migrated = JSON.parse(await readFile(filePath, 'utf8'));
    expect(migrated).toMatchObject({
      version: 6,
      environmentModel: 'fallback-model',
      keys: [{
        id,
        name: '迁移后账号',
        model: 'fallback-model',
        baseURL: 'https://environment.example/v1',
      }],
    });
  });

  it('stores GPT optimization per key and keeps it disabled by default', async () => {
    const { store } = await makeStore('sk-env');
    const added = await store.add('GPT relay', 'sk-gpt', 'https://relay.example/v1');
    const savedId = added.activeId!;

    expect((await store.getSnapshot(savedId)).gptOptimization.enabled).toBe(false);
    await store.updateGPTOptimization(savedId, true);
    expect((await store.getSnapshot(savedId)).gptOptimization).toMatchObject({
      enabled: true,
      useResponsesAPI: true,
      allowChatFallback: true,
      reasoningProfile: 'auto',
      creativeFreedom: 'balanced',
      internalImageSearch: true,
    });
    await store.updateGPTOptimization(savedId, {
      reasoningProfile: 'quality',
      creativeFreedom: 'open',
      internalImageSearch: false,
    });
    expect((await store.getSnapshot(savedId)).gptOptimization).toMatchObject({
      reasoningProfile: 'quality',
      creativeFreedom: 'open',
      internalImageSearch: false,
    });
    expect((await store.getSnapshot(ENVIRONMENT_KEY_ID)).gptOptimization.enabled).toBe(false);
  });

  it('migrates the hidden v4 balanced profile to the recommended v6 defaults', async () => {
    const { store, filePath } = await makeStore('sk-env');
    const id = '4b8382ec-bc4d-45a6-8b67-67437fc86bc1';
    const now = new Date().toISOString();
    const oldGPT = { enabled: true, useResponsesAPI: true, allowChatFallback: true, reasoningProfile: 'balanced' };
    await writeFile(filePath, JSON.stringify({
      version: 4,
      activeId: id,
      environmentModel: 'environment-model',
      environmentGPTOptimization: { ...oldGPT, enabled: false },
      keys: [{
        id, name: 'GPT legacy', apiKey: 'sk-gpt-legacy', model: 'gpt-model', baseURL: 'https://relay.example/v1',
        gptOptimization: oldGPT, createdAt: now, updatedAt: now,
      }],
    }), 'utf8');

    expect((await store.getSnapshot(id)).gptOptimization).toMatchObject({
      enabled: true,
      reasoningProfile: 'auto',
      creativeFreedom: 'balanced',
      internalImageSearch: true,
    });
    await store.rename(id, 'GPT migrated');
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ version: 6, environmentAPIProtocol: 'auto' });
  });

  it('migrates a v5 settings file with auto protocol defaults', async () => {
    const { store, filePath } = await makeStore('sk-env');
    const id = '4b8382ec-bc4d-45a6-8b67-67437fc86bc1';
    const now = new Date().toISOString();
    const gptOptimization = {
      enabled: false, useResponsesAPI: true, allowChatFallback: true,
      reasoningProfile: 'auto', creativeFreedom: 'balanced', internalImageSearch: true,
    };
    await writeFile(filePath, JSON.stringify({
      version: 5,
      activeId: id,
      environmentModel: 'environment-model',
      environmentGPTOptimization: gptOptimization,
      keys: [{
        id, name: 'Legacy relay', apiKey: 'sk-legacy', model: 'gpt-model', baseURL: 'https://relay.example/v1',
        gptOptimization, createdAt: now, updatedAt: now,
      }],
    }), 'utf8');

    expect((await store.getSnapshot(id)).apiProtocol).toBe('auto');
    await store.rename(id, 'Migrated relay');
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
      version: 6,
      environmentAPIProtocol: 'auto',
      keys: [{ id, apiProtocol: 'auto' }],
    });
  });

  it('reports a safe read error for a corrupted settings file', async () => {
    const { store, filePath } = await makeStore();
    await writeFile(filePath, '{not-json', 'utf8');

    await expect(store.list()).rejects.toMatchObject({
      code: 'READ_FAILED',
      message: '读取 Key 配置失败，请检查本地设置文件',
    });
  });

  it('masks both standard and non-standard key formats', () => {
    expect(maskAIKey('sk-abcdefgh')).toBe('sk-****efgh');
    expect(maskAIKey('token-1234')).toBe('tok****1234');
  });
});
