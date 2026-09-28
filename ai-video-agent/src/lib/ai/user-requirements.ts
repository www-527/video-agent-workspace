import type { Outline } from '@/types';

export interface DurationRequirement {
  kind: 'exact' | 'range';
  minSeconds: number;
  maxSeconds: number;
  targetSeconds?: number;
  source: string;
}

const DURATION_UNIT = '(?:秒钟?|分钟?|小时|钟头|secs?(?![A-Za-z])|seconds?(?![A-Za-z])|s(?![A-Za-z])|mins?(?![A-Za-z])|minutes?(?![A-Za-z])|hours?(?![A-Za-z])|hrs?(?![A-Za-z])|h(?![A-Za-z]))';
const DURATION_RANGE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:-|~|～|—|到|至)\\s*(\\d+(?:\\.\\d+)?)\\s*(${DURATION_UNIT})`, 'i');
const DURATION_EXACT = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${DURATION_UNIT})`, 'i');
const MINUTE_SECOND = /(\d+(?:\.\d+)?)\s*分(?:钟)?\s*(\d+(?:\.\d+)?)\s*秒/i;

function toSeconds(value: number, unit: string): number {
  if (/小时|钟头|hours?|hrs?|^h$/i.test(unit)) return value * 3_600;
  if (/分钟?|mins?|minutes?/i.test(unit)) return value * 60;
  return value;
}

function saneSeconds(value: number): number {
  return Math.max(3, Math.min(7_200, Math.round(value)));
}

/** Extract only explicit time units so content numbers and requested frame counts are never mistaken for duration. */
export function extractDurationRequirement(userInput: string): DurationRequirement | null {
  const compound = userInput.match(MINUTE_SECOND);
  if (compound) {
    const seconds = saneSeconds(Number(compound[1]) * 60 + Number(compound[2]));
    return { kind: 'exact', minSeconds: seconds, maxSeconds: seconds, targetSeconds: seconds, source: compound[0] };
  }

  const range = userInput.match(DURATION_RANGE);
  if (range) {
    const first = saneSeconds(toSeconds(Number(range[1]), range[3]));
    const second = saneSeconds(toSeconds(Number(range[2]), range[3]));
    return {
      kind: 'range',
      minSeconds: Math.min(first, second),
      maxSeconds: Math.max(first, second),
      source: range[0],
    };
  }

  const exact = userInput.match(DURATION_EXACT);
  if (!exact) return null;
  const seconds = saneSeconds(toSeconds(Number(exact[1]), exact[2]));
  return { kind: 'exact', minSeconds: seconds, maxSeconds: seconds, targetSeconds: seconds, source: exact[0] };
}

export function resolveRequestedDuration(modelDuration: number, requirement: DurationRequirement | null): number {
  const fallback = Number.isFinite(modelDuration) && modelDuration > 0 ? Math.round(modelDuration) : 60;
  if (!requirement) return fallback;
  if (requirement.kind === 'exact') return requirement.targetSeconds!;
  return Math.max(requirement.minSeconds, Math.min(requirement.maxSeconds, fallback));
}

export function formatDurationRequirement(requirement: DurationRequirement | null): string {
  if (!requirement) return '用户未明确指定时长：根据内容量规划，默认 60-300 秒。';
  if (requirement.kind === 'exact') {
    return `用户明确要求总时长 ${requirement.targetSeconds} 秒：这是硬约束，totalDuration 必须精确等于该值，逐字稿篇幅和分镜数量必须匹配。`;
  }
  return `用户明确要求总时长 ${requirement.minSeconds}-${requirement.maxSeconds} 秒：这是硬约束，totalDuration、逐字稿篇幅和分镜数量必须落在该区间。`;
}

export function estimateNarrationSeconds(script: string): number {
  const han = script.match(/[\p{Script=Han}]/gu)?.length || 0;
  const latinWords = script.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length || 0;
  const pauses = script.match(/[，。！？；,.!?;]/g)?.length || 0;
  return han / 3.5 + latinWords / 2.5 + pauses * 0.12;
}

