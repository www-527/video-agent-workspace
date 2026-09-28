'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getFrameDuration, getFrameSourceForOutlineFrame } from '@/lib/video-source';
import { useStudioStore } from '@/stores/studio-store';
import type { ProjectDetail } from '@/types';

// PlayerBar animates progress width for 100ms. Keep the completed state visible
// long enough for that transition to finish before the next frame resets it.
const PROGRESS_END_SETTLE_MS = 110;

export type PlayerStatus = 'idle' | 'playing' | 'paused';

interface UsePlayerResult {
  status: PlayerStatus;
  currentTime: number;
  currentIndex: number;
  currentFrameDuration: number;
  playbackRevision: number;
  audioRef: React.RefObject<HTMLAudioElement>;
  togglePlay: () => void;
  play: () => void;
  resume: () => void;
  pause: () => void;
  restart: () => void;
  resetToSelectedFrame: () => void;
  seek: (frameTime: number) => void;
  seekToFrame: (frameId: string) => void;
  playFromIndex: (index: number) => void;
}

export function usePlayer(project: ProjectDetail, initialIndex: number): UsePlayerResult {
  const audioRef = useRef<HTMLAudioElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const frameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRafRef = useRef<number | null>(null);
  const currentTimeRef = useRef(0);
  const currentIndexRef = useRef(Math.max(0, initialIndex));
  const currentFrameDurationRef = useRef(getFrameDuration(project, Math.max(0, initialIndex)));
  const statusRef = useRef<PlayerStatus>('idle');
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [currentIndex, setCurrentIndex] = useState(Math.max(0, initialIndex));
  const [currentTime, setCurrentTime] = useState(0);
  const [currentFrameDuration, setCurrentFrameDuration] = useState(currentFrameDurationRef.current);
  const [clockRevision, setClockRevision] = useState(0);
  const [playbackRevision, setPlaybackRevision] = useState(0);
  const setSelectedFrameId = useStudioStore(s => s.setSelectedFrameId);
  const setIsPlayingStore = useStudioStore(s => s.setIsPlaying);
  const setPlaybackContext = useStudioStore(s => s.setPlaybackContext);
  const lastPlaybackContextSyncRef = useRef(0);

  const updateStatus = useCallback((nextStatus: PlayerStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const updateCurrentIndex = useCallback((nextIndex: number) => {
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
  }, []);

  const updateCurrentTime = useCallback((nextTime: number) => {
    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);
  }, []);

  const updateCurrentFrameDuration = useCallback((nextDuration: number) => {
    const safeDuration = Math.max(0.1, nextDuration);
    currentFrameDurationRef.current = safeDuration;
    setCurrentFrameDuration(safeDuration);
  }, []);

  const clearFrameClock = useCallback(() => {
    if (frameTimerRef.current) {
      clearTimeout(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (progressRafRef.current !== null) {
      cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
    }
  }, []);

  const resetAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // Some browsers reject currentTime before media metadata is ready.
    }
  }, []);

  const advanceToNextFrame = useCallback(() => {
    clearFrameClock();
    resetAudio();
    updateCurrentTime(0);
    const frames = projectRef.current.outline?.frames ?? [];
    const nextIndex = currentIndexRef.current + 1;
    if (nextIndex < frames.length) {
      updateCurrentIndex(nextIndex);
      updateCurrentFrameDuration(getFrameDuration(projectRef.current, nextIndex));
      setSelectedFrameId(frames[nextIndex].id);
      setPlaybackRevision(revision => revision + 1);
      setClockRevision(revision => revision + 1);
      return;
    }
    updateStatus('idle');
  }, [clearFrameClock, resetAudio, setSelectedFrameId, updateCurrentFrameDuration, updateCurrentIndex, updateCurrentTime, updateStatus]);

  useEffect(() => {
    setIsPlayingStore(status === 'playing');
  }, [setIsPlayingStore, status]);

  useEffect(() => {
    const now = Date.now();
    if (status === 'playing' && now - lastPlaybackContextSyncRef.current < 200) return;
    lastPlaybackContextSyncRef.current = now;
    setPlaybackContext({
      frameId: project.outline?.frames[currentIndex]?.id ?? null,
      currentTimeMs: Math.round(currentTime * 1_000),
      durationMs: Math.round(currentFrameDuration * 1_000),
      playbackRevision,
    });
  }, [currentFrameDuration, currentIndex, currentTime, playbackRevision, project.outline, setPlaybackContext, status]);

  useEffect(() => {
    lastPlaybackContextSyncRef.current = Date.now();
    setPlaybackContext({
      frameId: project.outline?.frames[currentIndex]?.id ?? null,
      currentTimeMs: Math.round(currentTimeRef.current * 1_000),
      durationMs: Math.round(currentFrameDurationRef.current * 1_000),
      playbackRevision,
    });
  }, [currentIndex, playbackRevision, project.outline, setPlaybackContext]);

  useEffect(() => {
    const frameCount = project.outline?.frames.length ?? 0;
    const nextIndex = frameCount > 0
      ? Math.max(0, Math.min(initialIndex, frameCount - 1))
      : 0;
    if (nextIndex === currentIndexRef.current) return;
    clearFrameClock();
    resetAudio();
    updateCurrentIndex(nextIndex);
    updateCurrentFrameDuration(getFrameDuration(project, nextIndex));
    updateCurrentTime(0);
    updateStatus('idle');
    setPlaybackRevision(revision => revision + 1);
  }, [clearFrameClock, initialIndex, project, project.outline, resetAudio, updateCurrentFrameDuration, updateCurrentIndex, updateCurrentTime, updateStatus]);

  useEffect(() => {
    if (status !== 'playing') return;
    clearFrameClock();

    const currentProject = projectRef.current;
    const outlineFrame = currentProject.outline?.frames[currentIndex];
    if (!outlineFrame) {
      updateStatus('idle');
      return;
    }

    const frameSource = getFrameSourceForOutlineFrame(currentProject.videoSource, outlineFrame.id, currentIndex);
    const configuredDurationSeconds = getFrameDuration(currentProject, currentIndex);
    const audio = audioRef.current;

    if (!frameSource?.audioPath || !audio) {
      updateCurrentFrameDuration(configuredDurationSeconds);
      const startAt = Math.min(currentTimeRef.current, configuredDurationSeconds);
      const startedAt = performance.now() - startAt * 1000;
      const tick = () => {
        const elapsedSeconds = Math.min((performance.now() - startedAt) / 1000, configuredDurationSeconds);
        updateCurrentTime(elapsedSeconds);
        if (elapsedSeconds < configuredDurationSeconds && statusRef.current === 'playing') {
          progressRafRef.current = requestAnimationFrame(tick);
        }
      };

      progressRafRef.current = requestAnimationFrame(tick);
      frameTimerRef.current = setTimeout(advanceToNextFrame, Math.max(0, configuredDurationSeconds - startAt) * 1000);
      return clearFrameClock;
    }

    let cancelled = false;
    let onCanPlay: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let clockStarted = false;
    let mediaDurationSeconds = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : configuredDurationSeconds;
    updateCurrentFrameDuration(mediaDurationSeconds);
    let startAt = Math.min(currentTimeRef.current, mediaDurationSeconds);

    const startAudioClock = () => {
      if (cancelled || clockStarted) return;
      clockStarted = true;
      const tick = () => {
        if (cancelled || statusRef.current !== 'playing') return;
        updateCurrentTime(Math.min(audio.currentTime || 0, mediaDurationSeconds));
        if (!audio.ended) progressRafRef.current = requestAnimationFrame(tick);
      };
      progressRafRef.current = requestAnimationFrame(tick);
    };

    const handlePlayFailure = (error: unknown) => {
      if (cancelled) return;
      console.warn('[player] play() rejected:', error instanceof Error ? error.message : error);
      retryTimer = setTimeout(() => {
        if (cancelled || statusRef.current !== 'playing') return;
        audio.play()
          .then(startAudioClock)
          .catch(() => {
            if (!cancelled) updateStatus('paused');
          });
      }, 800);
    };

    const playNow = () => {
      if (cancelled) return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        mediaDurationSeconds = audio.duration;
        updateCurrentFrameDuration(mediaDurationSeconds);
        startAt = Math.min(currentTimeRef.current, mediaDurationSeconds);
      }
      try {
        audio.currentTime = startAt;
      } catch {
        // Some browsers reject currentTime before media metadata is ready.
      }
      const playResult = audio.play();
      if (playResult && typeof playResult.then === 'function') {
        void playResult.then(startAudioClock).catch(handlePlayFailure);
      } else {
        startAudioClock();
      }
    };

    const onEnded = () => {
      // The browser's media clock is authoritative for audio-backed frames. Paint
      // its final value before changing the scene so the progress bar never ends short.
      updateCurrentTime(mediaDurationSeconds);
      progressRafRef.current = requestAnimationFrame(() => {
        if (cancelled || statusRef.current !== 'playing') return;
        frameTimerRef.current = setTimeout(() => {
          if (!cancelled && statusRef.current === 'playing') advanceToNextFrame();
        }, PROGRESS_END_SETTLE_MS);
      });
    };
    audio.addEventListener('ended', onEnded);
    if (audio.readyState >= 3) {
      playNow();
    } else {
      onCanPlay = () => {
        if (onCanPlay) audio.removeEventListener('canplay', onCanPlay);
        onCanPlay = null;
        playNow();
      };
      audio.addEventListener('canplay', onCanPlay);
    }

    return () => {
      cancelled = true;
      audio.removeEventListener('ended', onEnded);
      if (onCanPlay) audio.removeEventListener('canplay', onCanPlay);
      if (retryTimer) clearTimeout(retryTimer);
      clearFrameClock();
    };
  }, [advanceToNextFrame, clearFrameClock, clockRevision, currentIndex, status, updateCurrentFrameDuration, updateCurrentTime, updateStatus]);

  useEffect(() => clearFrameClock, [clearFrameClock]);

  const pause = useCallback(() => {
    if (statusRef.current !== 'playing') return;
    clearFrameClock();
    const audio = audioRef.current;
    if (audio) {
      updateCurrentTime(Math.min(audio.currentTime || currentTimeRef.current, currentFrameDurationRef.current));
      audio.pause();
    }
    updateStatus('paused');
  }, [clearFrameClock, updateCurrentTime, updateStatus]);

  const resume = useCallback(() => {
    if (statusRef.current !== 'paused') return;
    updateStatus('playing');
  }, [updateStatus]);

  const play = useCallback(() => {
    const frames = project.outline?.frames ?? [];
    if (!frames.length || statusRef.current === 'playing') return;
    if (statusRef.current === 'paused') {
      resume();
      return;
    }
    const nextIndex = Math.max(0, Math.min(currentIndexRef.current, frames.length - 1));
    updateCurrentIndex(nextIndex);
    updateCurrentFrameDuration(getFrameDuration(project, nextIndex));
    updateCurrentTime(0);
    resetAudio();
    setSelectedFrameId(frames[nextIndex].id);
    setPlaybackRevision(revision => revision + 1);
    setClockRevision(revision => revision + 1);
    updateStatus('playing');
  }, [project, project.outline, resetAudio, resume, setSelectedFrameId, updateCurrentFrameDuration, updateCurrentIndex, updateCurrentTime, updateStatus]);

  const restart = useCallback(() => {
    const frames = project.outline?.frames ?? [];
    if (!frames.length) return;
    clearFrameClock();
    resetAudio();
    updateCurrentTime(0);
    setSelectedFrameId(frames[currentIndexRef.current]?.id ?? null);
    setPlaybackRevision(revision => revision + 1);
    setClockRevision(revision => revision + 1);
    updateStatus('playing');
  }, [clearFrameClock, project.outline, resetAudio, setSelectedFrameId, updateCurrentTime, updateStatus]);

  const resetToIndex = useCallback((index: number) => {
    const frames = project.outline?.frames ?? [];
    const nextIndex = frames.length ? Math.max(0, Math.min(index, frames.length - 1)) : 0;
    clearFrameClock();
    resetAudio();
    updateCurrentIndex(nextIndex);
    updateCurrentFrameDuration(getFrameDuration(project, nextIndex));
    updateCurrentTime(0);
    updateStatus('idle');
    setSelectedFrameId(frames[nextIndex]?.id ?? null);
    setPlaybackRevision(revision => revision + 1);
  }, [clearFrameClock, project, project.outline, resetAudio, setSelectedFrameId, updateCurrentFrameDuration, updateCurrentIndex, updateCurrentTime, updateStatus]);

  const resetToSelectedFrame = useCallback(() => {
    resetToIndex(initialIndex);
  }, [initialIndex, resetToIndex]);

  const seek = useCallback((frameTime: number) => {
    const nextTime = Math.max(0, Math.min(frameTime, currentFrameDurationRef.current));
    updateCurrentTime(nextTime);
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.currentTime = nextTime;
      } catch {
        // Some browsers reject currentTime before media metadata is ready.
      }
    }
    if (statusRef.current === 'playing') setClockRevision(revision => revision + 1);
  }, [updateCurrentTime]);

  const seekToFrame = useCallback((frameId: string) => {
    const index = project.outline?.frames.findIndex(frame => frame.id === frameId) ?? -1;
    if (index >= 0) resetToIndex(index);
  }, [project.outline, resetToIndex]);

  const playFromIndex = useCallback((index: number) => {
    const frames = project.outline?.frames ?? [];
    if (!frames.length) return;
    const nextIndex = Math.max(0, Math.min(index, frames.length - 1));
    clearFrameClock();
    resetAudio();
    updateCurrentIndex(nextIndex);
    updateCurrentFrameDuration(getFrameDuration(project, nextIndex));
    updateCurrentTime(0);
    setSelectedFrameId(frames[nextIndex].id);
    setPlaybackRevision(revision => revision + 1);
    setClockRevision(revision => revision + 1);
    updateStatus('playing');
  }, [clearFrameClock, project, project.outline, resetAudio, setSelectedFrameId, updateCurrentFrameDuration, updateCurrentIndex, updateCurrentTime, updateStatus]);

  return {
    status,
    currentTime,
    currentIndex,
    currentFrameDuration,
    playbackRevision,
    audioRef,
    togglePlay: status === 'playing' ? pause : play,
    play,
    resume,
    pause,
    restart,
    resetToSelectedFrame,
    seek,
    seekToFrame,
    playFromIndex,
  };
}
