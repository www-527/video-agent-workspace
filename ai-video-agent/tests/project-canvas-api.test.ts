import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { project: mocks },
}));

import { GET as listProjects, POST as createProject } from '@/app/api/projects/route';
import { PATCH as patchProject } from '@/app/api/projects/[id]/route';

const now = new Date('2026-07-27T00:00:00.000Z');

describe('project canvas API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockImplementation(async ({ data }: { data: { type: string; canvasPreset: string; title: string } }) => ({
      uuid: 'project-1',
      ...data,
    }));
    mocks.findMany.mockResolvedValue([]);
    mocks.findUnique.mockResolvedValue({ workflow: 'gpt-free' });
    mocks.update.mockResolvedValue({ uuid: 'project-1' });
  });

  it('defaults omitted canvasPreset to landscape and accepts the Douyin portrait preset', async () => {
    const defaultResponse = await createProject(jsonRequest('POST', {
      type: 'html',
      // Legacy clients may still send this field. It must be ignored rather
      // than persisted, so projects can never pin credentials.
      aiBinding: { keyId: 'legacy-key', model: 'legacy-model' },
    }) as never);
    expect(defaultResponse.status).toBe(200);
    expect(await defaultResponse.json()).toMatchObject({ canvasPreset: 'landscape-16-9' });
    expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ canvasPreset: 'landscape-16-9' }),
    }));
    expect(mocks.create.mock.calls.at(-1)?.[0].data).not.toHaveProperty('aiBinding');

    const portraitResponse = await createProject(jsonRequest('POST', {
      type: 'html',
      canvasPreset: 'douyin-portrait-9-16',
    }) as never);
    expect(await portraitResponse.json()).toMatchObject({ canvasPreset: 'douyin-portrait-9-16' });
  });

  it('returns canvasPreset in the project list', async () => {
    mocks.findMany.mockResolvedValueOnce([{
      uuid: 'project-1', title: '竖屏项目', type: 'html', canvasPreset: 'douyin-portrait-9-16',
      createdAt: now, updatedAt: now, outline: null,
    }]);
    const response = await listProjects();
    expect(await response.json()).toEqual([expect.objectContaining({ canvasPreset: 'douyin-portrait-9-16' })]);
  });

  it('rejects attempts to change the canvas after creation', async () => {
    const response = await patchProject(
      jsonRequest('PATCH', { canvasPreset: 'douyin-portrait-9-16' }) as never,
      { params: { id: 'project-1' } },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: '项目画幅在创建后不可切换' });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('stores a project-level GPT override independently of other project fields', async () => {
    const gptOptimization = {
      mode: 'override',
      reasoningProfile: 'quality',
      creativeFreedom: 'open',
      internalImageSearch: false,
    };
    const response = await patchProject(
      jsonRequest('PATCH', { gptOptimization }) as never,
      { params: { id: 'project-1' } },
    );
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { uuid: 'project-1' },
      data: { gptOptimization },
    });
  });

  it('stores optional first-frame confirmation only on a GPT-free project', async () => {
    const response = await createProject(jsonRequest('POST', {
      type: 'html', workflow: 'gpt-free',
      gptOptimization: { mode: 'inherit', confirmFirstFrame: true },
    }) as never);
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workflow: 'gpt-free',
        gptOptimization: { mode: 'inherit', confirmFirstFrame: true },
      }),
    }));
  });
});

function jsonRequest(method: string, body: unknown): Request {
  return new Request('http://localhost/api/projects', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
