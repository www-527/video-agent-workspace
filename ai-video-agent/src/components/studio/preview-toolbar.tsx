'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ImageIcon, ListTree, Loader2, Play, Square, X, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OutlineDialog } from '@/components/outline/outline-dialog';
import type { GenerationProgress } from '@/hooks/use-frame-generation';
import { getWorkbenchPrimaryLabel, resolveWorkbenchStage } from '@/lib/workbench-stage';
import type { ProjectDetail } from '@/types';
import { useFrameGenerationController } from './frame-generation-context';
import { MaterialSourcesDialog } from './material-sources-dialog';

interface PreviewToolbarProps {
  project: ProjectDetail;
  onProjectChange: (project: ProjectDetail) => void;
  editorDirty: boolean;
  blockingIssueCount: number;
  exportBusy: boolean;
  onExport: () => void;
  onCancelExport: () => void;
  onOpenQuality: () => void;
}
export function PreviewToolbar({ project, onProjectChange, editorDirty, blockingIssueCount, exportBusy, onExport, onCancelExport, onOpenQuality }: PreviewToolbarProps) {
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { generating, progress, start, abort, refresh, smartImageMode } = useFrameGenerationController();
  const stageState = useMemo(() => resolveWorkbenchStage(project, { generating, exporting: exportBusy, editorDirty, blockingIssueCount }), [blockingIssueCount, editorDirty, exportBusy, generating, project]);
  const primaryLabel = getWorkbenchPrimaryLabel(stageState);
  const hasMaterials = Boolean(project.videoSource?.frames.some(frame => frame.realImage || frame.realImages?.length));

  async function startPending(frameIds = stageState.pendingFrameIds) {
    if (!frameIds.length) return toast.success('所有分镜已生成完毕');
    if (project.workflow === 'gpt-free'
      && project.gptOptimization?.confirmFirstFrame === true
      && !project.outline?.visualAnchor?.approvedFrameIds.length
      && project.outline?.frames[0]
      && !frameIds.includes(project.outline.frames[0].id)) {
      const anchorResponse = await fetch('/api/visual-anchor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.uuid, frameIds: [project.outline.frames[0].id] }),
      });
      const anchorPayload = await anchorResponse.json().catch(() => ({})) as { error?: string };
      if (!anchorResponse.ok) throw new Error(anchorPayload.error || '确认首镜失败');
      const anchored = await refresh();
      if (anchored) onProjectChange(anchored);
    }
    await start(frameIds, {
      smartImages: smartImageMode !== 'off',
      smartImageMode,
    });
  }

  async function confirmAndGenerate() {
    if (!project.outline || confirming) return;
    setConfirming(true);
    try {
      const response = await fetch('/api/collaboration', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.uuid, action: 'approve-plan' }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || '确认内容计划失败');
      const refreshed = await refresh();
      if (refreshed) onProjectChange(refreshed);
      setOutlineOpen(false);
      const confirmFirstFrame = project.workflow === 'gpt-free' && project.gptOptimization?.confirmFirstFrame === true;
      toast.success(confirmFirstFrame ? '大纲已确认，开始生成首镜样片' : '大纲已确认，开始生成完整视频');
      if (confirmFirstFrame) {
        await start([project.outline.frames[0].id], {
          sampleOnly: true,
          smartImages: smartImageMode !== 'off',
          smartImageMode,
        });
      } else {
        await startPending(project.outline.frames.map(frame => frame.id));
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  function handlePrimary() {
    switch (stageState.stage) {
      case 'outline_ready':
        setOutlineOpen(true);
        break;
      case 'partial': void startPending(); break;
      case 'completed': onExport(); break;
      case 'quality_blocked': onOpenQuality(); break;
      default: break;
    }
  }

  const PrimaryIcon = stageState.stage === 'outline_ready' ? ListTree : stageState.stage === 'partial' ? Play : stageState.stage === 'quality_blocked' ? AlertTriangle : stageState.stage === 'completed' ? Download : Loader2;

  return (
    <>
      <div className="flex min-h-12 flex-shrink-0 items-center justify-between gap-3 border-b bg-background px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {project.outline ? <span className="truncate text-xs text-muted-foreground">{project.outline.frames.length} 个分镜</span> : <span className="text-xs text-muted-foreground">等待生成大纲</span>}
          {project.type === 'html' && hasMaterials ? <Button size="sm" variant="ghost" onClick={() => setSourcesOpen(true)}><ImageIcon data-icon="inline-start" />素材来源</Button> : null}
        </div>
        <div className="flex items-center gap-2">
          {generating ? <Button size="sm" variant="outline" className="text-destructive" onClick={abort}><Square data-icon="inline-start" />中断生成</Button> : null}
          {exportBusy ? <Button size="sm" variant="outline" className="text-destructive" onClick={onCancelExport}><X data-icon="inline-start" />取消导出</Button> : null}
          {primaryLabel ? (
            <Button size="sm" onClick={handlePrimary} disabled={stageState.stage === 'generating' || stageState.stage === 'exporting'}>
              <PrimaryIcon data-icon="inline-start" className={stageState.stage === 'generating' || stageState.stage === 'exporting' ? 'animate-spin' : undefined} />
              {primaryLabel}
            </Button>
          ) : null}
        </div>
      </div>
      {progress ? <GenerationProgressBar progress={progress} active={generating} /> : null}
      <OutlineDialog open={outlineOpen} onOpenChange={setOutlineOpen} project={project} onProjectChange={onProjectChange} onConfirmAndGenerate={confirmAndGenerate} confirming={confirming} />
      <MaterialSourcesDialog project={project} open={sourcesOpen} onOpenChange={setSourcesOpen} />
    </>
  );
}

const PHASE_LABELS: Record<GenerationProgress['phase'], string> = {
  prepare: '准备', image_plan: '规划智能配图', image_search: '匹配真实素材', image_download: '下载真实素材', image: '应用图片素材', tts: '语音合成', html: 'HTML 动画', save: '保存', done: '完成',
};

const STATUS_LABELS: Record<GenerationProgress['status'], string> = {
  preparing: '准备中', generating: '正在生成', saving: '正在保存', completed: '已完成', partial_failed: '部分失败', aborted: '已中断',
};

function GenerationProgressBar({ progress, active }: { progress: GenerationProgress; active: boolean }) {
  const isFailed = progress.status === 'partial_failed';
  const isAborted = progress.status === 'aborted';
  const isDone = progress.status === 'completed';
  const StatusIcon = isFailed ? AlertTriangle : isAborted ? XCircle : isDone ? CheckCircle2 : Loader2;
  const current = progress.total ? Math.min(progress.total, Math.max(1, progress.current)) : 0;
  return (
    <div className="flex-shrink-0 border-b bg-muted/40 px-4 py-2" role="status" aria-live="polite">
      <div className="mb-1.5 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <div className="flex min-w-0 items-center gap-1.5 font-medium"><StatusIcon className={active ? 'size-3.5 animate-spin text-primary' : 'size-3.5'} /><span className="truncate">{`${STATUS_LABELS[progress.status]}${progress.total > 0 && progress.phase !== 'done' ? `第 ${current}/${progress.total} 个分镜 · ${PHASE_LABELS[progress.phase]}` : ''}`}</span></div>
        <div className="flex flex-none items-center gap-3 tabular-nums text-muted-foreground"><span>{progress.percent}%</span><span>已用 {formatDuration(progress.elapsedSeconds)} · 剩余 {formatDuration(progress.remainingSeconds)}</span></div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${progress.percent}%` }} /></div>
      {progress.message ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{progress.message}</p> : null}
    </div>
  );
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return minutes ? `${minutes}分${String(rest).padStart(2, '0')}秒` : `${rest}秒`;
}
