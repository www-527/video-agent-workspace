import { z } from 'zod';
import { aiKeyStore } from '@/lib/ai-key-store';

const modelListSchema = z.object({
  data: z.array(z.object({
    id: z.string().trim().min(1),
    owned_by: z.string().trim().optional().default('unknown'),
  })),
});

export interface AvailableAIModel {
  id: string;
  ownedBy: string;
}

export interface AvailableAIModelList {
  count: number;
  models: AvailableAIModel[];
}

export class AIModelListError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'AIModelListError';
  }
}

export async function listAvailableAIModels(
  keyId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AvailableAIModelList> {
  const credential = await aiKeyStore.getSnapshot(keyId);
  const baseURL = credential.baseURL.replace(/\/+$/, '');
  if (!baseURL) throw new AIModelListError('AI_BASE_URL 未配置，无法读取模型列表', 409);

  let response: Response;
  try {
    response = await fetchImpl(`${baseURL}/models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${credential.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AIModelListError('无法连接模型服务，请检查接口地址或网络', 502);
  }

  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? 'API Key 无权读取模型列表'
      : response.status === 404
        ? '当前接口不支持读取模型列表，可手动输入模型 ID'
        : `读取模型列表失败（HTTP ${response.status}）`;
    throw new AIModelListError(message, response.status === 404 ? 404 : 502);
  }

  let parsed: z.infer<typeof modelListSchema>;
  try {
    parsed = modelListSchema.parse(await response.json());
  } catch {
    throw new AIModelListError('模型列表响应格式不兼容，可手动输入模型 ID', 502);
  }

  const uniqueModels = new Map<string, AvailableAIModel>();
  for (const model of parsed.data) {
    if (!uniqueModels.has(model.id)) {
      uniqueModels.set(model.id, { id: model.id, ownedBy: model.owned_by });
    }
  }
  const models = [...uniqueModels.values()].sort((left, right) => left.id.localeCompare(right.id));
  return { count: models.length, models };
}
