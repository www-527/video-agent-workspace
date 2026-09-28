import { v4 as uuid } from 'uuid';
import {
  deleteFrameFromOutline,
  insertFrameIntoOutline,
  realignVideoSource,
  syncOutlineContent,
} from './frame-ops';
import { approveFrames, approvePlan, getCollaborationState, invalidateFrameApproval } from '@/lib/collaboration';
import type { FrameOutline, FrameReviewDraft, FrameStructureDraft, FrameStructureItemDraft, Outline, ProjectType, VideoSource } from '@/types';

export interface ApplyFrameDraftOptions {
  type: ProjectType;
  outline: Outline;
  videoSource: VideoSource;
  draft: FrameReviewDraft;
  approveForGeneration?: boolean;
}

export interface ApplyFrameDraftResult {
  outline: Outline;
  videoSource: VideoSource;
  frameId?: string;
}

export interface ApplyFrameStructureDraftResult {
  outline: Outline;
  videoSource: VideoSource;
  frameIds: string[];
}

export function markPlanNeedsReview(outline: Outline): Outline {
  return {
    ...outline,
    visualAnchor: undefined,
    collaboration: {
      mode: 'guided',
      planApproved: false,
      approvedFrameIds: [],
    },
  };
}

export function applyFrameDraft({
  type,
  outline,
  videoSource,
  draft,
  approveForGeneration = false,
}: ApplyFrameDraftOptions): ApplyFrameDraftResult {
  if (draft.operation === 'delete') {
    const targetIndex = findTargetIndex(outline, draft);
    const { outline: nextOutline } = deleteFrameFromOutline(outline, targetIndex + 1);
    const reviewedOutline = markPlanNeedsReview(nextOutline);
    return {
      outline: reviewedOutline,
      videoSource: realignVideoSource(reviewedOutline, videoSource),
    };
  }

  if (draft.operation === 'add') {
    const frameId = uuid();
    const newFrame: FrameOutline = {
      id: frameId,
      index: 0,
      title: draft.title.trim(),
      narration: draft.narration.trim(),
      imagePrompt: type === 'image' ? normalizeVisualPrompt(type, draft) : undefined,
      htmlPrompt: type === 'html' ? normalizeVisualPrompt(type, draft) : undefined,
      sceneSpec: type === 'html' ? draft.sceneSpec : undefined,
    };
    const afterIndex = clampInsertAfterIndex(draft.insertAfterIndex ?? outline.frames.length, outline.frames.length);
    const { outline: insertedOutline, insertAt } = insertFrameIntoOutline(outline, newFrame, afterIndex);
    let nextOutline = markPlanNeedsReview(insertedOutline);
    if (approveForGeneration) nextOutline = approveFrames(nextOutline, [frameId]);

    const nextVideoSource = realignVideoSource(nextOutline, videoSource);
    nextVideoSource.frames[insertAt] = { id: frameId };
    return { outline: nextOutline, videoSource: nextVideoSource, frameId };
  }

  const targetIndex = findTargetIndex(outline, draft);
  const targetFrame = outline.frames[targetIndex];
  const visualPrompt = normalizeVisualPrompt(type, draft);
  const frames = outline.frames.map((frame, index) => index === targetIndex
    ? {
        ...frame,
        title: draft.title.trim(),
        narration: draft.narration.trim(),
        imagePrompt: type === 'image' ? visualPrompt : frame.imagePrompt,
        htmlPrompt: type === 'html' ? visualPrompt : frame.htmlPrompt,
        sceneSpec: type === 'html' ? draft.sceneSpec || frame.sceneSpec : frame.sceneSpec,
      }
    : frame);
  let nextOutline = invalidateFrameApproval(syncOutlineContent({ ...outline, frames }), targetFrame.id);
  if (approveForGeneration) nextOutline = approveFrames(nextOutline, [targetFrame.id]);

  const nextVideoSource = realignVideoSource(nextOutline, videoSource);
  nextVideoSource.frames[targetIndex] = { id: targetFrame.id };
  return { outline: nextOutline, videoSource: nextVideoSource, frameId: targetFrame.id };
}

