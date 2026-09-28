import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { applyEditCommand } from '@/lib/editor-command';
import { createProjectCheckpoint, loadCurrentProjectState, readProjectCheckpoint } from '@/lib/projects/checkpoints';
import { createProjectStateHash } from '@/lib/projects/state-hash';
import { resolveDataUrlPath } from '@/lib/render/paths';
import type {
  ChangeImpact,
  ChangeSetOperation,
  ChangeSetSummary,
  DirectorDiagnosis,
  FrameOutline,
  FrameSource,
  Outline,
  ProjectDetail,
  VideoSource,
} from '@/types';

export class ChangeSetError extends Error {
  constructor(readonly status: number, message: string, readonly code: string, readonly requiresConfirmation = false) {
    super(message);
    this.name = 'ChangeSetError';
  }
}

export function calculateChangeImpact(operations: ChangeSetOperation[], currentFrameCount: number): ChangeImpact {
  const affected = new Set<string>();
  let outlineChanged = false;
  let visualRegenerationCount = 0;
  let audioRegenerationCount = 0;
  let assetReplacementCount = 0;
  const warnings: string[] = [];
  for (const operation of operations) {
    if ('frameId' in operation) affected.add(operation.frameId);
    if (operation.type === 'merge_frames') operation.frameIds.forEach(id => affected.add(id));
    if (operation.type === 'add_frame' || operation.type === 'delete_frame' || operation.type === 'split_frame' || operation.type === 'merge_frames' || operation.type === 'update_frame_text') {
      outlineChanged = true;
    }
    if (operation.type === 'regenerate_visual' || operation.type === 'replace_asset' || operation.type === 'tune_element') visualRegenerationCount += 1;
    if (operation.type === 'regenerate_audio') audioRegenerationCount += 1;
    if (operation.type === 'update_frame_text') {
      visualRegenerationCount += 1;
      audioRegenerationCount += 1;
    }
    if (operation.type === 'add_frame' || operation.type === 'split_frame' || operation.type === 'merge_frames') {
      const count = operation.type === 'split_frame' ? operation.frames.length : 1;
      visualRegenerationCount += count;
      audioRegenerationCount += count;
    }
    if (operation.type === 'replace_asset') assetReplacementCount += 1;
    if (operation.type === 'delete_frame') warnings.push('删除镜头会同时移除该镜头当前画面和旁白引用。');
  }
  return {
    affectedFrameIds: [...affected],
    outlineChanged,
    visualRegenerationCount,
    audioRegenerationCount,
    assetReplacementCount,
    preservedFrameCount: Math.max(0, currentFrameCount - affected.size),
    estimatedStageCount: Math.max(1, visualRegenerationCount + audioRegenerationCount + (outlineChanged ? 1 : 0)),
    warnings: [...new Set(warnings)],
  };
}

export async function proposeChangeSetFromDiagnosis(input: {
  projectId: string;
  diagnosis: DirectorDiagnosis;
  intensity: 'light' | 'recommended' | 'redesign';
  runId?: string;
}): Promise<ChangeSetSummary> {
  const { project, stateHash } = await loadCurrentProjectState(input.projectId);
  if (stateHash !== input.diagnosis.baseStateHash) {
    throw new ChangeSetError(409, '项目已经变化，这份诊断已过期，请重新检查。', 'diagnosis_stale');
  }
  const outline = project.outline as unknown as Outline | null;
  if (!outline?.frames.length) throw new ChangeSetError(409, '当前项目没有可修改的分镜。', 'outline_missing');
  const operations = operationsForDiagnosis(input.diagnosis, input.intensity, outline);
  const impact = calculateChangeImpact(operations, outline.frames.length);
  const created = await prisma.projectChangeSet.create({
    data: {
      projectId: input.projectId,
      runId: input.runId,
      status: 'proposed',
      baseStateHash: stateHash,
      scope: input.diagnosis.scope as any,
      operations: operations as any,
      impact: impact as any,
      summary: {
        title: input.intensity === 'light' ? '轻微调整' : input.intensity === 'redesign' ? '重新设计' : '推荐修改方案',
        description: describeImpact(impact),
      },
    },
  });
  return toChangeSetSummary(created);
}

