// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateImagesPanel } from '@/components/studio/candidate-images-panel';
import type { FrameSource, ProjectDetail, SmartImageCandidate } from '@/types';

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

const candidate = (photoId: number, overrides: Partial<SmartImageCandidate> = {}): SmartImageCandidate => ({
  photoId,
  query: 'offshore wind turbine',
  slotIndex: 0,
  subject: 'offshore wind turbine',
  alt: `Wind turbine ${photoId}`,
  width: 2400,
  height: 1350,
  previewUrl: `/api/data/pexels/project-1/frame-1-candidate-${photoId}.jpg`,
  localPath: `/api/data/pexels/project-1/frame-1-candidate-${photoId}.jpg`,
  localFileHash: `hash-${photoId}`,
  pexelsUrl: `https://www.pexels.com/photo/${photoId}`,
  photographer: 'Photographer',
  photographerUrl: 'https://www.pexels.com/@photographer',
  score: 92,
  layout: 'editorial-split',
  fitMode: 'cover',
  matchedTerms: ['offshore', 'wind', 'turbine'],
  rejectedTerms: [],
  status: 'accepted',
  verificationLevel: 'metadata-matched',
  reason: '主体、清晰度和画幅均通过验收',
  ...overrides,
});

const request = {
  query: 'offshore wind turbine',
  fallbackQueries: ['wind turbine at sea'],
  requiredTerms: ['wind', 'turbine'],
  optionalTerms: ['offshore', 'sea'],
  excludedTerms: ['illustration'],
  subjectType: 'equipment' as const,
  purpose: '展示海上风电设备',
  imageRequired: true,
};

const source: FrameSource = {
  id: 'frame-1',
  htmlCode: '<main><img data-asset-slot="real-image-1" src="/api/data/pexels/project-1/frame-1-candidate-11.jpg" alt="Wind turbine 11"></main>',
  realImage: {
    provider: 'pexels',
    photoId: 11,
    localPath: '/api/data/pexels/project-1/frame-1-candidate-11.jpg',
    localFileHash: 'hash-11',
    query: request.query,
    alt: 'Wind turbine 11',
    width: 2400,
    height: 1350,
    photographer: 'Photographer',
    photographerUrl: 'https://www.pexels.com/@photographer',
    pexelsUrl: 'https://www.pexels.com/photo/11',
    fitMode: 'cover',
    position: 'center',
    layout: 'editorial-split',
    scaleFrom: 1,
    scaleTo: 1.04,
    downloadedAt: '2026-07-24T00:00:00.000Z',
    verificationLevel: 'human-confirmed',
  },
  imageSelection: {
    request,
    candidates: [candidate(11, { verificationLevel: 'human-confirmed' }), candidate(12)],
    attemptedQueries: [request.query, request.fallbackQueries[0]],
    selectedPhotoId: 11,
    selectedPhotoIds: [11],
    status: 'completed',
    verificationLevel: 'human-confirmed',
    requiresHumanReview: false,
    reason: '候选图已完成质量筛选并保存到本地',
    updatedAt: '2026-07-24T00:00:00.000Z',
  },
};
source.realImages = source.realImage ? [source.realImage] : [];

const project: ProjectDetail = {
  uuid: 'project-1',
  title: 'Candidate images',
  type: 'html',
  canvasPreset: 'landscape-16-9',
  styleId: null,
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
  hasOutline: true,
  outline: {
    title: 'Wind',
    totalDuration: 3,
    frames: [{
      id: 'frame-1',
      index: 1,
      title: 'Wind turbine',
      narration: 'Narration',
    }],
  },
  videoSource: { frames: [source] },
};

