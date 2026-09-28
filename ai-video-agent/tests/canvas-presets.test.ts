import { describe, expect, it } from 'vitest';
import { CANVAS_PRESETS, getCanvasPreset, normalizeCanvasPreset } from '@/lib/canvas-presets';
import { buildStructuredLayoutConstraints, buildFrameHtmlSystem } from '@/lib/ai/html';
import { getProtectedLayout } from '@/lib/layout-geometry';
import { getOutputSpec } from '@/lib/render/types';
import { buildRenderOptionsHash } from '@/lib/render/hash';
import { isCacheManifestCompatible } from '@/lib/render/cache';
import type { RenderCacheManifest } from '@/lib/render/types';
import type { RenderJobOptions } from '@/lib/render/types';
import { buildHtmlRenderQualityGuidance } from '@/lib/prompts/html-native-visual';
import { buildAdaptivePortraitDensityGuidance, buildPortraitVisualGuidance } from '@/lib/portrait-visual-system';
import { buildProtectedLayoutGuard } from '@/lib/layout-geometry';

describe('canvas presets', () => {
  it('keeps unknown and legacy projects on landscape', () => {
    expect(normalizeCanvasPreset(undefined)).toBe('landscape-16-9');
    expect(normalizeCanvasPreset('legacy-value')).toBe('landscape-16-9');
    expect(getCanvasPreset().design).toEqual({ width: 1280, height: 720 });
  });

  it('defines the conservative Douyin portrait safe areas and output', () => {
    const portrait = CANVAS_PRESETS['douyin-portrait-9-16'];
    expect(portrait.design).toEqual({ width: 720, height: 1280 });
    expect(portrait.output).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(portrait.platformSafeArea).toEqual({ left: 48, top: 80, right: 608, bottom: 1040 });
    expect(portrait.contentArea.bottom).toBe(920);
    expect(portrait.subtitleArea).toEqual({ left: 48, top: 920, right: 608, bottom: 1040 });
    expect(portrait.subtitle).toMatchObject({ horizontal: 46, vertical: 23, maxWidth: 520 });
  });

  it('feeds portrait dimensions into prompts, protected layout and render output', () => {
    const preset = 'douyin-portrait-9-16' as const;
    expect(buildFrameHtmlSystem(preset)).toContain('9:16');
    expect(buildFrameHtmlSystem(preset)).toContain('宽 720px，高 1280px');
    expect(buildStructuredLayoutConstraints(preset)).toContain('Canvas is exactly 720 x 1280 (9:16)');
    expect(getProtectedLayout(preset).content.bottom).toBe(920);
    expect(getOutputSpec(preset)).toMatchObject({ width: 1080, height: 1920, designWidth: 720, designHeight: 1280 });
  });

  it('keeps the portrait visual system isolated from landscape generation', () => {
    const portraitGuidance = buildPortraitVisualGuidance('douyin-portrait-9-16');
    expect(portraitGuidance).toContain('竖屏独立构图协议');
    expect(portraitGuidance).toContain('data-role="focal"');
    expect(portraitGuidance).toContain('自上而下的单路径');
    expect(portraitGuidance).toContain('上下对照');
    expect(buildPortraitVisualGuidance('landscape-16-9')).toBe('');
    expect(buildHtmlRenderQualityGuidance('landscape-16-9')).not.toContain('竖屏独立构图协议');
  });

  it('uses qualitative density guidance for free portrait composition', () => {
    const guidance = buildAdaptivePortraitDensityGuidance('douyin-portrait-9-16');
    expect(guidance).toContain('审美倾向，不是固定模板');
    expect(guidance).toContain('先判断本镜职责再决定密度');
    expect(guidance).toContain('再判断标题是不是主角');
    expect(guidance).toContain('留白可以很大');
    expect(guidance).toContain('不等于所有项目始终等权铺满');
    expect(guidance).toContain('不要机械缩小整组内容');
    expect(guidance).toContain('不要套用统一字号、固定对象数量或占屏比例');
    expect(buildAdaptivePortraitDensityGuidance('landscape-16-9')).toBe('');
  });

  it('uses portrait type tokens and relationship directions without changing landscape rules', () => {
    const portrait = buildStructuredLayoutConstraints('douyin-portrait-9-16');
    const landscape = buildStructuredLayoutConstraints('landscape-16-9');
    expect(portrait).toContain('titles are at least 56px');
    expect(portrait).toContain('comparison uses top/bottom contrast');
    expect(portrait).toContain('process/cause/timeline use top-to-bottom progression');
    expect(landscape).toContain('comparison uses left/right contrast');
    expect(landscape).toContain('process uses horizontal progression');
    expect(landscape).not.toContain('--ai-p-title-min');
    expect(buildProtectedLayoutGuard('douyin-portrait-9-16')).toContain('--ai-p-title-min:56px');
    expect(buildProtectedLayoutGuard('landscape-16-9')).not.toContain('--ai-p-title-min');
  });

  it('isolates landscape and portrait render cache options', () => {
    const landscape: Required<RenderJobOptions> = {
      canvasPreset: 'landscape-16-9', width: 1920, height: 1080, designWidth: 1280, designHeight: 720,
      fps: 30, subtitles: true, subtitleHorizontal: 50, subtitleVertical: 12,
      allowRealtimeFallback: true, bypassQualityGate: false, forceSceneIds: [], maxConcurrentScenes: 2, useGpuEncoding: false, resolvedVideoEncoder: 'libx264',
    };
    const portrait: Required<RenderJobOptions> = {
      ...landscape, canvasPreset: 'douyin-portrait-9-16', width: 1080, height: 1920,
      designWidth: 720, designHeight: 1280, subtitleHorizontal: 46, subtitleVertical: 23,
    };
    expect(buildRenderOptionsHash(landscape)).not.toBe(buildRenderOptionsHash(portrait));
  });

  it('rejects a manifest whose canvas or design dimensions belong to another preset', () => {
    const portrait = getOutputSpec('douyin-portrait-9-16');
    const manifest: RenderCacheManifest = {
      sceneId: 'scene-1', cacheKey: 'key-1', canvasPreset: portrait.canvasPreset,
      designWidth: portrait.designWidth, designHeight: portrait.designHeight,
      protocolVersion: 'test', rendererVersion: 'test', inputHashes: {},
      actualAudioDurationMs: 1000, outputDurationMs: 1000, frameCount: 30,
      width: portrait.width, height: portrait.height, fps: portrait.fps,
      compatibility: 'offline-compatible', warnings: [], renderElapsedMs: 100,
      createdAt: '2026-07-27T00:00:00.000Z',
    };
    expect(isCacheManifestCompatible(manifest, 'scene-1', 'key-1', portrait)).toBe(true);
    expect(isCacheManifestCompatible({ ...manifest, canvasPreset: 'landscape-16-9' }, 'scene-1', 'key-1', portrait)).toBe(false);
    expect(isCacheManifestCompatible({ ...manifest, designWidth: 1280 }, 'scene-1', 'key-1', portrait)).toBe(false);
  });
});
