'use client';

import { useState } from 'react';
import { Cpu, Database, FileSliders, Gauge, KeyRound, MessagesSquare, Mic2, Power, RefreshCw, Settings, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { AIKeyManager } from '@/components/ai-key-manager';
import { ShutdownButton } from '@/components/shutdown-button';
import { RestartButton } from '@/components/restart-button';
import { TtsProviderDialog } from '@/components/tts-provider/tts-provider-dialog';
import { RenderCacheDialog } from './render-cache-dialog';
import { ContentStyleSettingsDialog } from '@/components/content-style/content-style-settings-dialog';
import { ConversationHistoryDialog } from './conversation-history-dialog';
import { ThemeMenuItem } from '@/components/theme-toggle';
import {
  DEFAULT_FRAME_GENERATION_CONCURRENCY,
  GPT_FREE_FRAME_CONCURRENCY_OPTIONS,
} from '@/lib/generation/frame-concurrency';
import type { ChatMessage } from '@/types';

export function SettingsMenu({
  projectId,
  exportConcurrency,
  onExportConcurrencyChange,
  isGPTFree = false,
  gptFreeFrameConcurrency = DEFAULT_FRAME_GENERATION_CONCURRENCY,
  onGPTFreeFrameConcurrencyChange,
  autoOptimizeEnabled,
  onAutoOptimizeEnabledChange,
  useGpuEncoding,
  onUseGpuEncodingChange,
  messages = [],
}: {
  projectId: string;
  exportConcurrency: number;
  onExportConcurrencyChange: (value: number) => void;
  isGPTFree?: boolean;
  gptFreeFrameConcurrency?: number;
  onGPTFreeFrameConcurrencyChange?: (value: number) => void;
  autoOptimizeEnabled: boolean;
  onAutoOptimizeEnabledChange: (enabled: boolean) => void;
  useGpuEncoding: boolean;
  onUseGpuEncodingChange: (enabled: boolean) => void;
  messages?: readonly ChatMessage[];
}) {
  const [keyOpen, setKeyOpen] = useState(false);
  const [ttsOpen, setTtsOpen] = useState(false);
  const [cacheOpen, setCacheOpen] = useState(false);
  const [contentStyleOpen, setContentStyleOpen] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [conversationHistoryOpen, setConversationHistoryOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm"><Settings data-icon="inline-start" />设置</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="settings-menu w-64">
          <DropdownMenuLabel>AI 与账户</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setKeyOpen(true)}><KeyRound />Key 管理</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTtsOpen(true)}><Mic2 />配音服务配置</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setContentStyleOpen(true)}><FileSliders />内容提示词</DropdownMenuItem>
            {isGPTFree ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Sparkles className="mr-2 size-4" />分镜生成并发
                  <span className="ml-auto text-xs text-muted-foreground">{gptFreeFrameConcurrency} 路</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={String(gptFreeFrameConcurrency)}
                    onValueChange={value => onGPTFreeFrameConcurrencyChange?.(Number(value))}
                  >
                    {GPT_FREE_FRAME_CONCURRENCY_OPTIONS.map(value => (
                      <DropdownMenuRadioItem key={value} value={String(value)}>
                        {value} 路{value >= 4 ? ' · 高负载' : ''}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            <DropdownMenuItem onSelect={() => setConversationHistoryOpen(true)}>
              <MessagesSquare />对话记录
              <span className="ml-auto text-xs text-muted-foreground">{Math.min(messages.length, 100)}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>界面</DropdownMenuLabel>
          <DropdownMenuGroup>
            <ThemeMenuItem />
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>画面质量</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem className="justify-between" onSelect={event => event.preventDefault()}>
              <span className="flex items-center gap-2">
              <Sparkles className="size-4" />
              生成后逐镜自动优化
              </span>
              <Switch
                checked={autoOptimizeEnabled}
                onCheckedChange={onAutoOptimizeEnabledChange}
                aria-label="生成后逐镜自动优化"
              />
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>渲染与导出</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem className="justify-between" onSelect={event => event.preventDefault()}>
              <span className="flex items-center gap-2">
                <Cpu className="size-4" />
                <span>GPU 视频编码<span className="block text-[10px] font-normal text-muted-foreground">高画质优先 · 不可用时回退 CPU</span></span>
              </span>
              <Switch checked={useGpuEncoding} onCheckedChange={onUseGpuEncodingChange} aria-label="GPU 视频编码" />
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Gauge className="mr-2 size-4" />导出并发<span className="ml-auto text-xs text-muted-foreground">{exportConcurrency || '自动'}</span></DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={String(exportConcurrency)} onValueChange={value => onExportConcurrencyChange(Number(value))}>
                  <DropdownMenuRadioItem value="0">自动</DropdownMenuRadioItem>
                  {[1, 2, 3, 4].map(value => <DropdownMenuRadioItem key={value} value={String(value)}>{value} 路{value >= 3 ? ' · 高负载' : ''}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setCacheOpen(true)}><Database />渲染缓存</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>程序</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setRestartOpen(true)}><RefreshCw />重启程序</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setShutdownOpen(true)}><Power />关闭程序</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AIKeyManager open={keyOpen} onOpenChange={setKeyOpen} hideTrigger projectId={projectId} />
      <TtsProviderDialog open={ttsOpen} onOpenChange={setTtsOpen} />
      <RenderCacheDialog projectId={projectId} open={cacheOpen} onOpenChange={setCacheOpen} />
      <ContentStyleSettingsDialog projectId={projectId} open={contentStyleOpen} onOpenChange={setContentStyleOpen} />
      <ConversationHistoryDialog
        open={conversationHistoryOpen}
        onOpenChange={setConversationHistoryOpen}
        projectId={projectId}
        messages={messages}
      />
      <ShutdownButton open={shutdownOpen} onOpenChange={setShutdownOpen} hideTrigger />
      <RestartButton open={restartOpen} onOpenChange={setRestartOpen} hideTrigger />
    </>
  );
}
