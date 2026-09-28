'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Volume2, ImageOff, Code2, Play, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HtmlThumb } from './html-thumb';
import { useStudioStore } from '@/stores/studio-store';
import { filterIgnoredLayoutIssues, layoutIssueScope, permanentLayoutIssueScope } from '@/lib/layout-issues';
import { qualityHtmlHash } from '@/lib/quality/auto-optimize';
import { isQualityRepairRunActive } from '@/lib/quality/quality-ui';
import type { ProjectDetail } from '@/types';
import { isUiSceneDocumentReady, resolveFrameImagePath, resolveSceneContract } from '@/lib/scene-contract';
import { getCanvasPreset, isPortraitPreset } from '@/lib/canvas-presets';

interface StoryboardStripProps {
  project: ProjectDetail;
  onProjectChange: (p: ProjectDetail) => void;
  selectedFrameId: string | null;
  onFrameSelect: (id: string | null) => void;
  onQualityOpen?: (frameId: string) => void;
}

export function StoryboardStrip({ project, selectedFrameId, onFrameSelect, onQualityOpen }: StoryboardStripProps) {
  const canvas = getCanvasPreset(project.canvasPreset);
  const portrait = isPortraitPreset(project.canvasPreset);
  const generatingFrames = useStudioStore(s => s.generatingFrames);
  const qualityRuns = useStudioStore(s => s.qualityRuns);
  const qualityRepairRequests = useStudioStore(s => s.qualityRepairRequests);
  const qualityRepairStops = useStudioStore(s => s.qualityRepairStops);
  const layoutAudits = useStudioStore(s => s.layoutAudits);
  const ignoredLayoutIssueKeys = useStudioStore(s => s.ignoredLayoutIssueKeys);
  const permanentlyIgnoredLayoutIssueKeys = useStudioStore(s => s.permanentlyIgnoredLayoutIssueKeys);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const frameRefs = useRef(new Map<string, HTMLDivElement>());
  const [playingAudioFrameId, setPlayingAudioFrameId] = useState<string | null>(null);
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (!selectedFrameId) return;
    const element = frameRefs.current.get(selectedFrameId);
    if (!element) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedFrameId]);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    const handleWheel = (event: WheelEvent) => {
      if (strip.scrollWidth <= strip.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      const atStart = strip.scrollLeft <= 0;
      const atEnd = Math.ceil(strip.scrollLeft + strip.clientWidth) >= strip.scrollWidth;
      if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return;
      event.preventDefault();
      strip.scrollBy({ left: delta * 1.6, behavior: 'auto' });
    };

    strip.addEventListener('wheel', handleWheel, { passive: false });
    return () => strip.removeEventListener('wheel', handleWheel);
  }, []);
  // ⚠️ 关键：缩略图完全不挂 iframe。AI HTML 可能含无限循环动画，
  // 即使加了 sandbox+看门狗也不够稳。统一用静态占位，主预览区才渲染真实 HTML。

  if (!project.outline) {
    return (
      <div className="h-32 border-t bg-white px-4 py-3">
        <p className="text-xs text-muted-foreground">等待生成视频大纲...</p>
      </div>
    );
  }

  const frames = project.outline.frames;
  const sources = project.videoSource?.frames ?? [];

  function scrollByCards(direction: -1 | 1) {
    stripRef.current?.scrollBy({ left: direction * 420, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function stopFrameAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setPlayingAudioFrameId(null);
  }

  function toggleFrameAudio(frameId: string, audioPath: string) {
    if (playingAudioFrameId === frameId && audioRef.current && !audioRef.current.paused) {
      stopFrameAudio();
      return;
    }

    stopFrameAudio();
    const audio = new Audio(audioPath);
    audioRef.current = audio;
    setPlayingAudioFrameId(frameId);
    audio.addEventListener('ended', () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlayingAudioFrameId(null);
      }
    });
    audio.play().catch(() => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlayingAudioFrameId(null);
      }
    });
  }

  return (
    <div className="studio-storyboard group/storyboard relative border-t bg-white">
      <button type="button" onClick={() => scrollByCards(-1)} className="absolute left-1 top-1/2 z-20 -translate-y-1/2 rounded-full border bg-background/95 p-1.5 opacity-0 shadow-sm transition-opacity focus:opacity-100 group-hover/storyboard:opacity-100" title="向前浏览分镜"><ChevronLeft className="size-4" /></button>
      <div ref={stripRef} className="storyboard-strip flex gap-2 overflow-x-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {frames.map((f, i) => {
          const fs = sources[i];
          const isSelected = f.id === selectedFrameId;
          const contract = resolveSceneContract(project.type, f);
          const imagePath = resolveFrameImagePath(fs);
          const hasImage = Boolean(imagePath);
          const hasHtml = !!fs?.htmlCode;
          const hasUiScene = isUiSceneDocumentReady(f);
          const hasAudio = !!fs?.audioPath;
          const isAudioPlaying = playingAudioFrameId === f.id;
          const generationPhase = generatingFrames[f.id];
          const isGenerating = Boolean(generationPhase);
          const qualityRun = qualityRuns[f.id];
          const repairRequested = Boolean(qualityRepairRequests[f.id]);
          const repairRunning = isQualityRepairRunActive(qualityRun?.status);
          const repairStopping = Boolean(qualityRepairStops[f.id]) && (repairRequested || repairRunning);
          const repairActive = repairRequested || repairRunning;
          const showRepairOverlay = repairActive && !isGenerating;
          const repairStatusLabel = showRepairOverlay
            ? `，${repairStopping ? '正在停止' : '正在优化'}`
            : '';
          const runtimeIssues = layoutAudits[f.id]?.issues;
          const rawIssues = runtimeIssues !== undefined ? runtimeIssues : fs?.qualityReport?.issues ?? [];
          const issueScope = layoutIssueScope(project.uuid, f.id, qualityHtmlHash(fs?.htmlCode ?? ''));
          const permanentIssueScope = permanentLayoutIssueScope(project.uuid, f.id);
          const issues = filterIgnoredLayoutIssues(rawIssues, [
            ...(ignoredLayoutIssueKeys[issueScope] ?? []),
            ...(permanentlyIgnoredLayoutIssueKeys[permanentIssueScope] ?? []),
          ]);
          const blocking = issues.filter(issue => issue.severity === 'critical').length;

          return (
            <div
              key={f.id}
              ref={element => {
                if (element) frameRefs.current.set(f.id, element);
                else frameRefs.current.delete(f.id);
              }}
              role="button"
              tabIndex={0}
              aria-label={`选择分镜 #${i + 1} ${f.title}${isGenerating ? '，正在生成' : repairStatusLabel}`}
              onClick={() => onFrameSelect(f.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onFrameSelect(f.id);
                }
              }}
              className={cn(
                'studio-storyboard-card storyboard-card-motion group relative flex flex-shrink-0 flex-col overflow-hidden rounded-lg border-2',
                isSelected
                  ? 'border-primary shadow-md'
                  : 'border-slate-200 hover:border-slate-300',
              )}
              style={{ width: portrait ? 72 : 128 }}
            >
              {/* 预览区：HTML 模式用静态占位（绝不在缩略图挂 iframe） */}
              <div
                className="relative w-full overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200"
                style={{ aspectRatio: `${canvas.design.width} / ${canvas.design.height}` }}
              >
                <div
                  data-testid="storyboard-thumbnail-content"
                  className={cn(
                    'storyboard-thumbnail-content absolute inset-0',
                    showRepairOverlay && 'storyboard-thumbnail-content--repairing',
                  )}
                >
                  {contract.mode === 'image' && hasImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imagePath} alt={f.title} className="h-full w-full object-cover" />
                  ) : contract.mode === 'html' && hasHtml ? (
                    <HtmlThumb
                      htmlCode={fs!.htmlCode!}
                      scale={0.1}
                      canvasPreset={project.canvasPreset}
                      frameDuration={fs!.audioPath ? fs!.audioDuration : f.sceneSpec?.durationHint}
                    />
                  ) : (
                    <StaticThumb frame={f} type={project.type} generated={hasHtml || hasImage || hasUiScene} />
                  )}
                </div>

                {isGenerating && (
                  <div data-testid="frame-generation-indicator" role="status" aria-label={`分镜 ${i + 1} 正在生成`} className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-slate-900/45 text-white backdrop-blur-[1px]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-[9px]">
                      {generationPhase === 'tts' ? '生成中 · 旁白' : '生成中 · 画面'}
                    </span>
                  </div>
                )}

                {showRepairOverlay ? (
                  <div
                    data-testid="frame-repair-indicator"
                    data-state={repairStopping ? 'stopping' : 'repairing'}
                    role="status"
                    className="storyboard-repair-overlay pointer-events-none absolute inset-0 z-10"
                  >
                    <span aria-hidden="true" className="storyboard-repair-scan" />
                    <span className="storyboard-repair-label">
                      {repairStopping ? '正在停止' : '正在优化'}
                    </span>
                  </div>
                ) : null}

                {issues.length ? (
                  <button
                    type="button"
                    onClick={event => { event.stopPropagation(); onFrameSelect(f.id); onQualityOpen?.(f.id); }}
                    className={cn('absolute bottom-1 right-1 z-20 flex min-w-5 items-center justify-center gap-0.5 rounded-full border bg-background/95 px-1.5 py-0.5 text-[10px] font-medium shadow-sm', blocking ? 'border-destructive/30 text-destructive' : 'border-amber-300 text-amber-700')}
                    title={`查看 ${issues.length} 个质量问题`}
                  >
                    <AlertCircle className="size-3" />{issues.length}
                  </button>
                ) : null}

                {/* 序号 */}
                <span className="absolute left-1 top-1 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  #{i + 1}
                </span>

                {/* 喇叭按钮 */}
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    if (fs?.audioPath) toggleFrameAudio(f.id, fs.audioPath);
                  }}
                  disabled={!hasAudio}
                  aria-label={hasAudio ? `播放旁白：${f.title}` : `尚无旁白：${f.title}`}
                  aria-pressed={isAudioPlaying}
                  className={cn(
                    'absolute right-1 top-1 z-20 rounded-full p-1 transition-colors',
                    hasAudio
                      ? isAudioPlaying
                        ? 'bg-primary text-primary-foreground ring-2 ring-primary/20'
                        : 'bg-background/90 text-muted-foreground opacity-0 shadow-sm group-hover:opacity-100 focus:opacity-100'
                      : 'bg-amber-50 text-amber-700',
                  )}
                  title={hasAudio ? '播放旁白' : '尚无旁白'}
                >
                  <Volume2 className="h-3 w-3" />
                </button>
              </div>

              {/* 标题 */}
              <div className="bg-white px-2 py-1.5 text-left">
                <div className="truncate text-xs font-medium">{f.title}</div>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => scrollByCards(1)} className="absolute right-1 top-1/2 z-20 -translate-y-1/2 rounded-full border bg-background/95 p-1.5 opacity-0 shadow-sm transition-opacity focus:opacity-100 group-hover/storyboard:opacity-100" title="向后浏览分镜"><ChevronRight className="size-4" /></button>
    </div>
  );
}

/** 静态缩略图：根据分镜 id 哈希出色相，避免渲染 iframe 导致卡死 */
function StaticThumb({
  frame,
  type,
  generated,
}: {
  frame: { id: string; title: string; index: number };
  type: 'image' | 'html';
  generated: boolean;
}) {
  // 用 id 哈希出色相
  const hue = Array.from(frame.id).reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const bg = `linear-gradient(135deg, hsl(${hue} 60% 88%), hsl(${(hue + 40) % 360} 60% 92%))`;

  if (!generated) {
    return (
      <div className="flex h-full w-full items-center justify-center text-slate-400">
        {type === 'image' ? (
          <ImageOff className="h-4 w-4" />
        ) : (
          <Code2 className="h-4 w-4" />
        )}
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: bg }}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-white/40 via-white/10 to-black/10" />
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/35 px-1.5 py-0.5 text-[9px] text-white">
        <Play className="h-2.5 w-2.5" />
        <span>{type === 'html' ? 'HTML' : 'IMAGE'}</span>
      </div>
    </div>
  );
}
