// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAPITestDialog, consumeSSE } from '@/components/codex-api-test-dialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const keyList = {
  items: [
    {
      id: 'active-key', name: '蝶祈云', maskedKey: 'sk-****1111',
      selectedModel: 'gpt-5.6-terra', baseURL: 'https://hgapi.example/v1',
      apiProtocol: 'responses', source: 'saved', active: true,
    },
    {
      id: 'backup-key', name: '备用站', maskedKey: 'sk-****2222',
      selectedModel: 'gpt-backup', baseURL: 'https://backup.example/v1',
      apiProtocol: 'auto', source: 'saved', active: false,
    },
  ],
  activeId: 'active-key', configured: true,
};

describe('CodexAPITestDialog', () => {
  it('defaults to the active Key and lets the user inspect another masked provider', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(keyList));

    render(<CodexAPITestDialog open onOpenChange={vi.fn()} />);

    const select = await screen.findByLabelText('Codex 测试 Key') as HTMLSelectElement;
    expect(select.value).toBe('active-key');
    expect(screen.getByText('gpt-5.6-terra')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sk-****1111');

    fireEvent.change(select, { target: { value: 'backup-key' } });

    expect(screen.getByText('gpt-backup')).toBeTruthy();
    expect(screen.getByText(/中转站：https:\/\/backup\.example/)).toBeTruthy();
  });

  it('renders split SSE chunks incrementally and reports the real request diagnostics', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(keyList))
      .mockResolvedValueOnce(new Response(sseStream([
        'data: {"type":"meta","model":"gpt-5.6-terra","relayBaseURL":"https://hgapi.example","requestCount":1,"stream":true,',
        '"store":false,"reasoningEffort":"low","startedAt":"2026-08-04T00:00:00.000Z"}\n\n',
        'data: {"type":"response.created","responseId":"resp_test","status":"in_progress","elapsedMs":80}\n\n',
        'data: {"type":"response.output_text.delta","delta":"你","elapsedMs":120}\n\n',
        'data: {"type":"response.output_text.delta","delta":"好","elapsedMs":150}\n\n',
        'data: {"type":"response.completed","responseId":"resp_test","status":"completed","usage":{"input":3,"output":2,"total":5},"firstEventMs":80,"firstTextMs":120,"durationMs":180,"eventCount":4}\n\n',
      ]), { status: 200, headers: { 'content-type': 'text/event-stream' } }));

    render(<CodexAPITestDialog open onOpenChange={vi.fn()} />);
    await screen.findByLabelText('Codex 测试 Key');
    fireEvent.change(screen.getByLabelText('Codex API 测试消息'), { target: { value: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('你好')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('已完成')).toBeTruthy());
    expect(screen.getByText('1 次')).toBeTruthy();
    expect(screen.getByText('120 ms')).toBeTruthy();
    expect(screen.getByText('180 ms')).toBeTruthy();
    expect(screen.getByText(/输入 3 · 输出 2 · 总计 5/)).toBeTruthy();
    expect(screen.getByTitle('resp_test')).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/settings/codex-test-chat', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"keyId":"active-key"'),
      signal: expect.any(AbortSignal),
    }));
  });

  it('shows and copies the complete sanitized protocol evidence', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(keyList))
      .mockResolvedValueOnce(new Response(sseStream([
        `data: ${JSON.stringify({
          type: 'meta', model: 'gpt-5.6-terra', relayBaseURL: 'https://hgapi.example', requestCount: 1,
          stream: true, store: false, reasoningEffort: 'low', startedAt: '2026-08-04T00:00:00.000Z',
          request: {
            endpoint: 'https://hgapi.example/v1/responses', method: 'POST', bodyBytes: 321,
            headers: { authorization: '[REDACTED]', originator: 'codex_cli_rs' },
            body: { model: 'gpt-5.6-terra', input: [{ role: 'user', content: [{ type: 'input_text', text: '诊断' }] }] },
            correlation: { sessionId: 's1', threadId: 't1', turnId: 'u1', clientRequestId: 't1' },
          },
        })}\n\n`,
        `data: ${JSON.stringify({ type: 'http.response', status: 200, statusText: 'OK', headers: { 'x-request-id': 'req-1' }, contentType: 'text/event-stream', elapsedMs: 20 })}\n\n`,
        `data: ${JSON.stringify({ type: 'upstream.event', sequence: 1, elapsedMs: 21, eventType: 'vendor.custom', bytes: 40, known: false, payload: { safe: true }, truncated: false, originalBytes: 40, retainedBytes: 40 })}\n\n`,
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '诊断成功', elapsedMs: 22 })}\n\n`,
        `data: ${JSON.stringify({ type: 'stream.done', sequence: 2, elapsedMs: 23, bytes: 6 })}\n\n`,
        `data: ${JSON.stringify({ type: 'response.completed', status: 'completed', firstEventMs: 21, firstTextMs: 22, durationMs: 24, eventCount: 1, responseBytes: 46, unknownEventCount: 1, terminationMode: 'response.completed', diagnosticsTruncated: false, doneReceived: true })}\n\n`,
      ]), { status: 200 }));

    render(<CodexAPITestDialog open onOpenChange={vi.fn()} />);
    await screen.findByLabelText('Codex 测试 Key');
    fireEvent.change(screen.getByLabelText('Codex API 测试消息'), { target: { value: '诊断' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('诊断成功')).toBeTruthy();
    expect(screen.getByText('https://hgapi.example/v1/responses')).toBeTruthy();
    expect(screen.getByText('200 OK')).toBeTruthy();
    expect(screen.getByText(/vendor\.custom/)).toBeTruthy();
    expect(screen.getByText('未知')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制 JSON' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('https://hgapi.example/v1/responses');
    expect(copied).toContain('[REDACTED]');
    expect(copied).not.toContain('sk-codex-test-secret');
  });

  it('aborts the one active request when Stop is pressed', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(keyList))
      .mockImplementationOnce((_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }));

    render(<CodexAPITestDialog open onOpenChange={vi.fn()} />);
    await screen.findByLabelText('Codex 测试 Key');
    fireEvent.change(screen.getByLabelText('Codex API 测试消息'), { target: { value: '停止测试' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    fireEvent.click(await screen.findByRole('button', { name: '停止' }));

    await waitFor(() => expect(screen.getByText('已停止')).toBeTruthy());
    expect(screen.queryByText('等待首个文本事件……')).toBeNull();
  });

  it('clears completed conversation state without making another request', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(keyList))
      .mockResolvedValueOnce(new Response(sseStream([
        'data: {"type":"meta","model":"gpt","relayBaseURL":"https://relay.example","requestCount":1,"stream":true,"store":false,"reasoningEffort":"low","startedAt":"2026-08-04T00:00:00.000Z"}\n\n',
        'data: {"type":"response.output_text.delta","delta":"回答","elapsedMs":20}\n\n',
        'data: {"type":"response.completed","status":"completed","durationMs":30,"eventCount":2}\n\n',
      ]), { status: 200 }));

    render(<CodexAPITestDialog open onOpenChange={vi.fn()} />);
    await screen.findByLabelText('Codex 测试 Key');
    fireEvent.change(screen.getByLabelText('Codex API 测试消息'), { target: { value: '问题' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('回答');
    fireEvent.click(screen.getByRole('button', { name: '清空' }));

    expect(screen.getByText('Codex 格式通信基准')).toBeTruthy();
    expect(screen.getByText('0 次')).toBeTruthy();
  });

  it('does not send an empty assistant placeholder after a streamed error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(keyList))
      .mockResolvedValueOnce(new Response(sseStream([
        'data: {"type":"meta","model":"gpt","relayBaseURL":"https://relay.example","requestCount":1,"stream":true,"store":false,"reasoningEffort":"low","startedAt":"2026-08-04T00:00:00.000Z"}\n\n',
        'data: {"type":"error","message":"504 Gateway Time-out","status":504,"durationMs":60000,"eventCount":0}\n\n',
      ]), { status: 200 }))
      .mockResolvedValueOnce(new Response(sseStream([
        'data: {"type":"response.output_text.delta","delta":"恢复","elapsedMs":20}\n\n',
        'data: {"type":"response.completed","status":"completed","durationMs":30,"eventCount":2}\n\n',
      ]), { status: 200 }));

    render(<CodexAPITestDialog open onOpenChange={vi.fn()} />);
    await screen.findByLabelText('Codex 测试 Key');

    fireEvent.change(screen.getByLabelText('Codex API 测试消息'), { target: { value: '第一次' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(screen.getByText('失败')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Codex API 测试消息'), { target: { value: '第二次' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('恢复');

    const secondRequest = fetchMock.mock.calls[2]?.[1];
    const body = JSON.parse(String(secondRequest?.body)) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages).toEqual([
      { role: 'user', content: '第一次' },
      { role: 'user', content: '第二次' },
    ]);
  });
});

describe('consumeSSE', () => {
  it('ignores DONE and supports a final block without a trailing delimiter', async () => {
    const events: unknown[] = [];
    await consumeSSE(sseStream([
      'data: [DONE]\n\n',
      'data: {"type":"response.output_text.delta","delta":"ok","elapsedMs":1}',
    ]), event => events.push(event));
    expect(events).toEqual([{ type: 'response.output_text.delta', delta: 'ok', elapsedMs: 1 }]);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}
