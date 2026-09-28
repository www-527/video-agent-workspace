import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGPTFreeProject } from '@/lib/projects/create-gpt-free-project';

afterEach(() => vi.unstubAllGlobals());

describe('createGPTFreeProject', () => {
  it('sends the selected portrait canvas preset when creating a project', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => (
      new Response(JSON.stringify({ uuid: 'portrait-project' }), { status: 200 })
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createGPTFreeProject('douyin-portrait-9-16')).resolves.toBe('portrait-project');

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    expect(JSON.parse(request!.body as string)).toMatchObject({
      canvasPreset: 'douyin-portrait-9-16',
      workflow: 'gpt-free',
    });
  });
});
