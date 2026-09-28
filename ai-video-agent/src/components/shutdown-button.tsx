'use client';

import { useState } from 'react';
import { Loader2, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type ShutdownStatus = 'idle' | 'closing' | 'closed';

export function ShutdownButton({
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
} = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [status, setStatus] = useState<ShutdownStatus>('idle');
  const [error, setError] = useState('');

  async function handleShutdown() {
    if (status === 'closing') return;

    setStatus('closing');
    setError('');

    try {
      const response = await fetch('/api/shutdown', { method: 'POST' });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || '关闭程序失败');
      }

      setOpen(false);
      setStatus('closed');
    } catch (shutdownError) {
      setStatus('idle');
      setError(shutdownError instanceof Error ? shutdownError.message : '关闭程序失败');
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={status === 'closing' ? undefined : setOpen}>
        {!hideTrigger ? <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Power className="h-4 w-4" />
            关闭程序
          </Button>
        </DialogTrigger> : null}
        <DialogContent className="max-w-md" hideClose={status === 'closing'}>
          <DialogHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <Power className="h-5 w-5" />
            </div>
            <DialogTitle>确认关闭程序？</DialogTitle>
            <DialogDescription className="pt-1 leading-6">
              关闭后，正在生成或导出的任务会立即停止。下次使用时，请重新双击启动程序。
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={status === 'closing'}>
                取消
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleShutdown} disabled={status === 'closing'}>
              {status === 'closing' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  正在关闭…
                </>
              ) : (
                '确认关闭'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {status === 'closed' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950 px-6 text-white">
          <div className="w-full max-w-md text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <Power className="h-7 w-7 text-slate-200" />
            </div>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight">程序已关闭</h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              现在可以安全关闭此浏览器标签页。再次使用时，请双击“启动AI视频程序”。
            </p>
          </div>
        </div>
      )}
    </>
  );
}