export function applyFrameStructureDraft(opts: {
  type: ProjectType;
  outline: Outline;
  videoSource: VideoSource;
  draft: FrameStructureDraft;
  approveForGeneration?: boolean;
}): ApplyFrameStructureDraftResult {
  const { type, outline, videoSource, draft, approveForGeneration = false } = opts;
  const previousCollaboration = getCollaborationState(outline);
  const targetIndexes = draft.targetFrameIds.map(id => outline.frames.findIndex(frame => frame.id === id));
  if (targetIndexes.some(index => index < 0)) {
    throw new Error('目标分镜不存在或已被修改，请重新生成结构草稿');
  }
  const sortedIndexes = [...targetIndexes].sort((a, b) => a - b);
  if (sortedIndexes.some((index, offset) => offset > 0 && index !== sortedIndexes[offset - 1] + 1)) {
    throw new Error('只能合并连续分镜');
  }

  const startIndex = sortedIndexes[0];
  const firstTarget = outline.frames[startIndex];
  let replacements: FrameOutline[];
  let removeCount: number;

  if (draft.operation === 'split') {
    if (draft.targetFrameIds.length !== 1 || draft.frames.length < 2 || draft.frames.length > 4) {
      throw new Error('拆分草稿必须包含一个目标和 2–4 个新分镜');
    }
    replacements = draft.frames.map((item, index) => structureItemToFrame({
      type,
      item,
      id: index === 0 ? firstTarget.id : uuid(),
      base: index === 0 ? firstTarget : undefined,
    }));
    removeCount = 1;
  } else {
    if (draft.targetFrameIds.length < 2 || draft.frames.length !== 1) {
      throw new Error('合并草稿必须包含至少两个目标和一个合并结果');
    }
    replacements = [structureItemToFrame({ type, item: draft.frames[0], id: firstTarget.id, base: firstTarget })];
    removeCount = draft.targetFrameIds.length;
  }

  const frames = [
    ...outline.frames.slice(0, startIndex),
    ...replacements,
    ...outline.frames.slice(startIndex + removeCount),
  ].map((frame, index) => ({ ...frame, index: index + 1 }));

  let nextOutline = markPlanNeedsReview(syncOutlineContent({ ...outline, frames }));
  const frameIds = replacements.map(frame => frame.id);
  if (approveForGeneration) nextOutline = approveFrames(nextOutline, frameIds);
  if (approveForGeneration && previousCollaboration.planApproved) {
    nextOutline = approvePlan(nextOutline, previousCollaboration.planApprovedAt);
  }
  const nextVideoSource = realignVideoSource(nextOutline, videoSource);
  const affected = new Set(frameIds);
  nextVideoSource.frames = nextVideoSource.frames.map(source => affected.has(source.id) ? { id: source.id } : source);
  return { outline: nextOutline, videoSource: nextVideoSource, frameIds };
}

export function isDraftStale(baseUpdatedAt: string, projectUpdatedAt: Date | string) {
  const current = typeof projectUpdatedAt === 'string' ? projectUpdatedAt : projectUpdatedAt.toISOString();
  return Boolean(baseUpdatedAt && baseUpdatedAt !== current);
}

export function buildDraftFromFrame(opts: {
  operation: 'modify' | 'delete';
  frame: FrameOutline;
  type: ProjectType;
  baseUpdatedAt: string;
  freshStart?: boolean;
}): FrameReviewDraft {
  const { operation, frame, type, baseUpdatedAt, freshStart } = opts;
  return {
    operation,
    targetFrameId: frame.id,
    insertAfterIndex: frame.index - 1,
    ...(freshStart ? { freshStart: true } : {}),
    title: frame.title,
    narration: frame.narration,
    visualPrompt: visualPromptFromFrame(type, frame),
    imagePrompt: frame.imagePrompt,
    htmlPrompt: frame.htmlPrompt,
    sceneSpec: frame.sceneSpec,
    baseUpdatedAt,
  };
}

