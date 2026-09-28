// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '@/components/studio/chat-panel';
import type { TtsProvider } from '@/lib/tts-provider';
import type { ProjectDetail } from '@/types';

vi.mock('@/components/style-picker/style-picker-dialog', () => ({
  StylePickerDialog: () => null,
}));

vi.mock('@/components/tts-provider/tts-provider-dialog', () => ({
  TtsProviderDialog: ({ open, onProviderChange }: {
    open: boolean;
    onProviderChange?: (provider: TtsProvider) => void;
  }) => open ? (
    <button type="button" onClick={() => onProviderChange?.('indextts')}>选择 IndexTTS</button>
  ) : null,
}));

vi.mock('@/components/studio/frame-generation-context', () => ({
  useFrameGenerationController: () => ({
    start: vi.fn(),
    refresh: vi.fn(),
    smartImageMode: 'balanced',
    setSmartImageMode: vi.fn(),
  }),
}));

const project: ProjectDetail = {
  uuid: 'project-tts-label',
  title: 'TTS label test',
  type: 'html',
  canvasPreset: 'landscape-16-9',
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  hasOutline: false,
  styleId: null,
  outline: null,
  videoSource: null,
};

describe('ChatPanel audio entry point', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/settings/tts');
      return new Response(JSON.stringify({ provider: 'tencent' }), { status: 200 });
    }));
  });

  it('keeps the audio provider out of the collapsed composer footer', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ChatPanel
          project={project}
          messages={[]}
          onMessagesChange={vi.fn()}
          onProjectChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/settings/tts'));
    expect(screen.queryByText('腾讯云')).toBeNull();
    expect(screen.queryByRole('button', { name: '配音 · 腾讯云' })).toBeNull();
  });
});

describe('ChatPanel input height', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/settings/tts') {
        return new Response(JSON.stringify({ provider: 'edge' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        userMessage: { id: 'user-message', projectId: project.uuid, role: 'user', content: '一段更长的需求', metadata: { kind: 'text' }, createdAt: project.createdAt },
        assistantMessage: { id: 'assistant-message', projectId: project.uuid, role: 'assistant', content: '已收到', metadata: { kind: 'text' }, createdAt: project.createdAt },
        project,
      }), { status: 200 });
    }));
  });

  it('grows with content, caps at 40% of the chat panel, and resets after sending', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ChatPanel
          project={project}
          messages={[]}
          onMessagesChange={vi.fn()}
          onProjectChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const panel = container.firstElementChild as HTMLDivElement;
    Object.defineProperty(panel, 'clientHeight', { configurable: true, value: 500 });
    const textarea = screen.getByPlaceholderText('随心输入') as HTMLTextAreaElement;

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => textarea.value === '' ? 0 : textarea.value === '短文本' ? 40 : textarea.value.includes('更长') ? 280 : 120,
    });
    fireEvent.change(textarea, { target: { value: '短文本' } });
    expect(textarea.style.height).toBe('72px');

    fireEvent.change(textarea, { target: { value: '一段较长的需求' } });
    expect(textarea.style.height).toBe('120px');
    expect(textarea.style.overflowY).toBe('hidden');

    fireEvent.change(textarea, { target: { value: '一段更长的需求' } });
    expect(textarea.style.height).toBe('200px');
    expect(textarea.style.overflowY).toBe('auto');

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(textarea.value).toBe(''));
    expect(textarea.style.height).toBe('72px');
    expect(textarea.style.overflowY).toBe('hidden');
  });
});

describe('ChatPanel compact composer', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  });

  it('keeps settings inside the add menu and makes the input card the primary surface', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ChatPanel
          project={project}
          messages={[]}
          onMessagesChange={vi.fn()}
          onProjectChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const composer = screen.getByRole('group', { name: '消息输入' });
    expect(composer.classList.contains('rounded-[20px]')).toBe(true);
    expect(screen.getByPlaceholderText('随心输入')).toBeTruthy();

    const addSettings = screen.getByRole('button', { name: '添加创作设置' });
    expect(addSettings.getAttribute('aria-haspopup')).toBe('menu');
  });
});
