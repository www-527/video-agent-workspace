import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  project: null as any,
  changeSet: null as any,
  events: [] as string[],
  changeSetCreate: vi.fn(),
  changeSetFindFirst: vi.fn(),
  changeSetUpdate: vi.fn(),
  projectFindUnique: vi.fn(),
  projectAssetFindFirst: vi.fn(),
  transaction: vi.fn(),
  createCheckpoint: vi.fn(),
  loadState: vi.fn(),
  readCheckpoint: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: mocks.projectFindUnique },
    projectAsset: { findFirst: mocks.projectAssetFindFirst },
    projectChangeSet: {
      create: mocks.changeSetCreate,
      findFirst: mocks.changeSetFindFirst,
      update: mocks.changeSetUpdate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/projects/checkpoints', () => ({
  createProjectCheckpoint: mocks.createCheckpoint,
  loadCurrentProjectState: mocks.loadState,
  readProjectCheckpoint: mocks.readCheckpoint,
}));

import {
  applyProjectChangeSet,
  calculateChangeImpact,
  proposeChangeSetFromDiagnosis,
  revertProjectChangeSet,
} from '@/lib/changesets/service';
import { createProjectStateHash } from '@/lib/projects/state-hash';
import type { DirectorDiagnosis } from '@/types';

describe('project ChangeSet safety chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.project = projectRow();
    mocks.changeSet = changeSetRow(mocks.project);
    mocks.projectFindUnique.mockImplementation(async () => mocks.project);
    mocks.projectAssetFindFirst.mockResolvedValue({ id: 'asset-1' });
    mocks.changeSetFindFirst.mockImplementation(async ({ select, where }: any) => {
      if (select?.id && where?.status === 'applied') return { id: mocks.changeSet.id };
      return mocks.changeSet;
    });
    mocks.changeSetUpdate.mockImplementation(async ({ data }: any) => {
      mocks.changeSet = { ...mocks.changeSet, ...data };
      return mocks.changeSet;
    });
    mocks.changeSetCreate.mockImplementation(async ({ data }: any) => ({
      id: 'change-created',
      checkpointId: null,
      resultStateHash: null,
      ...data,
    }));
    mocks.loadState.mockImplementation(async () => currentState(mocks.project));
    mocks.createCheckpoint.mockImplementation(async () => {
      mocks.events.push('checkpoint');
      return { id: 'checkpoint-1' };
    });
    mocks.readCheckpoint.mockResolvedValue({
      outline: mocks.project.outline,
      videoSource: mocks.project.videoSource,
      styleId: mocks.project.styleId,
      contentStyle: mocks.project.contentStyle,
      gptOptimization: mocks.project.gptOptimization,
      projectBrief: mocks.project.projectBrief,
      briefStatus: mocks.project.briefStatus,
    });
    mocks.transaction.mockImplementation(async (callback: any) => callback({
      project: {
        updateMany: vi.fn(async ({ data }: any) => {
          mocks.events.push('project-update');
          mocks.project = { ...mocks.project, ...data, updatedAt: new Date('2026-08-10T00:00:01.000Z') };
          return { count: 1 };
        }),
        update: vi.fn(async ({ data }: any) => {
          mocks.events.push('project-restore');
          mocks.project = { ...mocks.project, ...data, updatedAt: new Date('2026-08-10T00:00:02.000Z') };
          return mocks.project;
        }),
      },
      projectCheckpoint: { update: vi.fn(async () => ({ id: 'checkpoint-1' })) },
      projectChangeSet: {
        update: vi.fn(async ({ data }: any) => {
          mocks.changeSet = { ...mocks.changeSet, ...data };
          return mocks.changeSet;
        }),
      },
    }));
  });

  it('calculates a bounded impact without mutating the project', () => {
    const operations = [
      { type: 'update_frame_text' as const, frameId: 'frame-1', narration: '更短旁白' },
      { type: 'regenerate_visual' as const, frameId: 'frame-2', reason: '画面重复' },
      { type: 'delete_frame' as const, frameId: 'frame-3' },
    ];
    const impact = calculateChangeImpact(operations, 5);
    expect(impact).toMatchObject({
      affectedFrameIds: ['frame-1', 'frame-2', 'frame-3'],
      outlineChanged: true,
      visualRegenerationCount: 2,
      audioRegenerationCount: 1,
      preservedFrameCount: 2,
    });
    expect(impact.warnings).toHaveLength(1);
  });

  it('rejects a diagnosis after the protected project state changes', async () => {
    const diagnosis = diagnosisFor(mocks.project);
    mocks.loadState.mockResolvedValue({ ...currentState(mocks.project), stateHash: 'different-state' });
    await expect(proposeChangeSetFromDiagnosis({
      projectId: mocks.project.uuid,
      diagnosis,
      intensity: 'recommended',
    })).rejects.toMatchObject({ code: 'diagnosis_stale', status: 409 });
    expect(mocks.changeSetCreate).not.toHaveBeenCalled();
  });

  it('creates a checkpoint before applying any project mutation', async () => {
    const result = await applyProjectChangeSet(mocks.project.uuid, mocks.changeSet.id);
    expect(mocks.events).toEqual(['checkpoint', 'project-update']);
    expect(result.changeSet).toMatchObject({ status: 'applied', checkpointId: 'checkpoint-1' });
    expect(result.project.videoSource?.frames[0]).not.toHaveProperty('htmlCode');
  });

  it('marks a proposal stale and leaves the project untouched on an apply conflict', async () => {
    mocks.loadState.mockResolvedValue({ ...currentState(mocks.project), stateHash: 'changed-after-proposal' });
    await expect(applyProjectChangeSet(mocks.project.uuid, mocks.changeSet.id))
      .rejects.toMatchObject({ code: 'change_set_stale', status: 409 });
    expect(mocks.createCheckpoint).not.toHaveBeenCalled();
    expect(mocks.changeSetUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'stale' } }));
  });

  it('requires confirmation before overwriting edits made after apply, then restores on force', async () => {
    mocks.changeSet = { ...mocks.changeSet, status: 'applied', checkpointId: 'checkpoint-1', resultStateHash: 'applied-state' };
    mocks.loadState.mockResolvedValue({ ...currentState(mocks.project), stateHash: 'newer-user-state' });
    await expect(revertProjectChangeSet({ projectId: mocks.project.uuid, changeSetId: mocks.changeSet.id }))
      .rejects.toMatchObject({ code: 'revert_conflict', requiresConfirmation: true });
    expect(mocks.readCheckpoint).not.toHaveBeenCalled();

    const restored = await revertProjectChangeSet({ projectId: mocks.project.uuid, changeSetId: mocks.changeSet.id, force: true });
    expect(mocks.events).toContain('project-restore');
    expect(restored.changeSet.status).toBe('reverted');
  });
});

