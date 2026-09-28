import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import type { AgentGraphHooks } from './orchestrator';
import type {
  AgentArtifact,
  AgentRunKind,
  AgentRunStatus,
  AgentTaskResult,
  AgentTaskSpec,
} from './types';
import { AGENT_PIPELINE_VERSION } from './types';

const ACTIVE_STATUSES = ['queued', 'running', 'cancelling'] as const;
const globalAgentRuns = globalThis as typeof globalThis & {
  __activeAgentRuns?: Map<string, string>;
};
const activeAgentRuns = globalAgentRuns.__activeAgentRuns ??= new Map<string, string>();

export class AgentRunConflictError extends Error {
  readonly code = 'AGENT_RUN_ACTIVE';
  readonly status = 409;

  constructor(readonly activeRunId: string) {
    super('该项目已有同类生成任务正在运行');
    this.name = 'AgentRunConflictError';
  }
}

export interface PersistentAgentRun {
  id: string;
  existing: boolean;
  hooks: AgentGraphHooks;
  finish(status: AgentRunStatus, summary?: unknown): Promise<void>;
}

export async function startPersistentAgentRun(options: {
  projectId: string;
  kind: AgentRunKind;
  inputHash: string;
  clientRequestId?: string;
  userMessageId?: string;
  contextSnapshot?: unknown;
  retryOfRunId?: string;
  resumeOfRunId?: string;
}): Promise<PersistentAgentRun> {
  const now = new Date();
  if (options.clientRequestId) {
    const existing = await prisma.agentRun.findUnique({
      where: {
        projectId_clientRequestId: {
          projectId: options.projectId,
          clientRequestId: options.clientRequestId,
        },
      },
    });
    if (existing) {
      return {
        id: existing.id,
        existing: true,
        hooks: {},
        async finish() {},
      };
    }
  }
  const activeKey = `${options.projectId}:${options.kind}`;
  const activeRunId = activeAgentRuns.get(activeKey);
  if (activeRunId) throw new AgentRunConflictError(activeRunId);

  // In-memory entries survive development hot reloads. Any database-only
  // running entry therefore belongs to a previous application process.
  await prisma.agentRun.updateMany({
    where: {
      projectId: options.projectId,
      kind: options.kind,
      status: { in: [...ACTIVE_STATUSES] },
    },
    data: { status: 'interrupted', finishedAt: now },
  });

  const id = randomUUID();
  await prisma.agentRun.create({
    data: {
      id,
      projectId: options.projectId,
      kind: options.kind,
      inputHash: options.inputHash,
      status: 'running',
      startedAt: now,
      clientRequestId: options.clientRequestId,
      userMessageId: options.userMessageId,
      contextSnapshot: options.contextSnapshot as any,
      retryOfRunId: options.retryOfRunId,
      resumeOfRunId: options.resumeOfRunId,
    },
  });
  activeAgentRuns.set(activeKey, id);

  const hooks: AgentGraphHooks = {
    async taskQueued(task) {
      await prisma.agentTask.upsert({
        where: { runId_taskKey: { runId: id, taskKey: task.id } },
        create: taskCreateData(id, task),
        update: {
          role: task.role,
          frameId: task.frameId,
          dependencies: task.dependencies as any,
          inputHash: task.inputHash,
          maxAttempts: Math.max(1, task.maxAttempts ?? 1),
        },
      });
    },
    async taskStarted(task, attempt, startedAt) {
      await prisma.agentTask.update({
        where: { runId_taskKey: { runId: id, taskKey: task.id } },
        data: {
          status: 'running',
          attempt,
          startedAt: new Date(startedAt),
          errorCode: null,
          errorMessage: null,
        },
      });
    },
    async taskFinished(task, result) {
      await persistTaskResult(id, task, result);
    },
    async resolveReusable(task) {
      const previous = await prisma.agentTask.findFirst({
        where: {
          role: task.role,
          inputHash: task.inputHash,
          status: { in: ['completed', 'reused'] },
          run: {
            projectId: options.projectId,
            kind: options.kind,
            // A completed task artifact remains reusable when the surrounding
            // process was interrupted, provided its input hash still matches.
            status: { in: ['completed', 'partial_failed', 'interrupted'] },
          },
        },
        orderBy: { finishedAt: 'desc' },
        select: { artifact: true },
      });
      return previous?.artifact
        ? previous.artifact as unknown as AgentArtifact
        : undefined;
    },
  };

  return {
    id,
    existing: false,
    hooks,
    async finish(status, summary) {
      const finishedAt = new Date();
      try {
        await prisma.agentRun.update({
          where: { id },
          data: {
            status,
            summary: {
              pipelineVersion: AGENT_PIPELINE_VERSION,
              ...(summary && typeof summary === 'object'
                ? summary as Record<string, unknown>
                : summary == null ? {} : { value: summary }),
            } as any,
            finishedAt,
            cancelledAt: status === 'cancelled' ? finishedAt : undefined,
          },
        });
      } finally {
        if (activeAgentRuns.get(activeKey) === id) activeAgentRuns.delete(activeKey);
      }
    },
  };
}

export function createEphemeralAgentRun(): PersistentAgentRun {
  return {
    id: randomUUID(),
    existing: false,
    hooks: {},
    async finish() {},
  };
}

async function persistTaskResult(runId: string, task: AgentTaskSpec, result: AgentTaskResult) {
  const diagnostic = result.diagnostics[0];
  await prisma.agentTask.upsert({
    where: { runId_taskKey: { runId, taskKey: task.id } },
    create: {
      ...taskCreateData(runId, task),
      status: result.status,
      attempt: result.attempts,
      artifact: result.artifact as any,
      diagnostics: result.diagnostics as any,
      errorCode: diagnostic?.code,
      errorMessage: diagnostic?.message,
      startedAt: result.startedAt ? new Date(result.startedAt) : undefined,
      finishedAt: new Date(result.finishedAt),
    },
    update: {
      status: result.status,
      attempt: result.attempts,
      artifact: result.artifact as any,
      diagnostics: result.diagnostics as any,
      errorCode: diagnostic?.code,
      errorMessage: diagnostic?.message,
      startedAt: result.startedAt ? new Date(result.startedAt) : undefined,
      finishedAt: new Date(result.finishedAt),
    },
  });
}

function taskCreateData(runId: string, task: AgentTaskSpec) {
  return {
    id: randomUUID(),
    runId,
    taskKey: task.id,
    role: task.role,
    frameId: task.frameId,
    status: 'queued',
    dependencies: task.dependencies as any,
    inputHash: task.inputHash,
    attempt: 0,
    maxAttempts: Math.max(1, task.maxAttempts ?? 1),
  };
}

export function artifact<T>(kind: string, data: T, summary?: string): AgentArtifact<T> {
  return { kind, data, summary, createdAt: new Date().toISOString() };
}
