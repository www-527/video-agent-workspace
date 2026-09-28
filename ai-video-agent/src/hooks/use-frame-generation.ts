'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useStudioStore } from '@/stores/studio-store';
import type { ProjectDetail, SmartImageMode } from '@/types';
import { estimateRemainingSeconds, updateDurationHistory, type DurationHistory, type GenerationEvent } from '@/lib/generation-progress';
import { getFrameSourceForOutlineFrame, isFrameSourceComplete } from '@/lib/video-source';

export interface GenerationProgress extends GenerationEvent {
  message?: string;
  aborted?: boolean;
  elapsedSeconds: number;
  remainingSeconds: number;
  errors: number;
}

export interface GenerationRunResult {
  status: GenerationEvent['status'];
  message?: string;
}

const HISTORY_KEY = 'ai-video-generation-duration-history-v1';

interface UseFrameGenerationProps {
  project: ProjectDetail;
  onProjectRefresh: () => Promise<ProjectDetail | undefined> | void;
  frameConcurrency?: number;
}

/**
 * 通用：驱动 /api/frames/(image|html) 的 SSE 流式生成
 */
export function useFrameGeneration({ project, onProjectRefresh, frameConcurrency }: UseFrameGenerationProps) {
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<DurationHistory>({});
  const markFrameGenerating = useStudioStore(s => s.markFrameGenerating);
  const completeGeneratingFrame = useStudioStore(s => s.completeGeneratingFrame);
  const clearGeneratingFrames = useStudioStore(s => s.clearGeneratingFrames);

  useEffect(() => {
    try { historyRef.current = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); } catch { historyRef.current = {}; }
  }, []);

  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => setProgress(previous => {
      if (!previous) return previous;
      const now = Date.now();
      const elapsedSeconds = Math.max(0, Math.round((now - Date.parse(previous.startedAt)) / 1000));
      const phaseElapsedSeconds = previous.phaseStartedAt ? Math.max(0, (now - Date.parse(previous.phaseStartedAt)) / 1000) : 0;
      return { ...previous, elapsedSeconds, remainingSeconds: estimateRemainingSeconds({ mode: previous.mode, total: previous.total, currentFrame: previous.current, phase: previous.phase, phaseElapsedSeconds, history: historyRef.current }) };
    }), 1000);
    return () => window.clearInterval(timer);
  }, [generating]);

  const start = useCallback(async (frameIds?: string[], options?: {
    sampleOnly?: boolean;
    forceVisual?: boolean;
    forceAudio?: boolean;
    freshStart?: boolean;
    promptOverride?: string;
    smartImages?: boolean;
    smartImageMode?: SmartImageMode | 'off';
  }) => {
    setGenerating(true);
    const mode = project.type;
    const startedAt = new Date().toISOString();
    setProgress({ mode, total: 0, current: 0, phase: 'prepare', status: 'preparing', percent: 0, startedAt, elapsedSeconds: 0, remainingSeconds: 0, errors: 0 });
    clearGeneratingFrames();
    const url = '/api/frames/html';
    abortRef.current = new AbortController();
    let finalStatus: GenerationEvent['status'] | undefined;
    let finalMessage: string | undefined;
    let finalSmartImages: {
      enabled: boolean;
      planned: number;
      downloaded: number;
      applied: number;
      fallback: number;
      failed: number;
    } | undefined;

    try {
      let passFrameIds = frameIds;
      let passOptions = options;
      const maxPasses = options?.sampleOnly ? 1 : 2;

      for (let pass = 0; pass < maxPasses; pass++) {
        finalStatus = undefined;
        await runPass(passFrameIds, passOptions);
        const refreshed = await onProjectRefresh();
        if (!refreshed || finalStatus !== 'partial_failed') break;

        const missing = getIncompleteFrameIds(refreshed, passFrameIds);
        if (!missing.length || pass + 1 >= maxPasses) break;

        passFrameIds = missing;
        // A partial failure can mean that only TTS failed after the HTML artifact
        // has already been persisted. Recovery must fill missing artifacts instead
        // of replaying the user's destructive regenerate request and overwriting a
        // successful visual with a second random render.
        passOptions = { ...options, forceVisual: false, forceAudio: false, promptOverride: undefined };
        const recoveryStartedAt = new Date().toISOString();
        setProgress({
          mode,
          total: missing.length,
          current: 0,
          phase: 'prepare',
          status: 'preparing',
          percent: 0,
          startedAt: recoveryStartedAt,
          elapsedSeconds: 0,
          remainingSeconds: 0,
          errors: 0,
          message: `正在自动修复 ${missing.length} 个未完成分镜`,
        });
      }

      if (finalSmartImages?.enabled) {
        if (finalSmartImages.applied > 0) {
          toast.success(`智能配图完成：规划 ${finalSmartImages.planned} 镜，下载 ${finalSmartImages.downloaded} 份，实际应用 ${finalSmartImages.applied} 镜，自动降级 ${finalSmartImages.fallback} 镜。`);
        } else {
          toast.info(`未应用真实素材，${finalSmartImages.fallback} 个候选镜头已自动使用动画设计。`);
        }
      }

      async function runPass(currentFrameIds?: string[], currentOptions = options) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            projectId: project.uuid,
            frameIds: currentFrameIds,
            sampleOnly: currentOptions?.sampleOnly,
            forceVisual: currentOptions?.forceVisual,
            forceAudio: currentOptions?.forceAudio,
            freshStart: currentOptions?.freshStart,
            promptOverride: currentOptions?.promptOverride,
            smartImages: Boolean(currentOptions?.smartImages),
            smartImageMode: currentOptions?.smartImageMode !== 'off'
              ? currentOptions?.smartImageMode
              : undefined,
            frameConcurrency,
          }),
          signal: abortRef.current!.signal,
        });
        if (!res.ok || !res.body) {
          const payload = await res.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error || '启动生成失败');
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          for (const ev of events) {
            const lines = ev.split('\n');
            let event = 'message';
            let data = '';
            for (const line of lines) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!data) continue;
            try {
              const payload = JSON.parse(data);
              handleEvent(event, payload);
            } catch {
              // Ignore malformed SSE chunks; the final reconciliation catches gaps.
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        finalStatus = 'aborted';
        finalMessage = '生成已取消';
      } else {
        finalStatus = 'partial_failed';
        finalMessage = (e as Error).message;
        console.error('生成失败', e);
        setProgress(p => (p ? { ...p, status: 'partial_failed', message: (e as Error).message, remainingSeconds: 0 } : null));
      }
    } finally {
      setGenerating(false);
      clearGeneratingFrames();
      // 成功状态短暂展示；最终仍失败或被中断时保留诊断信息，
      // 避免错误被后续成功事件覆盖后悄悄消失。
      setTimeout(() => setProgress(current => current?.status === 'completed' ? null : current), 3000);
    }

    function handleEvent(event: string, payload: any) {
      switch (event) {
        case 'start':
          applyEvent(payload);
          break;
        case 'message':
          applyEvent(payload);
          break;
        case 'phase_start':
          if (payload.frameId) markFrameGenerating(payload.frameId, payload.phase || 'prepare');
          applyEvent(payload);
          break;
        case 'phase_end':
          if (payload.phaseStartedAt && payload.phaseEndedAt) {
            const seconds = (Date.parse(payload.phaseEndedAt) - Date.parse(payload.phaseStartedAt)) / 1000;
            historyRef.current = updateDurationHistory(historyRef.current, payload.mode, payload.phase, seconds);
            try { localStorage.setItem(HISTORY_KEY, JSON.stringify(historyRef.current)); } catch { /* storage unavailable */ }
          }
          applyEvent(payload);
          break;
        case 'frame_done':
          if (payload.frameId) completeGeneratingFrame(payload.frameId);
          applyEvent(payload);
          // 立即刷新以便分镜卡显示
          onProjectRefresh();
          break;
        case 'frame_error':
          if (payload.frameId) completeGeneratingFrame(payload.frameId);
          applyEvent(payload, true);
          break;
        case 'phase_error':
          applyEvent(payload, true);
          break;
        case 'image_search':
        case 'image_download':
        case 'image_accepted':
        case 'html':
          if (payload.frameId) markFrameGenerating(payload.frameId, payload.phase || 'html');
          applyEvent(payload);
          break;
        case 'image_fallback':
          if (payload.imageUsageFailure) {
            console.error('[智能配图] 真实图片未应用到最终 HTML', {
              projectId: project.uuid,
              frameId: payload.frameId,
              reason: payload.imageUsageFailure.reason,
              assetPaths: payload.imageUsageFailure.assetPaths,
            });
          }
          if (payload.frameId) markFrameGenerating(payload.frameId, payload.phase || 'image');
          applyEvent(payload, Boolean(payload.imageUsageFailure));
          break;
        case 'skip':
          if (payload.frameId) completeGeneratingFrame(payload.frameId);
          applyEvent(payload);
          break;
        case 'aborted':
          clearGeneratingFrames();
          finalStatus = 'aborted';
          finalMessage = payload.reason || payload.message;
          applyEvent({ ...payload, message: payload.reason, aborted: true });
          break;
        case 'done':
          clearGeneratingFrames();
          finalStatus = payload.status;
          finalMessage = payload.message;
          if (payload.smartImages) {
            finalSmartImages = {
              enabled: Boolean(finalSmartImages?.enabled || payload.smartImages.enabled),
              planned: (finalSmartImages?.planned || 0) + (payload.smartImages.planned || 0),
              downloaded: (finalSmartImages?.downloaded || 0) + (payload.smartImages.downloaded || 0),
              applied: (finalSmartImages?.applied || 0) + (payload.smartImages.applied || 0),
              fallback: (finalSmartImages?.fallback || 0) + (payload.smartImages.fallback || 0),
              failed: (finalSmartImages?.failed || 0) + (payload.smartImages.failed || 0),
            };
          }
          applyEvent(payload);
          break;
      }

      function applyEvent(next: GenerationEvent & { aborted?: boolean }, incrementError = false) {
        setProgress(previous => {
          const eventStartedAt = next.startedAt || previous?.startedAt || new Date().toISOString();
          const elapsedSeconds = Math.max(0, Math.round((Date.now() - Date.parse(eventStartedAt)) / 1000));
          const remainingSeconds = estimateRemainingSeconds({ mode: next.mode, total: next.total, currentFrame: next.current, phase: next.phase, history: historyRef.current });
          return { ...next, percent: Math.max(previous?.percent || 0, next.percent || 0), elapsedSeconds, remainingSeconds, errors: (previous?.errors || 0) + (incrementError ? 1 : 0), aborted: next.aborted || next.status === 'aborted' };
        });
      }
    }

    return {
      status: finalStatus ?? 'partial_failed',
      message: finalMessage,
    } satisfies GenerationRunResult;
  }, [project.type, project.uuid, frameConcurrency, onProjectRefresh, markFrameGenerating, completeGeneratingFrame, clearGeneratingFrames]);

  const abort = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    clearGeneratingFrames();
    setProgress(previous => previous ? { ...previous, status: 'aborted', aborted: true, message: '用户中断', remainingSeconds: 0 } : previous);
    await fetch(
      '/api/frames/html/abort',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.uuid, mode: project.type }),
      },
    );
  }, [project.type, project.uuid, clearGeneratingFrames]);

  return { generating, progress, start, abort };
}

function getIncompleteFrameIds(project: ProjectDetail, requestedFrameIds?: string[]): string[] {
  const requested = requestedFrameIds?.length ? new Set(requestedFrameIds) : null;
  return (project.outline?.frames ?? [])
    .filter(frame => !requested || requested.has(frame.id))
    .filter((frame, index) => {
      const source = getFrameSourceForOutlineFrame(project.videoSource, frame.id, index);
      return Boolean(source?.id && source.id !== frame.id) || !isFrameSourceComplete(source, project.type, frame);
    })
    .map(frame => frame.id);
}
