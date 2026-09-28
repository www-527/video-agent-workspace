import type { FrameRepairHistoryEntry, VideoSource } from '@/types';

export function appendFrameRepairHistory(
  videoSource: VideoSource,
  entry: FrameRepairHistoryEntry,
  limit = 50,
): VideoSource {
  return {
    ...videoSource,
    repairHistory: [...(videoSource.repairHistory ?? []), entry].slice(-Math.max(1, limit)),
  };
}
