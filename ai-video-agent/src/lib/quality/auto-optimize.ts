'use client';

import { applyEditCommand, ensureEditableElementIds } from '@/lib/editor-command';
import { sanitizeAiHtml, wrapHtmlWithWatchdog } from '@/lib/iframe-utils';
import { stripUnsafeInlinePositionPatches } from '@/lib/layout-safety';
import type { EditCommand, FrameQualityReport, LayoutIssue } from '@/types';
import type { CanvasPresetId } from '@/types';
import { getCanvasPreset } from '@/lib/canvas-presets';
import {
  compareQualityVectors,
  isAuditTimeout,
  issueConflictKey,
  mergeLayoutIssues,
  qualityHtmlHash,
  qualityPassed,
  qualityReportNeedsAudit,
  qualityScore,
  qualityVector,
  type QualityVector,
} from './quality-vector';
import { QUALITY_AUDIT_VERSION } from '@/lib/quality/audit-version';

export { QUALITY_AUDIT_VERSION } from '@/lib/quality/audit-version';

export {
  compareQualityVectors,
  isAuditTimeout,
  issueConflictKey,
  mergeLayoutIssues,
  qualityHtmlHash,
  qualityPassed,
  qualityReportNeedsAudit,
  qualityScore,
  qualityVector,
  type QualityVector,
} from './quality-vector';

const AUDIT_PROGRESS_POINTS = [0.35, 0.7, 1] as const;
const MAX_ITERATIONS = 4;
const MAX_PLANS_PER_ROUND = 24;

type RepairOperation = {
  elementId: string;
  changes: Record<string, string | number | boolean>;
};

export type RepairPlan = {
  id: string;
  targetKey: string;
  strategy: string;
  operations: RepairOperation[];
  mutationCost: number;
};

async function auditFrameHtmlOnce(
  htmlCode: string,
  durationSeconds = 3,
  canvasPreset?: CanvasPresetId,
  auditAnimationProgress = 1,
): Promise<LayoutIssue[]> {
  if (typeof document === 'undefined') return [];
  const canvas = getCanvasPreset(canvasPreset);
  return new Promise(resolve => {
    const iframe = document.createElement('iframe');
    let settled = false;
    let timeout = 0;
    const finish = (issues: LayoutIssue[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timeout);
      iframe.remove();
      resolve(mergeLayoutIssues(issues));
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow || event.data?.type !== '__ai_video_layout_audit' || !Array.isArray(event.data.issues)) return;
      finish(event.data.issues as LayoutIssue[]);
    };
    window.addEventListener('message', onMessage);
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText = `position:fixed;left:-3000px;top:-3000px;width:${canvas.design.width}px;height:${canvas.design.height}px;opacity:0;pointer-events:none;border:0;`;
    const watchdogMs = Math.max(8_000, Math.ceil(durationSeconds * 1000) + 1_500);
    iframe.srcdoc = wrapHtmlWithWatchdog(
      sanitizeAiHtml(ensureEditableElementIds(htmlCode), canvasPreset),
      watchdogMs,
      { settleAnimationsBeforeAudit: true, auditAnimationProgress, canvasPreset },
    );
    document.body.appendChild(iframe);
    timeout = window.setTimeout(() => finish([{
      code: 'audit_timeout', severity: 'critical', label: '自检超时', detail: '画面自检未返回结果，不能判定为合格。',
    }]), 3_500);
  });
}

export async function auditFrameHtml(
  htmlCode: string,
  durationSeconds = 3,
  canvasPreset?: CanvasPresetId,
  progressPoints: readonly number[] = AUDIT_PROGRESS_POINTS,
): Promise<LayoutIssue[]> {
  const issues: LayoutIssue[] = [];
  for (const progress of progressPoints) {
    const first = await auditFrameHtmlOnce(htmlCode, durationSeconds, canvasPreset, progress);
    const result = isAuditTimeout(first)
      ? await auditFrameHtmlOnce(htmlCode, durationSeconds, canvasPreset, progress)
      : first;
    issues.push(...result.map(issue => ({
      ...issue,
      detail: `[animation progress ${Math.round(progress * 100)}%] ${issue.detail}`,
    })));
    if (isAuditTimeout(result)) break;
  }
  return mergeLayoutIssues(issues);
}

