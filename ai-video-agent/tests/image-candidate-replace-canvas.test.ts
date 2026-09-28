import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  sanitizeHtml: vi.fn((html: string) => `sanitized:${html}`),
  commitFrameSourcePatch: vi.fn(),
  verifyLocalPexelsAsset: vi.fn(async () => 'verified-hash'),
}));

vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: mocks.findUnique } },
}));

vi.mock('@/lib/ai/html', () => ({
  applyRealImageGallery: vi.fn(() => 'gallery-html'),
  removeRealImageAssets: vi.fn(() => 'removed-html'),
  replaceRealImageSlot: vi.fn(() => 'replaced-html'),
  sanitizeHtml: mocks.sanitizeHtml,
  validateGeneratedHtml: vi.fn(),
  validateRealImageUsage: vi.fn(),
}));

vi.mock('@/lib/pexels/local-asset', () => ({
  verifyLocalPexelsAsset: mocks.verifyLocalPexelsAsset,
}));

vi.mock('@/lib/agents/committer', () => ({
  AgentCommitConflictError: class AgentCommitConflictError extends Error {},
  commitFrameSourcePatch: mocks.commitFrameSourcePatch,
}));

import { DELETE, POST } from '@/app/api/projects/[id]/image-candidates/replace/route';

const now = new Date('2026-07-27T00:00:00.000Z');
const asset = {
  provider: 'pexels',
  photoId: 11,
  localPath: '/api/data/pexels/portrait-11.jpg',
  localFileHash: 'hash-11',
  query: 'portrait subject',
  alt: 'Portrait subject',
  width: 1080,
  height: 1920,
  photographer: 'Photographer',
  photographerUrl: 'https://www.pexels.com/@photographer',
  pexelsUrl: 'https://www.pexels.com/photo/11',
  fitMode: 'cover',
  position: 'center',
  layout: 'editorial-stack',
  scaleFrom: 1,
  scaleTo: 1.04,
  downloadedAt: now.toISOString(),
  verificationLevel: 'human-confirmed',
};
const candidate = {
  photoId: 12,
  query: 'portrait subject',
  slotIndex: 0,
  subject: 'portrait subject',
  alt: 'Replacement portrait',
  width: 1080,
  height: 1920,
  previewUrl: '/api/data/pexels/portrait-12.jpg',
  localPath: '/api/data/pexels/portrait-12.jpg',
  localFileHash: 'hash-12',
  pexelsUrl: 'https://www.pexels.com/photo/12',
  photographer: 'Photographer',
  photographerUrl: 'https://www.pexels.com/@photographer',
  score: 95,
  layout: 'editorial-stack',
  fitMode: 'cover',
  matchedTerms: ['portrait'],
  rejectedTerms: [],
  status: 'accepted',
  verificationLevel: 'metadata-matched',
  reason: 'accepted',
};
const project = {
  uuid: 'portrait-project',
  title: 'Portrait project',
  type: 'html',
  canvasPreset: 'douyin-portrait-9-16',
  styleId: null,
  createdAt: now,
  updatedAt: now,
  outline: {
    title: 'Portrait outline',
    totalDuration: 3,
    frames: [{ id: 'frame-1', index: 1, title: 'Portrait', narration: 'Narration' }],
  },
  videoSource: {
    frames: [{
      id: 'frame-1',
      htmlCode: '<main data-layout="stack"><img src="/api/data/pexels/portrait-11.jpg"></main>',
      realImage: asset,
      realImages: [asset],
      imageSelection: {
        request: {
          query: 'portrait subject', fallbackQueries: [], requiredTerms: ['portrait'], optionalTerms: [],
          excludedTerms: [], subjectType: 'person', purpose: 'portrait', imageRequired: true,
        },
        candidates: [candidate],
        attemptedQueries: ['portrait subject'],
        selectedPhotoId: 11,
        selectedPhotoIds: [11],
        status: 'completed',
        verificationLevel: 'human-confirmed',
        requiresHumanReview: false,
        reason: 'selected',
        updatedAt: now.toISOString(),
      },
    }],
  },
};

describe('portrait image candidate mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(project);
    mocks.sanitizeHtml.mockImplementation((html: string) => `sanitized:${html}`);
  });

  it('keeps the portrait layout guard when replacing a candidate', async () => {
    const response = await POST(jsonRequest('POST', { frameId: 'frame-1', photoId: 12 }) as never, {
      params: { id: project.uuid },
    });
    expect(response.status).toBe(200);
    expect(mocks.sanitizeHtml).toHaveBeenCalledWith(
      expect.any(String),
      'douyin-portrait-9-16',
    );
  });

  it('keeps the portrait layout guard when removing applied candidates', async () => {
    const response = await DELETE(jsonRequest('DELETE', { frameId: 'frame-1' }) as never, {
      params: { id: project.uuid },
    });
    expect(response.status).toBe(200);
    expect(mocks.sanitizeHtml).toHaveBeenCalledWith(
      'removed-html',
      'douyin-portrait-9-16',
    );
  });
});

function jsonRequest(method: string, body: unknown) {
  return new Request(`http://localhost/api/projects/${project.uuid}/image-candidates/replace`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
