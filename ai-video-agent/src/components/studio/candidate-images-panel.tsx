'use client';

import { useState } from 'react';
import { AlertCircle, Check, ImageIcon, Loader2, ShieldCheck, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { FrameSource, ProjectDetail, SmartImageCandidate, SmartImageFrameStatus } from '@/types';

const STATUS_LABELS: Record<SmartImageFrameStatus, string> = {
  'not-planned': '未安排搜图',
  planned: '等待搜图',
  searching: '检索中',
  'candidate-ready': '候选已就绪',
  downloading: '本地化中',
  accepted: '元数据已匹配',
  'needs-review': '等待人工确认',
  'rendering-with-image': '正在应用',
  'rendering-native': '使用原生画面',
  completed: '已应用',
  'timed-out': '检索超时',
  rejected: '未找到匹配图片',
  unavailable: '素材服务不可用',
};

export function CandidateImagesPanel({
  project,
  frameId,
  source,
  onProjectChange,
}: {
  project: ProjectDetail;
  frameId: string | null;
  source: FrameSource | null;
  onProjectChange: (project: ProjectDetail) => void;
}) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  if (!frameId) return null;

  const frame = project.outline?.frames.find(item => item.id === frameId);
  const selection = source?.imageSelection;
  const request = selection?.request || frame?.sceneSpec?.assetRequest;
  const fallbacks = source?.visualFallbacks || [];
  if (!request && !selection && !fallbacks.length) return null;

  const assets = source?.realImages?.length ? source.realImages : source?.realImage ? [source.realImage] : [];
  const slots = buildCandidateSlots(selection?.candidates || [], assets);
  const rejected = selection?.rejectedCandidates || [];
  const status = selection?.status || (request ? 'planned' : 'not-planned');
  const displayStatus: SmartImageFrameStatus = status === 'rejected'
    && slots.some(slot => slot.candidates.some(candidate => Boolean(candidate.localPath)))
    ? 'needs-review'
    : status;

  async function replace(candidate: SmartImageCandidate, slotIndex: number) {
    if (!candidate.localPath) return;
    const key = `${slotIndex}:${candidate.photoId}`;
    setPendingKey(key);
    try {
      const response = await fetch(`/api/projects/${project.uuid}/image-candidates/replace`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ frameId, photoId: candidate.photoId, slotIndex }),
      });
      const data = await response.json().catch(() => ({})) as { project?: ProjectDetail; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || '替换图片失败');
      onProjectChange(data.project);
      toast.success('图片已切换，排版和动画保持不变');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '替换图片失败');
    } finally {
      setPendingKey(null);
    }
  }

  async function removeImages() {
    setPendingKey('remove');
    try {
      const response = await fetch(`/api/projects/${project.uuid}/image-candidates/replace`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ frameId }),
      });
      const data = await response.json().catch(() => ({})) as { project?: ProjectDetail; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || '取消配图失败');
      onProjectChange(data.project);
      toast.success('已取消配图并恢复原生画面，候选图片仍保留');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '取消配图失败');
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <section className="mt-3 border-b pb-3" aria-label="配图候选">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <ImageIcon className="h-3.5 w-3.5" />
          配图与备选
        </div>
        <div className="flex items-center gap-1.5">
          {assets.length ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[10px] text-slate-600 hover:text-slate-900"
              disabled={Boolean(pendingKey)}
              title="移除当前分镜的配图，恢复原生画面；候选图片不会删除"
              onClick={() => void removeImages()}
            >
              {pendingKey === 'remove' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Undo2 className="mr-1 h-3 w-3" />}
              取消配图
            </Button>
          ) : null}
          <span className={statusClassName(displayStatus)}>{STATUS_LABELS[displayStatus]}</span>
        </div>
      </div>

      <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
        {selection?.reason || (request ? `计划检索：${request.query}` : fallbacks.at(-1)?.reason || '当前分镜未安排真实图片')}
      </p>

      {selection?.attemptedQueries?.length ? (
        <p className="mb-2 line-clamp-2 text-[10px] leading-4 text-muted-foreground" title={selection.attemptedQueries.join(' · ')}>
          已尝试：{selection.attemptedQueries.join(' · ')}
        </p>
      ) : null}

      {selection?.visionReview ? (
        <div className="mb-2 rounded-md border border-indigo-100 bg-indigo-50/60 px-2.5 py-2 text-[10px] leading-4 text-indigo-900" data-testid="vision-image-review">
          <div className="font-medium">
            视觉复选：{selection.visionReview.status === 'accepted'
              ? '已按图片内容排序'
              : selection.visionReview.status === 'fallback'
                ? '不可用，已回退规则第一名'
                : '不可用，未选出图片'}
          </div>
          <p className="mt-0.5">{selection.visionReview.rationale}</p>
          {selection.visionReview.status === 'accepted' ? (
            <p className="mt-0.5 text-indigo-700/80">
              主体：{selection.visionReview.subjectPosition || 'mixed'} · 文字留白：{selection.visionReview.safeTextSide || 'none'} · 裁切风险：{selection.visionReview.cropRisk}
            </p>
          ) : null}
          <p className="mt-0.5 text-indigo-700/70">视觉复选只帮助相关性和构图适配，不是身份或事实真实性的最终证明。</p>
        </div>
      ) : null}

      {slots.length ? (
        <div className="space-y-3">
          {slots.map(slot => (
            <div key={slot.slotIndex}>
              {slots.length > 1 ? (
                <p className="mb-1.5 text-[10px] font-medium text-slate-600">
                  图片 {slot.slotIndex + 1}{slot.subject ? ` · ${slot.subject}` : ''}
                </p>
              ) : null}
              <div className="grid grid-cols-3 gap-2">
                {slot.candidates.map(candidate => {
                  const active = candidate.photoId === slot.currentPhotoId;
                  const activeConfirmed = active && candidate.verificationLevel === 'human-confirmed';
                  const key = `${slot.slotIndex}:${candidate.photoId}`;
                  const busy = pendingKey === key;
                  const ready = Boolean(candidate.localPath);
                  return (
                    <div key={candidate.photoId} className={`min-w-0 rounded-md border p-1.5 ${active ? 'border-teal-500 bg-teal-50/70' : 'border-slate-200'}`}>
                      <div className="relative">
                        {candidate.localPath || candidate.previewUrl ? (
                          <img
                            src={candidate.localPath || candidate.previewUrl}
                            alt={candidate.alt}
                            className="h-16 w-full rounded object-cover"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="flex h-16 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">无预览</div>
                        )}
                        {ready ? (
                          <span className="absolute right-1 top-1 rounded bg-emerald-700/90 p-0.5 text-white" title={candidate.verificationLevel === 'human-confirmed' ? '用户已确认内容' : '高清文件已保存到本地，内容仍可能需要确认'}>
                            <ShieldCheck className="h-3 w-3" />
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-3 text-muted-foreground" title={candidate.alt}>
                        {candidate.alt || 'Pexels 图片'}
                      </p>
                      <p className="mt-1 truncate text-[10px] text-muted-foreground" title={candidate.reason}>
                        {candidate.width}×{candidate.height} · {Math.round(candidate.score)} 分
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant={active ? 'outline' : 'default'}
                        className="mt-1.5 h-7 w-full px-1 text-[10px]"
                        disabled={activeConfirmed || Boolean(pendingKey) || !ready}
                        title={!ready
                          ? '旧候选尚未本地化，请重新搜索图片'
                          : !assets[slot.slotIndex]
                            ? '将候选图应用到画面；多主体镜头会同时应用各槽位首选图'
                            : undefined}
                        onClick={() => void replace(candidate, slot.slotIndex)}
                      >
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : activeConfirmed ? <><Check className="mr-1 h-3 w-3" />已确认</> : active ? '确认当前素材' : assets[slot.slotIndex] ? '切换并确认' : '应用并确认'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed bg-slate-50 px-3 py-3 text-[11px] leading-4 text-slate-600">
          <div className="flex items-center gap-1.5 font-medium text-slate-700">
            <AlertCircle className="h-3.5 w-3.5" />
            暂无可切换的匹配图片
          </div>
          <p className="mt-1">{selection?.reason || '尚未执行图片检索，重新生成该镜时会按当前配图策略处理。'}</p>
        </div>
      )}

      {rejected.length ? (
        <details className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
          <summary className="cursor-pointer text-[10px] font-medium text-slate-600">
            查看 {rejected.length} 个被拒绝候选
          </summary>
          <div className="mt-2 space-y-1.5">
            {rejected.slice(0, 8).map(candidate => (
              <div key={`${candidate.slotIndex || 0}:${candidate.photoId}`} className="flex items-start gap-2 text-[10px] leading-4 text-slate-500">
                {candidate.previewUrl ? <img src={candidate.previewUrl} alt="" className="h-8 w-12 shrink-0 rounded object-cover opacity-70" loading="lazy" referrerPolicy="no-referrer" /> : null}
                <span className="min-w-0"><span className="font-medium text-slate-600">#{candidate.photoId}</span> · {candidate.reason}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function buildCandidateSlots(
  candidates: SmartImageCandidate[],
  assets: Array<{ photoId: number }>,
) {
  const bySlot = new Map<number, SmartImageCandidate[]>();
  for (const candidate of candidates) {
    const slotIndex = candidate.slotIndex ?? 0;
    const items = bySlot.get(slotIndex) || [];
    items.push(candidate);
    bySlot.set(slotIndex, items);
  }
  return [...bySlot.entries()]
    .sort(([left], [right]) => left - right)
    .map(([slotIndex, items]) => ({
      slotIndex,
      subject: items[0]?.subject,
      currentPhotoId: assets[slotIndex]?.photoId,
      candidates: items.slice(0, 3),
    }));
}

function statusClassName(status: SmartImageFrameStatus): string {
  const base = 'rounded-full px-2 py-0.5 text-[9px] font-medium';
  if (status === 'completed' || status === 'accepted' || status === 'candidate-ready') return `${base} bg-emerald-50 text-emerald-700`;
  if (status === 'needs-review') return `${base} bg-amber-100 text-amber-800`;
  if (status === 'rejected' || status === 'timed-out' || status === 'unavailable') return `${base} bg-amber-50 text-amber-700`;
  if (status === 'searching' || status === 'downloading' || status === 'rendering-with-image') return `${base} bg-blue-50 text-blue-700`;
  return `${base} bg-slate-100 text-slate-600`;
}