function mutationCost(operations: RepairOperation[]): number {
  return operations.reduce((sum, operation) => {
    const changes = operation.changes;
    const coordinateCost = ['left', 'top'].reduce((value, key) => value + (typeof changes[key] === 'number' ? Math.abs(changes[key] as number) * .02 : 0), 0);
    const scaleCost = typeof changes.scale === 'number' ? Math.abs(1 - changes.scale) * 300 : 0;
    const textCost = changes.fontSize !== undefined ? 500 : 0;
    return sum + coordinateCost + scaleCost + textCost + 80;
  }, 0);
}

function uniquePlans(plans: RepairPlan[]): RepairPlan[] {
  const seen = new Set<string>();
  return plans.filter(plan => {
    const key = JSON.stringify(plan.operations);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Build bounded, deterministic plans from DOM-derived repair hints. */
export function buildRepairPlans(rawIssues: LayoutIssue[]): RepairPlan[] {
  const issues = mergeLayoutIssues(rawIssues);
  const groups = new Map<string, LayoutIssue[]>();
  issues.forEach(issue => groups.set(issueConflictKey(issue), [...(groups.get(issueConflictKey(issue)) || []), issue]));
  const plans: RepairPlan[] = [];

  groups.forEach((group, targetKey) => {
    const actionable = group.filter(issue => issue.suggestedFix?.elementId && Object.keys(issue.suggestedFix.changes || {}).length);
    actionable.forEach((issue, index) => {
      const fix = issue.suggestedFix!;
      const base: RepairOperation = { elementId: fix.elementId, changes: { ...fix.changes } };
      const add = (strategy: string, operations: RepairOperation[]) => plans.push({
        id: `${targetKey}:${index}:${strategy}`,
        targetKey,
        strategy,
        operations,
        mutationCost: mutationCost(operations),
      });
      add('direct', [base]);

      if (issue.code === 'text_occluded' || issue.code === 'semantic_overlap') {
        [0.9, 0.82, 0.74].forEach(scale => add(`move-scale-${scale}`, [{
          elementId: fix.elementId,
          changes: { ...fix.changes, scale },
        }]));
        const left = typeof fix.changes.left === 'number' ? fix.changes.left : null;
        const top = typeof fix.changes.top === 'number' ? fix.changes.top : null;
        if (left !== null || top !== null) {
          const offsets = [[-32, 0], [32, 0], [0, -32], [-48, -24], [48, -24]];
          offsets.forEach(([dx, dy]) => add(`offset-${dx}-${dy}`, [{
            elementId: fix.elementId,
            changes: {
              ...fix.changes,
              ...(left !== null ? { left: Math.max(8, left + dx) } : {}),
              ...(top !== null ? { top: Math.max(8, top + dy) } : {}),
              scale: 0.82,
            },
          }]));
        }
      }
    });

    if (actionable.length > 1) {
      const operations = actionable.map(issue => ({
        elementId: issue.suggestedFix!.elementId,
        changes: { ...issue.suggestedFix!.changes },
      }));
      plans.push({ id: `${targetKey}:combined`, targetKey, strategy: 'combined', operations, mutationCost: mutationCost(operations) });
    }
  });

  return uniquePlans(plans).sort((a, b) => a.mutationCost - b.mutationCost).slice(0, MAX_PLANS_PER_ROUND);
}

function applyRepairPlan(html: string, frameId: string, plan: RepairPlan): string {
  return plan.operations.reduce((currentHtml, operation, index) => {
    const command: EditCommand = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `auto-${Date.now()}-${index}-${operation.elementId}`,
      operation: 'update_element', frameId, elementId: operation.elementId,
      scope: 'element', changes: operation.changes,
      preserve: ['content', 'narration', 'duration', 'otherElements'],
      source: 'auto', summary: `自动修复：${plan.strategy}`,
    };
    return applyEditCommand(currentHtml, command);
  }, html);
}

function targetCount(issues: LayoutIssue[], targetKey: string): number {
  return mergeLayoutIssues(issues).filter(issue => issueConflictKey(issue) === targetKey).length;
}

export async function autoOptimizeFrame(opts: {
  frameId: string;
  htmlCode: string;
  durationSeconds?: number;
  repair?: boolean;
  shouldStop?: () => boolean;
  canvasPreset?: CanvasPresetId;
  auditProgressPoints?: readonly number[];
}): Promise<{ htmlCode: string; report: FrameQualityReport }> {
  const duration = opts.durationSeconds || 3;
  console.info(`[画面修复][${opts.frameId}] 开始确定性审计`, { durationSeconds: duration });
  const originalHtml = stripUnsafeInlinePositionPatches(ensureEditableElementIds(opts.htmlCode));
  let bestHtml = originalHtml;
  let bestIssues = mergeLayoutIssues(await auditFrameHtml(bestHtml, duration, opts.canvasPreset, opts.auditProgressPoints));
  const scoreBefore = qualityScore(bestIssues);
  console.info(`[画面修复][${opts.frameId}] 确定性审计完成`, { issues: bestIssues.length, score: scoreBefore });
  let bestScore = scoreBefore;
  const appliedFixes: FrameQualityReport['appliedFixes'] = [];
  const attemptedByLayout = new Set<string>();
  let iterations = 0;

  while (opts.repair && !opts.shouldStop?.() && !qualityPassed(bestIssues) && iterations < MAX_ITERATIONS) {
    const layoutHash = qualityHtmlHash(bestHtml);
    const plans = buildRepairPlans(bestIssues).filter(plan => {
      const key = `${layoutHash}:${JSON.stringify(plan.operations)}`;
      if (attemptedByLayout.has(key)) return false;
      attemptedByLayout.add(key);
      return true;
    });
    if (!plans.length) break;
    console.info(`[画面修复][${opts.frameId}] 评估本地修复方案`, { round: iterations + 1, plans: plans.length, issues: bestIssues.length });

    let winning: { html: string; issues: LayoutIssue[]; score: number; plan: RepairPlan; vector: QualityVector } | null = null;
    const currentVector = qualityVector(bestIssues);
    const currentAcceptanceVector: QualityVector = [
      currentVector[0], currentVector[1], currentVector[2], currentVector[3], currentVector[4],
      currentVector[5], currentVector[6], currentVector[7], Number.POSITIVE_INFINITY,
    ];
    for (const [planIndex, plan] of plans.entries()) {
      if (opts.shouldStop?.()) break;
      console.info(`[画面修复][${opts.frameId}] 审计本地候选`, { round: iterations + 1, plan: planIndex + 1, totalPlans: plans.length, strategy: plan.strategy });
      const candidateHtml = applyRepairPlan(bestHtml, opts.frameId, plan);
      const candidateIssues = mergeLayoutIssues(await auditFrameHtml(candidateHtml, duration, opts.canvasPreset, opts.auditProgressPoints));
      // A plan is a repair only when the conflict that produced it disappears
      // or is reduced. Unrelated score gains must never mask an occlusion.
      if (targetCount(candidateIssues, plan.targetKey) >= targetCount(bestIssues, plan.targetKey)) continue;
      const candidateVector = qualityVector(candidateIssues, plan.mutationCost);
      if (compareQualityVectors(candidateVector, currentAcceptanceVector) >= 0) continue;
      const candidateScore = qualityScore(candidateIssues);
      if (!winning || compareQualityVectors(candidateVector, winning.vector) < 0
        || (compareQualityVectors(candidateVector, winning.vector) === 0 && candidateScore > winning.score)) {
        winning = { html: candidateHtml, issues: candidateIssues, score: candidateScore, plan, vector: candidateVector };
      }
    }
    iterations += 1;
    if (opts.shouldStop?.() || !winning) {
      console.info(`[画面修复][${opts.frameId}] 本地修复轮次结束，没有可接受候选`, { round: iterations, stopped: Boolean(opts.shouldStop?.()) });
      break;
    }

    winning.plan.operations.forEach(operation => appliedFixes.push({
      elementId: operation.elementId,
      changes: operation.changes,
      beforeScore: bestScore,
      afterScore: winning!.score,
    }));
    bestHtml = winning.html;
    bestIssues = winning.issues;
    bestScore = winning.score;
    console.info(`[画面修复][${opts.frameId}] 已接受本地修复候选`, { round: iterations, issues: bestIssues.length, score: bestScore, strategy: winning.plan.strategy });
  }

  console.info(`[画面修复][${opts.frameId}] 确定性修复结束`, { iterations, issues: bestIssues.length, score: bestScore, appliedFixes: appliedFixes.length });

  return {
    htmlCode: bestHtml,
    report: {
      frameId: opts.frameId,
      status: qualityPassed(bestIssues) ? 'passed' : 'needs_review',
      scoreBefore,
      scoreAfter: bestScore,
      iterations,
      issues: bestIssues,
      appliedFixes,
      auditedAt: Date.now(),
      auditVersion: QUALITY_AUDIT_VERSION,
      htmlHash: qualityHtmlHash(bestHtml),
    },
  };
}
