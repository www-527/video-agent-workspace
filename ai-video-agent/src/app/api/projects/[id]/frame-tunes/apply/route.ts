import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { applyFrameTuneSource, applyFrameTuneToHtml, normalizeTuneDraft } from '@/lib/ai/frame-tune';
import { sanitizeFreeHtml, sanitizeHtml, validateFreeGeneratedHtml, validateGeneratedHtml, validateRealImageUsage } from '@/lib/ai/html';
import { normalizeVideoSourceForFrames } from '@/lib/video-source';
import { appendFrameRepairHistory } from '@/lib/frame-repair-history';
import { getRepairJob, isRepairJobRunning, withRepairJob } from '@/lib/quality/repair-jobs';
import { auditGPTVideoQuality } from '@/lib/render/visual-audit';
import type { FrameQualityReport, FrameRepairHistoryEntry, FrameTuneDraft, Outline, ProjectDetail, ProjectType, VideoSource } from '@/types';

interface RouteContext {
  params: { id: string };
}

const tuneElementSchema = z.object({
  label: z.string().trim().min(1).max(80),
  kind: z.enum(['visual', 'text', 'decoration', 'motion']),
  selector: z.string().trim().max(200).optional(),
  previewAnchor: z.enum(['center', 'top', 'bottom', 'left', 'right']).optional(),
  current: z.record(z.string()).default({}),
  proposed: z.record(z.string()).default({}),
  reason: z.string().trim().max(300).default(''),
});

const tuneDraftSchema = z.object({
  targetFrameId: z.string().min(1),
  summary: z.string().trim().min(1).max(200),
  elements: z.array(tuneElementSchema).min(1).max(8),
  baseUpdatedAt: z.string().min(1),
});

