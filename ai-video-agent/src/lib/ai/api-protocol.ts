import type { AIAPIProtocol, AIKeySnapshot } from '@/lib/ai-key-store';

export type ResolvedAIAPIProtocol = Exclude<AIAPIProtocol, 'auto'>;

/** Resolves provider transport independently from creative GPT behavior. */
export function resolvePreferredAPIProtocol(credential: AIKeySnapshot): ResolvedAIAPIProtocol {
  if (credential.apiProtocol === 'responses') return 'responses';
  if (credential.apiProtocol === 'chat.completions') return 'chat.completions';
  return credential.gptOptimization.enabled && credential.gptOptimization.useResponsesAPI
    ? 'responses'
    : 'chat.completions';
}

export function isAutomaticAPIProtocol(credential: AIKeySnapshot): boolean {
  return credential.apiProtocol === 'auto';
}
