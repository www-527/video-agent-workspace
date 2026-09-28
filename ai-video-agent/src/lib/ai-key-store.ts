import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { z } from 'zod';
import { env } from '@/lib/env';
import {
  DEFAULT_GPT_OPTIMIZATION,
  type GPTOptimizationSettings,
} from '@/lib/gpt-optimization-settings';

export { DEFAULT_GPT_OPTIMIZATION } from '@/lib/gpt-optimization-settings';
export type { GPTOptimizationSettings } from '@/lib/gpt-optimization-settings';

export const ENVIRONMENT_KEY_ID = 'environment';

const storedKeyV1Schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  apiKey: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const storedKeyV2Schema = storedKeyV1Schema.extend({
  model: z.string().min(1),
});

const keyFileV1Schema = z.object({
  version: z.literal(1),
  activeId: z.string().nullable(),
  keys: z.array(storedKeyV1Schema),
});

const keyFileV2Schema = z.object({
  version: z.literal(2),
  activeId: z.string().nullable(),
  environmentModel: z.string().min(1),
  keys: z.array(storedKeyV2Schema),
});

const storedKeyV3Schema = storedKeyV2Schema.extend({
  baseURL: z.string().min(1),
});

const keyFileV3Schema = z.object({
  version: z.literal(3),
  activeId: z.string().nullable(),
  environmentModel: z.string().min(1),
  keys: z.array(storedKeyV3Schema),
});

const gptOptimizationSchema = z.object({
  enabled: z.boolean().default(DEFAULT_GPT_OPTIMIZATION.enabled),
  useResponsesAPI: z.boolean().default(DEFAULT_GPT_OPTIMIZATION.useResponsesAPI),
  allowChatFallback: z.boolean().default(DEFAULT_GPT_OPTIMIZATION.allowChatFallback),
  reasoningProfile: z.enum(['auto', 'fast', 'balanced', 'quality']).default(DEFAULT_GPT_OPTIMIZATION.reasoningProfile),
  creativeFreedom: z.enum(['conservative', 'balanced', 'open']).default(DEFAULT_GPT_OPTIMIZATION.creativeFreedom),
  internalImageSearch: z.boolean().default(DEFAULT_GPT_OPTIMIZATION.internalImageSearch),
});

const legacyGPTOptimizationSchema = z.object({
  enabled: z.boolean(),
  useResponsesAPI: z.boolean(),
  allowChatFallback: z.boolean(),
  reasoningProfile: z.enum(['fast', 'balanced', 'quality']),
});

const storedKeyV4Schema = storedKeyV3Schema.extend({
  gptOptimization: legacyGPTOptimizationSchema,
});

const keyFileV4Schema = z.object({
  version: z.literal(4),
  activeId: z.string().nullable(),
  environmentModel: z.string().min(1),
  environmentGPTOptimization: legacyGPTOptimizationSchema,
  keys: z.array(storedKeyV4Schema),
});

const storedKeyV5Schema = storedKeyV3Schema.extend({
  gptOptimization: gptOptimizationSchema,
});

const keyFileV5Schema = z.object({
  version: z.literal(5),
  activeId: z.string().nullable(),
  environmentModel: z.string().min(1),
  environmentGPTOptimization: gptOptimizationSchema,
  keys: z.array(storedKeyV5Schema),
});

export const AI_API_PROTOCOLS = ['auto', 'responses', 'chat.completions'] as const;
export type AIAPIProtocol = typeof AI_API_PROTOCOLS[number];

const apiProtocolSchema = z.enum(AI_API_PROTOCOLS);
const storedKeySchema = storedKeyV5Schema.extend({
  apiProtocol: apiProtocolSchema,
});

const keyFileSchema = z.object({
  version: z.literal(6),
  activeId: z.string().nullable(),
  environmentModel: z.string().min(1),
  environmentGPTOptimization: gptOptimizationSchema,
  environmentAPIProtocol: apiProtocolSchema,
  keys: z.array(storedKeySchema),
});

