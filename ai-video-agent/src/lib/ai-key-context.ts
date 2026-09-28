import { AsyncLocalStorage } from 'async_hooks';
import { aiKeyStore, type AIKeySnapshot } from '@/lib/ai-key-store';
import type { ProjectWorkflow } from '@/types';
import {
  resolveProjectGPTOptimization,
  type GPTOptimizationSettings,
  type ProjectGPTOptimizationConfig,
} from '@/lib/gpt-optimization-settings';
import { PROJECT_WORKFLOW, RETIRED_WORKFLOW_MESSAGE } from '@/lib/project-workflow';

export type AITransportPolicy = 'gpt-free-codex';

interface AIRequestContext {
  credential: AIKeySnapshot;
  transportPolicy: AITransportPolicy;
}

const aiKeyContext = new AsyncLocalStorage<AIRequestContext>();

export async function getTaskAIKeySnapshot(): Promise<AIKeySnapshot> {
  const existing = aiKeyContext.getStore();
  if (existing) return existing.credential;

  const snapshot = await aiKeyStore.getActiveSnapshot();
  aiKeyContext.enterWith({ credential: snapshot, transportPolicy: 'gpt-free-codex' });
  return snapshot;
}

export async function runWithActiveAIKey<T>(task: () => Promise<T>): Promise<T> {
  const existing = aiKeyContext.getStore();
  if (existing) return task();
  const snapshot = await aiKeyStore.getActiveSnapshot();
  return aiKeyContext.run({ credential: snapshot, transportPolicy: 'gpt-free-codex' }, task);
}

export function runWithAIKeySnapshot<T>(snapshot: AIKeySnapshot, task: () => T): T {
  return aiKeyContext.run({ credential: snapshot, transportPolicy: 'gpt-free-codex' }, task);
}

export function getCurrentAIKeySnapshot(): AIKeySnapshot | undefined {
  return aiKeyContext.getStore()?.credential;
}

export function getCurrentAITransportPolicy(): AITransportPolicy {
  return aiKeyContext.getStore()?.transportPolicy ?? 'gpt-free-codex';
}

export function isGPTOptimizationEnabled(): boolean {
  return aiKeyContext.getStore()?.credential.gptOptimization.enabled === true;
}

export function getCurrentGPTOptimizationSettings(): GPTOptimizationSettings | undefined {
  return aiKeyContext.getStore()?.credential.gptOptimization;
}

/** Apply a request-local project override without touching the saved key or non-GPT behavior. */
export function applyProjectGPTOptimizationOverride(
  projectSettings?: ProjectGPTOptimizationConfig | null,
): AIKeySnapshot | undefined {
  const current = aiKeyContext.getStore();
  if (!current) return undefined;
  const next = {
    ...current.credential,
    gptOptimization: resolveProjectGPTOptimization(current.credential.gptOptimization, projectSettings),
  };
  // Mutate the request-owned context object so callers keep the replacement
  // after this helper returns. enterWith() after an awaited helper only affects
  // that helper's continuation and restores the caller's previous store.
  current.credential = next;
  return next;
}

/**
 * Applies the GPT-free transport policy to the Key Manager's current active
 * credential. Projects deliberately carry no Key or model binding, so a
 * changed active configuration takes effect on the next project request.
 */
export async function applyProjectAIContext(
  workflow: ProjectWorkflow | string | null | undefined,
): Promise<AIKeySnapshot> {
  if (workflow !== PROJECT_WORKFLOW) throw new Error(RETIRED_WORKFLOW_MESSAGE);
  const snapshot = await getTaskAIKeySnapshot();
  const configured: AIKeySnapshot = {
    ...snapshot,
    gptOptimization: {
      ...snapshot.gptOptimization,
      enabled: true,
      reasoningProfile: 'quality',
      creativeFreedom: 'open',
      internalImageSearch: false,
    },
  };
  const current = aiKeyContext.getStore();
  if (current) {
    current.credential = configured;
    current.transportPolicy = 'gpt-free-codex';
  } else {
    aiKeyContext.enterWith({ credential: configured, transportPolicy: 'gpt-free-codex' });
  }
  return configured;
}
