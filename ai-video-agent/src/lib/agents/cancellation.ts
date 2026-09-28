const globalRunControllers = globalThis as typeof globalThis & {
  __agentRunAbortControllers?: Map<string, AbortController>;
};

const runAbortControllers = globalRunControllers.__agentRunAbortControllers ??= new Map<string, AbortController>();

export function registerAgentRunAbortController(runId: string, controller = new AbortController()): AbortController {
  runAbortControllers.set(runId, controller);
  return controller;
}

export function unregisterAgentRunAbortController(runId: string, controller?: AbortController): void {
  if (!controller || runAbortControllers.get(runId) === controller) runAbortControllers.delete(runId);
}

export function cancelAgentRun(runId: string, reason = '用户要求停止任务'): boolean {
  const controller = runAbortControllers.get(runId);
  if (!controller) return false;
  if (!controller.signal.aborted) controller.abort(new DOMException(reason, 'AbortError'));
  return true;
}

export function getAgentRunAbortSignal(runId: string): AbortSignal | undefined {
  return runAbortControllers.get(runId)?.signal;
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: string; code?: string; message?: string };
  return candidate.name === 'AbortError'
    || candidate.code === 'ABORT_ERR';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

export function rethrowIfAborted(error: unknown, signal?: AbortSignal): void {
  if (!isAbortError(error, signal)) return;
  if (error instanceof Error) throw error;
  throwIfAborted(signal);
  throw new DOMException('The operation was aborted.', 'AbortError');
}
