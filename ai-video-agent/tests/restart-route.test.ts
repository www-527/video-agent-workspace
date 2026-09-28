import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ launcher: true, request: vi.fn() }));
vi.mock('@/lib/app-restart', () => ({ hasManagedAppLauncher: vi.fn(() => state.launcher), requestManagedAppRestart: state.request }));
import { POST } from '@/app/api/restart/route';

describe('POST /api/restart', () => {
  beforeEach(() => { state.launcher = true; state.request.mockReset(); });
  it('writes a request for same-origin launcher sessions', async () => {
    const response = await POST(new NextRequest('http://127.0.0.1:3000/api/restart', { method: 'POST', headers: { origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' } }));
    expect(response.status).toBe(200); expect(state.request).toHaveBeenCalledOnce();
  });
  it('rejects cross-origin calls', async () => {
    const response = await POST(new NextRequest('http://127.0.0.1:3000/api/restart', { method: 'POST', headers: { origin: 'https://example.com', host: '127.0.0.1:3000' } }));
    expect(response.status).toBe(403); expect(state.request).not.toHaveBeenCalled();
  });
  it('does not self-restart outside the managed launcher', async () => {
    state.launcher = false;
    const response = await POST(new NextRequest('http://127.0.0.1:3000/api/restart', { method: 'POST' }));
    expect(response.status).toBe(409); expect(state.request).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: '自动重启需要通过工作区根目录的“启动AI视频程序.cmd”启动。当前服务不会自行关闭。',
    });
  });
});
