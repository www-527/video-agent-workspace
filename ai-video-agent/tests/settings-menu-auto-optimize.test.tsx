// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsMenu } from '@/components/studio/settings-menu';

vi.mock('@/components/ai-key-manager', () => ({ AIKeyManager: () => null }));
vi.mock('@/components/shutdown-button', () => ({ ShutdownButton: () => null }));
vi.mock('@/components/tts-provider/tts-provider-dialog', () => ({ TtsProviderDialog: () => null }));
vi.mock('@/components/studio/render-cache-dialog', () => ({ RenderCacheDialog: () => null }));

afterEach(() => vi.unstubAllGlobals());

describe('SettingsMenu auto optimize setting', () => {
  it('shows the persisted state and lets the user disable automatic per-frame optimization', async () => {
    const onChange = vi.fn();
    render(
      <SettingsMenu
        projectId="project-1"
        exportConcurrency={0}
        onExportConcurrencyChange={vi.fn()}
        autoOptimizeEnabled
        onAutoOptimizeEnabledChange={onChange}
        useGpuEncoding={false}
        onUseGpuEncodingChange={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: '设置' }), { button: 0, ctrlKey: false });
    const toggle = await screen.findByRole('switch', { name: /生成后逐镜自动优化/ });
    expect(toggle.getAttribute('data-state')).toBe('checked');

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('lets the user enable high-quality GPU video encoding', async () => {
    const onGpuChange = vi.fn();
    render(
      <SettingsMenu
        projectId="project-1"
        exportConcurrency={0}
        onExportConcurrencyChange={vi.fn()}
        autoOptimizeEnabled
        onAutoOptimizeEnabledChange={vi.fn()}
        useGpuEncoding={false}
        onUseGpuEncodingChange={onGpuChange}
      />,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: '设置' }), { button: 0, ctrlKey: false });
    const toggle = await screen.findByRole('switch', { name: 'GPU 视频编码' });
    expect(toggle.getAttribute('data-state')).toBe('unchecked');
    expect(screen.getByText(/高画质优先/)).toBeTruthy();

    fireEvent.click(toggle);
    expect(onGpuChange).toHaveBeenCalledWith(true);
  });

  it('offers GPT-free storyboard generation concurrency from one to five', async () => {
    const onConcurrencyChange = vi.fn();
    render(
      <SettingsMenu
        projectId="project-1"
        exportConcurrency={0}
        onExportConcurrencyChange={vi.fn()}
        isGPTFree
        gptFreeFrameConcurrency={3}
        onGPTFreeFrameConcurrencyChange={onConcurrencyChange}
        autoOptimizeEnabled
        onAutoOptimizeEnabledChange={vi.fn()}
        useGpuEncoding={false}
        onUseGpuEncodingChange={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: '设置' }), { button: 0, ctrlKey: false });
    const concurrencyTrigger = await screen.findByText('分镜生成并发');
    expect(screen.getByText('3 路')).toBeTruthy();
    fireEvent.keyDown(concurrencyTrigger.closest('[role="menuitem"]')!, { key: 'ArrowRight' });
    const fiveWorkers = await screen.findByRole('menuitemradio', { name: /5 路/ });
    fireEvent.click(fiveWorkers);

    expect(onConcurrencyChange).toHaveBeenCalledWith(5);
  });

  it('opens a transcript dialog with the newest 100 user and Agent messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        traces: [{
          id: 'trace-1',
          stage: 'agent.chat',
          model: 'gpt-test',
          relayBaseURL: 'https://relay.example.test/v1',
          system: 'System prompt',
          user: 'Relay user input',
          reasoning: null,
          output: 'Relay agent output',
          startedAt: new Date(2026, 0, 1).toISOString(),
          durationMs: 25,
          attempt: 1,
          maxAttempts: 1,
          visualInputs: [{
            label: '35% 画面',
            mimeType: 'image/png',
            byteLength: 68,
            thumbnailDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+8yV9WQAAAABJRU5ErkJggg==',
          }],
        }],
      }),
    }));
    const messages = Array.from({ length: 101 }, (_, index) => ({
      id: `message-${index}`,
      projectId: 'project-1',
      role: index % 2 ? 'assistant' as const : 'user' as const,
      content: `记录 ${index + 1}`,
      createdAt: new Date(2026, 0, 1, 0, index).toISOString(),
    }));
    render(
      <SettingsMenu
        projectId="project-1"
        exportConcurrency={0}
        onExportConcurrencyChange={vi.fn()}
        autoOptimizeEnabled
        onAutoOptimizeEnabledChange={vi.fn()}
        useGpuEncoding={false}
        onUseGpuEncodingChange={vi.fn()}
        messages={messages}
      />,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: '设置' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText('对话记录'));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByText('记录 1')).toBeNull();
    expect(screen.getByText('记录 2')).toBeTruthy();
    expect(screen.getByText('记录 101')).toBeTruthy();
    expect(screen.getAllByText('用户输入').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Agent 输出').length).toBeGreaterThan(0);
    expect(await screen.findByText('中转站收到的调用')).toBeTruthy();
    expect(screen.getByText('对话 100 / 101 条；中转调用 1 / 100 条')).toBeTruthy();
    expect(await screen.findByText('https://relay.example.test/v1')).toBeTruthy();
    expect(screen.getByText('System prompt')).toBeTruthy();
    expect(screen.getByText('Relay user input')).toBeTruthy();
    expect(screen.getByText('Relay agent output')).toBeTruthy();
    expect(screen.getByRole('img', { name: '35% 画面' })).toBeTruthy();
  });
});
