// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const routerPush = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock('next/dynamic', () => ({
  default: () => function LazyDialog(props: { open?: boolean }) {
    return props.open ? <div data-testid="lazy-dialog-open" /> : null;
  },
}));
vi.mock('@/lib/env', () => ({ env: { APP_NAME: 'AI Video Agent' } }));
vi.mock('@/components/ai-key-manager', () => ({ AIKeyManager: () => <button>Key 管理</button> }));
vi.mock('@/components/restart-button', () => ({ RestartButton: () => <button>重启</button> }));
vi.mock('@/components/shutdown-button', () => ({ ShutdownButton: () => <button>关闭</button> }));
const fetchMock = vi.fn(async (_url: string, init?: RequestInit): Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}> => {
  if (init?.method === 'POST') return { ok: true, json: async () => ({ uuid: 'project-1' }) };
  return { ok: true, json: async () => [] };
});
vi.stubGlobal('fetch', fetchMock);

import HomePage from '@/app/page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HomePage', () => {
  it('enters the latest project without creating a project', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ uuid: 'latest-project' }] });

    render(<HomePage />);

    await waitFor(() => expect(screen.getByText('还没有项目')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '进入项目中心' }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/projects/latest-project'));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('opens the project center when there is no project to enter', async () => {
    render(<HomePage />);

    await waitFor(() => expect(screen.getByText('还没有项目')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '进入项目中心' }));

    await waitFor(() => expect(screen.getByTestId('lazy-dialog-open')).toBeTruthy());
  });

  it('opens the lazy test dialog from the discreet corner icon', async () => {
    render(<HomePage />);

    await waitFor(() => expect(screen.getByText('还没有项目')).toBeTruthy());
    expect(screen.getByRole('button', { name: '全部项目' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Codex API 测试' }));

    expect(screen.getByTestId('lazy-dialog-open')).toBeTruthy();
  });
});
