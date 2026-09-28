import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  project: null as any,
  findUnique: vi.fn(),
  callVision: vi.fn(),
  currentKey: { model: 'vision-model', baseURL: 'https://relay.example/v1' } as any,
}));

vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: mocks.findUnique } },
}));

vi.mock('@/lib/ai/client', () => ({
  callAIVisionJson: mocks.callVision,
  isVisionUnavailableError: (error: any) => error?.code === 'vision_unavailable',
}));

vi.mock('@/lib/ai-key-context', () => ({
  getCurrentAIKeySnapshot: () => mocks.currentKey,
}));

import { collectDirectorEvidence } from '@/lib/director/evidence';
import {
  canUseVisualDiagnosis,
  diagnoseProject,
  runDeterministicDirectorChecks,
} from '@/lib/director/diagnosis';
import { createProjectStateHash } from '@/lib/projects/state-hash';
import type { ChatContextSnapshot, ProjectDetail } from '@/types';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('AI director diagnosis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentKey = { model: 'vision-model', baseURL: 'https://relay.example/v1' };
    mocks.project = projectRow();
    mocks.findUnique.mockImplementation(async () => mocks.project);
  });

  it('finds deterministic readability, empty-frame, rhythm, and repeated-layout issues', async () => {
    const project = toProjectDetail(mocks.project);
    const issues = await runDeterministicDirectorChecks(project, contextFor(mocks.project, 'project'));
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'readability', severity: 'blocking' }),
      expect.objectContaining({ id: expect.stringContaining('empty-visual') }),
      expect.objectContaining({ id: expect.stringContaining('repeated-layout') }),
    ]));
  });

  it('is read-only and skips visual calls for rhythm-only feedback', async () => {
    const result = await diagnoseProject({
      projectId: mocks.project.uuid,
      content: '整体节奏有点慢',
      context: contextFor(mocks.project, 'project'),
    });
    expect(result.visualStatus).toBe('not_needed');
    expect(result.diagnosis.options.filter(option => option.id === result.diagnosis.recommendedOptionId)).toHaveLength(1);
    expect(mocks.callVision).not.toHaveBeenCalled();
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
  });

  it('never sends DeepSeek into the visual chain', async () => {
    mocks.currentKey = { model: 'deepseek-v4-pro', baseURL: 'https://api.deepseek.com' };
    const collectEvidence = vi.fn();
    expect(canUseVisualDiagnosis()).toBe(false);
    const result = await diagnoseProject({
      projectId: mocks.project.uuid,
      content: '整体太像 PPT',
      context: contextFor(mocks.project, 'project'),
      collectEvidence,
    });
    expect(result.visualStatus).toBe('unavailable');
    expect(result.diagnosis.summary).toContain('不可用于视觉诊断');
    expect(collectEvidence).not.toHaveBeenCalled();
    expect(mocks.callVision).not.toHaveBeenCalled();
  });

  it('keeps deterministic issues when visual diagnosis is unavailable', async () => {
    mocks.callVision.mockRejectedValue(Object.assign(new Error('unsupported image input'), { code: 'vision_unavailable' }));
    const result = await diagnoseProject({
      projectId: mocks.project.uuid,
      content: '这个画面不好看',
      context: contextFor(mocks.project, 'frame', 'frame-4'),
      collectEvidence: async () => ({
        records: [{ frameId: 'frame-4', progress: 0.7, imageHash: 'a'.repeat(64), capturedAt: '2026-08-10T00:00:00.000Z' }],
        images: [{ dataUrl: `data:image/png;base64,${PNG_1X1.toString('base64')}`, mimeType: 'image/png', byteLength: PNG_1X1.length }],
        cacheHits: 0,
      }),
    });
    expect(result.visualStatus).toBe('unavailable');
    expect(result.diagnosis.issues.some(issue => issue.id.includes('empty-visual'))).toBe(true);
    expect(result.diagnosis.summary).toContain('不支持视觉输入');
  });

  it('reuses evidence for the same HTML hash, canvas, and sampling point', async () => {
    const renderer = {
      renderSample: vi.fn(async () => ({ image: PNG_1X1, issues: [], width: 1, height: 1 })),
    };
    const project = toProjectDetail(mocks.project);
    const context = contextFor(mocks.project, 'frame', 'frame-1');
    const first = await collectDirectorEvidence({ project, context, content: '这个画面不好看', renderer });
    const second = await collectDirectorEvidence({ project, context, content: '这个画面不好看', renderer });
    expect(first.records).toHaveLength(1);
    expect(second.records[0].imageHash).toBe(first.records[0].imageHash);
    expect(second.cacheHits).toBe(1);
    expect(renderer.renderSample).toHaveBeenCalledTimes(1);
  });
});

function projectRow() {
  const sameHtml = '<main><section class="layout"><h1>标题</h1></section></main>';
  return {
    uuid: 'project-director',
    title: '导演测试',
    type: 'html',
    canvasPreset: 'landscape-16-9',
    workflow: 'gpt-free',
    styleId: 'clean',
    contentStyle: null,
    gptOptimization: null,
    projectBrief: null,
    briefStatus: 'confirmed',
    outline: {
      title: '导演测试',
      frames: [1, 2, 3, 4].map(index => ({
        id: `frame-${index}`,
        index,
        title: `镜头 ${index}`,
        narration: index === 2 ? '非常密集的旁白'.repeat(30) : '普通旁白',
        sceneSpec: { durationHint: index === 2 ? 2 : 5 },
      })),
    },
    videoSource: {
      frames: [
        { id: 'frame-1', htmlCode: sameHtml, qualityReport: { issues: [{ code: 'subtitle_safe_area', label: '字幕遮挡', detail: '标题进入字幕区', severity: 'critical' }] } },
        { id: 'frame-2', htmlCode: sameHtml },
        { id: 'frame-3', htmlCode: sameHtml },
        { id: 'frame-4' },
      ],
    },
    assets: [],
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-10T00:00:00.000Z'),
  };
}

function contextFor(row: any, scope: 'project' | 'frame', frameId?: string): ChatContextSnapshot {
  return {
    version: 'chat-context-v1',
    projectId: row.uuid,
    projectUpdatedAt: row.updatedAt.toISOString(),
    projectStateHash: createProjectStateHash({
      outline: row.outline,
      videoSource: row.videoSource,
      styleId: row.styleId,
      contentStyle: row.contentStyle,
      gptOptimization: row.gptOptimization,
      projectBrief: row.projectBrief,
      assetBindings: row.assets,
    }),
    resolvedScope: scope,
    ...(frameId ? { selectedFrameId: frameId } : {}),
  };
}

function toProjectDetail(row: any): ProjectDetail {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    hasOutline: true,
  };
}