function projectRow() {
  return {
    uuid: 'project-changeset',
    title: '安全修改测试',
    type: 'html',
    canvasPreset: 'landscape-16-9',
    workflow: 'gpt-free',
    styleId: 'clean',
    contentStyle: null,
    gptOptimization: null,
    projectBrief: { version: 'project-brief-v1', goal: '测试' },
    briefStatus: 'confirmed',
    outline: {
      title: '安全修改测试',
      frames: [
        { id: 'frame-1', index: 1, title: '第一镜', narration: '这是需要缩短的一段旁白，它有足够长度供安全修改测试使用。' },
        { id: 'frame-2', index: 2, title: '第二镜', narration: '普通旁白。' },
      ],
    },
    videoSource: { frames: [{ id: 'frame-1', htmlCode: '<main>old</main>', audioPath: '/remote/audio.mp3' }, { id: 'frame-2' }] },
    assets: [],
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-10T00:00:00.000Z'),
  };
}

function currentState(project: any) {
  const state = {
    outline: project.outline,
    videoSource: project.videoSource,
    styleId: project.styleId,
    contentStyle: project.contentStyle,
    gptOptimization: project.gptOptimization,
    projectBrief: project.projectBrief,
    assetBindings: project.assets,
  };
  return { project, state, stateHash: createProjectStateHash(state) };
}

function changeSetRow(project: any) {
  return {
    id: 'change-1',
    projectId: project.uuid,
    status: 'proposed',
    baseStateHash: currentState(project).stateHash,
    resultStateHash: null,
    scope: { type: 'frame', frameIds: ['frame-1'] },
    operations: [{ type: 'update_frame_text', frameId: 'frame-1', narration: '更短旁白。' }],
    impact: calculateChangeImpact([{ type: 'update_frame_text', frameId: 'frame-1', narration: '更短旁白。' }], 2),
    summary: { title: '推荐修改方案', description: '仅修改第一镜' },
    checkpointId: null,
  };
}

function diagnosisFor(project: any): DirectorDiagnosis {
  return {
    version: 'director-diagnosis-v1',
    scope: { type: 'project', frameIds: project.outline.frames.map((frame: any) => frame.id) },
    summary: '节奏需要收紧',
    issues: [{
      id: 'rhythm-1',
      category: 'rhythm',
      severity: 'important',
      userFacingExplanation: '第一镜旁白偏长',
      evidenceFrameIds: ['frame-1'],
    }],
    options: [{ id: 'recommended', label: '推荐调整', description: '缩短旁白', intensity: 'recommended', expectedImpact: '只影响第一镜' }],
    recommendedOptionId: 'recommended',
    baseStateHash: currentState(project).stateHash,
  };
}
