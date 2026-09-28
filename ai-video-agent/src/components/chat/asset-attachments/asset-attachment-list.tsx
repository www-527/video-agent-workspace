'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, ImageIcon, Loader2, Paperclip, RefreshCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AssetSummary } from '@/types';

const ACCEPTED_FILES = '.png,.jpg,.jpeg,.webp,.docx,.md,.markdown,.txt';

interface AssetAttachmentListProps {
  projectId: string;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

export function AssetAttachmentList({
  projectId,
  selectedIds,
  onSelectedIdsChange,
  onBusyChange,
  disabled = false,
}: AssetAttachmentListProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const busy = uploadingNames.length > 0 || assets.some(asset => asset.status === 'uploaded' || asset.status === 'processing');

  const loadAssets = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/assets`);
    const data = await response.json().catch(() => ({})) as { assets?: AssetSummary[]; error?: string };
    if (!response.ok) throw new Error(data.error || '读取附件失败');
    setAssets(data.assets ?? []);
    return data.assets ?? [];
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadAssets()
      .catch(error => {
        if (!cancelled) toast.error((error as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [loadAssets]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (!assets.some(asset => asset.status === 'processing' || asset.status === 'uploaded')) return;
    const timer = window.setInterval(() => {
      void loadAssets().catch(() => {});
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [assets, loadAssets]);

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    if (files.length + selectedIds.length > 10) {
      toast.error('每条消息最多附加 10 个文件');
      return;
    }
    const form = new FormData();
    files.forEach(file => form.append('files', file));
    setUploadingNames(files.map(file => file.name));
    try {
      const response = await fetch(`/api/projects/${projectId}/assets`, { method: 'POST', body: form });
      const data = await response.json().catch(() => ({})) as { assets?: AssetSummary[]; error?: string };
      if (!response.ok) throw new Error(data.error || '上传附件失败');
      const nextAssets = await loadAssets();
      const readyIds = (data.assets ?? []).filter(asset => asset.status === 'ready').map(asset => asset.id);
      onSelectedIdsChange([...new Set([...selectedIds, ...readyIds])]);
      const failed = (data.assets ?? []).filter(asset => asset.status === 'failed');
      if (failed.length) toast.error(`${failed.length} 个附件处理失败，可以点击重试`);
      else toast.success(`已添加 ${files.length} 个附件`);
      setAssets(nextAssets);
    } catch (error) {
      toast.error((error as Error).message || '上传附件失败');
    } finally {
      setUploadingNames([]);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function retryAsset(assetId: string) {
    setAssets(current => current.map(asset => asset.id === assetId ? { ...asset, status: 'processing' } : asset));
    try {
      const response = await fetch(`/api/projects/${projectId}/assets/${assetId}/retry`, { method: 'POST' });
      const data = await response.json().catch(() => ({})) as { asset?: AssetSummary; error?: string };
      if (!response.ok || !data.asset) throw new Error(data.error || '重试失败');
      setAssets(current => current.map(asset => asset.id === assetId ? data.asset! : asset));
      if (data.asset.status === 'ready') onSelectedIdsChange([...new Set([...selectedIds, assetId])]);
    } catch (error) {
      toast.error((error as Error).message || '重试失败');
      await loadAssets().catch(() => {});
    }
  }

  async function deleteAsset(assetId: string) {
    try {
      const response = await fetch(`/api/projects/${projectId}/assets/${assetId}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || '删除附件失败');
      setAssets(current => current.filter(asset => asset.id !== assetId));
      onSelectedIdsChange(selectedIds.filter(id => id !== assetId));
    } catch (error) {
      toast.error((error as Error).message || '删除附件失败');
    }
  }

  async function updateUsage(assetId: string, usage: string) {
    try {
      const response = await fetch(`/api/projects/${projectId}/assets/${assetId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usage }),
      });
      const data = await response.json().catch(() => ({})) as { asset?: AssetSummary; error?: string };
      if (!response.ok || !data.asset) throw new Error(data.error || '更新附件用途失败');
      setAssets(current => current.map(asset => asset.id === assetId ? data.asset! : asset));
      if (usage === 'excluded') onSelectedIdsChange(selectedIds.filter(id => id !== assetId));
    } catch (error) {
      toast.error((error as Error).message || '更新附件用途失败');
    }
  }

  const selectedAssets = assets.filter(asset => selectedIds.includes(asset.id) || asset.status !== 'ready');

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={ACCEPTED_FILES}
        multiple
        disabled={disabled}
        onChange={event => void uploadFiles(Array.from(event.target.files ?? []))}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 rounded-full px-2 text-xs text-muted-foreground"
          disabled={disabled || uploadingNames.length > 0}
          onClick={() => inputRef.current?.click()}
        >
          {uploadingNames.length ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Paperclip className="mr-1 size-3.5" />}
          添加资料
        </Button>
        {loading ? <span className="text-[11px] text-muted-foreground">读取附件中…</span> : null}
        {!loading && assets.length ? (
          <span className="text-[11px] text-muted-foreground">已保存 {assets.length} 个</span>
        ) : null}
      </div>

      {uploadingNames.map(name => (
        <div key={name} className="flex items-center gap-2 rounded-lg border bg-slate-50 px-2 py-1.5 text-xs">
          <Loader2 className="size-3.5 animate-spin text-primary" />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span className="text-muted-foreground">上传并检查中</span>
        </div>
      ))}

      {selectedAssets.map(asset => (
        <div
          key={asset.id}
          className={cn(
            'flex items-center gap-2 rounded-lg border bg-white px-2 py-1.5 text-xs',
            asset.status === 'failed' && 'border-destructive/30 bg-destructive/5',
          )}
        >
          {asset.kind === 'image' ? (
            <img
              src={`/api/projects/${projectId}/assets/${asset.id}/preview`}
              alt=""
              className="size-8 shrink-0 rounded object-cover"
            />
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded bg-slate-100">
              <FileText className="size-4 text-slate-500" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{asset.originalName}</p>
            <p className={cn('truncate text-[11px] text-muted-foreground', asset.status === 'failed' && 'text-destructive')}>
              {assetStatusLabel(asset)}
            </p>
          </div>
          {asset.status === 'ready' ? (
            <select
              aria-label={`${asset.originalName}用途`}
              className="h-7 max-w-24 rounded border bg-white px-1 text-[11px]"
              defaultValue={defaultUsage(asset)}
              onChange={event => void updateUsage(asset.id, event.target.value)}
            >
              <option value="must">必须使用</option>
              <option value="optional">可以使用</option>
              <option value="reference">只供参考</option>
              <option value="excluded">不要使用</option>
            </select>
          ) : null}
          {asset.status === 'failed' ? (
            <Button type="button" variant="ghost" size="icon" className="size-7" title="重试" onClick={() => void retryAsset(asset.id)}>
              <RefreshCw className="size-3.5" />
            </Button>
          ) : null}
          {asset.status === 'ready' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              title="从本条消息移除"
              onClick={() => onSelectedIdsChange(selectedIds.filter(id => id !== asset.id))}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground" title="删除附件" onClick={() => void deleteAsset(asset.id)}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}

      {!selectedAssets.length && assets.some(asset => asset.status === 'ready') ? (
        <button
          type="button"
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => onSelectedIdsChange(assets.filter(asset => asset.status === 'ready' && asset.usage !== 'excluded').slice(0, 10).map(asset => asset.id))}
        >
          <ImageIcon className="size-3" />使用已上传资料
        </button>
      ) : null}
    </div>
  );
}

function assetStatusLabel(asset: AssetSummary): string {
  if (asset.status === 'uploaded') return '等待处理';
  if (asset.status === 'processing') return '正在提取内容';
  if (asset.status === 'failed') return asset.errorMessage || '处理失败，可重试';
  if (asset.kind === 'image') return asset.summary?.digest || '图片已就绪';
  return asset.summary?.digest || '文档摘要已就绪';
}

function defaultUsage(asset: AssetSummary): 'must' | 'optional' | 'reference' | 'excluded' {
  if (asset.usage) return asset.usage;
  if (asset.inferredUsage === 'reference') return 'reference';
  return asset.inferredUsage === 'brand' ? 'must' : 'optional';
}