const applySchema = z.object({
  draft: tuneDraftSchema,
});
const restoreSchema = z.object({
  restore: z.object({
    targetFrameId: z.string().min(1),
    htmlCode: z.string().min(1).max(500_000),
    qualityReport: z.unknown().optional(),
    repairJobId: z.string().uuid().optional(),
    recordHistory: z.object({
      source: z.enum(['auto-repair', 'restore']),
      summary: z.string().trim().min(1).max(200),
      restoreOfId: z.string().optional(),
    }).optional(),
  }),
});
const schema = z.union([applySchema, restoreSchema]);

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    const project = await prisma.project.findUnique({ where: { uuid: params.id } });
    if (!project?.outline) {
      return NextResponse.json({ error: '项目或大纲不存在' }, { status: 404 });
    }
    if (project.type !== 'html') {
      return NextResponse.json({ error: '微调功能暂只支持 HTML 动画分镜' }, { status: 400 });
    }

    const outline = project.outline as unknown as Outline;
    const targetFrameId = 'restore' in parsed.data
      ? parsed.data.restore.targetFrameId
      : parsed.data.draft.targetFrameId;
    const frameIndex = outline.frames.findIndex(frame => frame.id === targetFrameId);
    if (frameIndex < 0) {
      return NextResponse.json({ error: '分镜不存在或已被修改，请重新生成微调草稿' }, { status: 404 });
    }

    const videoSource = normalizeVideoSourceForFrames(project.videoSource as unknown as VideoSource | null, outline.frames);
    const source = videoSource.frames[frameIndex];
    if (!source?.htmlCode) {
      return NextResponse.json({ error: '请先生成该镜画面，再进行微调' }, { status: 409 });
    }
    const repairJobId = 'restore' in parsed.data ? parsed.data.restore.repairJobId : undefined;
    if (repairJobId && !isRepairJobRunning(videoSource, repairJobId, targetFrameId)) {
      return NextResponse.json({ error: '修复任务已停止，拒绝保存本次修改' }, { status: 409 });
    }

    const schemaFree = project.workflow === 'gpt-free';
    const htmlCode = 'restore' in parsed.data
      ? schemaFree
        ? sanitizeFreeHtml(parsed.data.restore.htmlCode)
        : sanitizeHtml(parsed.data.restore.htmlCode, project.canvasPreset as ProjectDetail['canvasPreset'])
      : await applyFrameTuneToHtml({
          frame: outline.frames[frameIndex],
          htmlCode: source.htmlCode,
          draft: normalizeTuneDraft(parsed.data.draft as FrameTuneDraft),
          canvasPreset: project.canvasPreset as ProjectDetail['canvasPreset'],
          schemaFree,
        });
    if (schemaFree) validateFreeGeneratedHtml(htmlCode);
    else validateGeneratedHtml(htmlCode);
    const realImages = source.realImages?.length ? source.realImages : source.realImage ? [source.realImage] : [];
    for (const realImage of realImages) validateRealImageUsage(htmlCode, realImage);
    let nextVideoSource = applyFrameTuneSource({
      videoSource,
      frameIndex,
      frameId: targetFrameId,
      htmlCode,
      qualityReport: 'restore' in parsed.data && isFrameQualityReport(parsed.data.restore.qualityReport)
        ? parsed.data.restore.qualityReport
        : undefined,
    });
    if ('restore' in parsed.data && parsed.data.restore.recordHistory && htmlCode !== source.htmlCode) {
      const record = parsed.data.restore.recordHistory;
      const historyEntry: FrameRepairHistoryEntry = {
        id: randomUUID(),
        frameId: targetFrameId,
        beforeHtml: source.htmlCode,
        afterHtml: htmlCode,
        summary: record.summary,
        source: record.source,
        qualityReport: isFrameQualityReport(parsed.data.restore.qualityReport)
          ? parsed.data.restore.qualityReport
          : undefined,
        restoreOfId: record.restoreOfId,
        createdAt: new Date().toISOString(),
      };
      nextVideoSource = appendFrameRepairHistory(nextVideoSource, historyEntry);
    }
    if (repairJobId) {
      const latestProject = await prisma.project.findUnique({ where: { uuid: params.id } });
      const latestSource = normalizeVideoSourceForFrames(latestProject?.videoSource as unknown as VideoSource | null, outline.frames);
      const latestJob = getRepairJob(latestSource, repairJobId);
      if (!latestJob || !isRepairJobRunning(latestSource, repairJobId, targetFrameId)) {
        return NextResponse.json({ error: '修复任务已停止，拒绝保存本次修改' }, { status: 409 });
      }
      nextVideoSource = withRepairJob(nextVideoSource, repairJobId, {
        ...latestJob,
        status: 'completed',
        updatedAt: new Date().toISOString(),
      });
    }
    if (project.workflow === 'gpt-free') {
      nextVideoSource = {
        ...nextVideoSource,
        gptQualityReport: auditGPTVideoQuality(outline, nextVideoSource),
      };
    }

    const updatedProject = await prisma.project.update({
      where: { uuid: params.id },
      data: { videoSource: nextVideoSource as any },
    });

    return NextResponse.json({
      project: toProjectDetail(updatedProject),
      frameId: targetFrameId,
    });
  } catch (error) {
    console.error('[POST /api/projects/[id]/frame-tunes/apply]', error);
    return NextResponse.json({ error: (error as Error).message || '应用画面微调失败' }, { status: 500 });
  }
}

function isFrameQualityReport(value: unknown): value is FrameQualityReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<FrameQualityReport>;
  return typeof report.frameId === 'string'
    && (report.status === 'passed' || report.status === 'needs_review')
    && typeof report.scoreBefore === 'number'
    && typeof report.scoreAfter === 'number'
    && Array.isArray(report.issues)
    && Array.isArray(report.appliedFixes)
    && typeof report.auditVersion === 'string'
    && typeof report.htmlHash === 'string';
}

function toProjectDetail(project: Awaited<ReturnType<typeof prisma.project.update>>): ProjectDetail {
  return {
    uuid: project.uuid,
    title: project.title,
    type: project.type as ProjectType,
    canvasPreset: project.canvasPreset as ProjectDetail['canvasPreset'],
    styleId: project.styleId,
    workflow: project.workflow as ProjectDetail['workflow'],
    contentStyle: project.contentStyle as ProjectDetail['contentStyle'],
    gptOptimization: project.gptOptimization as ProjectDetail['gptOptimization'],
    outline: (project.outline as unknown as Outline) ?? null,
    videoSource: (project.videoSource as unknown as VideoSource) ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    hasOutline: Boolean(project.outline),
  };
}
