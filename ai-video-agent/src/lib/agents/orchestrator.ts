import { runWithAgentExecutionContext } from './context';
import type {
  AgentArtifact,
  AgentDiagnostic,
  AgentRunSummary,
  AgentTaskResult,
  AgentTaskSpec,
} from './types';

export interface AgentTaskContext {
  runId: string;
  taskId: string;
  abortSignal?: AbortSignal;
  getArtifact<T = unknown>(taskId: string): AgentArtifact<T> | undefined;
}

export interface ExecutableAgentTask extends AgentTaskSpec {
  execute(context: AgentTaskContext): Promise<AgentArtifact>;
  shouldRun?(context: AgentTaskContext): boolean;
}

export interface AgentGraphHooks {
  taskQueued?(task: AgentTaskSpec): Promise<void> | void;
  taskStarted?(task: AgentTaskSpec, attempt: number, startedAt: string): Promise<void> | void;
  taskFinished?(task: AgentTaskSpec, result: AgentTaskResult): Promise<void> | void;
  resolveReusable?(task: AgentTaskSpec): Promise<AgentArtifact | undefined>;
}

export interface AgentGraphResult {
  results: Map<string, AgentTaskResult>;
  artifacts: Map<string, AgentArtifact>;
  summary: AgentRunSummary;
}

export async function runAgentGraph(options: {
  runId: string;
  tasks: ExecutableAgentTask[];
  concurrency?: number;
  abortSignal?: AbortSignal;
  hooks?: AgentGraphHooks;
}): Promise<AgentGraphResult> {
  validateGraph(options.tasks);
  const tasksById = new Map(options.tasks.map(task => [task.id, task]));
  const pending = new Set(tasksById.keys());
  const running = new Map<string, Promise<{ taskId: string; result: AgentTaskResult }>>();
  const results = new Map<string, AgentTaskResult>();
  const artifacts = new Map<string, AgentArtifact>();
  const concurrency = Math.max(1, Math.min(Math.floor(options.concurrency ?? 2), options.tasks.length || 1));

  await Promise.all(options.tasks.map(task => options.hooks?.taskQueued?.(task)));

  while (pending.size || running.size) {
    if (options.abortSignal?.aborted) {
      for (const taskId of pending) {
        const task = tasksById.get(taskId)!;
        const result = terminalResult(task, 'cancelled', [{
          code: 'RUN_CANCELLED',
          message: '任务在启动前被取消',
          severity: 'warning',
        }]);
        results.set(taskId, result);
        await options.hooks?.taskFinished?.(task, result);
      }
      pending.clear();
    }

    let scheduled = false;
    for (const taskId of Array.from(pending)) {
      if (running.size >= concurrency || options.abortSignal?.aborted) break;
      const task = tasksById.get(taskId)!;
      const dependencyResults = task.dependencies.map(id => results.get(id));
      if (dependencyResults.some(result => !result)) continue;

      pending.delete(taskId);
      const failedDependency = dependencyResults.find(result =>
        result && ['failed', 'cancelled', 'interrupted'].includes(result.status),
      );
      const context = createTaskContext(options.runId, task, artifacts, options.abortSignal);
      if (failedDependency && !task.allowFailedDependencies) {
        const result = terminalResult(task, 'skipped', [{
          code: 'DEPENDENCY_FAILED',
          message: `依赖任务 ${failedDependency.taskId} 未成功`,
          severity: 'warning',
        }]);
        results.set(taskId, result);
        await options.hooks?.taskFinished?.(task, result);
        scheduled = true;
        continue;
      }
      if (task.shouldRun && !task.shouldRun(context)) {
        const result = terminalResult(task, 'skipped', [{
          code: 'CONDITION_NOT_MET',
          message: '任务条件未满足',
          severity: 'info',
        }]);
        results.set(taskId, result);
        await options.hooks?.taskFinished?.(task, result);
        scheduled = true;
        continue;
      }

      const promise = executeTask(task, context, options.hooks).then(result => ({ taskId, result }));
      running.set(taskId, promise);
      scheduled = true;
    }

    if (!running.size) {
      if (!pending.size) break;
      if (!scheduled) {
        throw new Error(`Agent task graph is blocked: ${Array.from(pending).join(', ')}`);
      }
      continue;
    }

    const settled = await Promise.race(running.values());
    running.delete(settled.taskId);
    results.set(settled.taskId, settled.result);
    if (settled.result.artifact) artifacts.set(settled.taskId, settled.result.artifact);
  }

  return { results, artifacts, summary: summarizeResults(results) };
}

export async function runRecordedAgentTask<T>(options: {
  runId: string;
  task: AgentTaskSpec;
  execute: (context: AgentTaskContext) => Promise<AgentArtifact<T>>;
  abortSignal?: AbortSignal;
  hooks?: AgentGraphHooks;
  /** Shared per-run artifact store; required when dependencies are declared. */
  artifacts?: Map<string, AgentArtifact>;
}): Promise<AgentTaskResult<T>> {
  const artifacts = options.artifacts || new Map<string, AgentArtifact>();
  const missingDependencies = options.task.dependencies.filter(dependency => !artifacts.has(dependency));
  if (missingDependencies.length) {
    throw new Error(`Agent task ${options.task.id} started before dependencies completed: ${missingDependencies.join(', ')}`);
  }
  await options.hooks?.taskQueued?.(options.task);
  const result = await executeTask(
    { ...options.task, execute: options.execute },
    createTaskContext(options.runId, options.task, artifacts, options.abortSignal),
    options.hooks,
  );
  if (result.status !== 'completed' && result.status !== 'reused') {
    const error = new Error(result.diagnostics[0]?.message || 'Agent task failed');
    Object.assign(error, { agentTaskResult: result });
    throw error;
  }
  if (result.artifact) artifacts.set(options.task.id, cloneArtifact(result.artifact));
  return result as AgentTaskResult<T>;
}