export function buildAddDraft(opts: {
  frame: FrameOutline;
  insertAfterIndex: number;
  type: ProjectType;
  baseUpdatedAt: string;
}): FrameReviewDraft {
  const { frame, insertAfterIndex, type, baseUpdatedAt } = opts;
  return {
    operation: 'add',
    insertAfterIndex,
    title: frame.title,
    narration: frame.narration,
    visualPrompt: visualPromptFromFrame(type, frame),
    imagePrompt: frame.imagePrompt,
    htmlPrompt: frame.htmlPrompt,
    sceneSpec: frame.sceneSpec,
    baseUpdatedAt,
  };
}

function findTargetIndex(outline: Outline, draft: FrameReviewDraft) {
  const targetIndex = outline.frames.findIndex(frame => frame.id === draft.targetFrameId);
  if (targetIndex < 0) throw new Error('分镜不存在或已被修改，请重新生成草稿');
  return targetIndex;
}

function normalizeVisualPrompt(type: ProjectType, draft: FrameReviewDraft) {
  if (type === 'html') {
    return (
      draft.visualPrompt
      || draft.htmlPrompt
      || htmlPromptFromSceneSpec(draft.sceneSpec)
    ).trim();
  }
  return (draft.visualPrompt || draft.imagePrompt || '').trim();
}

function structureItemToFrame(opts: {
  type: ProjectType;
  item: FrameStructureItemDraft;
  id: string;
  base?: FrameOutline;
}): FrameOutline {
  const { type, item, id, base } = opts;
  const visualPrompt = type === 'html'
    ? (item.visualPrompt || item.htmlPrompt || htmlPromptFromSceneSpec(item.sceneSpec)).trim()
    : (item.visualPrompt || item.imagePrompt || '').trim();
  return {
    ...(base || {}),
    id,
    index: 0,
    title: item.title.trim(),
    narration: item.narration.trim(),
    imagePrompt: type === 'image' ? visualPrompt : undefined,
    htmlPrompt: type === 'html' ? visualPrompt : undefined,
    sceneSpec: type === 'html' ? item.sceneSpec : undefined,
  };
}

function visualPromptFromFrame(type: ProjectType, frame: FrameOutline) {
  if (type === 'html') {
    return (
      frame.htmlPrompt
      || htmlPromptFromSceneSpec(frame.sceneSpec)
      || frame.sceneSpec?.visualIntent
      || ''
    ).trim();
  }
  return (frame.imagePrompt || '').trim();
}

function htmlPromptFromSceneSpec(sceneSpec: FrameReviewDraft['sceneSpec']) {
  if (!sceneSpec) return '';
  const parts = [
    sceneSpec.focus ? `焦点：${sceneSpec.focus}` : '',
    sceneSpec.visualIntent ? `观众理解：${sceneSpec.visualIntent}` : '',
    sceneSpec.informationPool?.length ? `画面信息：${sceneSpec.informationPool.join('；')}` : '',
    sceneSpec.screenText?.length ? `屏幕文字：${sceneSpec.screenText.join(' / ')}` : '',
    sceneSpec.actionSemantics ? `内容关系：${sceneSpec.actionSemantics}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

function clampInsertAfterIndex(afterIndex: number, total: number) {
  return Math.max(0, Math.min(Math.floor(afterIndex), total));
}

export function hasPendingReview(metadata: unknown) {
  return Boolean(
    metadata
    && typeof metadata === 'object'
    && 'kind' in metadata
    && (metadata as { kind?: string }).kind === 'frame_review',
  );
}

export function getApprovedFrameIds(outline: Outline) {
  return getCollaborationState(outline).approvedFrameIds;
}
