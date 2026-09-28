'use client';

import { useCallback, useEffect, useState } from 'react';
import { Database, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface CacheStats {
  bytes: number;
  files: number;
  entries: number;
}

export function RenderCacheDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [projectStats, setProjectStats] = useState<CacheStats | null>(null);
  const [allStats, setAllStats] = useState<CacheStats | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const [projectResponse, allResponse] = await Promise.all([
      fetch(`/api/render-cache?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' }),
      fetch('/api/render-cache', { cache: 'no-store' }),
    ]);
    if (!projectResponse.ok || !allResponse.ok) throw new Error('读取渲染缓存失败。');
    const [projectPayload, allPayload] = await Promise.all([projectResponse.json(), allResponse.json()]);
    setProjectStats(projectPayload);
    setAllStats(allPayload);
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    void refresh().catch(error => toast.error(error instanceof Error ? error.message : '读取渲染缓存失败。'));
  }, [open, refresh]);

  async function clear(query: string, label: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/render-cache${query}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('清理渲染缓存失败。');
      await refresh();
      toast.success(label);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清理渲染缓存失败。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Database className="h-4 w-4" />渲染缓存</DialogTitle>
          <DialogDescription>缓存按项目、分镜和输入哈希隔离。清理不会删除项目、音频或素材。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <StatCard label="当前项目" stats={projectStats} />
          <StatCard label="全部项目" stats={allStats} />
        </div>
        <div className="grid gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void clear(`?projectId=${encodeURIComponent(projectId)}&failedOnly=true`, '已清理当前项目的失败缓存。')}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}仅清理失败缓存
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void clear(`?projectId=${encodeURIComponent(projectId)}`, '已清理当前项目渲染缓存。')}>
            <Trash2 className="mr-2 h-4 w-4" />清理当前项目缓存
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void clear('', '已清理全部渲染缓存。')}>
            <Trash2 className="mr-2 h-4 w-4" />清理全部渲染缓存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, stats }: { label: string; stats: CacheStats | null }) {
  return (
    <div className="rounded-xl border bg-slate-50 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{stats ? formatBytes(stats.bytes) : '—'}</div>
      <div className="mt-1 text-xs text-slate-400">{stats ? `${stats.entries} 个分镜版本 · ${stats.files} 个文件` : '正在统计'}</div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

