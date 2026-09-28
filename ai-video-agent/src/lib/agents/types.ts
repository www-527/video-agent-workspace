export type LegacyAgentRole =
  | 'orchestrator'
  | 'research'
  | 'creative-brief'
  | 'script'
  | 'content-reviewer'
  | 'script-reviser'
  | 'director'
  | 'asset-planner'
  | 'audio'
  | 'asset'
  | 'visual-composer'
  | 'frame-reviewer'
  | 'repair'
  | 'image-generation';

export type AIAgentRole =
  | 'content-planner'
  | 'content-quality'
  | 'director'
  | 'visual-composer';

export type AISupportRole =
  | 'intent-classifier'
  | 'research-planner';

export type WorkerRole =
  | 'research-search'
  | 'tts'
  | 'asset';

export type SystemRole =
  | 'intent-router'
  | 'scheduler'
  | 'asset-planner'
  | 'image-resolver'
  | 'ui-scene-renderer'
  | 'validator'
  | 'committer'
  | 'persistence';

/**
 * Persisted records intentionally accept legacy role strings. New pipelines
 * only schedule the compact roles above, while old AgentTask rows remain
 * readable without a data migration.
 */
export type PersistedRole =
  | LegacyAgentRole
  | AIAgentRole
  | AISupportRole
  | WorkerRole
  | SystemRole;

export type AgentRole = PersistedRole;
export type AgentCategory = 'ai-agent' | 'ai-support' | 'worker' | 'system' | 'legacy';

export const AGENT_PIPELINE_VERSION = 'compact-v2';

const AI_AGENT_ROLES = new Set<PersistedRole>([
  'content-planner',
  'content-quality',
  'director',
  'visual-composer',
]);
const AI_SUPPORT_ROLES = new Set<PersistedRole>(['intent-classifier', 'research-planner']);
const WORKER_ROLES = new Set<PersistedRole>(['research-search', 'tts', 'asset']);
const SYSTEM_ROLES = new Set<PersistedRole>([
  'intent-router',
  'scheduler',
  'asset-planner',
  'image-resolver',
  'ui-scene-renderer',
  'validator',
  'committer',
  'persistence',
]);

export function classifyAgentRole(role: PersistedRole): AgentCategory {
  if (AI_AGENT_ROLES.has(role)) return 'ai-agent';
  if (AI_SUPPORT_ROLES.has(role)) return 'ai-support';
  if (WORKER_ROLES.has(role)) return 'worker';
  if (SYSTEM_ROLES.has(role)) return 'system';
  return 'legacy';
}

export type AgentRunKind =
  | 'asset-processing'
  | 'brief-resolution'
  | 'outline'
  | 'frame-generation'
  | 'project-diagnosis'
  | 'change-proposal'
  | 'change-application'
  | 'project-restore';

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'partial_failed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type AgentTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'reused'
  | 'interrupted';

export interface AgentDiagnostic {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface AgentArtifact<T = unknown> {
  kind: string;
  data: T;
  summary?: string;
  createdAt: string;
}

export interface AgentTaskSpec {
  id: string;
  role: AgentRole;
  dependencies: string[];
  inputHash: string;
  frameId?: string;
  maxAttempts?: number;
  allowFailedDependencies?: boolean;
  allowReuse?: boolean;
}

export interface AgentTaskResult<T = unknown> {
  taskId: string;
  role: AgentRole;
  status: AgentTaskStatus;
  attempts: number;
  artifact?: AgentArtifact<T>;
  diagnostics: AgentDiagnostic[];
  startedAt?: string;
  finishedAt: string;
}

export interface AgentRunSummary {
  completed: number;
  failed: number;
  skipped: number;
  cancelled: number;
  reused: number;
}
