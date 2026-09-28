'use client';

import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { useStudioStore } from '@/stores/studio-store';
import { PlayerBar } from './player-bar';
import { StoryboardStrip } from './storyboard-strip';
import { PreviewCanvas } from './preview-canvas';
import { PreviewToolbar } from './preview-toolbar';
import { ExportRecordingOverlay } from './export-recording-overlay';
import { LocalRenderPanel } from './local-render-panel';
import { usePlayer } from '@/components/player/use-player';
import { toast } from 'sonner';
import { isWebCodecsMP4Supported, recordStreamToMP4 } from '@/lib/webcodecs-mp4-encoder';
import { getFrameDuration, getFrameSourceForOutlineFrame } from '@/lib/video-source';
import { getCanvasPreset } from '@/lib/canvas-presets';
import { wrapHtmlWithWatchdog, sanitizeAiHtml } from '@/lib/iframe-utils';
import { ensureEditableElementIds } from '@/lib/editor-command';
import {
  isAuditTimeout,
  QUALITY_AUDIT_VERSION,
  qualityHtmlHash,
  qualityPassed,
  qualityReportNeedsAudit,
  qualityScore,
} from '@/lib/quality/auto-optimize';
import type { CanvasPresetId, FrameQualityReport, ProjectDetail, FrameSource } from '@/types';
import type { LayoutIssue } from '@/types';
import type { RenderJobSnapshot } from '@/lib/render/types';
import { filterIgnoredLayoutIssues, layoutIssueScope, permanentLayoutIssueScope } from '@/lib/layout-issues';
import { isBlockingQualityIssue, isQualityRepairRunActive } from '@/lib/quality/quality-ui';
import {
  registerQualityRepairAbortController,
  unregisterQualityRepairAbortController,
} from '@/lib/quality/repair-cancellation';

interface PreviewPanelProps {
  project: ProjectDetail;
  onProjectChange: (p: ProjectDetail) => void;
  onFrameSelect: (id: string | null) => void;
  onOpenQuality?: (frameId?: string) => void;
  editorDirty?: boolean;
  frameConcurrency?: number;
  exportConcurrency?: number;
  autoOptimizeEnabled?: boolean;
  useGpuEncoding?: boolean;
}

type ExportStatus = 'idle' | 'preparing' | 'prompting' | 'countdown' | 'recording' | 'finalizing' | 'failed';

const RECORDING_TAIL_PADDING_SEC = 2;

interface ExportJob {
  status: ExportStatus;
  message: string;
  progress: number;
  elapsedSec: number;
  remainingSec: number;
  countdown: number;
}