export function createSerialCommitter() {
  let queue: Promise<void> = Promise.resolve();
  return function commit<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
}

async function executeTask(
  task: ExecutableAgentTask,
  context: AgentTaskContext,
  hooks?: AgentGraphHooks,
): Promise<AgentTaskResult> {
  const reusable = task.allowReuse ? await hooks?.resolveReusable?.(task) : undefined;
  if (reusable) {
    const result: AgentTaskResult = {
      taskId: task.id,
      role: task.role,
      status: 'reused',
      attempts: 0,
      artifact: cloneArtifact(reusable),
      diagnostics: [],
      finishedAt: new Date().toISOString(),
    };
    await hooks?.taskFinished?.(task, result);
    return result;
  }

  const maxAttempts = Math.max(1, task.maxAttempts ?? 1);
  const diagnostics: AgentDiagnostic[] = [];
  const startedAt = new Date().toISOString();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (context.abortSignal?.aborted) {
      const result = terminalResult(task, 'cancelled', [{
        code: 'RUN_CANCELLED',
        message: '任务已取消',
        severity: 'warning',
      }], attempt - 1, startedAt);
      await hooks?.taskFinished?.(task, result);
      return result;
    }

    await hooks?.taskStarted?.(task, attempt, startedAt);
    try {
      const artifact = await runWithAgentExecutionContext({
        runId: context.runId,
        taskId: task.id,
        agentRole: task.role,
      }, () => task.execute(context));
      const result: AgentTaskResult = {
        taskId: task.id,
        role: task.role,
        status: 'completed',
        attempts: attempt,
        artifact: cloneArtifact(artifact),
        diagnostics,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      await hooks?.taskFinished?.(task, result);
      return result;
    } catch (error) {
      const retryable = isRetryableAgentError(error);
      diagnostics.push({
        code: errorCode(error),
        message: safeErrorMessage(error),
        severity: 'error',
        retryable,
      });
      if (!retryable || attempt >= maxAttempts) {
        const status = context.abortSignal?.aborted ? 'cancelled' : 'failed';
        const result = terminalResult(task, status, diagnostics, attempt, startedAt);
        await hooks?.taskFinished?.(task, result);
        return result;
      }
      await abortableDelay(Math.min(250 * 2 ** (attempt - 1), 1_000), context.abortSignal);
    }
  }
  throw new Error('Unreachable agent task state');
}

function createTaskContext(
  runId: string,
  task: AgentTaskSpec,
  artifacts: Map<string, AgentArtifact>,
  abortSignal?: AbortSignal,
): AgentTaskContext {
  return {
    runId,
    taskId: task.id,
    abortSignal,
    getArtifact<T>(taskId: string) {
      const artifact = artifacts.get(taskId);
      return artifact ? cloneArtifact(artifact) as AgentArtifact<T> : undefined;
    },
  };
}

function terminalResult(
  task: AgentTaskSpec,
  status: AgentTaskResult['status'],
  diagnostics: AgentDiagnostic[],
  attempts = 0,
  startedAt?: string,
): AgentTaskResult {
  return {
    taskId: task.id,
    role: task.role,
    status,
    attempts,
    diagnostics,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function summarizeResults(results: Map<string, AgentTaskResult>): AgentRunSummary {
  const values = Array.from(results.values());
  return {
    completed: values.filter(result => result.status === 'completed').length,
    failed: values.filter(result => result.status === 'failed').length,
    skipped: values.filter(result => result.status === 'skipped').length,
    cancelled: values.filter(result => result.status === 'cancelled').length,
    reused: values.filter(result => result.status === 'reused').length,
  };
}

function validateGraph(tasks: ExecutableAgentTask[]) {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error(`Duplicate agent task id: ${task.id}`);
    ids.add(task.id);
  }
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency)) throw new Error(`Unknown dependency ${dependency} for task ${task.id}`);
      if (dependency === task.id) throw new Error(`Task ${task.id} depends on itself`);
    }
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const byId = new Map(tasks.map(task => [task.id, task]));
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Agent task graph contains a cycle at ${id}`);
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

function cloneArtifact<T>(artifact: AgentArtifact<T>): AgentArtifact<T> {
  return typeof structuredClone === 'function'
    ? structuredClone(artifact)
    : JSON.parse(JSON.stringify(artifact)) as AgentArtifact<T>;
}

function isRetryableAgentError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { retryable?: boolean; status?: number; code?: string; name?: string; message?: string };
  if (typeof candidate.retryable === 'boolean') return candidate.retryable;
  if (candidate.name === 'AbortError') return false;
  if (candidate.status === 408 || candidate.status === 409 || candidate.status === 429 || (candidate.status ?? 0) >= 500) return true;
  if (candidate.code && /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|RATE_LIMIT/i.test(candidate.code)) return true;
  // An upstream relay can abort an individual request without the user cancelling
  // the enclosing agent run. Treat that as a transient transport failure; genuine
  // cancellation is handled above via the task's AbortSignal / AbortError name.
  return /timeout|timed out|rate limit|temporar|connection reset|request was aborted|JSON.*parse/i.test(candidate.message || '');
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 2_000);
  return String(error).slice(0, 2_000);
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code.slice(0, 100);
  }
  return error instanceof Error ? error.name : 'AGENT_TASK_ERROR';
}

async function abortableDelay(ms: number, signal?: AbortSignal) {
  if (!signal) {
    await new Promise(resolve => setTimeout(resolve, ms));
    return;
  }
  if (signal.aborted) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
  });
}
