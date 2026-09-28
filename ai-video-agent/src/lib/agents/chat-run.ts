import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { POST as handleAgentChatPost } from '@/app/api/agent/chat/route';
import { createAgentInputHash } from '@/lib/agents/hash';
import {
  cancelAgentRun,
  getAgentRunAbortSignal,
  isAbortError,
  registerAgentRunAbortController,
  unregisterAgentRunAbortController,
} from '@/lib/agents/cancellation';
import { startPersistentAgentRun } from '@/lib/agents/persistence';
import type { AgentRunKind, AgentRunStatus } from '@/lib/agents/types';
import { getCurrentAIKeySnapshot, runWithAIKeySnapshot } from '@/lib/ai-key-context';
import { createChatContextSnapshot } from '@/lib/context/chat-context';
import { shouldRunDirectorDiagnosis } from '@/lib/director/diagnosis';
import type { AgentActionRequest, ChatContextSnapshot, ChatMessage } from '@/types';

const TERMINAL_STATUSES = new Set<AgentRunStatus>([
  'completed',
  'partial_failed',
  'failed',
  'cancelled',
  'interrupted',
]);

interface StoredActionContext {
  version: 'agent-action-context-v1';
  request: {
    attachmentIds: string[];
    context: AgentActionRequest['context'];
    sourceMessageId?: string;
    rewriteDraft?: unknown;
  };
  resolvedContext: ChatContextSnapshot | null;
}

export class AgentRunRequestError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
    this.name = 'AgentRunRequestError';
  }
}

export async function dispatchPersistentChatRun(input: {
  request: AgentActionRequest;
  origin: string;
  retryOfRunId?: string;
  resumeOfRunId?: string;
}) {
  const project = await prisma.project.findUnique({
    where: { uuid: input.request.projectId },
    select: { uuid: true, briefStatus: true, outline: true },
  });
  if (!project) throw new AgentRunRequestError(404, '项目不存在', 'project_not_found');

  const resolvedContext = project.outline
    ? await createChatContextSnapshot({
      projectId: input.request.projectId,
      content: input.request.content,
      context: input.request.context,
    })
    : null;
  const contextSnapshot: StoredActionContext = {
    version: 'agent-action-context-v1',
    request: {
      attachmentIds: [...input.request.attachmentIds],
      context: { ...input.request.context },
      ...(input.request.sourceMessageId ? { sourceMessageId: input.request.sourceMessageId } : {}),
      ...(input.request.rewriteDraft !== undefined ? { rewriteDraft: input.request.rewriteDraft } : {}),
    },
    resolvedContext: resolvedContext?.snapshot ?? null,
  };
  const kind = inferChatRunKind(project.briefStatus, input.request.content);
  const persistent = await startPersistentAgentRun({
    projectId: input.request.projectId,
    kind,
    clientRequestId: input.request.clientRequestId,
    inputHash: createAgentInputHash({
      projectId: input.request.projectId,
      content: input.request.content,
      attachmentIds: input.request.attachmentIds,
      context: input.request.context,
      sourceMessageId: input.request.sourceMessageId,
      rewriteDraft: input.request.rewriteDraft,
    }),
    contextSnapshot,
    retryOfRunId: input.retryOfRunId,
    resumeOfRunId: input.resumeOfRunId,
  });
  if (!persistent.existing) {
    const credential = getCurrentAIKeySnapshot();
    if (!credential) {
      await persistent.finish('failed', { errorCode: 'AI_KEY_CONTEXT_MISSING', retryable: true });
      throw new AgentRunRequestError(409, '请先在 Key 管理中选择 API Key', 'AI_KEY_NOT_CONFIGURED');
    }
    const controller = registerAgentRunAbortController(persistent.id);
    void runWithAIKeySnapshot(credential, () => executeChatRun({
      runId: persistent.id,
      persistent,
      request: input.request,
      origin: input.origin,
      controller,
      contextSnapshot,
    }));
  }
  return getAgentRunView(input.request.projectId, persistent.id);
}

