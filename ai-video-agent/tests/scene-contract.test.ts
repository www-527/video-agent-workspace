import { describe, expect, it } from 'vitest';
import {
  isFrameComplete,
  isFrameVisualComplete,
  resolveFrameImagePath,
  resolveSceneContract,
} from '@/lib/scene-contract';
import { getFrameDuration } from '@/lib/video-source';
import type { FrameOutline, FrameSource, ProjectDetail } from '@/types';

const frame = (renderMode?: 'html' | 'image' | 'ui-scene'): FrameOutline => ({
  id: 'frame-1',
  index: 1,
  title: 'Scene',
  narration: 'Narration',
  sceneSpec: renderMode ? {
    relationship: 'process',
    focus: 'Main idea',
    revealStrategy: 'progressive',
    focalElement: 'Main idea',
    composition: 'expand',
    actionSemantics: 'Explain the sequence',
    assetStrategy: 'css-svg',
    informationPool: ['Main idea'],
    visualIntent: 'Show the idea clearly',
    screenText: ['Main idea'],
    assetHints: [],
    durationHint: 3,
    prohibitedPatterns: [],
    renderMode,
    uiSchemaVersion: renderMode === 'ui-scene' ? 1 : undefined,
    uiArchetype: renderMode === 'ui-scene' ? 'workflow' : undefined,
  } : undefined,
});

describe('scene contract', () => {
  it('uses HTML as the default contract and only treats a real audio file as audio', () => {
    const outline = frame();
    expect(resolveSceneContract('html', outline).mode).toBe('html');
    expect(isFrameVisualComplete({ id: 'frame-1', htmlCode: '<main />' }, 'html', outline)).toBe(true);
    expect(isFrameComplete({ id: 'frame-1', htmlCode: '<main />' }, 'html', outline)).toBe(false);
    expect(isFrameComplete({ id: 'frame-1', htmlCode: '<main />', audioDuration: 3 }, 'html', outline)).toBe(false);
    expect(isFrameComplete({ id: 'frame-1', htmlCode: '<main />', audioPath: '/audio.mp3', audioDuration: 3 }, 'html', outline)).toBe(true);
    expect(isFrameComplete({ id: 'frame-1', htmlCode: '<main />' }, 'html', outline, { requiresAudio: false })).toBe(true);
  });

  it('uses the localized real image as the image contract fallback', () => {
    const outline = frame('image');
    const source: FrameSource = {
      id: 'frame-1',
      audioPath: '/api/data/audio/frame-1.mp3',
      realImage: {
        provider: 'pexels',
        photoId: 42,
        localPath: '/api/data/pexels/frame-1.jpg',
        query: 'wind turbine',
        alt: 'Wind turbine',
        width: 1920,
        height: 1080,
        photographer: 'Example',
        photographerUrl: 'https://example.com/photographer',
        pexelsUrl: 'https://example.com/photo',
        fitMode: 'cover',
        position: 'center',
        layout: 'full-bleed',
        scaleFrom: 1,
        scaleTo: 1.04,
        downloadedAt: '2026-07-25T00:00:00.000Z',
      },
    };

    expect(resolveSceneContract('html', outline).mode).toBe('image');
    expect(resolveFrameImagePath(source)).toBe('/api/data/pexels/frame-1.jpg');
    expect(isFrameComplete(source, 'html', outline)).toBe(true);
  });

  it('lets an image project override an HTML scene request', () => {
    expect(resolveSceneContract('image', frame('html')).mode).toBe('image');
  });

  it('completes a ui-scene from its validated document without HTML', () => {
    const outline = frame('ui-scene');
    expect(resolveSceneContract('html', outline).mode).toBe('ui-scene');
    expect(isFrameVisualComplete({ id: 'frame-1' }, 'html', outline)).toBe(true);
    expect(isFrameComplete({ id: 'frame-1', audioPath: '/audio.mp3', audioDuration: 2 }, 'html', outline)).toBe(true);
  });

  it('uses the calibrated scene hint when a silent project only has a placeholder duration', () => {
    const outline = frame('html');
    outline.sceneSpec!.durationHint = 9;
    const project = {
      outline: { title: 'Duration', totalDuration: 9, frames: [outline] },
      videoSource: { frames: [{ id: 'frame-1', audioDuration: 18 }] },
    } as ProjectDetail;

    expect(getFrameDuration(project, 0)).toBe(9);
    project.videoSource!.frames[0].audioPath = '/audio.mp3';
    expect(getFrameDuration(project, 0)).toBe(18);
  });
});
