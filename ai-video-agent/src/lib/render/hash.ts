import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import {
  OUTPUT_SPEC,
  RENDER_PROTOCOL_VERSION,
  RENDERER_VERSION,
  type RenderJobOptions,
} from './types';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function hashFile(path?: string | null): Promise<string> {
  if (!path) return 'none';
  try {
    return sha256(await readFile(path));
  } catch {
    return 'missing';
  }
}

export function buildRenderOptionsHash(options: Required<RenderJobOptions>): string {
  return sha256(JSON.stringify({
    canvasPreset: options.canvasPreset,
    width: options.width,
    height: options.height,
    designWidth: options.designWidth,
    designHeight: options.designHeight,
    fps: options.fps,
    subtitles: options.subtitles,
    subtitleHorizontal: options.subtitleHorizontal,
    subtitleVertical: options.subtitleVertical,
    allowRealtimeFallback: options.allowRealtimeFallback,
    useGpuEncoding: options.useGpuEncoding,
    resolvedVideoEncoder: options.resolvedVideoEncoder,
    // Retry scope and worker count only affect scheduling, not rendered pixels.
    forceSceneIds: [],
  }));
}

export function buildSceneCacheKey(input: {
  contentHash: string;
  imageHash: string;
  audioHash: string;
  actualAudioDurationMs: number;
  subtitleHash: string;
  themeHash: string;
  renderOptionsHash: string;
  outputSpec?: { width: number; height: number; designWidth?: number; designHeight?: number; fps: number; canvasPreset?: string };
}): string {
  return sha256(JSON.stringify({
    protocol: RENDER_PROTOCOL_VERSION,
    renderer: RENDERER_VERSION,
    ...input,
    output: input.outputSpec ?? OUTPUT_SPEC,
  }));
}
