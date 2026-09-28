'use client';

import { ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ProjectDetail } from '@/types';
import { getFrameSourceForOutlineFrame } from '@/lib/video-source';

export function MaterialSourcesDialog({ project, open, onOpenChange }: { project: ProjectDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const rows = (project.outline?.frames || []).flatMap((frame, index) => {
    const source = getFrameSourceForOutlineFrame(project.videoSource, frame.id, index);
    const assets = source?.realImages?.length ? source.realImages : source?.realImage ? [source.realImage] : [];
    return assets.map(asset => ({ frame, asset }));
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>素材来源</DialogTitle><DialogDescription>本项目使用的 Pexels 或生成图片，以及对应来源和降级原因。</DialogDescription></DialogHeader>
        {rows.length ? <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {rows.map(({ frame, asset }) => <div key={`${frame.id}-${asset.photoId}`} className="flex items-start justify-between gap-4 rounded-md border border-slate-200 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">#{frame.index} {frame.title}</p>
              <p className="mt-1 text-xs text-slate-600">{asset.purpose || '建立真实场景与叙事参照'}</p>
              <p className="mt-1 text-[11px] text-slate-500">{asset.layout} · {asset.imageMotion || 'slow-push-in'}{asset.visualGroup ? ` · ${asset.visualGroup}` : ''}</p>
              {asset.provider === 'pexels' ? (
                <p className="mt-1 truncate text-xs text-slate-500">Photo by <a href={asset.photographerUrl} target="_blank" rel="noreferrer" className="hover:underline">{asset.photographer}</a> on Pexels</p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">AI 生成图片{asset.fallbackReason ? ` · Pexels 降级原因：${asset.fallbackReason}` : ''}</p>
              )}
            </div>
            {asset.provider === 'pexels' ? <a href={asset.pexelsUrl} target="_blank" rel="noreferrer" className="inline-flex flex-none items-center gap-1 text-xs font-medium text-primary hover:underline">查看图片 <ExternalLink className="h-3 w-3" /></a> : null}
          </div>)}
        </div> : <p className="py-8 text-center text-sm text-muted-foreground">尚未使用本地化图片素材。</p>}
      </DialogContent>
    </Dialog>
  );
}
