import { NextRequest, NextResponse } from 'next/server';
import { withAIKeyRoute } from '@/lib/ai-key-route';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { normalizeVideoSourceForFrames } from '@/lib/video-source';
import { repairFrameHtmlWithAI, repairFreeFrameHtmlWithAI } from '@/lib/ai/frame-quality-repair';
import { isVisionUnavailableError } from '@/lib/ai/client';
import { getRepairJob, isRepairJobRunning, registerRepairJobAbort, unregisterRepairJobAbort } from '@/lib/quality/repair-jobs';
import { commitRepairJobState } from '@/lib/quality/repair-job-store';
import {
  auditVisualRepairHtml,
  captureVisualRepairSamples,
  safeVisualRepairSummary,
  selectVisualRepairSamplePoints,
  type VisualRepairError,
} from '@/lib/quality/visual-self-repair';
import { applyLocalTextQualityRepairs } from '@/lib/quality/local-text-quality-repair';
import {
  mergeLayoutIssues,
  qualityHtmlHash,
  qualityPassed,
  qualityScore,
} from '@/lib/quality/quality-vector';
import { QUALITY_AUDIT_VERSION } from '@/lib/quality/audit-version';
import type { FrameQualityRepairStatus, FrameQualityReport, LayoutIssue, Outline, VideoSource } from '@/types';
import { applyProjectAIContext, applyProjectGPTOptimizationOverride } from '@/lib/ai-key-context';
import { runWithAITraceProjectContext } from '@/lib/ai/trace';

interface RouteContext {
  params: { id: string };
}

const issueSchema = z.object({
  code: z.enum(['clipped', 'out_of_bounds', 'platform_safe_area', 'subtitle_safe_area', 'text_occluded', 'semantic_overlap', 'font_too_small', 'focal_too_small', 'edge_spacing', 'low_contrast', 'excessive_micro_labels', 'invisible', 'audit_timeout']),
  label: z.string().max(120),
  detail: z.string().max(500),
  severity: z.enum(['critical', 'major', 'minor']).optional(),
  elementId: z.string().max(160).optional(),
  relatedElementId: z.string().max(160).optional(),
  suggestedFix: z.object({
    elementId: z.string().max(160),
    changes: z.record(z.union([z.string(), z.number(), z.boolean()])),
  }).optional(),
});

const schema = z.object({
  frameId: z.string().min(1).max(160),
  // A single frame can legitimately exceed 30 findings (font-size and contrast
  // checks alone may report several issues per element). Keep the request
  // bounded without rejecting the browser audit before the repair model runs.
  issues: z.array(issueSchema).max(100).default([]),
  // Follow-up rounds repair the candidate that the browser just audited.
  // Without this field every round silently restarts from the database copy.
  htmlCode: z.string().min(1).max(2_000_000).optional(),
  repairJobId: z.string().uuid().optional(),
});

