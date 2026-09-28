import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: new Map<string, any>(),
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    agentRun: {
      create: mocks.create,
      findUnique: mocks.findUnique,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
    agentTask: {
      upsert: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { AgentRunConflictError, startPersistentAgentRun } from '@/lib/agents/persistence';

describe('persistent AgentRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows.clear();
    mocks.findUnique.mockImplementation(async ({ where, select }: any) => {
      let row: any;
      if (where.projectId_clientRequestId) {
        row = [...mocks.rows.values()].find(candidate => (
          candidate.projectId === where.projectId_clientRequestId.projectId
          && candidate.clientRequestId === where.projectId_clientRequestId.clientRequestId
        ));
      } else {
        row = mocks.rows.get(where.id);
      }
      if (!row) return null;
      if (!select) return row;
      return Object.fromEntries(Object.keys(select).map(key => [key, row[key]]));
    });
    mocks.create.mockImplementation(async ({ data }: any) => {
      const row = {
        requestedAt: new Date(),
        finishedAt: null,
        cancelledAt: null,
        summary: null,
        ...data,
      };
      mocks.rows.set(row.id, row);
      return row;
    });
    mocks.update.mockImplementation(async ({ where, data }: any) => {
      const row = { ...mocks.rows.get(where.id), ...data };
      mocks.rows.set(where.id, row);
      return row;
    });
    mocks.updateMany.mockImplementation(async ({ where, data }: any) => {
      let count = 0;
      for (const [id, row] of mocks.rows) {
        if (row.projectId !== where.projectId || row.kind !== where.kind || !where.status.in.includes(row.status)) continue;
        mocks.rows.set(id, { ...row, ...data });
        count += 1;
      }
      return { count };
    });
  });

  it('returns the original run for the same project and client idempotency key', async () => {
    const first = await startPersistentAgentRun({
      projectId: 'project-idempotent',
      kind: 'brief-resolution',
      inputHash: 'a'.repeat(64),
      clientRequestId: 'client-request-1',
    });
    const second = await startPersistentAgentRun({
      projectId: 'project-idempotent',
      kind: 'brief-resolution',
      inputHash: 'a'.repeat(64),
      clientRequestId: 'client-request-1',
    });
    expect(second).toMatchObject({ id: first.id, existing: true });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await first.finish('completed');
  });

  it('rejects a second active run of the same kind while allowing explicit retry lineage', async () => {
    const active = await startPersistentAgentRun({
      projectId: 'project-conflict',
      kind: 'project-diagnosis',
      inputHash: 'b'.repeat(64),
    });
    await expect(startPersistentAgentRun({
      projectId: 'project-conflict',
      kind: 'project-diagnosis',
      inputHash: 'c'.repeat(64),
    })).rejects.toBeInstanceOf(AgentRunConflictError);
    await active.finish('failed', { retryable: true });

    const retry = await startPersistentAgentRun({
      projectId: 'project-conflict',
      kind: 'project-diagnosis',
      inputHash: 'c'.repeat(64),
      retryOfRunId: active.id,
      resumeOfRunId: 'interrupted-parent',
    });
    expect(mocks.rows.get(retry.id)).toMatchObject({
      retryOfRunId: active.id,
      resumeOfRunId: 'interrupted-parent',
    });
    await retry.finish('completed');
  });

  it('marks database-only running work interrupted before starting after a restart', async () => {
    mocks.rows.set('orphan-run', {
      id: 'orphan-run',
      projectId: 'project-restart',
      kind: 'change-proposal',
      status: 'running',
    });
    const next = await startPersistentAgentRun({
      projectId: 'project-restart',
      kind: 'change-proposal',
      inputHash: 'd'.repeat(64),
    });
    expect(mocks.rows.get('orphan-run').status).toBe('interrupted');
    expect(mocks.rows.get(next.id).status).toBe('running');
    await next.finish('completed');
  });
});
