'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, History, Loader2, RotateCcw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useStudioStore } from '@/stores/studio-store';
import { filterIgnoredLayoutIssues, layoutIssueScope, permanentLayoutIssueScope } from '@/lib/layout-issues';
import { qualityHtmlHash } from '@/lib/quality/auto-optimize';
import { getQualitySeverity, isBlockingQualityIssue, isQualityRepairRunActive } from '@/lib/quality/quality-ui';
import { getFrameSourceForOutlineFrame } from '@/lib/video-source';
import type { FrameRepairHistoryEntry, LayoutIssue, ProjectDetail } from '@/types';

export function QualityPanel({
  project,
  onProjectChange,
  frameConcurrency = 2,
}: {
  project: ProjectDetail;
  onProjectChange: (project: ProjectDetail) => void;
  frameConcurrency?: number;
}) {
  const selectedFrameId = useStudioStore(state => state.selectedFrameId);
  const setSelectedFrameId = useStudioStore(state => state.setSelectedFrameId);
  const setSelectedElementIds = useStudioStore(state => state.setSelectedElementIds);
  const layoutAudits = useStudioStore(state => state.layoutAudits);
  const qualityRuns = useStudioStore(state => state.qualityRuns);
  const qualityRepairRequests = useStudioStore(state => state.qualityRepairRequests);
  const ignored = useStudioStore(state => state.ignoredLayoutIssueKeys);
  const permanentlyIgnored = useStudioStore(state => state.permanentlyIgnoredLayoutIssueKeys);
  const qualityRepairStops = useStudioStore(state => state.qualityRepairStops);
  const ignoreLayoutIssue = useStudioStore(state => state.ignoreLayoutIssue);
  const permanentlyIgnoreLayoutIssue = useStudioStore(state => state.permanentlyIgnoreLayoutIssue);
  const requestQualityRepair = useStudioStore(state => state.requestQualityRepair);
  const stopQualityRepair = useStudioStore(state => state.stopQualityRepair);
  const requestForceExport = useStudioStore(state => state.requestForceExport);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [repairDetailsOpen, setRepairDetailsOpen] = useState(false);
  const [repairPickerOpen, setRepairPickerOpen] = useState(false);
  const [selectedRepairFrameIds, setSelectedRepairFrameIds] = useState<string[]>([]);
  const [submittedRepairFrameIds, setSubmittedRepairFrameIds] = useState<string[]>([]);
  const [repairActivityMounted, setRepairActivityMounted] = useState(false);
  const [repairActivityLeaving, setRepairActivityLeaving] = useState(false);
  const repairDetailsRef = useRef<HTMLDivElement>(null);
  const frameNavigationRef = useRef<HTMLDivElement>(null);
  const frameButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const frames = project.outline?.frames ?? [];
  const currentFrameId = selectedFrameId ?? frames[0]?.id ?? null;
  const currentIndex = frames.findIndex(frame => frame.id === currentFrameId);
  const currentSource = getFrameSourceForOutlineFrame(project.videoSource, currentFrameId, Math.max(0, currentIndex));
  const scope = layoutIssueScope(project.uuid, currentFrameId ?? '', qualityHtmlHash(currentSource?.htmlCode ?? ''));
  const permanentScope = permanentLayoutIssueScope(project.uuid, currentFrameId ?? '');
  const rawIssues = layoutAudits[currentFrameId ?? '']
    ? layoutAudits[currentFrameId ?? ''].issues
    : currentSource?.qualityReport?.issues ?? [];
  const issues = filterIgnoredLayoutIssues(rawIssues, [...(ignored[scope] ?? []), ...(permanentlyIgnored[permanentScope] ?? [])]);
  const qualityRun = qualityRuns[currentFrameId ?? ''];
  const repairInProgress = isQualityRepairRunActive(qualityRun?.status);
  const repairRequested = Boolean(qualityRepairRequests[currentFrameId ?? '']);
  const stopRequested = Boolean(qualityRepairStops[currentFrameId ?? '']);
  const repairCancelling = qualityRun?.status === 'cancelling'
    || (stopRequested && (repairRequested || repairInProgress));
  const repairActive = !repairCancelling && (repairRequested || repairInProgress);
  const repairableFrameIds = useMemo(() => frames.flatMap((frame, index) => (
    getFrameSourceForOutlineFrame(project.videoSource, frame.id, index)?.htmlCode ? [frame.id] : []
  )), [frames, project.videoSource]);
  const activeRepairFrameIds = useMemo(() => frames.flatMap(frame => {
    const run = qualityRuns[frame.id];
    const running = isQualityRepairRunActive(run?.status);
    return qualityRepairRequests[frame.id] || running ? [frame.id] : [];
  }), [frames, qualityRepairRequests, qualityRuns]);
  const batchRepairBusy = activeRepairFrameIds.length > 0;
  const history = useMemo(() => (project.videoSource?.repairHistory ?? []).filter(entry => entry.frameId === currentFrameId).reverse(), [currentFrameId, project.videoSource?.repairHistory]);
  const blockingIssueCount = useMemo(() => frames.reduce((total, frame, index) => {
    const source = getFrameSourceForOutlineFrame(project.videoSource, frame.id, index);
    const frameIssues = layoutAudits[frame.id]
      ? layoutAudits[frame.id].issues
      : source?.qualityReport?.issues ?? [];
    const frameScope = layoutIssueScope(project.uuid, frame.id, qualityHtmlHash(source?.htmlCode ?? ''));
    const framePermanentScope = permanentLayoutIssueScope(project.uuid, frame.id);
    return total + filterIgnoredLayoutIssues(frameIssues, [...(ignored[frameScope] ?? []), ...(permanentlyIgnored[framePermanentScope] ?? [])]).filter(isBlockingQualityIssue).length;
  }, 0), [frames, ignored, layoutAudits, permanentlyIgnored, project.uuid, project.videoSource]);
  const centerFrameNavigation = useCallback((frameId: string) => {
    const navigation = frameNavigationRef.current;
    const activeButton = frameButtonRefs.current.get(frameId);
    if (!navigation || !activeButton) return;
    const navigationRect = navigation.getBoundingClientRect();
    const activeButtonRect = activeButton.getBoundingClientRect();
    const targetLeft = navigation.scrollLeft
      + activeButtonRect.left
      - navigationRect.left
      - (navigationRect.width - activeButtonRect.width) / 2;
    const maxLeft = navigation.scrollWidth - navigation.clientWidth;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    navigation.scrollTo({
      left: Math.max(0, Math.min(targetLeft, maxLeft)),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, []);

  useEffect(() => {
    if (currentFrameId) centerFrameNavigation(currentFrameId);
  }, [centerFrameNavigation, currentFrameId]);

  useEffect(() => {
    const navigation = frameNavigationRef.current;
    if (!navigation) return;
    const handleWheel = (event: WheelEvent) => {
      if (navigation.scrollWidth <= navigation.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      const atStart = navigation.scrollLeft <= 0;
      const atEnd = Math.ceil(navigation.scrollLeft + navigation.clientWidth) >= navigation.scrollWidth;
      if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return;
      event.preventDefault();
      navigation.scrollBy({ left: delta * 1.6, behavior: 'auto' });
    };
    navigation.addEventListener('wheel', handleWheel, { passive: false });
    return () => navigation.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    if (batchRepairBusy) {
      setRepairActivityMounted(true);
      setRepairActivityLeaving(false);
      return;
    }
    if (!repairActivityMounted) return;
    setRepairDetailsOpen(false);
    setRepairActivityLeaving(true);
    const timer = window.setTimeout(() => {
      setRepairActivityMounted(false);
      setRepairActivityLeaving(false);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [batchRepairBusy, repairActivityMounted]);

  useEffect(() => {
    if (!repairDetailsOpen && !repairPickerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !repairDetailsRef.current?.contains(event.target)) {
        setRepairDetailsOpen(false);
        setRepairPickerOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRepairDetailsOpen(false);
        setRepairPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [repairDetailsOpen, repairPickerOpen]);

  function toggleRepairFrame(frameId: string) {
    setSelectedFrameId(frameId);
    window.requestAnimationFrame(() => centerFrameNavigation(frameId));
    setSelectedRepairFrameIds(current => current.includes(frameId)
      ? current.filter(id => id !== frameId)
      : [...current, frameId]);
  }

  function startSelectedRepairs() {
    if (!selectedRepairFrameIds.length || batchRepairBusy) return;
    const targets = [...selectedRepairFrameIds];
    setSubmittedRepairFrameIds(targets);
    targets.forEach(requestQualityRepair);
    setSelectedRepairFrameIds([]);
    setRepairPickerOpen(false);
  }

  function locate(issue: LayoutIssue) {
    if (!currentFrameId) return;
    setSelectedFrameId(currentFrameId);
    const ids = [issue.elementId, issue.relatedElementId].filter((id): id is string => Boolean(id));
    window.requestAnimationFrame(() => setSelectedElementIds(ids));
  }

  async function restore(entry: FrameRepairHistoryEntry) {
    if (!currentFrameId || restoringId) return;
    setRestoringId(entry.id);
    try {
      const response = await fetch(`/api/projects/${project.uuid}/frame-tunes/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          restore: {
            targetFrameId: currentFrameId,
            htmlCode: entry.beforeHtml,
            recordHistory: { source: 'restore', summary: `撤销：${entry.summary}`, restoreOfId: entry.id },
          },
        }),
      });
      const data = await response.json().catch(() => ({})) as { project?: ProjectDetail; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || '恢复修复前版本失败');
      onProjectChange(data.project);
      toast.success('已恢复修复前版本，恢复操作也已记入历史');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">质量检查</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">后台自动检查，手动修复按设置并发，问题按分镜归档</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2" data-testid="quality-header-actions">
            <Button
              size="sm"
              variant="outline"
              className="w-[7.625rem] border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
              data-testid="force-export-button"
              onClick={requestForceExport}
            >
              <ShieldAlert data-icon="inline-start" />强制导出视频
            </Button>
            <div ref={repairDetailsRef} className="relative flex w-[7.625rem] items-center justify-between" data-testid="quality-repair-actions">
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                aria-expanded={repairPickerOpen}
                aria-haspopup="dialog"
                disabled={batchRepairBusy || !repairableFrameIds.length}
                onClick={() => {
                  setRepairDetailsOpen(false);
                  setRepairPickerOpen(open => !open);
                }}
              >
                重新修复
              </Button>
              {repairActivityMounted ? <Button
                size="icon"
                variant="outline"
                className={`repair-activity-control size-9 shrink-0 rounded-full border-input bg-background p-0 text-primary hover:bg-primary/10 hover:text-primary${repairActivityLeaving ? ' repair-activity-return' : ''}`}
                data-testid="repair-activity-control"
                aria-label="查看修复详情"
                title="查看修复详情"
                aria-hidden={repairActivityLeaving || undefined}
                tabIndex={repairActivityLeaving ? -1 : undefined}
                onClick={() => !repairActivityLeaving && setRepairDetailsOpen(open => !open)}
              >
                <span className="flex size-5 items-center justify-center" aria-hidden="true">
                  <Loader2 className={repairCancelling ? 'size-5' : 'repair-activity-spinner size-5'} data-testid="repair-activity-spinner" strokeWidth={2.4} />
                </span>
              </Button> : null}
              {repairPickerOpen ? <div
                role="dialog"
                aria-label="选择要修复的分镜"
                className="absolute right-0 top-[calc(100%+8px)] z-40 w-80 rounded-xl border bg-background p-3 text-left shadow-lg"
                data-testid="repair-frame-picker"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">批量选择分镜</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">单击选中，再次单击取消；预览会同步跳到该分镜。</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">{frameConcurrency} 路并发</span>
                </div>
                <div className="mt-3 grid max-h-52 grid-cols-4 gap-2 overflow-y-auto p-0.5" data-testid="repair-frame-grid">
                  {frames.map((frame, index) => {
                    const available = repairableFrameIds.includes(frame.id);
                    const selected = selectedRepairFrameIds.includes(frame.id);
                    const isCurrentFrame = frame.id === currentFrameId;
                    return <button
                      key={frame.id}
                      type="button"
                      aria-pressed={selected}
                      aria-current={isCurrentFrame || undefined}
                      aria-label={`选择分镜 ${index + 1}${isCurrentFrame ? '，当前分镜' : ''}${selected ? '，已选择' : ''}`}
                      disabled={!available}
                      onClick={() => toggleRepairFrame(frame.id)}
                      className={`relative flex h-12 items-center justify-center gap-1 rounded-lg border text-sm font-semibold tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35 ${selected
                        ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/20'
                        : 'border-border bg-muted/20 text-foreground hover:border-primary/50 hover:bg-muted/60'}`}
                    >
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      {isCurrentFrame ? <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium leading-none text-primary" data-testid="current-repair-frame-hint">当前</span> : null}
                      {selected ? <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true"><Check className="size-2.5" strokeWidth={3} /></span> : null}
                    </button>;
                  })}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
                  <span className="text-xs text-muted-foreground">已选 {selectedRepairFrameIds.length} 个</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => setSelectedRepairFrameIds([])} disabled={!selectedRepairFrameIds.length}>清空</Button>
                    <Button size="sm" className="h-8 px-3 text-xs" onClick={startSelectedRepairs} disabled={!selectedRepairFrameIds.length}>修复所选</Button>
                  </div>
                </div>
              </div> : null}
              {repairDetailsOpen ? <div
                role="dialog"
                aria-label="修复详情"
                className="absolute right-0 top-[calc(100%+8px)] z-30 w-72 rounded-xl border bg-background p-3 text-left shadow-lg"
                data-testid="repair-details-popover"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">修复详情</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{submittedRepairFrameIds.length > 1 && batchRepairBusy
                      ? `正在按 ${frameConcurrency} 路并发修复 ${submittedRepairFrameIds.length} 个分镜。`
                      : qualityRun?.message || (repairRequested ? '正在启动当前分镜的修复。' : '当前分镜尚未开始修复。')}</p>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setRepairDetailsOpen(false)}>关闭</Button>
                </div>
                <dl className="mt-3 grid gap-2 rounded-lg border bg-muted/30 p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">当前状态</dt>
                    <dd className="font-medium">{repairCancelling
                      ? '正在停止'
                      : repairActive
                        ? qualityRun?.status === 'sampling' ? '采样中'
                          : qualityRun?.status === 'visual_repairing' ? '视觉修复中'
                            : qualityRun?.status === 'terminal_verifying' ? '终态验收中'
                              : qualityRun?.status === 'sampling_recheck' ? '三点复检中'
                                : '检查中'
                        : qualityRun?.status === 'saved' || qualityRun?.status === 'passed' ? '已保存'
                          : qualityRun?.status === 'unchanged' ? '未改善'
                            : qualityRun?.status === 'unavailable' ? '模型不可用'
                              : qualityRun?.status === 'cancelled' ? '已取消'
                                : qualityRun?.status === 'needs_review' ? '需要复查'
                                  : qualityRun?.status === 'failed' ? '修复失败' : '尚未开始'}</dd>
                  </div>
                  {qualityRun ? <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">最近更新</dt>
                    <dd>{new Date(qualityRun.updatedAt).toLocaleString('zh-CN')}</dd>
                  </div> : null}
                  {typeof qualityRun?.score === 'number' ? <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">质量分数</dt>
                    <dd>{qualityRun.score}</dd>
                  </div> : null}
                </dl>
                {batchRepairBusy ? <Button
                  className="mt-3 w-full"
                  size="sm"
                  variant="outline"
                  disabled={activeRepairFrameIds.every(frameId => qualityRepairStops[frameId])}
                  onClick={() => activeRepairFrameIds.forEach(stopQualityRepair)}
                >
                  {activeRepairFrameIds.every(frameId => qualityRepairStops[frameId]) ? '正在停止修复' : activeRepairFrameIds.length > 1 ? '停止全部修复' : '停止修复'}
                </Button> : null}
              </div> : null}
            </div>
          </div>
        </div>
        {batchRepairBusy ? <p className="mt-2 text-xs text-muted-foreground" role="status">正在按 {frameConcurrency} 路并发修复，当前运行/排队 {activeRepairFrameIds.length} 个分镜</p>
          : qualityRun?.message ? <p className="mt-2 text-xs text-muted-foreground" role="status">{qualityRun.message}</p> : null}
      </div>
      <div className="quality-frame-navigation border-b border-slate-200/80 px-3 py-2.5">
        <div ref={frameNavigationRef} className="flex gap-1.5 overflow-x-auto px-1 pb-1.5 pt-2.5" data-testid="quality-frame-navigation">
          {frames.map((frame, index) => {
            const source = getFrameSourceForOutlineFrame(project.videoSource, frame.id, index);
            const rawFrameIssues = layoutAudits[frame.id] ? layoutAudits[frame.id].issues : source?.qualityReport?.issues ?? [];
            const frameScope = layoutIssueScope(project.uuid, frame.id, qualityHtmlHash(source?.htmlCode ?? ''));
            const framePermanentScope = permanentLayoutIssueScope(project.uuid, frame.id);
            const frameIssues = filterIgnoredLayoutIssues(rawFrameIssues, [...(ignored[frameScope] ?? []), ...(permanentlyIgnored[framePermanentScope] ?? [])]);
            const critical = frameIssues.filter(isBlockingQualityIssue).length;
            const active = frame.id === currentFrameId;
            const issueLabel = critical ? '严重问题' : '普通问题';
            return <Button
              key={frame.id}
              ref={element => {
                if (element) frameButtonRefs.current.set(frame.id, element);
                else frameButtonRefs.current.delete(frame.id);
              }}
              size="sm"
              variant={active ? 'secondary' : 'ghost'}
              onClick={() => {
                setSelectedFrameId(frame.id);
                window.requestAnimationFrame(() => centerFrameNavigation(frame.id));
              }}
              aria-label={`分镜 ${index + 1}${frameIssues.length ? `，${issueLabel} ${frameIssues.length} 个` : ''}`}
              className={`group relative h-9 min-w-9 shrink-0 overflow-visible rounded-md px-3 font-medium tabular-nums transition-colors ${active
                ? 'border border-primary/70 bg-primary/15 text-primary ring-1 ring-primary/20 hover:bg-primary/20'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <span>{index + 1}</span>
              {frameIssues.length ? <Badge
                variant={critical ? 'destructive' : 'outline'}
                aria-hidden="true"
                className={`pointer-events-none absolute -right-1.5 -top-1.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none tabular-nums ${critical
                  ? 'border border-destructive/20 bg-destructive text-destructive-foreground'
                  : 'border border-slate-200 bg-white text-slate-500'}`}
              >
                {frameIssues.length}
              </Badge> : null}
            </Button>;
          })}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-medium">当前分镜</h3>
              <span className="text-[11px] tabular-nums text-muted-foreground">{String(issues.length).padStart(2, '0')} 项诊断</span>
            </div>
            <div className="border-y border-border/80" data-testid="quality-issue-list">
              {issues.length ? issues.map((issue, index) => {
                const severity = getQualitySeverity(issue);
                const severityLabel = severity === 'blocking' ? '严重' : severity === 'attention' ? '待处理' : '提示';
                const severityClass = severity === 'blocking'
                  ? 'bg-destructive'
                  : severity === 'attention'
                    ? 'bg-amber-500'
                    : 'bg-slate-300';
                return (
                  <article key={`${issue.code}-${issue.elementId ?? 'frame'}-${issue.relatedElementId ?? 'none'}-${index}`} className="relative border-b border-border/80 py-3 last:border-b-0">
                    <span className={`absolute inset-y-3 left-0 w-0.5 rounded-full ${severityClass}`} aria-hidden="true" />
                    <div className="flex items-start gap-3 pl-3">
                      <span className="mt-0.5 w-5 shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className={severity === 'blocking' ? 'text-xs font-medium text-destructive' : severity === 'attention' ? 'text-xs font-medium text-amber-700' : 'text-xs font-medium text-muted-foreground'}>{severityLabel}</span>
                              <span className="text-xs font-medium text-foreground">{issue.label}</span>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{issue.detail}</p>
                            {issue.code === 'invisible' ? (
                              <p className="mt-1 text-xs leading-5 text-amber-700">
                                建议：修复动画启动脚本，或重新生成当前分镜。
                              </p>
                            ) : null}
                          </div>
                          {issue.elementId ? <Button size="sm" variant="link" className="h-7 shrink-0 px-0 text-xs no-underline hover:no-underline" onClick={() => locate(issue)}>定位</Button> : null}
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5" data-testid="quality-issue-actions">
                          <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => ignoreLayoutIssue(scope, issue)}>忽略本次</Button>
                          <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => permanentlyIgnoreLayoutIssue(permanentScope, issue)}>永久忽略</Button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              }) : <div className="px-4 py-8 text-center text-xs text-muted-foreground">当前分镜没有待处理问题</div>}
            </div>
          </section>
          <Separator />
          <section>
            <div className="mb-2 flex items-center gap-2"><History className="size-4 text-muted-foreground" /><h3 className="text-xs font-medium">自动修复历史</h3></div>
            <div className="flex flex-col gap-2">
              {history.length ? history.map(entry => (
                <div key={entry.id} className="rounded-lg border px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="truncate text-xs font-medium">{entry.summary}</p><p className="mt-1 text-[11px] text-muted-foreground">{new Date(entry.createdAt).toLocaleString('zh-CN')} · {entry.source === 'auto-repair' ? 'AI 自动修复' : '版本恢复'}</p></div>
                    {entry.source === 'auto-repair' ? <Button size="sm" variant="ghost" disabled={restoringId === entry.id} onClick={() => void restore(entry)}>{restoringId === entry.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}撤销</Button> : null}
                  </div>
                </div>
              )) : <p className="py-5 text-center text-xs text-muted-foreground">还没有自动修复记录</p>}
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