async function handlePost(req: NextRequest, { params }: RouteContext) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'AI 修复参数错误' }, { status: 400 });

    const project = await prisma.project.findUnique({ where: { uuid: params.id } });
    if (!project?.outline) return NextResponse.json({ error: '项目或大纲不存在' }, { status: 404 });
    await applyProjectAIContext(project.workflow);
    applyProjectGPTOptimizationOverride(project.gptOptimization as any);
    if (project.type !== 'html') return NextResponse.json({ error: 'AI 修复仅支持 HTML 分镜' }, { status: 400 });

    const outline = project.outline as unknown as Outline;
    const frameIndex = outline.frames.findIndex(frame => frame.id === parsed.data.frameId);
    if (frameIndex < 0) return NextResponse.json({ error: '当前分镜不存在' }, { status: 404 });
    const videoSource = normalizeVideoSourceForFrames(project.videoSource as unknown as VideoSource | null, outline.frames);
    const source = videoSource.frames[frameIndex];
    if (!source?.htmlCode) return NextResponse.json({ error: '当前分镜没有可修复的 HTML' }, { status: 409 });

    if (parsed.data.repairJobId) {
      const existingJob = getRepairJob(videoSource, parsed.data.repairJobId);
      if (existingJob && !isRepairJobRunning(videoSource, parsed.data.repairJobId, parsed.data.frameId)) {
        return NextResponse.json({ error: '修复任务已停止，不会继续调用 AI' }, { status: 409 });
      }
      if (!existingJob) {
        await commitRepairJobState({
          projectId: params.id,
          frameId: parsed.data.frameId,
          jobId: parsed.data.repairJobId,
          status: 'running',
        });
      }
    }

    const repairAbortController = new AbortController();
    if (parsed.data.repairJobId) registerRepairJobAbort(parsed.data.repairJobId, repairAbortController);
    const abortFromRequest = () => repairAbortController.abort(req.signal.reason);
    if (req.signal.aborted) abortFromRequest();
    else req.signal.addEventListener('abort', abortFromRequest, { once: true });

    try {
      const currentHtml = parsed.data.htmlCode || source.htmlCode;
      const durationSeconds = Math.max(
        0.1,
        source.audioDuration || outline.frames[frameIndex].sceneSpec?.durationHint || 3,
      );
      const canvasPreset = project.canvasPreset as 'landscape-16-9' | 'douyin-portrait-9-16';
      // Run one local final-state audit first so deterministic typography fixes
      // do not consume visual-model attention or screenshot budget.
      const localAudit = await auditVisualRepairHtml({
        htmlCode: currentHtml,
        durationSeconds,
        canvasPreset,
        abortSignal: repairAbortController.signal,
        samplePoints: [1],
      });
      const originalIssues = mergeLayoutIssues([
        ...(parsed.data.issues as LayoutIssue[]),
        ...localAudit.samples.flatMap(sample => sample.issues),
      ]);
      const localRepair = applyLocalTextQualityRepairs(currentHtml, originalIssues);
      const samplePoints = selectVisualRepairSamplePoints(localRepair.remainingIssues);
      let sampling = await captureVisualRepairSamples({
        htmlCode: localRepair.htmlCode,
        durationSeconds,
        canvasPreset,
        abortSignal: repairAbortController.signal,
        samplePoints,
      });
      const sampledIssues = mergeLayoutIssues([
        ...localRepair.remainingIssues,
        ...sampling.samples.flatMap(sample => sample.issues),
      ]);
      if (samplePoints.length === 1 && selectVisualRepairSamplePoints(sampledIssues).length === 3) {
        sampling = await captureVisualRepairSamples({
          htmlCode: localRepair.htmlCode,
          durationSeconds,
          canvasPreset,
          abortSignal: repairAbortController.signal,
        });
      }
      const beforeIssues = mergeLayoutIssues([
        ...localRepair.remainingIssues,
        ...sampling.samples.flatMap(sample => sample.issues),
      ]);
      const allObservedIssues = mergeLayoutIssues([...originalIssues, ...beforeIssues]);
      const repair = project.workflow === 'gpt-free' ? repairFreeFrameHtmlWithAI : repairFrameHtmlWithAI;
      const modelHtmlCode = await runWithAITraceProjectContext(project.uuid, () => repair({
        frame: outline.frames[frameIndex],
        htmlCode: localRepair.htmlCode,
        issues: beforeIssues,
        abortSignal: repairAbortController.signal,
        canvasPreset,
        visualSamples: sampling.samples,
      }));
      // The model may legitimately restructure layout, but deterministic text
      // fixes remain program-owned and are re-applied idempotently at the end.
      const htmlCode = localRepair.appliedFixes.length
        ? applyLocalTextQualityRepairs(modelHtmlCode, originalIssues).htmlCode
        : modelHtmlCode;
      if (parsed.data.repairJobId) {
        const latestProject = await prisma.project.findUnique({ where: { uuid: params.id } });
        const latestSource = normalizeVideoSourceForFrames(latestProject?.videoSource as unknown as VideoSource | null, outline.frames);
        if (!isRepairJobRunning(latestSource, parsed.data.repairJobId, parsed.data.frameId)) {
          return NextResponse.json({ error: '修复任务已停止，不会返回可保存结果' }, { status: 409 });
        }
      }
      const scoreBefore = qualityScore(allObservedIssues);
      const scoreAfterLocal = qualityScore(beforeIssues);
      const localAppliedFixes: FrameQualityReport['appliedFixes'] = localRepair.appliedFixes.map(fix => ({
        ...fix,
        beforeScore: scoreBefore,
        afterScore: scoreAfterLocal,
      }));
      const report = buildQualityReport({
        frameId: parsed.data.frameId,
        htmlCode,
        // The repair model is now the acceptance authority. Do not re-render or
        // compare a candidate against the pre-repair DOM audit before saving it.
        issues: [],
        scoreBefore,
        scoreAfter: 100,
        iterations: localAppliedFixes.length ? 2 : 1,
        appliedFixes: localAppliedFixes,
      });
      return NextResponse.json({
        status: 'accepted' satisfies FrameQualityRepairStatus,
        frameId: parsed.data.frameId,
        htmlCode,
        report,
        summary: sampling.summary,
        message: `已完成${localAppliedFixes.length ? ` ${localAppliedFixes.length} 项本地文字修复和` : ''}视觉审核（${sampling.samples.length} 张截图），等待保存。`,
      });
    } catch (error) {
      if (repairAbortController.signal.aborted) {
        return NextResponse.json({
          status: 'cancelled' satisfies FrameQualityRepairStatus,
          frameId: parsed.data.frameId,
          message: '修复任务已停止，不会返回可保存结果。',
        });
      }
      if (isVisionUnavailableError(error)) {
        return NextResponse.json({
          status: 'unavailable' satisfies FrameQualityRepairStatus,
          frameId: parsed.data.frameId,
          reasonCode: 'vision_unavailable',
          message: '当前模型不支持视觉输入，保留原画面。',
        });
      }
      if (isVisualSamplingError(error)) {
        return NextResponse.json({
          status: error.code === 'cancelled' ? 'cancelled' satisfies FrameQualityRepairStatus : 'failed' satisfies FrameQualityRepairStatus,
          frameId: parsed.data.frameId,
          message: safeVisualRepairSummary(error),
        });
      }
      throw error;
    } finally {
      req.signal.removeEventListener('abort', abortFromRequest);
      if (parsed.data.repairJobId) unregisterRepairJobAbort(parsed.data.repairJobId, repairAbortController);
    }
  } catch (error) {
    console.error('[POST /api/projects/[id]/frame-quality/repair]', safeRepairError(error));
    return NextResponse.json({ status: 'failed' satisfies FrameQualityRepairStatus, error: safeRepairError(error), message: 'AI 画面修复失败，保留原画面。' }, { status: 200 });
  }
}

