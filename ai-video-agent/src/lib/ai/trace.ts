import { AsyncLocalStorage } from 'async_hooks';
import { getCurrentAgentExecutionContext } from '@/lib/agents/context';

export interface AITraceEvent {
  id: string;
  stage: string;
  model: string;
  configuredModel?: string;
  actualModel?: string;
  apiMode?: 'chat.completions' | 'responses';
  relayBaseURL?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  requestedReasoningEffort?: 'low' | 'medium' | 'high';
  responseId?: string;
  responseStatus?: string;
  terminationMode?: 'response.completed' | 'done' | 'eof' | 'failed' | 'aborted';
  downgradeReason?: string;
  /** Input image shown as an in-memory thumbnail while the local server is running. */
  visualInputs?: Array<{
    label?: string;
    mimeType?: string;
    byteLength?: number;
    thumbnailDataUrl?: string;
  }>;
  system: string;
  user: string;
  reasoning: string | null;
  output: string | null;
  startedAt: string;
  durationMs: number;
  attempt: number;
  maxAttempts: number;
  tokens?: { prompt?: number; completion?: number; total?: number };
  finishReason?: string | null;
  outputLength?: number;
  reasoningLength?: number;
  error?: string;
  runId?: string;
  taskId?: string;
  agentRole?: string;
  category?: string;
  pipelineVersion?: string;
  /** Project scope for the local, in-process history view. */
  projectId?: string;
}

type TraceListener = (event: AITraceEvent) => void;

const MAX_PROJECT_TRACE_EVENTS = 100;

const projectTraceContext = new AsyncLocalStorage<{ projectId: string }>();

const globalTrace = globalThis as typeof globalThis & {
  __aiTraceListeners?: Set<TraceListener>;
  __projectAITraceHistory?: Map<string, AITraceEvent[]>;
};

const listeners = globalTrace.__aiTraceListeners ?? new Set<TraceListener>();
globalTrace.__aiTraceListeners = listeners;
const projectTraceHistory = globalTrace.__projectAITraceHistory ?? new Map<string, AITraceEvent[]>();
globalTrace.__projectAITraceHistory = projectTraceHistory;

export function publishAITrace(event: AITraceEvent) {
  const context = getCurrentAgentExecutionContext();
  const projectId = event.projectId ?? projectTraceContext.getStore()?.projectId;
  const enriched: AITraceEvent = {
    ...event,
    ...(context ?? {}),
    ...(projectId ? { projectId } : {}),
  };

  if (projectId) {
    const history = projectTraceHistory.get(projectId) ?? [];
    history.push(enriched);
    if (history.length > MAX_PROJECT_TRACE_EVENTS) history.splice(0, history.length - MAX_PROJECT_TRACE_EVENTS);
    projectTraceHistory.set(projectId, history);
  }

  for (const listener of listeners) listener(enriched);
}

/** Binds downstream AI calls to one project without changing every provider API. */
export function runWithAITraceProjectContext<T>(projectId: string, operation: () => T): T {
  return projectTraceContext.run({ projectId }, operation);
}

/** Latest local-server AI calls for a project. Image data is never retained. */
export function getProjectAITraceHistory(projectId: string): AITraceEvent[] {
  return [...(projectTraceHistory.get(projectId) ?? [])];
}

export function subscribeAITrace(listener: TraceListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isLocalDebugRequest(headers: Headers): boolean {
  const host = (headers.get('host') || '').split(':')[0].replace(/^\[|\]$/g, '');
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0].trim();
  const localHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const localPeer = !forwarded || forwarded === '127.0.0.1' || forwarded === '::1';
  return localHost && localPeer;
}
