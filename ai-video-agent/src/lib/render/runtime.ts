import { availableParallelism, freemem } from 'os';

export type FrameTransport = 'pipe' | 'png';

export interface RenderRuntimeSettings {
  frameTransport: FrameTransport;
  realtimeFallbackTransport: 'png';
  maxConcurrentScenes: number;
  encodingPreset: 'medium';
}

const GIB = 1024 ** 3;

export function inferMaxConcurrentScenes(input: {
  logicalCores: number;
  freeMemoryBytes: number;
  configured?: number | null;
}): number {
  if (input.configured && Number.isFinite(input.configured)) {
    return clamp(Math.floor(input.configured), 1, 4);
  }
  return input.logicalCores >= 8 && input.freeMemoryBytes >= 6 * GIB ? 2 : 1;
}

export function getRenderRuntimeSettings(): RenderRuntimeSettings {
  const configured = Number(process.env.RENDER_SCENE_CONCURRENCY);
  return {
    frameTransport: process.env.RENDER_FRAME_TRANSPORT === 'png' ? 'png' : 'pipe',
    realtimeFallbackTransport: 'png',
    maxConcurrentScenes: inferMaxConcurrentScenes({
      logicalCores: availableParallelism(),
      freeMemoryBytes: freemem(),
      configured: Number.isFinite(configured) && configured > 0 ? configured : null,
    }),
    encodingPreset: 'medium',
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
