import { createHash } from 'crypto';
import { getCurrentAIKeySnapshot } from '@/lib/ai-key-context';
import { AGENT_PIPELINE_VERSION } from './types';

export function createAgentInputHash(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

export function createAgentTaskInputHash(value: unknown): string {
  const credential = getCurrentAIKeySnapshot();
  return createAgentInputHash({
    pipelineVersion: AGENT_PIPELINE_VERSION,
    credential: credential ? {
      id: credential.id,
      baseURL: credential.baseURL,
      model: credential.model,
      gptOptimization: credential.gptOptimization,
    } : null,
    value,
  });
}

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`);
  return `{${entries.join(',')}}`;
}
