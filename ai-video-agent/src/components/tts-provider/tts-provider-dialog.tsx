'use client';

import { useEffect, useState } from 'react';
import { Check, Cloud, HardDrive, Loader2, MoreHorizontal, Radio, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { TtsProvider } from '@/lib/tts-provider';
import { IndexTtsSettingsDialog } from './indextts-settings-dialog';

interface TtsProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProviderChange?: (provider: TtsProvider) => void;
}

const PROVIDERS: Array<{
  id: TtsProvider;
  name: string;
  description: string;
  detail: string;
  icon: typeof Radio;
}> = [
  {
    id: 'none',
    name: '无',
    description: '静音生成',
    detail: '不调用语音合成服务，后续分镜只保留画面与估算时长。',
    icon: VolumeX,
  },
  {
    id: 'edge',
    name: 'Edge TTS',
    description: '免费在线语音合成',
    detail: '无需 API 密钥，适合快速预览和低成本批量生成。',
    icon: Radio,
  },
  {
    id: 'tencent',
    name: '腾讯云 TTS SDK',
    description: '腾讯云语音合成服务',
    detail: '使用当前腾讯云账号的音色与额度，适合正式成片。',
    icon: Cloud,
  },
  {
    id: 'indextts',
    name: 'IndexTTS 本地',
    description: '本机 IndexTTS 2.0 服务',
    detail: '连接本地 Gradio WebUI，适合使用自定义参考音频和离线合成。',
    icon: HardDrive,
  },
];

export function TtsProviderDialog({ open, onOpenChange, onProviderChange }: TtsProviderDialogProps) {
  const [savedProvider, setSavedProvider] = useState<TtsProvider>('tencent');
  const [draftProvider, setDraftProvider] = useState<TtsProvider>('tencent');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/settings/tts')
      .then(async response => {
        if (!response.ok) throw new Error('读取 TTS 设置失败');
        return response.json() as Promise<{ provider: TtsProvider }>;
      })
      .then(({ provider }) => {
        setSavedProvider(provider);
        setDraftProvider(provider);
      })
      .catch(error => toast.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [open]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !saving) setDraftProvider(savedProvider);
    onOpenChange(nextOpen);
  }

  async function handleConfirm() {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: draftProvider }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || '切换 TTS 服务失败');

      setSavedProvider(draftProvider);
      onProviderChange?.(draftProvider);
      onOpenChange(false);
      toast.success(`已切换到 ${PROVIDERS.find(item => item.id === draftProvider)?.name}`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle>选择 TTS 服务</DialogTitle>
          <DialogDescription>
            选择后续旁白生成使用的语音服务。已有音频不会被自动替换。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-44 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            读取当前设置...
          </div>
        ) : (
          <div className="grid gap-3 py-2" role="radiogroup" aria-label="TTS 服务">
            {PROVIDERS.map(provider => {
              const selected = draftProvider === provider.id;
              const Icon = provider.icon;
              return (
                <div
                  key={provider.id}
                  role="radio"
                  tabIndex={0}
                  aria-checked={selected}
                  onClick={() => setDraftProvider(provider.id)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setDraftProvider(provider.id);
                    }
                  }}
                  className={cn(
                    'group flex w-full cursor-pointer items-start gap-3 rounded-xl border-2 p-4 text-left outline-none transition-all',
                    'hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                    selected && 'border-primary bg-primary/[0.035] shadow-sm hover:border-primary hover:bg-primary/[0.05]',
                  )}
                >
                  <span className={cn(
                    'mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors',
                    selected && 'bg-primary text-primary-foreground',
                  )}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-900">{provider.name}</span>
                      <span className="flex flex-none items-center gap-1">
                        {provider.id === 'indextts' && (
                          <button
                            type="button"
                            aria-label="IndexTTS 参数设置"
                            title="IndexTTS 参数设置"
                            onClick={event => {
                              event.stopPropagation();
                              setSettingsOpen(true);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        )}
                        {selected && (
                          <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs font-medium text-slate-600">{provider.description}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{provider.detail}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={loading || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            确定
          </Button>
        </div>
      </DialogContent>
      <IndexTtsSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </Dialog>
  );
}
