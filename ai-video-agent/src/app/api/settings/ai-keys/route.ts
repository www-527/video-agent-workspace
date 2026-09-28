import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiKeyStore, AIKeyStoreError } from '@/lib/ai-key-store';

const addSchema = z.object({
  name: z.string(),
  apiKey: z.string(),
  baseURL: z.string(),
});

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rename'), id: z.string().min(1), name: z.string() }),
  z.object({ action: z.literal('activate'), id: z.string().min(1) }),
  z.object({ action: z.literal('select-model'), id: z.string().min(1), model: z.string() }),
  z.object({ action: z.literal('update-base-url'), id: z.string().min(1), baseURL: z.string() }),
  z.object({ action: z.literal('update-api-protocol'), id: z.string().min(1), apiProtocol: z.enum(['auto', 'responses', 'chat.completions']) }),
  z.object({
    action: z.literal('update-gpt-optimization'),
    id: z.string().min(1),
    enabled: z.boolean().optional(),
    reasoningProfile: z.enum(['auto', 'fast', 'balanced', 'quality']).optional(),
    creativeFreedom: z.enum(['conservative', 'balanced', 'open']).optional(),
    internalImageSearch: z.boolean().optional(),
  }),
]);

const deleteSchema = z.object({ id: z.string().min(1) });

export async function GET() {
  try {
    return NextResponse.json(await aiKeyStore.list());
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = addSchema.parse(await request.json());
    return NextResponse.json(await aiKeyStore.add(input.name, input.apiKey, input.baseURL), { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = patchSchema.parse(await request.json());
    const result = input.action === 'rename'
      ? await aiKeyStore.rename(input.id, input.name)
      : input.action === 'select-model'
        ? await aiKeyStore.selectModel(input.id, input.model)
        : input.action === 'update-base-url'
          ? await aiKeyStore.updateBaseURL(input.id, input.baseURL)
          : input.action === 'update-api-protocol'
            ? await aiKeyStore.updateAPIProtocol(input.id, input.apiProtocol)
          : input.action === 'update-gpt-optimization'
            ? await aiKeyStore.updateGPTOptimization(input.id, {
              ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
              ...(input.reasoningProfile ? { reasoningProfile: input.reasoningProfile } : {}),
              ...(input.creativeFreedom ? { creativeFreedom: input.creativeFreedom } : {}),
              ...(input.internalImageSearch !== undefined ? { internalImageSearch: input.internalImageSearch } : {}),
            })
          : await aiKeyStore.activate(input.id);
    return NextResponse.json(result);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const input = deleteSchema.parse(await request.json());
    return NextResponse.json(await aiKeyStore.remove(input.id));
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message || '请求参数无效', code: 'INVALID_INPUT' },
      { status: 400 },
    );
  }
  if (error instanceof AIKeyStoreError) {
    const status = error.code === 'NOT_FOUND' ? 404
      : error.code === 'DUPLICATE_KEY' || error.code === 'DUPLICATE_NAME' ? 409
        : 500;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  return NextResponse.json({ error: 'Key 管理操作失败', code: 'INTERNAL_ERROR' }, { status: 500 });
}