describe('CandidateImagesPanel', () => {
  beforeEach(() => {
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    vi.unstubAllGlobals();
  });

  it('switches to a localized alternative with its stable slot index', async () => {
    const updatedProject = { ...project, updatedAt: '2026-07-24T00:01:00.000Z' };
    const onProjectChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ project: updatedProject }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CandidateImagesPanel
        project={project}
        frameId="frame-1"
        source={source}
        onProjectChange={onProjectChange}
      />,
    );

    expect((screen.getByRole('button', { name: '已确认' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '切换并确认' }));

    await waitFor(() => expect(onProjectChange).toHaveBeenCalledWith(updatedProject));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/image-candidates/replace',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ frameId: 'frame-1', photoId: 12, slotIndex: 0 }),
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it('shows the bounded vision audit without exposing image bytes', () => {
    const reviewedSource: FrameSource = {
      ...source,
      imageSelection: source.imageSelection ? {
        ...source.imageSelection,
        visionReview: {
          status: 'accepted',
          selectedPhotoId: 11,
          backupPhotoIds: [12],
          subjectMatch: 'high',
          safeTextSide: 'left',
          subjectPosition: 'right',
          cropRisk: 'low',
          rationale: '主体在右侧，左侧有稳定留白。',
          rejections: [],
          model: 'vision-model',
          elapsedMs: 120,
        },
      } : undefined,
    };

    render(
      <CandidateImagesPanel
        project={project}
        frameId="frame-1"
        source={reviewedSource}
        onProjectChange={() => undefined}
      />,
    );

    const audit = screen.getByTestId('vision-image-review');
    expect(audit.textContent).toContain('已按图片内容排序');
    expect(audit.textContent).toContain('左侧有稳定留白');
    expect(audit.textContent).not.toContain('data:image');
  });

  it('cancels the applied image while keeping candidates available for later', async () => {
    const updatedProject = { ...project, updatedAt: '2026-07-24T00:01:30.000Z' };
    const onProjectChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ project: updatedProject }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CandidateImagesPanel
        project={project}
        frameId="frame-1"
        source={source}
        onProjectChange={onProjectChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '取消配图' }));
    await waitFor(() => expect(onProjectChange).toHaveBeenCalledWith(updatedProject));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/image-candidates/replace',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ frameId: 'frame-1' }),
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已取消配图并恢复原生画面，候选图片仍保留');
  });

  it('lets the user explicitly confirm the active metadata-matched candidate', async () => {
    const reviewSource: FrameSource = {
      ...source,
      realImage: source.realImage ? { ...source.realImage, verificationLevel: 'metadata-matched' } : undefined,
      realImages: source.realImages?.map(asset => ({ ...asset, verificationLevel: 'metadata-matched' })),
      imageSelection: source.imageSelection ? {
        ...source.imageSelection,
        candidates: source.imageSelection.candidates.map(item => ({ ...item, verificationLevel: 'metadata-matched' })),
        status: 'needs-review',
        verificationLevel: 'metadata-matched',
        requiresHumanReview: true,
      } : undefined,
    };
    const updatedProject = { ...project, updatedAt: '2026-07-24T00:02:00.000Z' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ project: updatedProject }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CandidateImagesPanel
        project={project}
        frameId="frame-1"
        source={reviewSource}
        onProjectChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '确认当前素材' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/image-candidates/replace',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ frameId: 'frame-1', photoId: 11, slotIndex: 0 }),
      }),
    ));
  });

  it('lets the first localized candidate activate a frame that has no image slot yet', async () => {
    const orphanSource: FrameSource = {
      id: 'frame-1',
      htmlCode: source.htmlCode,
      imageSelection: source.imageSelection ? {
        ...source.imageSelection,
        selectedPhotoId: undefined,
        selectedPhotoIds: [],
        status: 'rejected',
        verificationLevel: 'metadata-matched',
        requiresHumanReview: true,
      } : undefined,
    };
    const updatedProject = { ...project, updatedAt: '2026-07-24T00:03:00.000Z' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ project: updatedProject }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CandidateImagesPanel
        project={project}
        frameId="frame-1"
        source={orphanSource}
        onProjectChange={() => undefined}
      />,
    );

    const applyButtons = screen.getAllByRole('button', { name: '应用并确认' });
    expect(screen.getByText('等待人工确认')).toBeTruthy();
    expect((applyButtons[0] as HTMLButtonElement).disabled).toBe(false);
    expect(applyButtons[0].getAttribute('title')).toContain('多主体镜头');
    fireEvent.click(applyButtons[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/image-candidates/replace',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ frameId: 'frame-1', photoId: 11, slotIndex: 0 }),
      }),
    ));
  });

  it('keeps failure diagnostics visible when no candidate was accepted', () => {
    const failedSource: FrameSource = {
      id: 'frame-1',
      imageSelection: {
        request,
        candidates: [],
        rejectedCandidates: [
          candidate(21, {
            localPath: undefined,
            localFileHash: undefined,
            status: 'rejected',
            rejectionCode: 'required-term-missing',
            missingTerms: ['turbine'],
            reason: '缺少必需主体词：turbine',
          }),
        ],
        attemptedQueries: [request.query],
        status: 'rejected',
        reason: '没有找到同时满足主体词、清晰度和画幅要求的图片',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
    };

    render(
      <CandidateImagesPanel
        project={project}
        frameId="frame-1"
        source={failedSource}
        onProjectChange={() => undefined}
      />,
    );

    expect(screen.getByText('暂无可切换的匹配图片')).toBeTruthy();
    expect(screen.getAllByText('没有找到同时满足主体词、清晰度和画幅要求的图片').length).toBeGreaterThan(0);
    expect(screen.getByText('查看 1 个被拒绝候选')).toBeTruthy();
  });
});