async function executeChatRun(input: {
  runId: string;
  persistent: Awaited<ReturnType<typeof startPersistentAgentRun>>;
  request: AgentActionRequest;
  origin: string;
  controller: AbortController;
  contextSnapshot: StoredActionContext;
}) {
  try {
    const chatRequest = new NextRequest(new URL('/api/agent/chat', input.origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-run-id': input.runId },
      body: JSON.stringify({
        projectId: input.request.projectId,
        content: input.request.content,
        attachmentIds: input.request.attachmentIds,
        context: input.request.context,
        rewriteDraft: input.request.rewriteDraft,
      }),
      signal: input.controller.signal,
    });
    const response = await handleAgentChatPost(chatRequest);
    const payload = await response.json().catch(() => ({})) as {
      error?: string;
      code?: string;
      userMessage?: ChatMessage;
      assistantMessage?: ChatMessage;
      assistantMessages?: ChatMessage[];
      project?: { updatedAt?: string };
      contextSnapshot?: ChatContextSnapshot | null;
    };
    const userMessageId = payload.userMessage?.id ?? await findRunUserMessageId(input.request, input.runId);
    await prisma.agentRun.update({
      where: { id: input.runId },
      data: {
        userMessageId,
        contextSnapshot: {
          ...input.contextSnapshot,
          resolvedContext: payload.contextSnapshot ?? input.contextSnapshot.resolvedContext,
        } as any,
      },
    });
    if (input.controller.signal.aborted || response.status === 499 || payload.code === 'AGENT_RUN_CANCELLED') {
      await input.persistent.finish('cancelled', {
        errorCode: 'AGENT_RUN_CANCELLED',
        retryable: true,
        userMessageId,
      });
      return;
    }
    if (!response.ok) {
      await input.persistent.finish('failed', {
        errorCode: payload.code || `CHAT_HTTP_${response.status}`,
        errorMessage: sanitizeRunError(payload.error),
        retryable: response.status >= 500 || response.status === 409,
        userMessageId,
      });
      return;
    }
    const assistantMessageIds = (payload.assistantMessages?.length ? payload.assistantMessages : payload.assistantMessage ? [payload.assistantMessage] : [])
      .map(message => message.id);
    await input.persistent.finish('completed', {
      userMessageId,
      assistantMessageIds,
      projectUpdatedAt: payload.project?.updatedAt,
      retryable: false,
    });
  } catch (error) {
    const cancelled = isAbortError(error, input.controller.signal);
    await input.persistent.finish(cancelled ? 'cancelled' : 'failed', {
      errorCode: cancelled ? 'AGENT_RUN_CANCELLED' : 'CHAT_RUN_FAILED',
      errorMessage: cancelled ? '任务已取消' : sanitizeRunError(error instanceof Error ? error.message : ''),
      retryable: true,
    }).catch(() => {});
  } finally {
    unregisterAgentRunAbortController(input.runId, input.controller);
  }
}

export async function getAgentRunView(projectId: string, runId: string) {
  let run = await prisma.agentRun.findFirst({
    where: { id: runId, projectId },
    include: { tasks: { orderBy: { createdAt: 'asc' } } },
  });
  if (!run) throw new AgentRunRequestError(404, '任务不存在', 'agent_run_not_found');
  if ((run.status === 'running' || run.status === 'queued' || run.status === 'cancelling') && !getAgentRunAbortSignal(run.id)) {
    const nextStatus = run.cancelRequestedAt ? 'cancelled' : 'interrupted';
    run = await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: nextStatus,
        finishedAt: new Date(),
        ...(nextStatus === 'cancelled' ? { cancelledAt: new Date() } : {}),
      },
      include: { tasks: { orderBy: { createdAt: 'asc' } } },
    });
  }
  return serializeAgentRun(run);
}

export async function requestAgentRunCancellation(projectId: string, runId: string) {
  const existing = await prisma.agentRun.findFirst({ where: { id: runId, projectId } });
  if (!existing) throw new AgentRunRequestError(404, '任务不存在', 'agent_run_not_found');
  if (TERMINAL_STATUSES.has(existing.status as AgentRunStatus)) return getAgentRunView(projectId, runId);
  const requestedAt = new Date();
  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: 'cancelling', cancelRequestedAt: requestedAt },
  });
  if (!cancelAgentRun(runId)) {
    await prisma.agentRun.update({
      where: { id: runId },
      data: { status: 'interrupted', finishedAt: new Date() },
    });
  }
  return getAgentRunView(projectId, runId);
}

