'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, RefreshCw, RotateCcw, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { buildFrameTunePreviewHtml } from '@/lib/frame-tune-preview';
import { getFrameSourceForOutlineFrame } from '@/lib/video-source';
import { cn } from '@/lib/utils';
import { getCanvasPreset } from '@/lib/canvas-presets';
import { useStudioStore } from '@/stores/studio-store';
import type { FrameReviewDraft, FrameTuneDraft, FrameTuneElement, ProjectDetail } from '@/types';

interface FrameTuneReviewCardProps {
  draft: FrameTuneDraft;
  project: ProjectDetail;
  onProjectChange: (project: ProjectDetail) => void;
  onSendText?: (text: string) => void;
  onRewriteDraft?: (text: string, draft: FrameReviewDraft) => void;
  onAppendAssistantText?: (text: string) => void | Promise<void>;
}

const KIND_LABELS: Record<string, string> = {
  visual: '视觉元素',
  text: '文字',
  decoration: '装饰',
  motion: '动效',
};

export function FrameTuneReviewCard({
  draft,
  project,
  onProjectChange,
  onSendText,
  onRewriteDraft,
  onAppendAssistantText,
}: FrameTuneReviewCardProps) {
  const canvas = getCanvasPreset(project.canvasPreset);
  const [workingDraft, setWorkingDraft] = useState(() => convertDraftPositionsToPixels(draft, canvas.design));
  const [applying, setApplying] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [selectedElementIndex, setSelectedElementIndex] = useState<number | null>(null);
  const setTunePreview = useStudioStore(s => s.setTunePreview);
  const frameIndex = findFrameIndex(project, workingDraft.targetFrameId);
  const frame = frameIndex ? project.outline?.frames[frameIndex - 1] : undefined;
  const source = frameIndex ? getFrameSourceForOutlineFrame(project.videoSource, workingDraft.targetFrameId, frameIndex - 1) : null;
  const frameLabel = frameIndex ? `第 ${frameIndex} 镜` : '当前分镜';
  const hasRemoval = workingDraft.elements.some(element => element.proposed?.visibility === 'removed');

  const previewHtml = useMemo(() => {
    if (!source?.htmlCode) return '';
    return buildFrameTunePreviewHtml(source.htmlCode, workingDraft.elements, {
      selectedIndex: selectedElementIndex,
      showControls,
      canvasPreset: project.canvasPreset,
    });
  }, [source?.htmlCode, workingDraft.elements, selectedElementIndex, showControls, project.canvasPreset]);

  useEffect(() => {
    if (!previewHtml || cancelled) return;
    setTunePreview({ frameId: workingDraft.targetFrameId, htmlCode: previewHtml });
    return () => setTunePreview(null);
  }, [cancelled, previewHtml, setTunePreview, workingDraft.targetFrameId]);

  function updateProposed(elementIndex: number, key: string, value: string) {
    setSelectedElementIndex(elementIndex);
    setWorkingDraft(current => ({
      ...current,
      elements: current.elements.map((element, index) => index === elementIndex
        ? { ...element, proposed: { ...element.proposed, [key]: value } }
        : element),
    }));
  }

  async function applyTune() {
    setApplying(true);
    try {
      await onAppendAssistantText?.(
        hasRemoval ? `正在删除${frameLabel}中选定的元素。` : `正在应用${frameLabel}的画面微调。`,
      );
      const response = await fetch(`/api/projects/${project.uuid}/frame-tunes/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft: workingDraft }),
      });
      const data = await response.json().catch(() => ({})) as { project?: ProjectDetail; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || '应用画面微调失败');

      setCancelled(true);
      setTunePreview(null);
      onProjectChange(data.project);
      toast.success(hasRemoval ? '元素已删除' : '已应用画面微调', source?.htmlCode ? {
        action: {
          label: '撤销',
          onClick: () => void restorePreviousHtml(source.htmlCode!),
        },
      } : undefined);
      await onAppendAssistantText?.(hasRemoval
        ? `已删除${frameLabel}中选定的元素。旁白、分镜内容和音频都保持不变。`
        : `已微调${frameLabel}画面。旁白、分镜内容和音频都保持不变。`);
    } catch (error) {
      toast.error((error as Error).message);
      await onAppendAssistantText?.(`${frameLabel}画面微调失败：${(error as Error).message}`);
    } finally {
      setApplying(false);
    }
  }

  async function restorePreviousHtml(htmlCode: string) {
    try {
      await onAppendAssistantText?.(`正在撤销${frameLabel}上一次画面微调。`);
      const response = await fetch(`/api/projects/${project.uuid}/frame-tunes/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ restore: { targetFrameId: workingDraft.targetFrameId, htmlCode } }),
      });
      const data = await response.json().catch(() => ({})) as { project?: ProjectDetail; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || '撤销失败');
      onProjectChange(data.project);
      toast.success('已撤销上一次画面微调');
      await onAppendAssistantText?.(`已撤销${frameLabel}上一次画面微调。`);
    } catch (error) {
      toast.error((error as Error).message);
      await onAppendAssistantText?.(`${frameLabel}撤销失败：${(error as Error).message}`);
    }
  }

  function askMajorRevision() {
    if (!onSendText && !onRewriteDraft) return;
    setTunePreview(null);
    setCancelled(true);
    const request = [
      `请基于${frameLabel}大改一版，不要只做轻微微调。`,
      '要求：可以重新设计叙事角度、画面意图和视觉呈现；保留事实准确性。',
    ].join('\n');
    if (frame && onRewriteDraft) {
      onRewriteDraft(request, {
        operation: 'modify',
        targetFrameId: frame.id,
        insertAfterIndex: frame.index - 1,
        title: frame.title,
        narration: frame.narration,
        visualPrompt: frame.htmlPrompt,
        htmlPrompt: frame.htmlPrompt,
        sceneSpec: frame.sceneSpec,
        baseUpdatedAt: project.updatedAt,
      });
      return;
    }
    onSendText?.(request);
  }

  function cancelTune() {
    setTunePreview(null);
    setCancelled(true);
  }

  if (cancelled) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
        已关闭这份微调草稿。
      </div>
    );
  }

  return (
    <div className="min-w-[320px] max-w-lg space-y-3 rounded-md border bg-slate-50 p-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">微调画面草稿</p>
          </div>
          <span className="rounded bg-white px-2 py-0.5 text-[11px] text-muted-foreground">{frameLabel}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          预览已暂停并临时展示主要内容。删除的元素会先用红色半透明标记，确认后才会从成片隐藏。
        </p>
      </div>

      <div className="flex items-center justify-between rounded border bg-white px-2 py-1.5">
        <div>
          <p className="text-xs font-medium text-slate-700">临时控制点</p>
          <p className="text-[10px] text-muted-foreground">只在预览里显示，不会保存到画面</p>
        </div>
        <Switch aria-label="切换临时控制点显示" checked={showControls} onCheckedChange={setShowControls} />
      </div>

      <div className="rounded border bg-white p-2">
        <p className="text-xs font-medium text-slate-700">修改摘要</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-900">{workingDraft.summary}</p>
      </div>

      <div className="space-y-2">
        {workingDraft.elements.map((element, index) => (
          <TuneElementEditor
            key={`${element.label}-${index}`}
            element={element}
            elementIndex={index}
            selected={selectedElementIndex === index}
            design={canvas.design}
            onSelect={() => setSelectedElementIndex(index)}
            onChange={updateProposed}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={hasRemoval ? 'destructive' : 'default'} disabled={applying} onClick={() => void applyTune()}>
          {applying ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : hasRemoval ? <Trash2 className="mr-1 h-3.5 w-3.5" /> : <Check className="mr-1 h-3.5 w-3.5" />}
          {hasRemoval ? '确认删除' : '应用微调'}
        </Button>
        <Button size="sm" variant="outline" disabled={applying} onClick={askMajorRevision}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          让 AI 大改一版
        </Button>
        <Button size="sm" variant="ghost" disabled={applying} onClick={cancelTune}>
          <X className="mr-1 h-3.5 w-3.5" />
          取消
        </Button>
      </div>
    </div>
  );
}

function TuneElementEditor({
  element,
  elementIndex,
  selected,
  design,
  onSelect,
  onChange,
}: {
  element: FrameTuneElement;
  elementIndex: number;
  selected: boolean;
  design: { width: number; height: number };
  onSelect: () => void;
  onChange: (elementIndex: number, key: string, value: string) => void;
}) {
  const removed = element.proposed?.visibility === 'removed';
  const keys = Array.from(new Set([...Object.keys(element.current || {}), ...Object.keys(element.proposed || {})]))
    .filter(key => key !== 'visibility');
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') onSelect();
      }}
      className={cn(
        'rounded border bg-white p-2 text-left outline-none transition-colors',
        selected ? 'border-primary/60 bg-primary/5' : 'border-slate-200',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">{element.label}</p>
        <div className="flex items-center gap-1">
          {removed ? <Badge variant="destructive" className="text-[10px]">待删除</Badge> : null}
          {!element.selector ? <span className="text-[10px] text-amber-600">无法定位</span> : null}
          <Badge variant="outline" className="bg-slate-50 text-[10px]">{KIND_LABELS[element.kind] || '视觉元素'}</Badge>
        </div>
      </div>
      {element.selector ? (
        <div className="mb-2 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant={removed ? 'outline' : 'ghost'}
            className={cn('h-7 px-2 text-xs', !removed && 'text-rose-600 hover:bg-rose-50 hover:text-rose-700')}
            onClick={event => {
              event.stopPropagation();
              onSelect();
              onChange(elementIndex, 'visibility', removed ? '' : 'removed');
            }}
          >
            {removed ? <RotateCcw className="mr-1 h-3 w-3" /> : <Trash2 className="mr-1 h-3 w-3" />}
            {removed ? '保留元素' : '删除元素'}
          </Button>
        </div>
      ) : null}
      {removed ? (
        <p className="rounded bg-rose-50 px-2 py-1.5 text-xs leading-relaxed text-rose-700">
          确认后会隐藏这个元素；如果它是组合对象的根容器，整个组合都会被删除。
        </p>
      ) : null}
      <div className="space-y-2">
        {keys.length ? keys.map(key => {
          const axisSize = getPositionAxisSize(key, design);
          return (
          <div key={key} className="grid grid-cols-[92px_1fr] items-center gap-2 text-xs">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-700">{key}</p>
              <p className="truncate text-[10px] text-muted-foreground">
                当前 {element.current?.[key] || '-'}{axisSize ? ` / ${axisSize}px` : ''}
              </p>
            </div>
            <Input
              value={element.proposed?.[key] || ''}
              inputMode={axisSize ? 'decimal' : undefined}
              onFocus={onSelect}
              onChange={event => onChange(elementIndex, key, event.target.value)}
              className="h-8 bg-slate-50 text-xs"
              placeholder={axisSize ? `0–${axisSize}px` : element.current?.[key] || '输入建议值'}
            />
          </div>
          );
        }) : (
          <p className="text-xs text-muted-foreground">AI 没有给出可编辑参数，可让 AI 大改一版或重新提出微调要求。</p>
        )}
      </div>
      {element.reason ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{element.reason}</p> : null}
    </div>
  );
}

function findFrameIndex(project: ProjectDetail, frameId?: string) {
  const index = project.outline?.frames.findIndex(frame => frame.id === frameId) ?? -1;
  return index >= 0 ? index + 1 : undefined;
}

function convertDraftPositionsToPixels(draft: FrameTuneDraft, design: { width: number; height: number }): FrameTuneDraft {
  return {
    ...draft,
    elements: draft.elements.map(element => ({
      ...element,
      current: convertPositionRecordToPixels(element.current, design),
      proposed: convertPositionRecordToPixels(element.proposed, design),
    })),
  };
}

function convertPositionRecordToPixels(record: Record<string, string>, design: { width: number; height: number }): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => {
    const axisSize = getPositionAxisSize(key, design);
    return [key, axisSize ? formatPositionInPixels(value, axisSize) : value];
  }));
}

function getPositionAxisSize(key: string, design: { width: number; height: number }): number | null {
  if (key === 'x' || key === 'left') return design.width;
  if (key === 'y' || key === 'top') return design.height;
  return null;
}

function formatPositionInPixels(value: string, axisSize: number): string {
  const text = String(value).trim();
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return value;
  const numericValue = Number(match[0]);
  const pixels = text.includes('%') ? (numericValue / 100) * axisSize : numericValue;
  return `${Math.round(pixels)}px`;
}