export function PreviewPanel({
  project,
  onProjectChange,
  onFrameSelect,
  onOpenQuality = () => {},
  editorDirty = false,
  frameConcurrency = 2,
  exportConcurrency = 0,
  autoOptimizeEnabled = true,
  useGpuEncoding = false,
}: PreviewPanelProps) {
  const canvas = getCanvasPreset(project.canvasPreset);
  const selectedFrameId = useStudioStore(s => s.selectedFrameId);
  const showSubtitle = useStudioStore(s => s.showSubtitle);
  const setSubtitleHorizontal = useStudioStore(s => s.setSubtitleHorizontal);
  const setSubtitleVertical = useStudioStore(s => s.setSubtitleVertical);
  const tunePreview = useStudioStore(s => s.tunePreview);
  const setTunePreview = useStudioStore(s => s.setTunePreview);
  // 全屏目标需要同时包含预览画面和录制悬浮窗，否则倒计时/进度层不会出现在全屏里。
  const previewStageRef = useRef<HTMLDivElement>(null);
  const subtitleProjectRef = useRef<string | null>(null);
  const previewCanvasRef = useRef<HTMLDivElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const focusStateRef = useRef<{ style: string; attr: string | null } | null>(null);
  const progressWindowRef = useRef<Window | null>(null);
  const exportJobRef = useRef<ExportJob>({
    status: 'idle',
    message: '',
    progress: 0,
    elapsedSec: 0,
    remainingSec: 0,
    countdown: 3,
  });
  const isFinalizingExportRef = useRef(false);
  const exportCompletionRequestedRef = useRef(false);
  const exportPlaybackWasActiveRef = useRef(false);
  const exportAbortRef = useRef<AbortController | null>(null);
  const localRenderPollRef = useRef<AbortController | null>(null);
  const [localRenderJob, setLocalRenderJob] = useState<RenderJobSnapshot | null>(null);
  const [exportJob, setExportJob] = useState<ExportJob>({
    status: 'idle',
    message: '',
    progress: 0,
    elapsedSec: 0,
    remainingSec: 0,
    countdown: 3,
  });

  useEffect(() => {
    const key = `${project.uuid}:${project.canvasPreset}`;
    if (subtitleProjectRef.current === key) return;
    subtitleProjectRef.current = key;
    setSubtitleHorizontal(canvas.subtitle.horizontal);
    setSubtitleVertical(canvas.subtitle.vertical);
  }, [canvas.subtitle.horizontal, canvas.subtitle.vertical, project.canvasPreset, project.uuid, setSubtitleHorizontal, setSubtitleVertical]);
  const setLayoutAudit = useStudioStore(s => s.setLayoutAudit);
  const layoutAudits = useStudioStore(s => s.layoutAudits);
  const ignoredLayoutIssueKeys = useStudioStore(s => s.ignoredLayoutIssueKeys);
  const permanentlyIgnoredLayoutIssueKeys = useStudioStore(s => s.permanentlyIgnoredLayoutIssueKeys);
  const setQualityRun = useStudioStore(s => s.setQualityRun);
  const hasGeneratingFrames = useStudioStore(s => Object.keys(s.generatingFrames).length > 0);
  const generatingFrames = useStudioStore(s => s.generatingFrames);
  const qualityRuns = useStudioStore(s => s.qualityRuns);
  const qualityRepairRequests = useStudioStore(s => s.qualityRepairRequests);
  const qualityRepairJobs = useStudioStore(s => s.qualityRepairJobs);
  const qualityRepairStops = useStudioStore(s => s.qualityRepairStops);
  const requestQualityRepair = useStudioStore(s => s.requestQualityRepair);
  const clearQualityRepairRequest = useStudioStore(s => s.clearQualityRepairRequest);
  const forceExportRequest = useStudioStore(s => s.forceExportRequest);
  const selectedFrameIndex = useMemo(() => {
    if (!selectedFrameId || !project.outline) return 0;
    const idx = project.outline.frames.findIndex(frame => frame.id === selectedFrameId);
    return idx < 0 ? 0 : idx;
  }, [project.outline, selectedFrameId]);
  // The player state must be available before the background quality effect so
  // a play action can synchronously prevent new HTML repair work from starting.
  const player = usePlayer(project, selectedFrameIndex);
  const isPlaying = player.status === 'playing';
  const isPlayingRef = useRef(isPlaying);
  const deferredQualityProjectRef = useRef<ProjectDetail | null>(null);
  isPlayingRef.current = isPlaying;
  const handledForceExportRequestRef = useRef(forceExportRequest);
  const activeQualityRunnersRef = useRef(new Set<string>());
  const qualitySaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const qualityAttemptedRef = useRef(new Set<string>());
  const qualityRepairAbortRefs = useRef(new Map<string, AbortController>());
  const qualityRepairStopSentRef = useRef(new Set<string>());
  const qualityRunnerDisposedRef = useRef(false);
  const automaticRepairStoppedRef = useRef(false);
  const [qualityRunnerRevision, setQualityRunnerRevision] = useState(0);

  useEffect(() => {
    exportJobRef.current = exportJob;
  }, [exportJob]);

  useEffect(() => {
    if (isPlaying || !deferredQualityProjectRef.current) return;
    const deferredProject = deferredQualityProjectRef.current;
    deferredQualityProjectRef.current = null;
    onProjectChange(deferredProject);
  }, [isPlaying, onProjectChange]);

  useEffect(() => {
    qualityRunnerDisposedRef.current = false;
    return () => {
      qualityRunnerDisposedRef.current = true;
      localRenderPollRef.current?.abort();
      qualityRepairAbortRefs.current.forEach((controller, frameId) => {
        controller.abort();
        unregisterQualityRepairAbortController(frameId, controller);
      });
      qualityRepairAbortRefs.current.clear();
    };
  }, []);

  useEffect(() => {
    automaticRepairStoppedRef.current = false;
  }, [autoOptimizeEnabled, project.uuid]);

  useEffect(() => {
    Object.entries(qualityRepairStops).forEach(([frameId, shouldStop]) => {
      if (!shouldStop) return;
      qualityRepairAbortRefs.current.get(frameId)?.abort();
      const repairJobId = qualityRepairJobs[frameId];
      if (!repairJobId || qualityRepairStopSentRef.current.has(repairJobId)) return;
      qualityRepairStopSentRef.current.add(repairJobId);
      setQualityRun(frameId, { status: 'cancelling', message: '正在向服务端停止修复，不会保存本次修改' });
      void fetch(`/api/projects/${project.uuid}/frame-quality/repair/${repairJobId}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ frameId }),
      }).then(async response => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || '停止修复请求未被服务端确认');
        if (useStudioStore.getState().qualityRepairStops[frameId]) {
          setQualityRun(frameId, { status: 'needs_review', message: '已停止修复，保留当前画面和问题列表' });
        }
      }).catch(error => {
        setQualityRun(frameId, { status: 'cancelling', message: (error as Error).message || '停止请求失败，正在等待当前步骤结束' });
        qualityRepairStopSentRef.current.delete(repairJobId);
      });
    });
  }, [project.uuid, qualityRepairJobs, qualityRepairStops, setQualityRun]);

  useEffect(() => {
    if (isPlaying || project.type !== 'html' || !project.outline || !project.videoSource || hasGeneratingFrames || tunePreview) return;
    const candidates = project.outline.frames.map((frame, index) => ({
      frame,
      source: getFrameSourceForOutlineFrame(project.videoSource, frame.id, index),
      repairRequest: qualityRepairRequests[frame.id] || 0,
    }));
    const activeFrameIds = activeQualityRunnersRef.current;
    const concurrency = Math.max(1, Math.min(5, Math.round(frameConcurrency)));
    const requestedTargets = candidates.filter(({ frame, source, repairRequest }) => (
      Boolean(source?.htmlCode && repairRequest) && !activeFrameIds.has(frame.id)
    ));
    const availableSlots = Math.max(0, concurrency - activeFrameIds.size);
    const manualTargets = requestedTargets.slice(0, availableSlots);
    const automaticTarget = manualTargets.length === 0 && activeFrameIds.size === 0 && autoOptimizeEnabled && !automaticRepairStoppedRef.current ? candidates.find(({ frame, source }) => {
      if (!source?.htmlCode) return false;
      const hash = qualityHtmlHash(source.htmlCode);
      const stale = qualityReportNeedsAudit(source.qualityReport, source.htmlCode);
      return !activeFrameIds.has(frame.id) && stale && !qualityAttemptedRef.current.has(`audit:${source.id}:${hash}`);
    }) : undefined;
    const targets = manualTargets.length ? manualTargets : automaticTarget ? [automaticTarget] : [];
    targets.forEach(target => {
    if (!target.source?.htmlCode) return;
    const automaticRepair = !target.repairRequest;
    const repair = Boolean(target.repairRequest) || automaticRepair;
    const targetHtml = target.source.htmlCode;
    const targetHash = qualityHtmlHash(targetHtml);
    if (automaticRepair) {
      // Automatic optimization is now the same action as pressing “重新修复”.
      // Mark the source before the synchronous store update so a failed or
      // unchanged frame is skipped once and the next outline frame can run.
      qualityAttemptedRef.current.add(`audit:${target.frame.id}:${targetHash}`);
      requestQualityRepair(target.frame.id);
    }
    const repairJobId = repair
      ? qualityRepairJobs[target.frame.id] || useStudioStore.getState().qualityRepairJobs[target.frame.id]
      : undefined;
    const attemptKey = repair && repairJobId
      ? `repair:${repairJobId}`
      : `auto-repair:${target.frame.id}:${targetHash}`;
    if (qualityAttemptedRef.current.has(attemptKey)) return;
    qualityAttemptedRef.current.add(attemptKey);
    activeFrameIds.add(target.frame.id);
    const priorIssues = layoutAudits[target.frame.id]
      ? layoutAudits[target.frame.id].issues
      : target.source.qualityReport?.issues ?? [];
    const repairAbortController = repair ? new AbortController() : null;
    if (repairAbortController) {
      qualityRepairAbortRefs.current.set(target.frame.id, repairAbortController);
      registerQualityRepairAbortController(target.frame.id, repairAbortController);
      if (useStudioStore.getState().qualityRepairStops[target.frame.id]) repairAbortController.abort();
    }
    setLayoutAudit(target.frame.id, []);
    setQualityRun(target.frame.id, repair
      ? { status: 'sampling', message: '正在本地修复字号与对比度，并按问题复杂度准备视觉证据' }
      : { status: 'auditing', message: '正在后台检查终态遮挡、安全区与对比度；只会保存质量报告' });

    const optimization = autoRepairFrame({
      projectId: project.uuid,
      frameId: target.frame.id,
      htmlCode: target.source.htmlCode,
      shouldStop: () => Boolean(useStudioStore.getState().qualityRepairStops[target.frame.id]),
      abortSignal: repairAbortController?.signal,
      repairJobId,
      issues: priorIssues,
      onPhase: phase => {
        if (repair && !qualityRunnerDisposedRef.current) {
          setQualityRun(target.frame.id, { status: 'visual_repairing', message: '正在进行视觉审核；失败时该镜头会自动重试一次' });
        }
      },
    });

    void optimization.then(async result => {
      if (qualityRunnerDisposedRef.current) return;
      const stopped = repair && (Boolean(useStudioStore.getState().qualityRepairStops[target.frame.id]) || Boolean(repairAbortController?.signal.aborted));
      if (stopped) {
        setLayoutAudit(target.frame.id, priorIssues);
        setQualityRun(target.frame.id, { status: 'needs_review', message: '已停止修复，保留当前画面' });
        return;
      }
      const stopBeforeSave = repair && (Boolean(useStudioStore.getState().qualityRepairStops[target.frame.id]) || Boolean(repairAbortController?.signal.aborted));
      if (stopBeforeSave) {
        setLayoutAudit(target.frame.id, priorIssues);
        setQualityRun(target.frame.id, { status: 'needs_review', message: '已停止修复，保留当前画面' });
        return;
      }
      if (isAuditTimeout(result.report.issues)) {
        const auditKey = `audit:${target.frame.id}:${qualityHtmlHash(targetHtml)}`;
        qualityAttemptedRef.current.add(auditKey);
        setLayoutAudit(target.frame.id, result.report.issues);
        setQualityRun(target.frame.id, { status: 'failed', message: '画面自检连续两次超时，本次结果未保存；重新打开项目后会再次检查。' });
        toast.error(`“${target.frame.title}”画面自检超时，未缓存为有效质量报告。`);
        return;
      }
      if (repair && result.repairStatus && result.repairStatus !== 'accepted') {
        setLayoutAudit(target.frame.id, result.repairStatus === 'unchanged' ? result.report.issues : priorIssues);
        const status = result.repairStatus === 'unchanged'
          ? 'unchanged'
          : result.repairStatus === 'unavailable'
            ? 'unavailable'
            : result.repairStatus === 'cancelled'
              ? 'cancelled'
              : 'failed';
        setQualityRun(target.frame.id, {
          status,
          message: result.message || (status === 'unchanged' ? '未改善，保留当前画面' : '本次修复未保存，保留当前画面'),
          score: result.report.scoreAfter,
        });
        if (status === 'unavailable') toast.warning(result.message || '当前模型不支持视觉输入，保留原画面。');
        else if (status === 'failed') toast.error(result.message || '视觉修复失败，保留原画面。');
        return;
      }
      setQualityRun(target.frame.id, result.report.appliedFixes.length
        ? { status: 'optimizing', message: result.report.status === 'passed'
          ? 'AI 已返回修复页面，正在保存模型修复结果'
          : `AI 已返回修复页面，正在保存结果`, score: result.report.scoreAfter }
        : { status: 'saving', message: stopped ? '修复已停止，正在保存当前最佳版本' : '正在保存质量报告', score: result.report.scoreAfter });
      const saveRequest = () => fetch(`/api/projects/${project.uuid}/frame-tunes/apply`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ restore: {
          targetFrameId: target.frame.id,
          htmlCode: result.htmlCode,
          qualityReport: result.report,
          repairJobId,
          recordHistory: {
            source: 'auto-repair',
            summary: `AI 自动修复：${beforeIssuesLabel(result.report.issues.length, result.report.scoreBefore, result.report.scoreAfter)}`,
          },
        } }),
        signal: repairAbortController?.signal,
      });
      const savePromise = qualitySaveQueueRef.current.then(saveRequest, saveRequest);
      qualitySaveQueueRef.current = savePromise.then(() => undefined, () => undefined);
      const response = await savePromise;
      if (repair && (Boolean(useStudioStore.getState().qualityRepairStops[target.frame.id]) || Boolean(repairAbortController?.signal.aborted))) {
        setLayoutAudit(target.frame.id, priorIssues);
        setQualityRun(target.frame.id, { status: 'needs_review', message: '已停止修复，保留当前画面' });
        return;
      }
      const data = await response.json().catch(() => ({})) as { project?: ProjectDetail; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || '保存自动优化结果失败');
      setLayoutAudit(target.frame.id, result.report.issues);
      setQualityRun(target.frame.id, {
        status: result.report.status,
        message: stopped
          ? `已停止修复，保留当前最佳版本；仍有 ${result.report.issues.length} 项问题`
          : result.report.status === 'passed'
          ? `本地文字检查与模型视觉审核结果已保存`
          : `AI 修复已改善画面，仍有 ${result.report.issues.length} 项问题`,
        score: result.report.scoreAfter,
      });
      if (isPlayingRef.current) deferredQualityProjectRef.current = data.project;
      else onProjectChange(data.project);
      if (result.report.status === 'passed' && result.report.appliedFixes.length) {
        toast.success(`第 ${project.outline!.frames.findIndex(frame => frame.id === target.frame.id) + 1} 镜已由 AI 修复，质量分 ${result.report.scoreAfter}`);
      } else if (result.report.appliedFixes.length) {
        toast.warning(`第 ${project.outline!.frames.findIndex(frame => frame.id === target.frame.id) + 1} 镜已有改善，但仍有 ${result.report.issues.length} 项问题`);
      } else if (result.report.status === 'needs_review') {
        toast.error(`“${target.frame.title}”未通过画面自检，请检查标记的问题。`);
      }
    }).catch(error => {
      if (qualityRunnerDisposedRef.current) return;
      const stopped = repair && (Boolean(useStudioStore.getState().qualityRepairStops[target.frame.id]) || Boolean(repairAbortController?.signal.aborted));
      if (stopped) {
        setLayoutAudit(target.frame.id, priorIssues);
        setQualityRun(target.frame.id, { status: 'needs_review', message: '已停止修复，保留当前画面' });
        return;
      }
      setQualityRun(target.frame.id, { status: 'failed', message: (error as Error).message || '画面自动自检失败' });
      toast.error((error as Error).message || '画面自动自检失败');
    }).finally(() => {
      const repairWasStopped = repair && (Boolean(useStudioStore.getState().qualityRepairStops[target.frame.id]) || Boolean(repairAbortController?.signal.aborted));
      if (automaticRepair && repairWasStopped) automaticRepairStoppedRef.current = true;
      if (repairWasStopped) {
        qualityAttemptedRef.current.add(`audit:${target.frame.id}:${targetHash}`);
      }
      if (repair) clearQualityRepairRequest(target.frame.id);
      if (repairAbortController && qualityRepairAbortRefs.current.get(target.frame.id) === repairAbortController) {
        qualityRepairAbortRefs.current.delete(target.frame.id);
        unregisterQualityRepairAbortController(target.frame.id, repairAbortController);
      }
      if (!qualityRunnerDisposedRef.current) {
        activeQualityRunnersRef.current.delete(target.frame.id);
        setQualityRunnerRevision(revision => revision + 1);
      }
    });
    });
  }, [autoOptimizeEnabled, clearQualityRepairRequest, frameConcurrency, hasGeneratingFrames, isPlaying, layoutAudits, onProjectChange, project, qualityRepairJobs, qualityRepairRequests, qualityRunnerRevision, requestQualityRepair, setLayoutAudit, setQualityRun, tunePreview]);

  // 大纲更新时默认选中第一帧
  const outlineFirstId = project.outline?.frames?.[0]?.id;
  useEffect(() => {
    if (!selectedFrameId && outlineFirstId) {
      onFrameSelect(outlineFirstId);
    }
  }, [outlineFirstId, selectedFrameId, onFrameSelect]);

  const exitTunePreview = useCallback(() => {
    if (tunePreview) setTunePreview(null);
  }, [setTunePreview, tunePreview]);

  const handleFrameSelect = useCallback(
    (frameId: string | null, options?: { preserveTunePreview?: boolean }) => {
      if (!options?.preserveTunePreview) exitTunePreview();
      if (!frameId) {
        onFrameSelect(null);
        return;
      }

      const frameIndex = project.outline?.frames.findIndex(frame => frame.id === frameId) ?? -1;
      if (frameIndex < 0) {
        onFrameSelect(frameId);
        return;
      }

      if (isPlaying) {
        player.playFromIndex(frameIndex);
      } else {
        player.seekToFrame(frameId);
      }
    },
    [exitTunePreview, isPlaying, onFrameSelect, player, project.outline],
  );

  useEffect(() => {
    if (!tunePreview) return;
    if (isPlaying) player.resetToSelectedFrame();
    if (selectedFrameId !== tunePreview.frameId) handleFrameSelect(tunePreview.frameId, { preserveTunePreview: true });
  }, [tunePreview, isPlaying, player, selectedFrameId, handleFrameSelect]);

  // 播放或暂停时都保留播放器当前分镜；空闲时跟随外部选择。
  const displayIndex = tunePreview
    ? Math.max(0, project.outline?.frames.findIndex(frame => frame.id === tunePreview.frameId) ?? selectedFrameIndex)
    : player.status === 'idle' ? selectedFrameIndex : player.currentIndex;
  const displayFrameSource: FrameSource | null = useMemo(() => {
    const frameId = project.outline?.frames[displayIndex]?.id;
    const source = getFrameSourceForOutlineFrame(project.videoSource, frameId, displayIndex);
    if (tunePreview && source?.id === tunePreview.frameId) {
      return { ...source, htmlCode: tunePreview.htmlCode };
    }
    return source;
  }, [displayIndex, project.outline, project.videoSource, tunePreview]);
  const displayFrameId = project.outline?.frames[displayIndex]?.id ?? null;
  const displayRepairRequested = Boolean(displayFrameId && qualityRepairRequests[displayFrameId]);
  const displayRepairRun = displayFrameId ? qualityRuns[displayFrameId] : undefined;
  const displayRepairRunning = isQualityRepairRunActive(displayRepairRun?.status);
  const displayRepairStopping = Boolean(displayFrameId && qualityRepairStops[displayFrameId])
    && (displayRepairRequested || displayRepairRunning);
  const showPreviewRepairOverlay = !displayFrameId || Boolean(generatingFrames[displayFrameId])
    ? false
    : displayRepairRequested || displayRepairRunning;

  const currentFrameDuration = displayIndex === player.currentIndex
    ? player.currentFrameDuration
    : getFrameDuration(project, displayIndex);
  const totalDuration = useMemo(() => (
    project.outline?.frames.reduce((sum, _, index) => sum + getFrameDuration(project, index), 0) ?? 0
  ), [project]);
  const recordingDuration = Math.max(totalDuration, 1);

  const lastFrameIndex = Math.max(0, (project.outline?.frames.length ?? 1) - 1);

  useEffect(() => {
    if (localRenderJob) return;
    if (exportJob.status !== 'recording') {
      exportPlaybackWasActiveRef.current = false;
      return;
    }
    if (isPlaying) {
      exportPlaybackWasActiveRef.current = true;
      return;
    }
    if (!exportPlaybackWasActiveRef.current) return;
    if (player.currentIndex < lastFrameIndex) return;
    // Keep recording briefly after the final narration ends. Stopping the
    // capture immediately can drop the audio encoder's last buffered frames.
    const timer = window.setTimeout(() => {
      void finalizeExport('completed');
    }, RECORDING_TAIL_PADDING_SEC * 1000);
    return () => window.clearTimeout(timer);
  }, [exportJob.status, isPlaying, player.currentIndex, lastFrameIndex, localRenderJob]);

  function applyRecordingFocus() {
    const target = previewStageRef.current;
    if (!target || focusStateRef.current) return;
    focusStateRef.current = {
      style: target.getAttribute('style') || '',
      attr: target.getAttribute('data-recording-target'),
    };
    target.setAttribute('data-recording-target', 'true');
    target.style.position = 'fixed';
    target.style.top = '0';
    target.style.left = '0';
    target.style.bottom = '0';
    target.style.right = '0';
    target.style.width = '100vw';
    target.style.height = '100vh';
    target.style.maxWidth = 'none';
    target.style.maxHeight = 'none';
    target.style.borderRadius = '0';
    target.style.boxShadow = 'none';
    target.style.border = 'none';
    target.style.margin = '0';
    target.style.padding = '0';
    target.style.zIndex = '2147483646';
    document.body.classList.add('recording-mode');
    if (!document.getElementById('recording-mode-style')) {
      const style = document.createElement('style');
      style.id = 'recording-mode-style';
      style.textContent = [
        'body.recording-mode * { visibility: hidden !important; }',
        'body.recording-mode [data-recording-target="true"],',
        'body.recording-mode [data-recording-target="true"] * { visibility: visible !important; }',
        'body.recording-mode { background: #000 !important; }',
        'body.recording-mode [data-recording-target="true"] .preview-stage { border-radius: 0 !important; box-shadow: none !important; }',
      ].join('\n');
      document.head.appendChild(style);
    }
  }

  function clearRecordingFocus() {
    const target = previewStageRef.current;
    const state = focusStateRef.current;
    if (state && target) {
      target.setAttribute('style', state.style);
      if (state.attr === null) {
        target.removeAttribute('data-recording-target');
      } else {
        target.setAttribute('data-recording-target', state.attr);
      }
      focusStateRef.current = null;
    }
    document.body.classList.remove('recording-mode');
    document.getElementById('recording-mode-style')?.remove();
  }

  function createProgressWindow(durationSec: number): Window | null {
    const w = window.open(
      '',
      'export_progress',
      'width=320,height=240,top=100,left=100,toolbar=no,menubar=no,scrollbars=no,resizable=no',
    );
    progressWindowRef.current = w;
    if (w) {
      w.document.write(`<!DOCTYPE html><html><head><title>录制进度</title>
<style>*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:linear-gradient(135deg,#1e293b,#0f172a);color:#fff;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px}
.dot{width:12px;height:12px;background:#ef4444;border-radius:50%;animation:pulse 1s ease-in-out infinite;margin-bottom:16px}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.9)}}
.badge{font-size:11px;color:#22c55e;background:rgba(34,197,94,.15);padding:2px 8px;border-radius:4px;margin-bottom:12px}
.title{font-size:14px;color:#94a3b8;margin-bottom:12px}
.wrap{width:100%;max-width:240px;height:8px;background:#334155;border-radius:4px;overflow:hidden;margin-bottom:12px}
.bar{height:100%;background:linear-gradient(90deg,#f97316,#fb923c);border-radius:4px;transition:width .1s}
.pct{font-size:24px;font-weight:600}
.remain{font-size:12px;color:#64748b;margin-top:8px}
</style></head><body>
<div class="dot"></div>
<div class="badge">MP4 (H.264)</div>
<div class="title">正在录制...</div>
<div class="wrap"><div class="bar" id="bar" style="width:0%"></div></div>
<div class="pct" id="pct">0%</div>
<div class="remain" id="remain">剩余: ${durationSec}s</div>
</body></html>`);
      w.document.close();
    }
    return w;
  }

  function updateProgressWindow(pct: number, remainingSec: number) {
    const w = progressWindowRef.current;
    if (!w || w.closed) return;
    try {
      const bar = w.document.getElementById('bar');
      const pctEl = w.document.getElementById('pct');
      const remain = w.document.getElementById('remain');
      if (bar) bar.style.width = `${pct}%`;
      if (pctEl) pctEl.textContent = `${pct}%`;
      if (remain) remain.textContent = remainingSec < 0 ? `进度: ${pct}%` : `剩余: ${Math.ceil(Math.max(0, remainingSec))}s`;
    } catch { /* popup may be closed */ }
  }

  function closeProgressWindow() {
    const w = progressWindowRef.current;
    if (w && !w.closed) { try { w.close(); } catch { /* ignore */ } }
    progressWindowRef.current = null;
  }

  async function handleExport(force = false) {
    if (!project.outline?.frames.length) return;
    if (project.type === 'html') {
      setExportJob({
        status: 'preparing',
        message: '正在检查全部画面的文字安全区…',
        progress: 0,
        elapsedSec: 0,
        remainingSec: recordingDuration,
        countdown: 3,
      });
      const audits = await auditHtmlFrames(project, project.outline.frames.map((frame, index) =>
        getFrameSourceForOutlineFrame(project.videoSource, frame.id, index),
      ));
      const visibleAudits = audits.map(audit => ({
        ...audit,
        issues: filterIgnoredLayoutIssues(
          audit.issues,
          [
            ...(useStudioStore.getState().ignoredLayoutIssueKeys[layoutIssueScope(
              project.uuid,
              audit.frameId,
              qualityHtmlHash(getFrameSourceForOutlineFrame(
                project.videoSource,
                audit.frameId,
                project.outline!.frames.findIndex(frame => frame.id === audit.frameId),
              )?.htmlCode || ''),
            )] || []),
            ...(useStudioStore.getState().permanentlyIgnoredLayoutIssueKeys[permanentLayoutIssueScope(project.uuid, audit.frameId)] || []),
          ],
        ),
      }));
      visibleAudits.forEach(audit => setLayoutAudit(audit.frameId, audit.issues));
      const failed = visibleAudits.filter(audit => audit.issues.some(isBlockingQualityIssue));
      setExportJob({ status: 'idle', message: '', progress: 0, elapsedSec: 0, remainingSec: 0, countdown: 3 });
      if (failed.length && !force) {
        onOpenQuality(failed[0].frameId);
        toast.error(`${failed.length} 个分镜存在严重问题。请先修复后再导出。`, { duration: 10_000 });
        return;
      }
    }
    await startLocalRender([], force);
    return;

    // Kept as the per-scene legacy fallback implementation. The primary export
    // path above never asks the user to share a tab and never adds tail padding.
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getDisplayMedia ||
      !isWebCodecsMP4Supported()
    ) {
      setExportJob({
        status: 'failed',
        message: '当前浏览器不支持 MP4 录屏导出，请使用最新版 Chrome。',
        progress: 0,
        elapsedSec: 0,
        remainingSec: 0,
        countdown: 3,
      });
      return;
    }

    setExportJob({
      status: 'prompting',
      message: '请在共享弹窗中选择当前标签页，并勾选共享标签页音频。',
      progress: 0,
      elapsedSec: 0,
      remainingSec: recordingDuration,
      countdown: 3,
    });
    exportCompletionRequestedRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 30,
        },
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
      } as DisplayMediaStreamOptions & {
        preferCurrentTab?: boolean;
        selfBrowserSurface?: 'include' | 'exclude';
        surfaceSwitching?: 'include' | 'exclude';
      });

      const displaySurface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
      if (displaySurface && displaySurface !== 'browser') {
        stopMediaStream(stream);
        throw new Error('请选择“当前标签页”进行录制。');
      }

      mediaStreamRef.current = stream;

      for (const track of stream.getTracks()) {
        track.addEventListener(
          'ended',
          () => {
            const status = exportJobRef.current.status;
            if (status === 'recording' || status === 'countdown' || status === 'prompting' || status === 'finalizing') {
              void finalizeExport('completed');
            }
          },
          { once: true },
        );
      }

      await beginCountdownAndRecord(stream);
    } catch (error) {
      cleanupRecorder();
      const legacyError = error as { name?: string; message?: string };
      if (legacyError.name === 'AbortError' || legacyError.name === 'NotAllowedError') {
        setExportJob({ status: 'idle', message: '', progress: 0, elapsedSec: 0, remainingSec: 0, countdown: 3 });
        return;
      }
      setExportJob({
        status: 'failed',
        message: legacyError.message || '导出失败，请重试。',
        progress: 0,
        elapsedSec: 0,
        remainingSec: 0,
        countdown: 3,
      });
    }
  }

  useEffect(() => {
    if (forceExportRequest === handledForceExportRequestRef.current) return;
    handledForceExportRequestRef.current = forceExportRequest;
    exitTunePreview();
    void handleExport(true);
  }, [exitTunePreview, forceExportRequest]);

  async function handleCancelExport() {
    if (localRenderJob && !['completed', 'cancelled', 'failed', 'partial-failed'].includes(localRenderJob.stage)) {
      localRenderPollRef.current?.abort();
      await fetch(`/api/render-jobs/${localRenderJob.id}`, { method: 'DELETE' }).catch(() => undefined);
      setLocalRenderJob(job => job ? { ...job, stage: 'cancelled', message: '导出已取消；已完成分镜缓存会保留。' } : job);
      setExportJob({ status: 'idle', message: '', progress: 0, elapsedSec: 0, remainingSec: 0, countdown: 3 });
      return;
    }
    await finalizeExport('cancelled');
  }

  async function startLocalRender(forceSceneIds: string[] = [], bypassQualityGate = false) {
    localRenderPollRef.current?.abort();
    setExportJob({
      status: 'preparing',
      message: '正在创建本地离线渲染任务…',
      progress: 0,
      elapsedSec: 0,
      remainingSec: 0,
      countdown: 0,
    });
    try {
      const response = await fetch(`/api/projects/${project.uuid}/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subtitles: showSubtitle,
          subtitleHorizontal: useStudioStore.getState().subtitleHorizontal,
          subtitleVertical: useStudioStore.getState().subtitleVertical,
          allowRealtimeFallback: true,
          bypassQualityGate,
          useGpuEncoding,
          forceSceneIds,
          ...(exportConcurrency > 0 ? { maxConcurrentScenes: exportConcurrency } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { job?: RenderJobSnapshot; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error || '创建本地渲染任务失败。');
      setLocalRenderJob(payload.job);
      setExportJob(job => ({ ...job, status: 'recording', message: payload.job!.message }));
      await pollLocalRender(payload.job.id);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setExportJob({
        status: 'failed',
        message: error instanceof Error ? error.message : '本地离线导出失败。',
        progress: 0,
        elapsedSec: 0,
        remainingSec: 0,
        countdown: 0,
      });
    }
  }

  async function pollLocalRender(jobId: string) {
    const controller = new AbortController();
    localRenderPollRef.current = controller;
    while (!controller.signal.aborted) {
      const response = await fetch(`/api/render-jobs/${jobId}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as { job?: RenderJobSnapshot; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error || '读取渲染进度失败。');
      const snapshot = payload.job;
      setLocalRenderJob(snapshot);
      setExportJob(job => ({
        ...job,
        status: snapshot.stage === 'assembling' || snapshot.stage === 'generating-subtitles' ? 'finalizing' : 'recording',
        message: snapshot.message,
        progress: snapshot.progress,
        elapsedSec: snapshot.elapsedMs / 1000,
        remainingSec: (snapshot.estimatedRemainingMs || 0) / 1000,
      }));
      if (snapshot.stage === 'completed') {
        setExportJob({ status: 'idle', message: '', progress: 100, elapsedSec: snapshot.elapsedMs / 1000, remainingSec: 0, countdown: 0 });
        if (snapshot.outputUrl) {
          const anchor = document.createElement('a');
          anchor.href = snapshot.outputUrl;
          anchor.download = buildExportFileName(project.title);
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        }
        toast.success('本地离线 MP4 已生成并开始下载。');
        return;
      }
      if (snapshot.stage === 'partial-failed' || snapshot.stage === 'failed') {
        setExportJob({
          status: 'failed',
          message: snapshot.message,
          progress: snapshot.progress,
          elapsedSec: snapshot.elapsedMs / 1000,
          remainingSec: 0,
          countdown: 0,
        });
        return;
      }
      if (snapshot.stage === 'cancelled') {
        setExportJob({ status: 'idle', message: '', progress: 0, elapsedSec: 0, remainingSec: 0, countdown: 0 });
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, 800);
        controller.signal.addEventListener('abort', () => {
          window.clearTimeout(timer);
          reject(controller.signal.reason || new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }
  }

  async function retryLocalScene(sceneId: string) {
    if (!localRenderJob) return;
    try {
      const response = await fetch(`/api/render-jobs/${localRenderJob.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sceneId }),
      });
      const payload = await response.json().catch(() => ({})) as { job?: RenderJobSnapshot; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error || '分镜重试失败。');
      setLocalRenderJob(payload.job);
      setExportJob(job => ({ ...job, status: 'recording', message: payload.job!.message }));
      await pollLocalRender(payload.job.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '分镜重试失败。');
    }
  }

  async function finalizeExport(reason: 'completed' | 'cancelled') {
    if (isFinalizingExportRef.current) return;
    isFinalizingExportRef.current = true;

    try {
      const stream = mediaStreamRef.current;

      if (!stream) {
        cleanupRecorder();
        setExportJob({ status: 'idle', message: '', progress: 0, elapsedSec: 0, remainingSec: 0, countdown: 3 });
        return;
      }

      if (reason === 'cancelled') {
        exportAbortRef.current?.abort();
        cleanupRecorder();
        await exitPreviewFullscreen();
        player.resetToSelectedFrame();
        setExportJob({ status: 'idle', message: '', progress: 0, elapsedSec: 0, remainingSec: 0, countdown: 3 });
        return;
      }

      if (exportCompletionRequestedRef.current) {
        return;
      }
      exportCompletionRequestedRef.current = true;
      setExportJob(job => ({
        ...job,
        status: 'finalizing',
        message: '正在封装 MP4 文件…',
      }));
      stopMediaStream(stream);
    } catch (error) {
      cleanupRecorder();
      await exitPreviewFullscreen();
      setExportJob({
        status: 'failed',
        message: error instanceof Error ? error.message : '导出失败，请重试。',
        progress: 0,
        elapsedSec: 0,
        remainingSec: 0,
        countdown: 3,
      });
    } finally {
      isFinalizingExportRef.current = false;
    }
  }

  function cleanupRecorder() {
    if (mediaStreamRef.current) {
      stopMediaStream(mediaStreamRef.current);
    }
    mediaStreamRef.current = null;
    exportAbortRef.current = null;
    exportCompletionRequestedRef.current = false;
  }

  async function exitPreviewFullscreen() {
    clearRecordingFocus();
    closeProgressWindow();
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
  }

  async function beginCountdownAndRecord(stream: MediaStream) {
    let remaining = 3;
    setExportJob({
      status: 'countdown',
      message: '录屏即将开始',
      progress: 0,
      elapsedSec: 0,
      remainingSec: recordingDuration,
      countdown: remaining,
    });

    await new Promise<void>(resolve => {
      const timer = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          window.clearInterval(timer);
          resolve();
          return;
        }
        setExportJob(job => ({
          ...job,
          countdown: remaining,
        }));
      }, 1000);
    });

    // Apply CSS fake-fullscreen: hide all UI, show only the canvas element.
    // This ensures the recording stream captures only the video content without
    // any surrounding padding, toolbars, or overlay panels.
    applyRecordingFocus();

    // Wait two animation frames so the CSS changes are painted before we start encoding.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const controller = new AbortController();
    exportAbortRef.current = controller;

    setExportJob({
      status: 'recording',
      message: '正在录制并编码 MP4…',
      progress: 0,
      elapsedSec: 0,
      remainingSec: recordingDuration,
      countdown: 0,
    });
    player.playFromIndex(0);

    // Show progress in a separate popup so it doesn't appear in the recording.
    createProgressWindow(Math.round(recordingDuration));

    try {
      const blob = await recordStreamToMP4(stream, recordingDuration, {
        frameRate: 30,
        maxWidth: 1920,
        targetWidth: canvas.output.width,
        targetHeight: canvas.output.height,
        maxDurationSec: recordingDuration + Math.max(30, project.outline?.frames.length ?? 0),
        signal: controller.signal,
        onProgress: progress => {
          setExportJob(job => ({
            ...job,
            status: progress >= 100 ? 'finalizing' : 'recording',
            progress,
            message: progress >= 100 ? '正在封装 MP4 文件…' : '正在录制并编码 MP4…',
          }));
        },
        onTimeUpdate: (elapsedSec, remainingSec) => {
          setExportJob(job => ({
            ...job,
            elapsedSec,
            remainingSec,
          }));
          updateProgressWindow(
            Math.min(99, Math.round((elapsedSec / recordingDuration) * 100)),
            remainingSec,
          );
        },
      });

      downloadBlob(blob, buildExportFileName(project.title));
      cleanupRecorder();
      await exitPreviewFullscreen();
      player.resetToSelectedFrame();
      setExportJob({ status: 'idle', message: '', progress: 100, elapsedSec: recordingDuration, remainingSec: 0, countdown: 0 });
      toast.success('MP4 视频已开始下载');
    } catch (error) {
      cleanupRecorder();
      await exitPreviewFullscreen();
      if (error instanceof DOMException && error.name === 'AbortError') {
        setExportJob({ status: 'idle', message: '', progress: 0, elapsedSec: 0, remainingSec: 0, countdown: 3 });
        return;
      }
      setExportJob({
        status: 'failed',
        message: error instanceof Error ? error.message : 'MP4 导出失败，请重试。',
        progress: 0,
        elapsedSec: 0,
        remainingSec: 0,
        countdown: 3,
      });
    }
  }

  return (
    <div className="studio-preview-panel flex h-full flex-col bg-slate-50">
      <PreviewToolbar
        project={project}
        onProjectChange={onProjectChange}
        editorDirty={editorDirty}
        blockingIssueCount={countKnownBlockingIssues(project, layoutAudits, ignoredLayoutIssueKeys, permanentlyIgnoredLayoutIssueKeys)}
        exportBusy={exportJob.status !== 'idle' && exportJob.status !== 'failed'}
        onExport={() => { exitTunePreview(); void handleExport(); }}
        onCancelExport={handleCancelExport}
        onOpenQuality={() => onOpenQuality(selectedFrameId ?? undefined)}
      />
      <div className="studio-preview-well flex-1 overflow-hidden p-4">
        <div ref={previewStageRef} className="preview-fullscreen-stage relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
          <div
            className="relative max-h-full max-w-full overflow-hidden"
            data-canvas-preset={project.canvasPreset}
            style={{ aspectRatio: `${canvas.design.width} / ${canvas.design.height}`, height: '100%', width: 'auto' }}
          >
            <div
              className={`preview-canvas-content absolute inset-0${showPreviewRepairOverlay ? ' preview-canvas-content--repairing' : ''}`}
              data-testid="preview-canvas-content"
            >
              <PreviewCanvas
                ref={previewCanvasRef}
                project={project}
                frameSource={displayFrameSource}
                showSubtitle={showSubtitle}
                currentTime={player.currentTime}
                isPlaying={isPlaying}
                playbackRevision={player.playbackRevision}
                audioRef={player.audioRef}
              />
            </div>
            {showPreviewRepairOverlay ? (
              <div
                className="preview-repair-overlay pointer-events-none absolute inset-0 z-10"
                data-state={displayRepairStopping ? 'stopping' : 'repairing'}
                data-testid="preview-repair-indicator"
                role="status"
              >
                <span aria-hidden="true" className="storyboard-repair-scan" />
                <span className="preview-repair-label">{displayRepairStopping ? '正在停止优化' : '正在优化'}</span>
              </div>
            ) : null}
          </div>
          <ExportRecordingOverlay
            open={exportJob.status !== 'idle' && exportJob.status !== 'failed'}
            status={exportJob.status}
            message={exportJob.message}
            progress={exportJob.progress}
            countdown={exportJob.countdown}
            elapsedSec={exportJob.elapsedSec}
            remainingSec={exportJob.remainingSec}
          />
          {localRenderJob ? (
            <LocalRenderPanel
              job={localRenderJob}
              onClose={() => setLocalRenderJob(null)}
              onRetryScene={sceneId => void retryLocalScene(sceneId)}
            />
          ) : null}
        </div>
      </div>
      <PlayerBar
        project={project}
        currentIndex={displayIndex}
        currentFrameDuration={currentFrameDuration}
        totalDuration={totalDuration}
        status={player.status}
        currentTime={player.currentTime}
        audioRef={player.audioRef}
        onTogglePlay={() => {
          exitTunePreview();
          player.togglePlay();
        }}
        onRestart={() => {
          exitTunePreview();
          player.restart();
        }}
        previewRef={previewStageRef}
        exportStatus={exportJob.status}
        exportMessage={exportJob.message}
      />
      <StoryboardStrip
        project={project}
        onProjectChange={onProjectChange}
        selectedFrameId={selectedFrameId}
        onFrameSelect={handleFrameSelect}
        onQualityOpen={onOpenQuality}
      />
    </div>
  );
}

function countKnownBlockingIssues(
  project: ProjectDetail,
  audits: ReturnType<typeof useStudioStore.getState>['layoutAudits'],
  ignored: ReturnType<typeof useStudioStore.getState>['ignoredLayoutIssueKeys'],
  permanentlyIgnored: ReturnType<typeof useStudioStore.getState>['permanentlyIgnoredLayoutIssueKeys'],
) {
  return (project.outline?.frames ?? []).reduce((total, frame, index) => {
    const source = getFrameSourceForOutlineFrame(project.videoSource, frame.id, index);
    const issues = audits[frame.id] ? audits[frame.id].issues : source?.qualityReport?.issues ?? [];
    const scope = layoutIssueScope(project.uuid, frame.id, qualityHtmlHash(source?.htmlCode ?? ''));
    const permanentScope = permanentLayoutIssueScope(project.uuid, frame.id);
    return total + filterIgnoredLayoutIssues(issues, [...(ignored[scope] ?? []), ...(permanentlyIgnored[permanentScope] ?? [])]).filter(isBlockingQualityIssue).length;
  }, 0);
}

function beforeIssuesLabel(remaining: number, beforeScore: number, afterScore: number) {
  return `${beforeScore}→${afterScore} 分${remaining ? `，仍有 ${remaining} 项` : ''}`;
}

function logRepairProgress(frameId: string, step: string, details: Record<string, unknown> = {}) {
  // Keep browser diagnostics useful without exposing the HTML, prompts, or any
  // project credentials in DevTools.
  console.info(`[画面修复][${frameId}] ${step}`, details);
}

async function autoRepairFrame(opts: {
  projectId: string;
  frameId: string;
  htmlCode: string;
  issues: LayoutIssue[];
  shouldStop: () => boolean;
  abortSignal?: AbortSignal;
  repairJobId?: string;
  onPhase?: (phase: 'visual_repairing') => void;
}): Promise<{
  htmlCode: string;
  report: FrameQualityReport;
  repairStatus?: 'accepted' | 'unchanged' | 'unavailable' | 'cancelled' | 'failed';
  message?: string;
}> {
  throwIfRepairAborted(opts);
  opts.onPhase?.('visual_repairing');
  logRepairProgress(opts.frameId, '请求视觉审核', { issues: opts.issues.length, samplingStrategy: '100% or 35/70/100' });
  const response = await fetch(`/api/projects/${opts.projectId}/frame-quality/repair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      frameId: opts.frameId,
      htmlCode: opts.htmlCode,
      issues: opts.issues,
      repairJobId: opts.repairJobId,
    }),
    signal: opts.abortSignal,
  });
  const payload = await response.json().catch(() => ({})) as {
    status?: 'accepted' | 'unchanged' | 'unavailable' | 'cancelled' | 'failed';
    htmlCode?: string;
    report?: FrameQualityReport;
    message?: string;
    error?: string;
  };
  throwIfRepairAborted(opts);
  logRepairProgress(opts.frameId, '视觉修复请求完成', {
    status: payload.status || (response.ok ? 'unknown' : 'failed'),
    hasHtml: Boolean(payload.htmlCode),
  });
  if (!response.ok && !payload.status) throw new Error(payload.error || '视觉修复请求失败');
  const status = payload.status || 'failed';
  const report = payload.report || buildNoChangeQualityReport(opts.frameId, opts.htmlCode, opts.issues);
  if (status !== 'accepted' || !payload.htmlCode) {
    return {
      htmlCode: opts.htmlCode,
      report,
      repairStatus: status,
      message: payload.message || '视觉修复未保存，保留当前画面',
    };
  }
  return {
    htmlCode: payload.htmlCode,
    report,
    repairStatus: 'accepted',
    message: payload.message,
  };
}

function throwIfRepairAborted(opts: { shouldStop: () => boolean; abortSignal?: AbortSignal }) {
  if (opts.shouldStop() || opts.abortSignal?.aborted) throw opts.abortSignal?.reason ?? new Error('AI 修复已停止');
}

function buildNoChangeQualityReport(frameId: string, htmlCode: string, issues: LayoutIssue[]): FrameQualityReport {
  const score = qualityScore(issues);
  return {
    frameId,
    status: qualityPassed(issues) ? 'passed' : 'needs_review',
    scoreBefore: score,
    scoreAfter: score,
    iterations: 0,
    issues,
    appliedFixes: [],
    auditedAt: Date.now(),
    auditVersion: QUALITY_AUDIT_VERSION,
    htmlHash: qualityHtmlHash(htmlCode),
  };
}

async function auditHtmlFrames(project: ProjectDetail, frames: Array<FrameSource | null>): Promise<Array<{ frameId: string; issues: LayoutIssue[] }>> {
  const canvas = getCanvasPreset(project.canvasPreset);
  const targets = frames.filter((frame): frame is FrameSource => Boolean(frame?.id && frame.htmlCode));
  if (!targets.length || typeof document === 'undefined') return [];

  return new Promise(resolve => {
    const results = new Map<string, LayoutIssue[]>();
    const windows = new Map<Window, string>();
    const iframes: HTMLIFrameElement[] = [];
    const finish = () => {
      window.removeEventListener('message', onMessage);
      iframes.forEach(iframe => iframe.remove());
      resolve(targets.map(frame => ({
        frameId: frame.id,
        issues: results.get(frame.id) || [{ code: 'clipped', label: '布局审计', detail: '布局审计未返回结果，请重新生成该帧。' }],
      })));
    };
    const onMessage = (event: MessageEvent) => {
      const frameId = windows.get(event.source as Window);
      if (!frameId || event.data?.type !== '__ai_video_layout_audit' || !Array.isArray(event.data.issues)) return;
      results.set(frameId, event.data.issues as LayoutIssue[]);
      if (results.size === targets.length) finish();
    };
    window.addEventListener('message', onMessage);
    targets.forEach(frame => {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      iframe.style.cssText = `position:fixed;left:-2000px;top:-2000px;width:${canvas.design.width}px;height:${canvas.design.height}px;opacity:0;pointer-events:none;border:0;`;
      iframe.srcdoc = wrapHtmlWithWatchdog(
        sanitizeAiHtml(ensureEditableElementIds(frame.htmlCode || ''), project.canvasPreset),
        Math.max(8_000, Math.ceil(((frame.audioPath ? frame.audioDuration : undefined) || 3) * 1000) + 1_500),
        { canvasPreset: project.canvasPreset },
      );
      document.body.appendChild(iframe);
      if (iframe.contentWindow) windows.set(iframe.contentWindow, frame.id);
      iframes.push(iframe);
    });
    window.setTimeout(finish, 3_400);
  });
}

function stopMediaStream(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function buildExportFileName(title: string) {
  const base = (title || 'ai-video-export')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 48);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${base || 'ai-video-export'}-${timestamp}.mp4`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