export async function getChangeSet(projectId: string, changeSetId: string): Promise<ChangeSetSummary> {
  const changeSet = await prisma.projectChangeSet.findFirst({ where: { id: changeSetId, projectId } });
  if (!changeSet) throw new ChangeSetError(404, '修改方案不存在。', 'change_set_not_found');
  return toChangeSetSummary(changeSet);
}

export async function applyProjectChangeSet(projectId: string, changeSetId: string): Promise<{
  changeSet: ChangeSetSummary;
  project: ProjectDetail;
}> {
  const changeSet = await prisma.projectChangeSet.findFirst({ where: { id: changeSetId, projectId } });
  if (!changeSet) throw new ChangeSetError(404, '修改方案不存在。', 'change_set_not_found');
  if (changeSet.status !== 'proposed') throw new ChangeSetError(409, '该修改方案已经处理，不能重复应用。', 'change_set_not_proposed');
  const { project, state, stateHash } = await loadCurrentProjectState(projectId);
  if (stateHash !== changeSet.baseStateHash) {
    await prisma.projectChangeSet.update({ where: { id: changeSet.id }, data: { status: 'stale' } });
    throw new ChangeSetError(409, '项目在方案生成后发生了变化，请重新生成修改方案。', 'change_set_stale');
  }
  const operations = changeSet.operations as unknown as ChangeSetOperation[];
  await validateOperations(projectId, operations, project.outline as unknown as Outline | null);
  const checkpoint = await createProjectCheckpoint({
    projectId,
    reason: '应用 AI 修改方案',
    changeSetId: changeSet.id,
    summary: { operationCount: operations.length },
  });
  const mutation = applyOperations({
    outline: project.outline as unknown as Outline,
    videoSource: project.videoSource as unknown as VideoSource | null,
    styleId: project.styleId,
  }, operations, projectId);
  const resultStateHash = createProjectStateHash({
    ...state,
    outline: mutation.outline,
    videoSource: mutation.videoSource,
    styleId: mutation.styleId,
  });
  const updated = await prisma.$transaction(async tx => {
    const locked = await tx.project.updateMany({
      where: { uuid: projectId, updatedAt: project.updatedAt },
      data: {
        outline: mutation.outline as any,
        videoSource: mutation.videoSource as any,
        styleId: mutation.styleId,
      },
    });
    if (locked.count !== 1) throw new ChangeSetError(409, '项目刚刚发生了变化，修改没有应用。', 'apply_conflict');
    return tx.projectChangeSet.update({
      where: { id: changeSet.id },
      data: {
        status: 'applied',
        checkpointId: checkpoint.id,
        resultStateHash,
        appliedAt: new Date(),
      },
    });
  }).catch(async error => {
    if (error instanceof ChangeSetError && error.code === 'apply_conflict') {
      await prisma.projectChangeSet.update({ where: { id: changeSet.id }, data: { status: 'stale', checkpointId: checkpoint.id } });
    } else {
      await prisma.projectChangeSet.update({ where: { id: changeSet.id }, data: { status: 'failed', checkpointId: checkpoint.id } }).catch(() => {});
    }
    throw error;
  });
  return { changeSet: toChangeSetSummary(updated), project: await readProjectDetail(projectId) };
}