const keyNameSchema = z.string().trim().min(1, '请输入 Key 名称').max(50, 'Key 名称不能超过 50 个字符');
const apiKeySchema = z.string().trim().min(1, '请输入 API Key').max(4096, 'API Key 长度异常');
const modelSchema = z.string().trim().min(1, '请输入模型 ID').max(200, '模型 ID 不能超过 200 个字符');

const baseURLSchema = z.string().trim()
  .url('请输入有效的 Base URL')
  .refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Base URL 仅支持 HTTP/HTTPS')
  .transform(value => value.replace(/\/+$/, ''));

type StoredKey = z.infer<typeof storedKeySchema>;
type KeyFile = z.infer<typeof keyFileSchema>;

export type AIKeySource = 'saved' | 'environment';

export interface AIKeyItem {
  id: string;
  name: string;
  maskedKey: string;
  selectedModel: string;
  baseURL: string;
  apiProtocol: AIAPIProtocol;
  gptOptimization: GPTOptimizationSettings;
  source: AIKeySource;
  active: boolean;
  deletable: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AIKeyList {
  items: AIKeyItem[];
  activeId: string | null;
  activeName: string | null;
  activeModel: string | null;
  activeBaseURL: string | null;
  activeAPIProtocol: AIAPIProtocol | null;
  activeGPTOptimization: GPTOptimizationSettings | null;
  configured: boolean;
}

export interface AIKeySnapshot {
  id: string;
  name: string;
  apiKey: string;
  model: string;
  baseURL: string;
  apiProtocol: AIAPIProtocol;
  gptOptimization: GPTOptimizationSettings;
  source: AIKeySource;
}

export class AIKeyStoreError extends Error {
  constructor(
    message: string,
    public readonly code: 'DUPLICATE_NAME' | 'DUPLICATE_KEY' | 'NOT_FOUND' | 'READ_FAILED' | 'WRITE_FAILED',
  ) {
    super(message);
    this.name = 'AIKeyStoreError';
  }
}

export class AIKeyStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly getEnvironmentKey: () => string,
    private readonly getDefaultModel: () => string = () => env.AI_MODEL,
    private readonly getEnvironmentBaseURL: () => string = () => env.AI_BASE_URL,
  ) {}

  async list(): Promise<AIKeyList> {
    const data = await this.read();
    const activeId = this.resolveActiveId(data);
    const items: AIKeyItem[] = [];
    const environmentKey = this.getEnvironmentKey().trim();

    if (environmentKey) {
      items.push({
        id: ENVIRONMENT_KEY_ID,
        name: '环境变量 Key',
        maskedKey: maskAIKey(environmentKey),
        selectedModel: data.environmentModel,
        baseURL: this.defaultBaseURL(),
        apiProtocol: data.environmentAPIProtocol,
        gptOptimization: data.environmentGPTOptimization,
        source: 'environment',
        active: activeId === ENVIRONMENT_KEY_ID,
        deletable: false,
      });
    }

    for (const item of data.keys) {
      items.push({
        id: item.id,
        name: item.name,
        maskedKey: maskAIKey(item.apiKey),
        selectedModel: item.model,
        baseURL: item.baseURL,
        apiProtocol: item.apiProtocol,
        gptOptimization: item.gptOptimization,
        source: 'saved',
        active: activeId === item.id,
        deletable: true,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
    }

    const active = items.find(item => item.active);
    return {
      items,
      activeId,
      activeName: active?.name ?? null,
      activeModel: active?.selectedModel ?? null,
      activeBaseURL: active?.baseURL ?? null,
      activeAPIProtocol: active?.apiProtocol ?? null,
      activeGPTOptimization: active?.gptOptimization ?? null,
      configured: Boolean(active),
    };
  }

  async getActiveSnapshot(): Promise<AIKeySnapshot> {
    const data = await this.read();
    const activeId = this.resolveActiveId(data);
    if (!activeId) {
      throw new AIKeyStoreError('请先在 Key 管理中添加并选择 API Key', 'NOT_FOUND');
    }
    return this.snapshotFromData(data, activeId);
  }

  async getSnapshot(id: string): Promise<AIKeySnapshot> {
    return this.snapshotFromData(await this.read(), id);
  }

  add(name: string, apiKey: string, baseURL = this.defaultBaseURL()): Promise<AIKeyList> {
    return this.mutate(data => {
      const normalizedName = keyNameSchema.parse(name);
      const normalizedKey = apiKeySchema.parse(apiKey);
      const normalizedBaseURL = baseURLSchema.parse(baseURL);
      this.assertUnique(data, normalizedName, normalizedKey);
      const now = new Date().toISOString();
      const item: StoredKey = {
        id: randomUUID(),
        name: normalizedName,
        apiKey: normalizedKey,
        model: this.defaultModel(),
        baseURL: normalizedBaseURL,
        apiProtocol: 'auto',
        gptOptimization: { ...DEFAULT_GPT_OPTIMIZATION },
        createdAt: now,
        updatedAt: now,
      };
      data.keys.push(item);
      data.activeId = item.id;
    });
  }

  rename(id: string, name: string): Promise<AIKeyList> {
    return this.mutate(data => {
      if (id === ENVIRONMENT_KEY_ID) {
        throw new AIKeyStoreError('环境变量 Key 不能重命名', 'NOT_FOUND');
      }
      const item = data.keys.find(key => key.id === id);
      if (!item) throw new AIKeyStoreError('Key 不存在或已被删除', 'NOT_FOUND');
      const normalizedName = keyNameSchema.parse(name);
      this.assertUnique(data, normalizedName, undefined, id);
      item.name = normalizedName;
      item.updatedAt = new Date().toISOString();
    });
  }

  activate(id: string): Promise<AIKeyList> {
    return this.mutate(data => {
      this.assertKeyExists(data, id);
      data.activeId = id;
    });
  }

  selectModel(id: string, model: string): Promise<AIKeyList> {
    return this.mutate(data => {
      this.assertKeyExists(data, id);
      const normalizedModel = modelSchema.parse(model);
      if (id === ENVIRONMENT_KEY_ID) {
        data.environmentModel = normalizedModel;
        return;
      }
      const item = data.keys.find(key => key.id === id)!;
      item.model = normalizedModel;
      item.updatedAt = new Date().toISOString();
    });
  }

  updateBaseURL(id: string, baseURL: string): Promise<AIKeyList> {
    return this.mutate(data => {
      if (id === ENVIRONMENT_KEY_ID) {
        throw new AIKeyStoreError('环境变量 Key 的 Base URL 请在 .env 中修改', 'NOT_FOUND');
      }
      const item = data.keys.find(key => key.id === id);
      if (!item) throw new AIKeyStoreError('Key 不存在或已被删除', 'NOT_FOUND');
      item.baseURL = baseURLSchema.parse(baseURL);
      item.updatedAt = new Date().toISOString();
    });
  }

  updateAPIProtocol(id: string, apiProtocol: AIAPIProtocol): Promise<AIKeyList> {
    return this.mutate(data => {
      this.assertKeyExists(data, id);
      const normalized = apiProtocolSchema.parse(apiProtocol);
      if (id === ENVIRONMENT_KEY_ID) {
        data.environmentAPIProtocol = normalized;
        return;
      }
      const item = data.keys.find(key => key.id === id)!;
      item.apiProtocol = normalized;
      item.updatedAt = new Date().toISOString();
    });
  }

  updateGPTOptimization(id: string, patch: Partial<GPTOptimizationSettings> | boolean): Promise<AIKeyList> {
    return this.mutate(data => {
      this.assertKeyExists(data, id);
      const update = typeof patch === 'boolean' ? { enabled: patch } : patch;
      if (id === ENVIRONMENT_KEY_ID) {
        data.environmentGPTOptimization = gptOptimizationSchema.parse({ ...data.environmentGPTOptimization, ...update });
        return;
      }
      const item = data.keys.find(key => key.id === id)!;
      item.gptOptimization = gptOptimizationSchema.parse({ ...item.gptOptimization, ...update });
      item.updatedAt = new Date().toISOString();
    });
  }

  remove(id: string): Promise<AIKeyList> {
    return this.mutate(data => {
      if (id === ENVIRONMENT_KEY_ID) {
        throw new AIKeyStoreError('环境变量 Key 不能删除', 'NOT_FOUND');
      }
      const index = data.keys.findIndex(key => key.id === id);
      if (index < 0) throw new AIKeyStoreError('Key 不存在或已被删除', 'NOT_FOUND');
      const wasActive = data.activeId === id || this.resolveActiveId(data) === id;
      data.keys.splice(index, 1);
      if (wasActive) {
        data.activeId = this.getEnvironmentKey().trim()
          ? ENVIRONMENT_KEY_ID
          : data.keys[0]?.id ?? null;
      }
    });
  }

  private async read(): Promise<KeyFile> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const current = keyFileSchema.safeParse(parsed);
      if (current.success) return current.data;

      const version5 = keyFileV5Schema.safeParse(parsed);
      if (version5.success) {
        return {
          version: 6,
          activeId: version5.data.activeId,
          environmentModel: version5.data.environmentModel,
          environmentGPTOptimization: version5.data.environmentGPTOptimization,
          environmentAPIProtocol: 'auto',
          keys: version5.data.keys.map(item => ({ ...item, apiProtocol: 'auto' })),
        };
      }

      const version4 = keyFileV4Schema.safeParse(parsed);
      if (version4.success) {
        const migrateGPTSettings = (settings: z.infer<typeof legacyGPTOptimizationSchema>): GPTOptimizationSettings => ({
          ...DEFAULT_GPT_OPTIMIZATION,
          enabled: settings.enabled,
          useResponsesAPI: settings.useResponsesAPI,
          allowChatFallback: settings.allowChatFallback,
          // v4 exposed only the master switch, so its old internal "balanced"
          // value was not a user choice. v6 adopts the documented Auto default.
          reasoningProfile: 'auto',
        });
        return {
          version: 6,
          activeId: version4.data.activeId,
          environmentModel: version4.data.environmentModel,
          environmentGPTOptimization: migrateGPTSettings(version4.data.environmentGPTOptimization),
          environmentAPIProtocol: 'auto',
          keys: version4.data.keys.map(item => ({
            ...item,
            gptOptimization: migrateGPTSettings(item.gptOptimization),
            apiProtocol: 'auto',
          })),
        };
      }

      const version3 = keyFileV3Schema.safeParse(parsed);
      if (version3.success) {
        return {
          version: 6,
          activeId: version3.data.activeId,
          environmentModel: version3.data.environmentModel,
          environmentGPTOptimization: { ...DEFAULT_GPT_OPTIMIZATION },
          environmentAPIProtocol: 'auto',
          keys: version3.data.keys.map(item => ({
            ...item,
            gptOptimization: { ...DEFAULT_GPT_OPTIMIZATION },
            apiProtocol: 'auto',
          })),
        };
      }

      const previous = keyFileV2Schema.safeParse(parsed);
      if (previous.success) {
        const baseURL = this.defaultBaseURL();
        return {
          version: 6,
          activeId: previous.data.activeId,
          environmentModel: previous.data.environmentModel,
          environmentGPTOptimization: { ...DEFAULT_GPT_OPTIMIZATION },
          environmentAPIProtocol: 'auto',
          keys: previous.data.keys.map(item => ({
            ...item,
            baseURL,
            gptOptimization: { ...DEFAULT_GPT_OPTIMIZATION },
            apiProtocol: 'auto',
          })),
        };
      }

      const legacy = keyFileV1Schema.safeParse(parsed);
      if (legacy.success) {
        const defaultModel = this.defaultModel();
        const baseURL = this.defaultBaseURL();
        return {
          version: 6,
          activeId: legacy.data.activeId,
          environmentModel: defaultModel,
          environmentGPTOptimization: { ...DEFAULT_GPT_OPTIMIZATION },
          environmentAPIProtocol: 'auto',
          keys: legacy.data.keys.map(item => ({
            ...item,
            model: defaultModel,
            baseURL,
            gptOptimization: { ...DEFAULT_GPT_OPTIMIZATION },
            apiProtocol: 'auto',
          })),
        };
      }
      throw current.error;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return {
          version: 6,
          activeId: this.getEnvironmentKey().trim() ? ENVIRONMENT_KEY_ID : null,
          environmentModel: this.defaultModel(),
          environmentGPTOptimization: { ...DEFAULT_GPT_OPTIMIZATION },
          environmentAPIProtocol: 'auto',
          keys: [],
        };
      }
      if (error instanceof AIKeyStoreError) throw error;
      throw new AIKeyStoreError('读取 Key 配置失败，请检查本地设置文件', 'READ_FAILED');
    }
  }

  private snapshotFromData(data: KeyFile, id: string): AIKeySnapshot {
    if (id === ENVIRONMENT_KEY_ID) {
      const apiKey = this.getEnvironmentKey().trim();
      if (!apiKey) throw new AIKeyStoreError('环境变量 Key 未配置', 'NOT_FOUND');
      return {
        id: ENVIRONMENT_KEY_ID,
        name: '环境变量 Key',
        apiKey,
        model: data.environmentModel,
        baseURL: this.defaultBaseURL(),
        apiProtocol: data.environmentAPIProtocol,
        gptOptimization: data.environmentGPTOptimization,
        source: 'environment',
      };
    }
    const item = data.keys.find(key => key.id === id);
    if (!item) throw new AIKeyStoreError('Key 不存在或已被删除', 'NOT_FOUND');
    return {
      id: item.id,
      name: item.name,
      apiKey: item.apiKey,
      model: item.model,
      baseURL: item.baseURL,
      apiProtocol: item.apiProtocol,
      gptOptimization: item.gptOptimization,
      source: 'saved',
    };
  }

  private resolveActiveId(data: KeyFile): string | null {
    if (data.activeId === ENVIRONMENT_KEY_ID && this.getEnvironmentKey().trim()) {
      return ENVIRONMENT_KEY_ID;
    }
    if (data.activeId && data.keys.some(key => key.id === data.activeId)) {
      return data.activeId;
    }
    if (this.getEnvironmentKey().trim()) return ENVIRONMENT_KEY_ID;
    return data.keys[0]?.id ?? null;
  }

  private assertKeyExists(data: KeyFile, id: string): void {
    if (id === ENVIRONMENT_KEY_ID) {
      if (!this.getEnvironmentKey().trim()) {
        throw new AIKeyStoreError('环境变量 Key 未配置', 'NOT_FOUND');
      }
      return;
    }
    if (!data.keys.some(key => key.id === id)) {
      throw new AIKeyStoreError('Key 不存在或已被删除', 'NOT_FOUND');
    }
  }

  private assertUnique(data: KeyFile, name?: string, apiKey?: string, ignoredId?: string): void {
    if (name && data.keys.some(item => item.id !== ignoredId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new AIKeyStoreError('Key 名称已存在', 'DUPLICATE_NAME');
    }
    if (apiKey && data.keys.some(item => item.id !== ignoredId && item.apiKey === apiKey)) {
      throw new AIKeyStoreError('该 API Key 已经添加', 'DUPLICATE_KEY');
    }
  }

  private defaultModel(): string {
    return modelSchema.parse(this.getDefaultModel());
  }

  private defaultBaseURL(): string {
    return baseURLSchema.parse(this.getEnvironmentBaseURL());
  }

  private mutate(update: (data: KeyFile) => void): Promise<AIKeyList> {
    const operation = this.mutationQueue.then(async () => {
      const data = await this.read();
      update(data);
      await this.write(data);
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation.then(() => this.list());
  }

  private async write(data: KeyFile): Promise<void> {
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporaryPath, JSON.stringify(keyFileSchema.parse(data), null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
    } catch {
      await unlink(temporaryPath).catch(() => undefined);
      throw new AIKeyStoreError('保存 Key 配置失败，请检查 data/settings 目录权限', 'WRITE_FAILED');
    }
  }
}

export function maskAIKey(value: string): string {
  const trimmed = value.trim();
  const prefix = trimmed.startsWith('sk-') ? 'sk-' : trimmed.slice(0, Math.min(3, trimmed.length));
  const suffix = trimmed.slice(-4);
  return `${prefix}****${suffix}`;
}

export const aiKeyStore = new AIKeyStore(
  join(process.cwd(), 'data', 'settings', 'ai-keys.json'),
  () => env.AI_API_KEY,
  () => env.AI_MODEL,
  () => env.AI_BASE_URL,
);
