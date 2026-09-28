export type GenerationMode = 'image' | 'html';
export type GenerationPhase = 'prepare' | 'image_plan' | 'image_search' | 'image_download' | 'image' | 'tts' | 'html' | 'save' | 'done';
export type GenerationStatus = 'preparing' | 'generating' | 'saving' | 'completed' | 'partial_failed' | 'aborted';

export interface GenerationEvent {
  mode: GenerationMode;
  total: number;
  current: number;
  frameId?: string;
  phase: GenerationPhase;
  status: GenerationStatus;
  percent: number;
  startedAt: string;
  phaseStartedAt?: string;
  phaseEndedAt?: string;
  skipped?: boolean;
  failed?: boolean;
  message?: string;
}

export const PHASES: Record<GenerationMode, GenerationPhase[]> = {
  image: ['image', 'tts', 'save'],
  html: ['image_plan', 'image_search', 'image_download', 'tts', 'html', 'save'],
};

export const PHASE_WEIGHTS: Record<GenerationMode, Partial<Record<GenerationPhase, number>>> = {
  image: { image: 0.68, tts: 0.24, save: 0.08 },
  html: { image_plan: 0.03, image_search: 0.08, image_download: 0.07, tts: 0.12, html: 0.63, save: 0.07 },
};

export const DEFAULT_PHASE_SECONDS: Record<GenerationMode, Partial<Record<GenerationPhase, number>>> = {
  image: { image: 45, tts: 8, save: 2 },
  html: { image_plan: 4, image_search: 8, image_download: 8, tts: 8, html: 55, save: 2 },
};

export type DurationHistory = Partial<Record<GenerationMode, Partial<Record<GenerationPhase, number>>>>;

export function progressPercent(mode: GenerationMode, total: number, frameIndex: number, phase: GenerationPhase, phaseComplete = false): number {
  if (phase === 'done') return 100;
  if (total <= 0) return 0;
  const weights = PHASE_WEIGHTS[mode];
  const phases = PHASES[mode];
  const prior = phases.slice(0, Math.max(0, phases.indexOf(phase))).reduce((sum, item) => sum + (weights[item] || 0), 0);
  const withinFrame = prior + (phaseComplete ? (weights[phase] || 0) : 0);
  return clamp(Math.round(((Math.max(0, frameIndex) + withinFrame) / total) * 100), 0, 99);
}

/**
 * Aggregate independently progressing frame pipelines into one monotonic value.
 * Each entry is the completed phase weight for one frame, in the 0..1 range.
 */
export function aggregateProgressPercent(frameProgress: readonly number[], total: number): number {
  if (total <= 0) return 0;
  const completedWeight = frameProgress.reduce((sum, value) => sum + clamp(value, 0, 1), 0);
  return clamp(Math.round((completedWeight / total) * 100), 0, 99);
}

export function phaseProgressWeight(mode: GenerationMode, phase: GenerationPhase, phaseComplete = false): number {
  if (phase === 'done') return 1;
  const phases = PHASES[mode];
  const weights = PHASE_WEIGHTS[mode];
  const phaseIndex = phases.indexOf(phase);
  if (phaseIndex < 0) return 0;
  const prior = phases.slice(0, phaseIndex).reduce((sum, item) => sum + (weights[item] || 0), 0);
  return clamp(prior + (phaseComplete ? (weights[phase] || 0) : 0), 0, 1);
}

export function updateDurationHistory(history: DurationHistory, mode: GenerationMode, phase: GenerationPhase, seconds: number, alpha = 0.25): DurationHistory {
  if (!Number.isFinite(seconds) || seconds <= 0 || !PHASES[mode].includes(phase)) return history;
  const previous = history[mode]?.[phase];
  const smoothed = previous == null ? seconds : previous * (1 - alpha) + seconds * alpha;
  return { ...history, [mode]: { ...history[mode], [phase]: Math.round(smoothed * 10) / 10 } };
}

export function estimateRemainingSeconds(opts: {
  mode: GenerationMode;
  total: number;
  currentFrame: number;
  phase: GenerationPhase;
  phaseElapsedSeconds?: number;
  history?: DurationHistory;
}): number {
  const { mode, total, phase, history = {} } = opts;
  if (phase === 'done' || total <= 0) return 0;
  const phases = PHASES[mode];
  const phaseIndex = Math.max(0, phases.indexOf(phase));
  const duration = (item: GenerationPhase) => history[mode]?.[item] ?? DEFAULT_PHASE_SECONDS[mode][item] ?? 0;
  const currentRemaining = Math.max(0, duration(phase) - (opts.phaseElapsedSeconds || 0));
  const restOfFrame = phases.slice(phaseIndex + 1).reduce((sum, item) => sum + duration(item), 0);
  const laterFrames = Math.max(0, total - Math.max(1, opts.currentFrame));
  const fullFrame = phases.reduce((sum, item) => sum + duration(item), 0);
  return Math.max(0, Math.round(currentRemaining + restOfFrame + laterFrames * fullFrame));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