export async function revertProjectChangeSet(input: {
  projectId: string;
  changeSetId: string;
  force?: boolean;
}): Promise<{ changeSet: ChangeSetSummary; project: ProjectDetail }> {
  const changeSet = await prisma.projectChangeSet.findFirst({ where: { id: input.changeSetId, projectId: input.projectId } });
  if (!changeSet || !changeSet.checkpointId) throw new ChangeSetError(404, '没有可用的撤销检查点。', 'checkpoint_missing');
  if (changeSet.status !== 'applied') throw new ChangeSetError(409, '只有已应用且尚未撤销的方案可以恢复。', 'change_set_not_applied');
  const latestApplied = await prisma.projectChangeSet.findFirst({
    where: { projectId: input.projectId, status: 'applied' },
    orderBy: { appliedAt: 'desc' },
    select: { id: true },
  });
  if (latestApplied?.id !== changeSet.id) throw new ChangeSetError(409, '只能撤销最近一次项目级 AI 修改。', 'not_latest_change');
  const current = await loadCurrentProjectState(input.projectId);
  if (current.stateHash !== changeSet.resultStateHash && !input.force) {
    throw new ChangeSetError(409, '应用方案后项目还有其他修改。继续恢复会覆盖这些修改。', 'revert_conflict', true);
  }
  const snapshot = await readProjectCheckpoint(input.projectId, changeSet.checkpointId);
  await validateSnapshotMedia(snapshot.videoSource as VideoSource | null);
  const updated = await prisma.$transaction(async tx => {
    await tx.project.update({
      where: { uuid: input.projectId },
      data: {
        outline: jsonValue(snapshot.outline),
        videoSource: jsonValue(snapshot.videoSource),
        styleId: snapshot.styleId,
        contentStyle: jsonValue(snapshot.contentStyle),
        gptOptimization: jsonValue(snapshot.gptOptimization),
        projectBrief: jsonValue(snapshot.projectBrief),
        ...(snapshot.briefStatus ? { briefStatus: snapshot.briefStatus } : {}),
      },
    });
    await tx.projectCheckpoint.update({ where: { id: changeSet.checkpointId! }, data: { restoredAt: new Date() } });
    return tx.projectChangeSet.update({
      where: { id: changeSet.id },
      data: { status: 'reverted', revertedAt: new Date() },
    });
  });
  return { changeSet: toChangeSetSummary(updated), project: await readProjectDetail(input.projectId) };
}

function operationsForDiagnosis(
  diagnosis: DirectorDiagnosis,
  intensity: 'light' | 'recommended' | 'redesign',
  outline: Outline,
): ChangeSetOperation[] {
  const issueFrames = [...new Set(diagnosis.issues.flatMap(issue => issue.evidenceFrameIds))];
  const scopeFrames = diagnosis.scope.frameIds.length ? diagnosis.scope.frameIds : outline.frames.map(frame => frame.id);
  const targetFrames = intensity === 'redesign'
    ? scopeFrames
    : intensity === 'light'
      ? issueFrames.slice(0, Math.max(1, diagnosis.issues.filter(issue => issue.severity === 'blocking').length || 1))
      : issueFrames;
  const operations: ChangeSetOperation[] = [];
  for (const frameId of targetFrames.length ? targetFrames : scopeFrames.slice(0, 1)) {
    const frameIssues = diagnosis.issues.filter(issue => issue.evidenceFrameIds.includes(frameId));
    const frame = outline.frames.find(item => item.id === frameId);
    if (!frame) continue;
    const hasRhythmIssue = frameIssues.some(issue => issue.category === 'rhythm' || issue.category === 'content');
    const hasAudioIssue = frameIssues.some(issue => issue.category === 'audio');
    const hasVisualIssue = intensity === 'redesign' || frameIssues.some(issue => ['visual', 'readability', 'asset'].includes(issue.category));
    if (hasRhythmIssue && frame.narration.length > 40) {
      operations.push({
        type: 'update_frame_text',
        frameId,
        narration: shortenNarration(frame.narration, intensity === 'light' ? 0.88 : 0.72),
      });
    }
    if (hasAudioIssue) operations.push({ type: 'regenerate_audio', frameId, reason: '根据导演诊断重新生成旁白' });
    if (hasVisualIssue || (!hasRhythmIssue && !hasAudioIssue)) {
      operations.push({ type: 'regenerate_visual', frameId, reason: intensity === 'redesign' ? '按新视觉方向重新设计' : '修复导演诊断中的画面问题' });
    }
  }
  return dedupeOperations(operations);
}

