import type { FrameOutline, FrameSource, ProjectDetail, VideoSource } from '@/types';
import { isFrameComplete } from '@/lib/scene-contract';

export function getFrameSourceForOutlineFrame(
  videoSource: VideoSource | null | undefined,
  frameId: string | null | undefined,
  frameIndex: number,
): FrameSource | null {
  if (!videoSource?.frames?.length) return null;
  if (frameId) {
    const byId = videoSource.frames.find(frame => frame?.id === frameId);
    if (byId) return byId;
  }
  return videoSource.frames[frameIndex] ?? null;
}

export function getFrameDuration(project: ProjectDetail, frameIndex: number): number {
  const outlineFrame = project.outline?.frames[frameIndex];
  const source = getFrameSourceForOutlineFrame(project.videoSource, outlineFrame?.id, frameIndex);
  const renderedAudioDuration = source?.audioPath ? source.audioDuration : undefined;
  return Math.max(0.1, renderedAudioDuration ?? outlineFrame?.sceneSpec?.durationHint ?? 3);
}

export function normalizeVideoSourceForFrames(
  videoSource: VideoSource | null | undefined,
  frames: Pick<FrameOutline, 'id'>[],
): VideoSource {
  const existingFrames = (videoSource?.frames ?? []).filter(Boolean);
  const byId = new Map(existingFrames.filter(frame => frame.id).map(frame => [frame.id, frame]));
  return {
    ...(videoSource ?? {}),
    frames: frames.map((frame, index) => {
      const existing = byId.get(frame.id) || existingFrames[index];
      if (!existing) return { id: frame.id };
      if (!existing.id || existing.id === frame.id) return { ...existing, id: frame.id };
      return { id: frame.id };
    }),
  };
}

export function isFrameSourceComplete(
  source: FrameSource | null | undefined,
  type: 'image' | 'html',
  frame?: Pick<FrameOutline, 'sceneSpec'> | null,
) {
  return isFrameComplete(source, type, frame);
}

export function withRegeneratedNarration(
  videoSource: VideoSource | null | undefined,
  frameIndex: number,
  frameId: string,
  tts: { url: string; duration: number },
) {
  const frames = [...(videoSource?.frames ?? [])];
  frames[frameIndex] = {
    ...(frames[frameIndex] || {}),
    id: frames[frameIndex]?.id || frameId,
    audioPath: tts.url,
    audioDuration: tts.duration,
  };
  return frames;
}
