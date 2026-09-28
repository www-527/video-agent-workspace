'use client';

import { Maximize2, Minimize2, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PlayerStatus } from '@/components/player/use-player';
import { cn, formatDuration } from '@/lib/utils';
import { getFrameSourceForOutlineFrame } from '@/lib/video-source';
import type { ProjectDetail } from '@/types';

type ExportStatus = 'idle' | 'preparing' | 'prompting' | 'countdown' | 'recording' | 'finalizing' | 'failed';

interface PlayerBarProps {
  project: ProjectDetail;
  currentIndex: number;
  currentFrameDuration: number;
  totalDuration: number;
  status: PlayerStatus;
  currentTime: number;
  audioRef: React.RefObject<HTMLAudioElement>;
  onTogglePlay: () => void;
  onRestart: () => void;
  /** 预览区 DOM ref，用于全屏预览区域（而不是全屏整个页面）。 */
  previewRef?: React.RefObject<HTMLElement>;
  exportStatus: ExportStatus;
  exportMessage: string;
  /** @deprecated Export controls now live in PreviewToolbar. */
  exportConcurrency?: number;
  /** @deprecated Export controls now live in PreviewToolbar. */
  onExportConcurrencyChange?: (value: number) => void;
  /** @deprecated Export controls now live in PreviewToolbar. */
  onExport?: () => void;
  /** @deprecated Export controls now live in PreviewToolbar. */
  onCancelExport?: () => void;
}

function isTextEntryTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
}

export function PlayerBar({
  project,
  currentIndex,
  currentFrameDuration,
  totalDuration,
  status,
  currentTime,
  audioRef,
  onTogglePlay,
  onRestart,
  previewRef,
  exportStatus,
  exportMessage,
}: PlayerBarProps) {
  const [isFs, setIsFs] = useState(false);
  const fsContainerRef = useRef<HTMLDivElement>(null);
  const isPlaying = status === 'playing';

  useEffect(() => {
    function onFsChange() {
      const target = previewRef?.current ?? fsContainerRef.current;
      setIsFs(Boolean(target && document.fullscreenElement === target));
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [previewRef]);

  useEffect(() => {
    if (!isFs) return;
    function onKeyDown(event: KeyboardEvent) {
      const fullscreenTarget = previewRef?.current ?? fsContainerRef.current;
      if (!fullscreenTarget || document.fullscreenElement !== fullscreenTarget) return;
      if ((event.code !== 'Space' && event.key !== ' ') || event.repeat || isTextEntryTarget(event.target)) return;
      event.preventDefault();
      onTogglePlay();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isFs, onTogglePlay, previewRef]);

  const outlineFrameId = project.outline?.frames[currentIndex]?.id;
  const currentFrameSource = getFrameSourceForOutlineFrame(project.videoSource, outlineFrameId, currentIndex);
  const hasFrames = (project.outline?.frames.length ?? 0) > 0;
  const safeFrameDuration = Math.max(0.1, currentFrameDuration);
  const safeCurrentTime = Math.max(0, Math.min(currentTime, safeFrameDuration));
  const isExportBusy = exportStatus !== 'idle' && exportStatus !== 'failed';

  async function handleFullscreen() {
    const target = (previewRef?.current ?? fsContainerRef.current) as HTMLElement | null;
    if (!target) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    try {
      await target.requestFullscreen?.();
    } catch (error) {
      console.warn('[fullscreen] 进入失败：', error);
    }
  }

  return (
    <>
      <div
        ref={fsContainerRef}
        className={cn(
          'flex min-h-12 flex-shrink-0 items-center gap-2 border-t bg-white px-4 py-2',
          isFs && 'bg-slate-900 text-white',
        )}
      >
        <Button
          size="sm"
          variant="default"
          onClick={onTogglePlay}
          disabled={!hasFrames || isExportBusy}
          aria-label={isPlaying ? '暂停' : status === 'paused' ? '继续播放' : '播放'}
          className="min-w-20 gap-2"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {isPlaying ? '暂停' : '播放'}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={onRestart}
          disabled={!hasFrames || isExportBusy}
          title="当前分镜从 00:00 立即播放"
          className={cn('gap-1.5', isFs && 'text-white hover:bg-slate-800')}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          重新开始
        </Button>

        <div className="min-w-28 flex-1">
          <div
            role="progressbar"
            aria-label="当前分镜播放进度"
            aria-valuemin={0}
            aria-valuemax={safeFrameDuration}
            aria-valuenow={safeCurrentTime}
            aria-valuetext={`${formatDuration(safeCurrentTime)} / ${formatDuration(safeFrameDuration)}`}
            className={cn('h-1.5 w-full overflow-hidden rounded-full', isFs ? 'bg-slate-700' : 'bg-slate-200')}
          >
            <div
              className="h-full bg-primary transition-[width] duration-100"
              style={{ width: `${(safeCurrentTime / safeFrameDuration) * 100}%` }}
            />
          </div>
        </div>

        <div className={cn('whitespace-nowrap font-mono text-xs tabular-nums', isFs ? 'text-slate-300' : 'text-muted-foreground')}>
          {status === 'paused' ? <span className="mr-1 font-sans">已暂停 ·</span> : null}
          {formatDuration(safeCurrentTime)} / {formatDuration(safeFrameDuration)}
        </div>

        <div className={cn('whitespace-nowrap text-xs', isFs ? 'text-slate-300' : 'text-muted-foreground')}>
          全片：{formatDuration(totalDuration)}
        </div>

        {exportMessage ? (
          <div className={cn('max-w-56 truncate text-xs', exportStatus === 'failed' ? 'text-red-500' : isFs ? 'text-slate-300' : 'text-muted-foreground')}>
            {exportMessage}
          </div>
        ) : null}

        <Button
          size="icon"
          variant="ghost"
          onClick={handleFullscreen}
          title={isFs ? '退出全屏' : '全屏预览区（空格播放/暂停）'}
          aria-label={isFs ? '退出全屏' : '全屏预览区（空格播放/暂停）'}
          className={isFs ? 'text-white hover:bg-slate-800' : ''}
          disabled={isExportBusy}
        >
          {isFs ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </div>

      <audio
        ref={audioRef}
        src={currentFrameSource?.audioPath || undefined}
        preload="auto"
      />
    </>
  );
}