function applyOperations(
  current: { outline: Outline; videoSource: VideoSource | null; styleId: string | null },
  operations: ChangeSetOperation[],
  projectId: string,
) {
  let frames = structuredClone(current.outline.frames);
  let sources: FrameSource[] = structuredClone(current.videoSource?.frames ?? frames.map(frame => ({ id: frame.id }))) as FrameSource[];
  let styleId = current.styleId;
  for (const operation of operations) {
    if (operation.type === 'update_frame_text') {
      frames = frames.map(frame => frame.id === operation.frameId ? { ...frame, title: operation.title ?? frame.title, narration: operation.narration ?? frame.narration } : frame);
      sources = sources.map(source => source.id === operation.frameId ? clearAudio(clearVisual(source)) : source);
    }
    if (operation.type === 'add_frame') {
      const index = operation.afterFrameId ? frames.findIndex(frame => frame.id === operation.afterFrameId) + 1 : frames.length;
      const draft = { ...operation.draft, id: operation.draft.id || randomUUID() };
      frames.splice(Math.max(0, index), 0, draft);
      sources.splice(Math.max(0, index), 0, { id: draft.id });
    }
    if (operation.type === 'delete_frame') {
      frames = frames.filter(frame => frame.id !== operation.frameId);
      sources = sources.filter(source => source.id !== operation.frameId);
    }
    if (operation.type === 'split_frame') {
      const index = frames.findIndex(frame => frame.id === operation.frameId);
      if (index >= 0) {
        const drafts = operation.frames.map(frame => ({ ...frame, id: frame.id || randomUUID() }));
        frames.splice(index, 1, ...drafts);
        sources.splice(index, 1, ...drafts.map(frame => ({ id: frame.id })));
      }
    }
    if (operation.type === 'merge_frames') {
      const indexes = operation.frameIds.map(id => frames.findIndex(frame => frame.id === id)).filter(index => index >= 0);
      const index = Math.min(...indexes);
      frames = frames.filter(frame => !operation.frameIds.includes(frame.id));
      sources = sources.filter(source => !operation.frameIds.includes(source.id));
      const merged = { ...operation.frame, id: operation.frame.id || randomUUID() };
      frames.splice(index, 0, merged);
      sources.splice(index, 0, { id: merged.id });
    }
    if (operation.type === 'regenerate_visual') sources = sources.map(source => source.id === operation.frameId ? clearVisual(source) : source);
    if (operation.type === 'regenerate_audio') sources = sources.map(source => source.id === operation.frameId ? clearAudio(source) : source);
    if (operation.type === 'replace_asset') {
      sources = sources.map(source => source.id === operation.frameId ? {
        ...clearVisual(source),
        projectAssetId: operation.assetId,
        imagePath: `/api/projects/${projectId}/assets/${operation.assetId}/preview`,
      } : source);
    }
    if (operation.type === 'tune_element') {
      sources = sources.map(source => source.id === operation.frameId && source.htmlCode
        ? { ...source, htmlCode: applyEditCommand(source.htmlCode, operation.command), qualityReport: null }
        : source);
    }
    if (operation.type === 'update_project_style') styleId = operation.styleId;
  }
  frames = frames.map((frame, index) => ({ ...frame, index: index + 1 }));
  const byId = new Map(sources.map(source => [source.id, source]));
  sources = frames.map(frame => byId.get(frame.id) ?? { id: frame.id });
  const outlineChanged = operations.some(operation => ['update_frame_text', 'add_frame', 'delete_frame', 'split_frame', 'merge_frames'].includes(operation.type));
  return {
    outline: {
      ...current.outline,
      frames,
      ...(outlineChanged ? {
        visualAnchor: undefined,
        collaboration: { mode: 'guided' as const, planApproved: false, approvedFrameIds: [] },
      } : {}),
    },
    videoSource: { ...(current.videoSource ?? {}), frames: sources },
    styleId,
  };
}

function clearVisual(source: FrameSource): FrameSource {
  const next = { ...source };
  delete next.htmlCode;
  delete next.imagePath;
  delete next.realImage;
  delete next.realImages;
  delete next.imageSelection;
  delete next.imageAsset;
  delete next.visualFallbacks;
  next.qualityReport = null;
  return next;
}

function clearAudio(source: FrameSource): FrameSource {
  const next = { ...source };
  delete next.audioPath;
  delete next.audioDuration;
  return next;
}

