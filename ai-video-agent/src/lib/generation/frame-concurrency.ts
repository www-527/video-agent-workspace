import { PROJECT_WORKFLOW } from '@/lib/project-workflow';

export const MIN_GPT_FREE_FRAME_CONCURRENCY = 1;
export const DEFAULT_FRAME_GENERATION_CONCURRENCY = 2;
export const MAX_GPT_FREE_FRAME_CONCURRENCY = 5;
export const GPT_FREE_FRAME_CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5] as const;

interface FrameGenerationConcurrencyOptions {
  workflow: string | null | undefined;
  sampleOnly: boolean;
  targetFrameCount: number;
  configuredGPTFreeConcurrency?: string | number | null;
}

/**
 * Limits whole-frame work, rather than individual upstream requests. GPT-free
 * frames are independent once the outline has been approved. The configured
 * worker count is bounded to the range exposed in Settings so a malformed
 * client cannot create an unbounded request burst. First-frame samples
 * intentionally remain serial.
 */
export function resolveFrameGenerationConcurrency(
  options: FrameGenerationConcurrencyOptions,
): number {
  const targetFrameCount = Math.max(0, Math.floor(options.targetFrameCount));
  if (!targetFrameCount) return 0;
  if (options.sampleOnly) return 1;

  const requested = options.workflow === PROJECT_WORKFLOW
    ? parseGPTFreeConcurrency(options.configuredGPTFreeConcurrency)
    : DEFAULT_FRAME_GENERATION_CONCURRENCY;
  return Math.min(targetFrameCount, requested);
}

function parseGPTFreeConcurrency(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') {
    return DEFAULT_FRAME_GENERATION_CONCURRENCY;
  }
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized === '') return DEFAULT_FRAME_GENERATION_CONCURRENCY;
  const parsed = typeof normalized === 'number' ? normalized : Number(normalized);
  if (!Number.isInteger(parsed)) return DEFAULT_FRAME_GENERATION_CONCURRENCY;
  return Math.min(MAX_GPT_FREE_FRAME_CONCURRENCY, Math.max(MIN_GPT_FREE_FRAME_CONCURRENCY, parsed));
}
