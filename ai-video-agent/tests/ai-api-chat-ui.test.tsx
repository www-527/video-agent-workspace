// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIAPIChat } from '@/components/ai-api-chat';

afterEach(() => vi.restoreAllMocks());

describe('AIAPIChat', () => {
  it('sends the conversation and renders reply metadata', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      message: '你好，我可以正常回复。',
      configuredModel: 'gpt-5.6-terra',
      actualModel: 'gpt-5.6-terra-real',
      apiMode: 'responses',
      responseId: 'resp_ui',
      responseStatus: 'completed',
      tokens: { total: 42 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    render(<AIAPIChat keyId="relay-id" keyName="中转站" model="gpt-5.6-terra" />);
    fireEvent.change(screen.getByLabelText('API 对话消息'), { target: { value: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('你好，我可以正常回复。')).toBeTruthy();
    expect(screen.getByText(/responses/)).toBeTruthy();
    expect(screen.getByText(/gpt-5.6-terra-real/)).toBeTruthy();
    expect(screen.getByText(/42 tokens/)).toBeTruthy();
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload).toEqual({ keyId: 'relay-id', messages: [{ role: 'user', content: '你好' }] });

    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    await waitFor(() => expect(screen.queryByText('你好，我可以正常回复。')).toBeNull());
  });

  it('shows a raw upstream request error without removing the user message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      message: '503 Service temporarily unavailable',
      type: 'server_error',
    }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    }));
    render(<AIAPIChat keyId="relay-id" keyName="中转站" model="gpt-5.6-terra" />);
    fireEvent.change(screen.getByLabelText('API 对话消息'), { target: { value: '测试消息' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect((await screen.findByRole('alert')).textContent).toContain('503 Service temporarily unavailable');
    expect(screen.getByText('测试消息')).toBeTruthy();
  });

  it('renders combined GPT relay compatibility fallback metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      message: 'OK',
      configuredModel: 'gpt-5.6-terra',
      actualModel: 'gpt-5.6-terra',
      apiMode: 'chat.completions',
      fallbackReason: 'responses_upstream_request_failed;chat_token_limit_removed',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    render(<AIAPIChat keyId="relay-id" keyName="中转站" model="gpt-5.6-terra" />);
    fireEvent.change(screen.getByLabelText('API 对话消息'), { target: { value: 'ping' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('OK')).toBeTruthy();
    expect(screen.getByText(/Responses 上游转发失败 \+ 已移除不兼容的 Token 上限/)).toBeTruthy();
  });
});