async function validateOperations(projectId: string, operations: ChangeSetOperation[], outline: Outline | null) {
  if (!outline) throw new ChangeSetError(409, '项目大纲不存在。', 'outline_missing');
  const frameIds = new Set(outline.frames.map(frame => frame.id));
  for (const operation of operations) {
    if ('frameId' in operation && !frameIds.has(operation.frameId)) {
      throw new ChangeSetError(409, '修改方案引用的分镜已经不存在。', 'frame_stale');
    }
    if (operation.type === 'merge_frames' && operation.frameIds.some(id => !frameIds.has(id))) {
      throw new ChangeSetError(409, '合并方案引用的分镜已经变化。', 'frame_stale');
    }
    if (operation.type === 'replace_asset') {
      const asset = await prisma.projectAsset.findFirst({ where: { id: operation.assetId, projectId, status: 'ready' }, select: { id: true } });
      if (!asset) throw new ChangeSetError(409, '替换素材已不存在或尚未处理完成。', 'asset_stale');
    }
  }
}

async function validateSnapshotMedia(videoSource: VideoSource | null) {
  const paths = (videoSource?.frames ?? []).flatMap(source => [source.imagePath, source.audioPath].filter((value): value is string => Boolean(value)));
  for (const value of paths) {
    const path = resolveDataUrlPath(value);
    if (!path) continue;
    try {
      await access(path);
    } catch {
      throw new ChangeSetError(409, '检查点引用的媒体已缺失，不能安全恢复。', 'checkpoint_media_missing');
    }
  }
}

async function readProjectDetail(projectId: string): Promise<ProjectDetail> {
  const project = await prisma.project.findUnique({ where: { uuid: projectId } });
  if (!project) throw new ChangeSetError(404, '项目不存在。', 'project_not_found');
  return {
    uuid: project.uuid,
    title: project.title,
    type: project.type as ProjectDetail['type'],
    canvasPreset: project.canvasPreset as ProjectDetail['canvasPreset'],
    workflow: project.workflow as ProjectDetail['workflow'],
    styleId: project.styleId,
    contentStyle: project.contentStyle as ProjectDetail['contentStyle'],
    gptOptimization: project.gptOptimization as ProjectDetail['gptOptimization'],
    projectBrief: project.projectBrief as ProjectDetail['projectBrief'],
    briefStatus: project.briefStatus as ProjectDetail['briefStatus'],
    outline: project.outline as unknown as Outline | null,
    videoSource: project.videoSource as unknown as VideoSource | null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    hasOutline: Boolean(project.outline),
  };
}

function toChangeSetSummary(changeSet: {
  id: string;
  status: string;
  baseStateHash: string;
  resultStateHash: string | null;
  scope: unknown;
  operations: unknown;
  impact: unknown;
  summary: unknown;
  checkpointId: string | null;
}): ChangeSetSummary {
  return {
    id: changeSet.id,
    status: changeSet.status as ChangeSetSummary['status'],
    baseStateHash: changeSet.baseStateHash,
    ...(changeSet.resultStateHash ? { resultStateHash: changeSet.resultStateHash } : {}),
    scope: changeSet.scope as ChangeSetSummary['scope'],
    operations: changeSet.operations as ChangeSetOperation[],
    impact: changeSet.impact as ChangeImpact,
    summary: changeSet.summary as ChangeSetSummary['summary'],
    ...(changeSet.checkpointId ? { checkpointId: changeSet.checkpointId } : {}),
  };
}

function shortenNarration(value: string, ratio: number): string {
  const target = Math.max(20, Math.round(value.length * ratio));
  if (value.length <= target) return value;
  const sentences = value.split(/(?<=[。！？!?；;])/).filter(Boolean);
  let result = '';
  for (const sentence of sentences) {
    if (result && result.length + sentence.length > target) break;
    result += sentence;
  }
  return result.trim() || `${value.slice(0, target).replace(/[，、；：\s]+$/g, '')}。`;
}

function dedupeOperations(operations: ChangeSetOperation[]): ChangeSetOperation[] {
  const seen = new Set<string>();
  return operations.filter(operation => {
    const key = `${operation.type}:${'frameId' in operation ? operation.frameId : operation.type === 'merge_frames' ? operation.frameIds.join(',') : ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeImpact(impact: ChangeImpact): string {
  return `影响 ${impact.affectedFrameIds.length} 个镜头；重做 ${impact.visualRegenerationCount} 个画面、${impact.audioRegenerationCount} 段旁白，保留 ${impact.preservedFrameCount} 个镜头。`;
}

function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}
