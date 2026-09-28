import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkpoint: null as null | {
    id: string;
    projectId: string;
    reason: string;
    stateHash: string;
    snapshotPath: string;
    snapshotHash: string;
    summary: unknown;
    changeSetId?: string;
    createdAt: Date;
  },
  projectFindUnique: vi.fn(),
  checkpointCreate: vi.fn(),
  checkpointFindFirst: vi.fn(),
  checkpointFindMany: vi.fn(),
  checkpointDelete: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: mocks.projectFindUnique },
    projectCheckpoint: {
      create: mocks.checkpointCreate,
      findFirst: mocks.checkpointFindFirst,
      findMany: mocks.checkpointFindMany,
      delete: mocks.checkpointDelete,
    },
  },
}));

import {
  cancelAgentRun,
  registerAgentRunAbortController,
  unregisterAgentRunAbortController,
} from '@/lib/agents/cancellation';
import { createProjectCheckpoint, readProjectCheckpoint } from '@/lib/projects/checkpoints';
import { createProjectStateHash } from '@/lib/projects/state-hash';
import { removeProjectPrivateStorage, resolveInside } from '@/lib/projects/storage-paths';

const projectId = 'p0-checkpoint-test';

describe('AI dialog P0 foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkpoint = null;
    mocks.projectFindUnique.mockResolvedValue({
      uuid: projectId,
      outline: { title: '测试', frames: [{ id: 'frame-1', narration: '原始旁白' }] },
      videoSource: { frames: [{ id: 'frame-1', htmlCode: '<main>ok</main>' }] },
      styleId: 'clean',
      contentStyle: null,
      gptOptimization: null,
      projectBrief: { version: 'project-brief-v1', goal: '测试' },
      assets: [{ id: 'asset-1', status: 'ready', inferredUsage: 'visual' }],
    });
    mocks.checkpointCreate.mockImplementation(async ({ data }) => {
      mocks.checkpoint = { ...data, createdAt: new Date() };
      return mocks.checkpoint;
    });
    mocks.checkpointFindFirst.mockImplementation(async () => mocks.checkpoint);
    mocks.checkpointFindMany.mockResolvedValue([]);
  });

  afterEach(async () => {
    await removeProjectPrivateStorage(projectId);
  });

  it('produces stable hashes and changes when protected project state changes', () => {
    const base = {
      outline: { frames: [{ id: 'a', title: 'A' }] },
      videoSource: { frames: [{ id: 'a' }] },
      styleId: null,
      contentStyle: null,
      gptOptimization: null,
      projectBrief: null,
      assetBindings: [{ id: 'asset-1', usage: 'visual' }],
    };
    expect(createProjectStateHash(base)).toBe(createProjectStateHash({
      ...base,
      outline: { frames: [{ title: 'A', id: 'a' }] },
    }));
    expect(createProjectStateHash(base)).not.toBe(createProjectStateHash({
      ...base,
      outline: { frames: [{ id: 'a', title: 'B' }] },
    }));
  });

  it('writes and verifies a compressed checkpoint without exposing its payload', async () => {
    const created = await createProjectCheckpoint({ projectId, reason: '测试修改' });
    const restored = await readProjectCheckpoint(projectId, created.id);

    expect(created.snapshotPath).toMatch(/^data\/project-checkpoints\//);
    expect(created.snapshotPath).toMatch(/\.json\.gz$/);
    expect(restored).toMatchObject({
      version: 'project-checkpoint-v1',
      projectId,
      outline: { title: '测试' },
    });
    expect(created.stateHash).toHaveLength(64);
    expect(created.snapshotHash).toHaveLength(64);
  });

  it('rejects path traversal and aborts only the registered run', () => {
    expect(() => resolveInside('C:\\safe-root', '..', 'escape')).toThrow('存储路径越界');
    const controller = registerAgentRunAbortController('run-foundation');
    expect(cancelAgentRun('run-foundation')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    unregisterAgentRunAbortController('run-foundation', controller);
    expect(cancelAgentRun('run-foundation')).toBe(false);
  });
});