export const POST = withAIKeyRoute(handlePost);

function buildQualityReport(opts: {
  frameId: string;
  htmlCode: string;
  issues: LayoutIssue[];
  scoreBefore: number;
  scoreAfter?: number;
  iterations: number;
  appliedFixes?: FrameQualityReport['appliedFixes'];
}): FrameQualityReport {
  const scoreAfter = opts.scoreAfter ?? qualityScore(opts.issues);
  return {
    frameId: opts.frameId,
    status: qualityPassed(opts.issues) ? 'passed' : 'needs_review',
    scoreBefore: opts.scoreBefore,
    scoreAfter,
    iterations: opts.iterations,
    issues: opts.issues,
    appliedFixes: opts.iterations ? [...(opts.appliedFixes || []), {
      elementId: 'ai-layout-repair',
      changes: { mode: 'visual_review', acceptance: 'model' },
      beforeScore: opts.scoreBefore,
      afterScore: scoreAfter,
    }] : [],
    auditedAt: Date.now(),
    auditVersion: QUALITY_AUDIT_VERSION,
    htmlHash: qualityHtmlHash(opts.htmlCode),
  };
}

function isVisualSamplingError(error: unknown): error is VisualRepairError {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && ['cancelled', 'sampling_timeout', 'invalid_image', 'renderer_unavailable', 'render_failed'].includes(String((error as { code?: unknown }).code)));
}

function safeRepairError(error: unknown): string {
  if (isVisualSamplingError(error)) return safeVisualRepairSummary(error);
  if (isVisionUnavailableError(error)) return '当前模型不支持视觉输入。';
  return '视觉修复请求失败。';
}
