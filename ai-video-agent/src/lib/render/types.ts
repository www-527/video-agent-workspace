import type { CanvasPresetId, UIInteractionStep } from '@/types';
import { DEFAULT_CANVAS_PRESET, getCanvasPreset } from '@/lib/canvas-presets';

export const RENDER_PROTOCOL_VERSION = 'render-bridge-v1';
export const RENDERER_VERSION = 'local-renderer-v2';
export const RENDER_STRATEGY_VERSION = 'scene-contract-v2';
export function getOutputSpec(canvasPreset?: CanvasPresetId | string | null) {
  const preset = getCanvasPreset(canvasPreset);
  return {
    width: preset.output.width,
    height: preset.output.height,
    designWidth: preset.design.width,
    designHeight: preset.design.height,
    fps: preset.output.fps,
    videoCodec: 'h264',
    audioCodec: 'aac',
    canvasPreset: preset.id,
  } as const;
}

export const OUTPUT_SPEC = getOutputSpec(DEFAULT_CANVAS_PRESET);

export type RenderCompatibility =
  | 'offline-compatible'
  | 'offline-repaired'
  | 'realtime-fallback'
  | 'failed';

export interface RenderStatus {
  ready: boolean;
  assets: 'loading' | 'ready' | 'failed';
  controllable: boolean;
  compatibility: RenderCompatibility;
  warnings: string[];
}

export type RenderJobStage =
  | 'queued'
  | 'checking-compatibility'
  | 'rendering-scenes'
  | 'encoding-scenes'
  | 'muxing-audio'
  | 'generating-subtitles'
  | 'assembling'
  | 'completed'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'partial-failed';

export type RenderSceneStage =
  | 'pending'
  | 'cache-hit'
  | 'waiting-resource'
  | 'rendering'
  | 'encoding'
  | 'realtime-fallback'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface RenderSceneMetrics {
  pageSetupMs: number;
  assetWaitMs: number;
  frameControlMs: number;
  screenshotMs: number;
  pngWriteMs: number;
  backpressureMs: number;
  encoderWallMs: number;
  validationMs: number;
  totalMs: number;
  temporaryBytes: number;
}

export interface RenderJobMetrics {
  preparationMs: number;
  sceneWallMs: number;
  assemblyMs: number;
  subtitleMuxMs: number;
  validationMs: number;
  totalMs: number;
}

export interface RenderSceneState {
  id: string;
  index: number;
  title: string;
  stage: RenderSceneStage;
  renderMode: 'html' | 'image' | 'ui-scene';
  compatibility?: RenderCompatibility;
  warnings: string[];
  cacheKey?: string;
  durationMs?: number;
  frameCount?: number;
  elapsedMs?: number;
  metrics?: RenderSceneMetrics;
  error?: {
    type: string;
    message: string;
    logPath?: string;
  };
}

export interface RenderJobOptions {
  canvasPreset?: CanvasPresetId;
  width?: number;
  height?: number;
  designWidth?: number;
  designHeight?: number;
  fps?: number;
  subtitles?: boolean;
  subtitleHorizontal?: number;
  subtitleVertical?: number;
  allowRealtimeFallback?: boolean;
  /** Explicit user override: skip only the pre-render quality-report gate. */
  bypassQualityGate?: boolean;
  forceSceneIds?: string[];
  /** Performance-only setting. It must not participate in the scene cache key. */
  maxConcurrentScenes?: number;
  /** Prefer a probed hardware H.264 encoder while retaining high-quality settings. */
  useGpuEncoding?: boolean;
  /** Runtime-resolved encoder; included in cache identity to avoid CPU/GPU cache collisions. */
  resolvedVideoEncoder?: 'libx264' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf';
}

export interface RenderJobSnapshot {
  id: string;
  projectId: string;
  stage: RenderJobStage;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  cacheHits: number;
  offlineRendered: number;
  realtimeFallbacks: number;
  failedScenes: number;
  actualConcurrency: number;
  peakConcurrency: number;
  renderStrategyVersion: string;
  metrics: RenderJobMetrics;
  slowestScene?: {
    sceneId: string;
    title: string;
    elapsedMs: number;
  };
  scenes: RenderSceneState[];
  visualWarnings: Array<{ sceneId: string; message: string }>;
  outputUrl?: string;
  outputPath?: string;
  error?: string;
}

export interface SceneTimelineItem {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  frameCount: number;
}

export interface RenderCacheManifest {
  sceneId: string;
  cacheKey: string;
  canvasPreset: CanvasPresetId;
  designWidth: number;
  designHeight: number;
  protocolVersion: string;
  rendererVersion: string;
  inputHashes: Record<string, string>;
  actualAudioDurationMs: number;
  outputDurationMs: number;
  frameCount: number;
  width: number;
  height: number;
  fps: number;
  compatibility: RenderCompatibility;
  warnings: string[];
  renderElapsedMs: number;
  failed?: { type: string; message: string };
  createdAt: string;
}

export interface UISceneDocument {
  archetype: 'overview' | 'master-detail' | 'workflow' | 'ai-approval';
  data: Record<string, unknown>;
  interactions: UIInteractionStep[];
  isDemoData: boolean;
}
