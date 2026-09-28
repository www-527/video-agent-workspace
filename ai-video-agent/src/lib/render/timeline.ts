import { splitSubtitles } from '@/lib/subtitle';
import type { FrameOutline } from '@/types';
import type { SceneTimelineItem } from './types';

export interface TimelineInput {
  id: string;
  durationMs: number;
}

export function buildSceneTimeline(inputs: TimelineInput[], fps = 30): SceneTimelineItem[] {
  let cursorMs = 0;
  return inputs.map((input, index) => {
    const safeDuration = Math.max(1, Math.round(input.durationMs));
    const frameCount = Math.max(1, Math.round((safeDuration / 1000) * fps));
    const quantizedDurationMs = (frameCount * 1000) / fps;
    const item: SceneTimelineItem = {
      id: input.id,
      index,
      startMs: cursorMs,
      endMs: cursorMs + quantizedDurationMs,
      durationMs: quantizedDurationMs,
      frameCount,
    };
    cursorMs = item.endMs;
    return item;
  });
}

export function buildSrt(
  frames: Pick<FrameOutline, 'id' | 'narration'>[],
  timeline: SceneTimelineItem[],
): string {
  let cueIndex = 1;
  const blocks: string[] = [];
  for (const item of timeline) {
    const frame = frames.find(candidate => candidate.id === item.id);
    if (!frame?.narration) continue;
    const localCues = splitSubtitles(frame.narration, item.durationMs / 1000);
    for (const cue of localCues) {
      blocks.push([
        String(cueIndex),
        `${formatSrtTime(item.startMs + cue.startTime * 1000)} --> ${formatSrtTime(item.startMs + cue.endTime * 1000)}`,
        cue.text,
      ].join('\n'));
      cueIndex += 1;
    }
  }
  return blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

export function formatSrtTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

function pad(value: number, length: number) {
  return String(value).padStart(length, '0');
}