export async function redispatchAgentRun(input: {
  projectId: string;
  runId: string;
  mode: 'retry' | 'resume';
  clientRequestId?: string;
  origin: string;
}) {
  const previous = await prisma.agentRun.findFirst({
    where: { id: input.runId, projectId: input.projectId },
  });
  if (!previous) throw new AgentRunRequestError(404, '原任务不存在', 'agent_run_not_found');
  if (!TERMINAL_STATUSES.has(previous.status as AgentRunStatus) || previous.status === 'completed') {
    throw new AgentRunRequestError(409, '当前任务状态不能重试或恢复', 'agent_run_not_retryable');
  }
  if (!previous.userMessageId) {
    throw new AgentRunRequestError(409, '原任务没有可复用的用户消息，请重新发送', 'agent_run_message_missing');
  }
  const userMessage = await prisma.message.findFirst({
    where: { id: previous.userMessageId, projectId: input.projectId, role: 'user' },
  });
  if (!userMessage) throw new AgentRunRequestError(409, '原用户消息已不存在，请重新发送', 'agent_run_message_missing');
  const stored = readStoredActionContext(previous.contextSnapshot);
  const metadata = userMessage.metadata as unknown as { kind?: string; assets?: Array<{ id: string }> } | null;
  const attachmentIds = stored?.request.attachmentIds
    ?? (metadata?.kind === 'asset_summary' ? (metadata.assets ?? []).map(asset => asset.id) : []);
  return dispatchPersistentChatRun({
    request: {
      projectId: input.projectId,
      clientRequestId: input.clientRequestId || randomUUID(),
      content: userMessage.content,
      attachmentIds,
      context: stored?.request.context ?? {},
      sourceMessageId: stored?.request.sourceMessageId,
      rewriteDraft: stored?.request.rewriteDraft,
    },
    origin: input.origin,
    ...(input.mode === 'retry' ? { retryOfRunId: previous.id } : { resumeOfRunId: previous.id }),
  });
}

function inferChatRunKind(briefStatus: string | null, content: string): AgentRunKind {
  if (briefStatus !== 'confirmed') return 'brief-resolution';
  if (shouldRunDirectorDiagnosis(content)) return 'project-diagnosis';
  return 'change-proposal';
}

async function findRunUserMessageId(request: AgentActionRequest, runId: string): Promise<string | undefined> {
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { startedAt: true } });
  if (!run?.startedAt) return undefined;
  const message = await prisma.message.findFirst({
    where: {
      projectId: request.projectId,
      role: 'user',
      content: request.content,
      createdAt: { gte: run.startedAt },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return message?.id;
}

function readStoredActionContext(value: unknown): StoredActionContext | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoredActionContext>;
  return candidate.version === 'agent-action-context-v1' && candidate.request && Array.isArray(candidate.request.attachmentIds)
    ? candidate as StoredActionContext
    : null;
}

function sanitizeRunError(value: unknown): string {
  const message = typeof value === 'string' ? value.trim() : '';
  return (message || '任务执行失败').slice(0, 500);
}

function serializeAgentRun(run: any) {
  return {
    id: run.id,
    projectId: run.projectId,
    kind: run.kind,
    status: run.status,
    summary: run.summary,
    clientRequestId: run.clientRequestId,
    userMessageId: run.userMessageId,
    retryOfRunId: run.retryOfRunId,
    resumeOfRunId: run.resumeOfRunId,
    requestedAt: run.requestedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
    tasks: (run.tasks ?? []).map((task: any) => ({
      id: task.id,
      taskKey: task.taskKey,
      role: task.role,
      frameId: task.frameId,
      status: task.status,
      attempt: task.attempt,
      maxAttempts: task.maxAttempts,
      errorCode: task.errorCode,
      errorMessage: task.errorMessage,
    })),
  };
}