/**
 * Flag only a narration that cannot plausibly fit the chosen runtime. This
 * deliberately does not prescribe scene count, structure, or visual language.
 */
export function needsNarrationDurationCalibration(script: string, totalDuration: number): boolean {
  if (!script.trim() || !Number.isFinite(totalDuration) || totalDuration <= 0) return false;
  const estimated = estimateNarrationSeconds(script);
  return estimated < totalDuration * 0.85 || estimated > totalDuration * 1.15;
}

/**
 * Reconcile the director's per-scene playback hints with the outline runtime.
 * It only affects the schedule used when no TTS duration is available.
 */
export function calibrateOutlineSceneDurations(outline: Outline): Outline {
  const frameCount = outline.frames.length;
  const target = Math.round(outline.totalDuration);
  const minimum = 3;
  const maximum = 20;
  if (!frameCount || target < frameCount * minimum || target > frameCount * maximum) return outline;
  if (outline.frames.some(frame => !frame.sceneSpec)) return outline;

  const weights = outline.frames.map(frame => Math.max(1, estimateNarrationSeconds(frame.narration)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!totalWeight) return outline;

  const ideal = weights.map(weight => (weight / totalWeight) * target);
  const durations = ideal.map(value => Math.max(minimum, Math.min(maximum, Math.floor(value))));
  let difference = target - durations.reduce((sum, duration) => sum + duration, 0);

  while (difference > 0) {
    const candidate = durations
      .map((duration, index) => ({ index, remainder: ideal[index] - duration, duration }))
      .filter(item => item.duration < maximum)
      .sort((left, right) => right.remainder - left.remainder || left.index - right.index)[0];
    if (!candidate) return outline;
    durations[candidate.index] += 1;
    difference -= 1;
  }
  while (difference < 0) {
    const candidate = durations
      .map((duration, index) => ({ index, remainder: ideal[index] - duration, duration }))
      .filter(item => item.duration > minimum)
      .sort((left, right) => left.remainder - right.remainder || right.index - left.index)[0];
    if (!candidate) return outline;
    durations[candidate.index] -= 1;
    difference += 1;
  }

  return {
    ...outline,
    frames: outline.frames.map((frame, index) => ({
      ...frame,
      sceneSpec: { ...frame.sceneSpec!, durationHint: durations[index] },
    })),
  };
}

export function auditRequirementAlignment(input: {
  userInput: string;
  totalDuration: number;
  script: string;
  frameCount: number;
}): string[] {
  const issues: string[] = [];
  const requirement = extractDurationRequirement(input.userInput);
  if (requirement && (input.totalDuration < requirement.minSeconds || input.totalDuration > requirement.maxSeconds)) {
    issues.push(`总时长 ${input.totalDuration} 秒未满足用户明确要求 ${requirement.source}`);
  }

  const estimated = estimateNarrationSeconds(input.script);
  const target = Math.max(1, input.totalDuration);
  if (estimated < target * .58) {
    issues.push(`内容密度不足：按当前逐字稿估算约 ${Math.round(estimated)} 秒，明显短于计划 ${input.totalDuration} 秒`);
  } else if (estimated > target * 1.35) {
    issues.push(`内容超量：按当前逐字稿估算约 ${Math.round(estimated)} 秒，明显超过计划 ${input.totalDuration} 秒`);
  }

  const averageFrameDuration = input.frameCount ? input.totalDuration / input.frameCount : input.totalDuration;
  if (input.frameCount > 0 && averageFrameDuration > 18) {
    issues.push(`分镜过少：平均每镜约 ${averageFrameDuration.toFixed(1)} 秒，容易造成画面内容不足或停留过久`);
  } else if (input.frameCount > 0 && averageFrameDuration < 3) {
    issues.push(`分镜过密：平均每镜约 ${averageFrameDuration.toFixed(1)} 秒，信息难以完整呈现`);
  }
  return issues;
}
