// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIKeyManager } from '@/components/ai-key-manager';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AIKeyManager', () => {
  it('loads keys when a parent opens the controlled dialog', async () => {
    const keyList = {
      items: [{
        id: 'saved-id', name: 'pro', maskedKey: 'sk-****2f17',
        selectedModel: 'deepseek-v4-pro', baseURL: 'https://api.deepseek.com',
        source: 'saved', active: true, deletable: true,
      }],
      activeId: 'saved-id', activeName: 'pro', activeModel: 'deepseek-v4-pro',
      activeBaseURL: 'https://api.deepseek.com', configured: true,
    };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(keyList), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 0, models: [] }), { status: 200 }));

    const { rerender } = render(<AIKeyManager open={false} onOpenChange={vi.fn()} hideTrigger />);
    rerender(<AIKeyManager open onOpenChange={vi.fn()} hideTrigger />);

    expect(await screen.findByRole('button', { name: 'pro，当前使用' })).toBeTruthy();
    expect(screen.queryByText('暂无可用 Key，请在下方添加。')).toBeNull();
  });

  it('loads masked keys when opened and never renders a saved secret', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          id: 'saved-id',
          name: '工作账号',
          maskedKey: 'sk-****3456',
          selectedModel: 'deepseek-v4-flash',
          baseURL: 'https://api.deepseek.com',
          source: 'saved',
          active: true,
          deletable: true,
        }],
        activeId: 'saved-id',
        activeName: '工作账号',
        activeModel: 'deepseek-v4-flash',
        activeBaseURL: 'https://api.deepseek.com',
        configured: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        count: 2,
        models: [
          { id: 'deepseek-v4-flash', ownedBy: 'deepseek' },
          { id: 'deepseek-v4-pro', ownedBy: 'deepseek' },
        ],
      }), { status: 200 }));

    render(<AIKeyManager />);
    fireEvent.click(screen.getByRole('button', { name: 'Key 管理' }));

    expect(await screen.findByRole('button', { name: '工作账号，当前使用' })).toBeTruthy();
    expect(screen.getByText('sk-****3456')).toBeTruthy();
    expect(await screen.findByText('可用模型 2 个')).toBeTruthy();
    expect(screen.getByLabelText('API 返回的模型')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sk-work-123456');
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/ai-keys', expect.objectContaining({
      headers: expect.objectContaining({ 'content-type': 'application/json' }),
    }));
  });

  it('adds a key through a password field and clears the secret after success', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [], activeId: null, activeName: null, activeModel: null, activeBaseURL: null, configured: false,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          id: 'new-id',
          name: '备用账号',
          maskedKey: 'sk-****7890',
          selectedModel: 'deepseek-v4-flash',
          baseURL: 'https://api.deepseek.com',
          source: 'saved',
          active: true,
          deletable: true,
        }],
        activeId: 'new-id',
        activeName: '备用账号',
        activeModel: 'deepseek-v4-flash',
        activeBaseURL: 'https://api.deepseek.com',
        configured: true,
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        count: 1,
        models: [{ id: 'deepseek-v4-flash', ownedBy: 'deepseek' }],
      }), { status: 200 }));

    render(<AIKeyManager />);
    fireEvent.click(screen.getByRole('button', { name: 'Key 管理' }));
    await screen.findByText('暂无可用 Key');

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '备用账号' } });
    const secretInput = screen.getByLabelText('API Key') as HTMLInputElement;
    expect(secretInput.type).toBe('password');
    fireEvent.change(secretInput, { target: { value: 'sk-backup-7890' } });
    fireEvent.click(screen.getByRole('button', { name: '添加并切换' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
    expect(await screen.findByRole('button', { name: '备用账号，当前使用' })).toBeTruthy();
  });

  it('switches the active model and updates the header status', async () => {
    const keyList = {
      items: [{
        id: 'saved-id',
        name: '工作账号',
        maskedKey: 'sk-****3456',
        selectedModel: 'deepseek-v4-flash',
        baseURL: 'https://api.deepseek.com',
        source: 'saved',
        active: true,
        deletable: true,
      }],
      activeId: 'saved-id',
      activeName: '工作账号',
      activeModel: 'deepseek-v4-flash',
      activeBaseURL: 'https://api.deepseek.com',
      configured: true,
    };
    const switched = {
      ...keyList,
      items: [{ ...keyList.items[0], selectedModel: 'deepseek-v4-pro' }],
      activeModel: 'deepseek-v4-pro',
    };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(keyList), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        count: 2,
        models: [
          { id: 'deepseek-v4-flash', ownedBy: 'deepseek' },
          { id: 'deepseek-v4-pro', ownedBy: 'deepseek' },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(switched), { status: 200 }));

    render(<AIKeyManager />);
    fireEvent.click(screen.getByRole('button', { name: 'Key 管理' }));
    const select = await screen.findByLabelText('API 返回的模型');
    await screen.findByText('可用模型 2 个');
    fireEvent.change(select, { target: { value: 'deepseek-v4-pro' } });

    expect(await screen.findByText('工作账号 · deepseek-v4-pro')).toBeTruthy();
  });

  it('updates the active saved key Base URL and refreshes its model list', async () => {
    const keyList = {
      items: [{
        id: 'saved-id',
        name: 'DeepSeek',
        maskedKey: 'sk-****3456',
        selectedModel: 'deepseek-v4-pro',
        baseURL: 'https://old.example/v1',
        source: 'saved',
        active: true,
        deletable: true,
      }],
      activeId: 'saved-id',
      activeName: 'DeepSeek',
      activeModel: 'deepseek-v4-pro',
      activeBaseURL: 'https://old.example/v1',
      configured: true,
    };
    const updated = {
      ...keyList,
      items: [{ ...keyList.items[0], baseURL: 'https://api.deepseek.com' }],
      activeBaseURL: 'https://api.deepseek.com',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(keyList), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 0, models: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        count: 2,
        models: [
          { id: 'deepseek-v4-flash', ownedBy: 'deepseek' },
          { id: 'deepseek-v4-pro', ownedBy: 'deepseek' },
        ],
      }), { status: 200 }));

    render(<AIKeyManager />);
    fireEvent.click(screen.getByRole('button', { name: 'Key 管理' }));
    const input = await screen.findByLabelText('当前 Key 的 Base URL');
    fireEvent.change(input, { target: { value: 'https://api.deepseek.com/' } });
    fireEvent.click(screen.getByRole('button', { name: '保存地址' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const updateCall = fetchMock.mock.calls[2];
    expect(JSON.parse(String(updateCall[1]?.body))).toEqual({
      action: 'update-base-url',
      id: 'saved-id',
      baseURL: 'https://api.deepseek.com/',
    });
    expect((screen.getByLabelText('当前 Key 的 Base URL') as HTMLInputElement).value)
      .toBe('https://api.deepseek.com');
  });

  it('updates provider API protocol independently from GPT optimization', async () => {
    const keyList = {
      items: [{
        id: 'relay-id', name: 'Responses relay', maskedKey: 'sk-****3456',
        selectedModel: 'gpt-5.6-terra', baseURL: 'https://relay.example/v1', apiProtocol: 'auto',
        source: 'saved', active: true, deletable: true,
      }],
      activeId: 'relay-id', activeName: 'Responses relay', activeModel: 'gpt-5.6-terra',
      activeBaseURL: 'https://relay.example/v1', activeAPIProtocol: 'auto', configured: true,
    };
    const updated = {
      ...keyList,
      items: [{ ...keyList.items[0], apiProtocol: 'responses' }],
      activeAPIProtocol: 'responses',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(keyList), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 0, models: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }));

    render(<AIKeyManager />);
    fireEvent.click(screen.getByRole('button', { name: 'Key 管理' }));
    const select = await screen.findByLabelText('当前 Key 的 API 协议');
    fireEvent.change(select, { target: { value: 'responses' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      action: 'update-api-protocol', id: 'relay-id', apiProtocol: 'responses',
    });
    expect((screen.getByLabelText('当前 Key 的 API 协议') as HTMLSelectElement).value).toBe('responses');
  });

  it('shows three independent GPT controls and saves a current-project override', async () => {
    const keyList = {
      items: [{
        id: 'gpt-id', name: 'GPT relay', maskedKey: 'sk-****1234', selectedModel: 'gpt-5',
        baseURL: 'https://relay.example/v1', source: 'saved', active: true, deletable: true,
        gptOptimization: {
          enabled: true, useResponsesAPI: true, allowChatFallback: true,
          reasoningProfile: 'auto', creativeFreedom: 'balanced', internalImageSearch: true,
        },
      }],
      activeId: 'gpt-id', activeName: 'GPT relay', activeModel: 'gpt-5',
      activeBaseURL: 'https://relay.example/v1', configured: true,
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/settings/ai-keys') return new Response(JSON.stringify(keyList), { status: 200 });
      if (url === '/api/projects/project-1' && !init?.method) {
        return new Response(JSON.stringify({ gptOptimization: { mode: 'inherit' } }), { status: 200 });
      }
      if (url === '/api/projects/project-1' && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ uuid: 'project-1' }), { status: 200 });
      }
      if (url.startsWith('/api/settings/ai-models')) return new Response(JSON.stringify({ count: 0, models: [] }), { status: 200 });
      return new Response(JSON.stringify(keyList), { status: 200 });
    });

    render(<AIKeyManager open hideTrigger projectId="project-1" />);
    fireEvent.click(await screen.findByText('GPT 专项能力'));
    expect(await screen.findByLabelText('GPT 推理深度')).toBeTruthy();
    expect(screen.getByLabelText('GPT 创作自由度')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'GPT 内部搜图能力' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('当前项目 GPT 设置模式'), { target: { value: 'override' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-1', expect.objectContaining({ method: 'PATCH' })));
    const projectPatch = fetchMock.mock.calls.find(call => String(call[0]) === '/api/projects/project-1' && call[1]?.method === 'PATCH');
    expect(JSON.parse(String(projectPatch?.[1]?.body))).toEqual({
      gptOptimization: {
        mode: 'override', reasoningProfile: 'auto', creativeFreedom: 'balanced', internalImageSearch: true,
      },
    });
    expect(await screen.findByLabelText('项目推理深度')).toBeTruthy();
  });
});
