import { describe, expect, it } from 'vitest';
import { buildRenderOptionsHash, buildSceneCacheKey } from '@/lib/render/hash';
import type { RenderJobOptions } from '@/lib/render/types';

const base = {
  contentHash: 'html-a',
  imageHash: 'image-a',
  audioHash: 'audio-a',
  actualAudioDurationMs: 1_000,
  subtitleHash: 'subtitle-a',
  themeHash: 'theme-a',
  renderOptionsHash: 'options-a',
};

describe('scene cache key', () => {
  it('is stable for identical scene inputs', () => {
    expect(buildSceneCacheKey(base)).toBe(buildSceneCacheKey({ ...base }));
  });

  it.each([
    ['contentHash', 'html-b'],
    ['imageHash', 'image-b'],
    ['audioHash', 'audio-b'],
    ['actualAudioDurationMs', 1_033],
    ['subtitleHash', 'subtitle-b'],
    ['themeHash', 'theme-b'],
    ['renderOptionsHash', 'options-b'],
  ] as const)('invalidates when %s changes', (field, value) => {
    expect(buildSceneCacheKey({ ...base, [field]: value })).not.toBe(buildSceneCacheKey(base));
  });
});

describe('render options hash', () => {
  const options: Required<RenderJobOptions> = {
    width: 1920,
    height: 1080,
    designWidth: 1280,
    designHeight: 720,
    canvasPreset: 'landscape-16-9',
    fps: 30,
    subtitles: true,
    subtitleHorizontal: 50,
    subtitleVertical: 12,
    allowRealtimeFallback: true,
    bypassQualityGate: false,
    forceSceneIds: [],
    maxConcurrentScenes: 2,
    useGpuEncoding: false,
    resolvedVideoEncoder: 'libx264',
  };

  it('does not invalidate scene cache when concurrency or retry scope changes', () => {
    expect(buildRenderOptionsHash({ ...options, maxConcurrentScenes: 4, forceSceneIds: ['scene-1'] }))
      .toBe(buildRenderOptionsHash(options));
  });

  it('invalidates scene cache when a visual option changes', () => {
    expect(buildRenderOptionsHash({ ...options, subtitles: false }))
      .not.toBe(buildRenderOptionsHash(options));
  });

  it('invalidates scene cache when the requested encoder changes', () => {
    expect(buildRenderOptionsHash({ ...options, useGpuEncoding: true }))
      .not.toBe(buildRenderOptionsHash(options));
  });

  it('invalidates scene cache when GPU availability changes the resolved encoder', () => {
    expect(buildRenderOptionsHash({ ...options, useGpuEncoding: true, resolvedVideoEncoder: 'h264_nvenc' }))
      .not.toBe(buildRenderOptionsHash({ ...options, useGpuEncoding: true, resolvedVideoEncoder: 'libx264' }));
  });
});
