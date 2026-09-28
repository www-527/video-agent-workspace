import type { CollaborationState, FrameStructureDraft, Outline } from '@/types';

export function getCollaborationState(outline?: Outline | null): CollaborationState {
  const validIds = new Set(outline?.frames.map(frame => frame.id) || []);
  const current = outline?.collaboration;
  return {
    mode: 'guided',
    planApproved: Boolean(current?.planApproved),
    planApprovedAt: current?.planApprovedAt,
    approvedFrameIds: (current?.approvedFrameIds || []).filter(id => validIds.has(id)),
  };
}

export function initializeCollaboration(outline: Outline): Outline {
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

export function approvePlan(outline: Outline, approvedAt = new Date().toISOString()): Outline {
  return {
    ...outline,
    collaboration: {
      ...getCollaborationState(outline),
      planApproved: true,
      planApprovedAt: approvedAt,
    },
  };
}

export function approveFrames(outline: Outline, frameIds: string[]): Outline {
  const state = getCollaborationState(outline);
  const validIds = new Set(outline.frames.map(frame => frame.id));
  const approvedFrameIds = Array.from(new Set([
    ...state.approvedFrameIds,
    ...frameIds.filter(id => validIds.has(id)),
  ]));
  return { ...outline, collaboration: { ...state, approvedFrameIds } };
}

export function areFramesApprovedForGeneration(outline: Outline, frameIds?: string[]): boolean {
  if (!frameIds?.length) return false;
  const validIds = new Set(outline.frames.map(frame => frame.id));
  const approvedIds = new Set(getCollaborationState(outline).approvedFrameIds);
  return frameIds.every(id => validIds.has(id) && approvedIds.has(id));
}

export function findAppliedFrameStructureIds(outline: Outline, draft: FrameStructureDraft): string[] | null {
  const approvedIds = new Set(getCollaborationState(outline).approvedFrameIds);
  const firstIndex = outline.frames.findIndex(frame => frame.id === draft.targetFrameIds[0]);
  if (firstIndex < 0) return null;

  if (draft.operation === 'split') {
    const candidates = outline.frames.slice(firstIndex, firstIndex + draft.frames.length).map(frame => frame.id);
    return candidates.length === draft.frames.length && candidates.every(id => approvedIds.has(id))
      ? candidates
      : null;
  }

  const removedTargetIds = draft.targetFrameIds.slice(1);
  const remainingIds = new Set(outline.frames.map(frame => frame.id));
  return approvedIds.has(draft.targetFrameIds[0]) && removedTargetIds.every(id => !remainingIds.has(id))
    ? [draft.targetFrameIds[0]]
    : null;
}

export function invalidateFrameApproval(outline: Outline, frameId: string): Outline {
  const state = getCollaborationState(outline);
  const invalidatesAnchor = Boolean(outline.visualAnchor?.approvedFrameIds.includes(frameId));
  return {
    ...outline,
    visualAnchor: invalidatesAnchor ? undefined : outline.visualAnchor,
    collaboration: {
      ...state,
      approvedFrameIds: state.approvedFrameIds.filter(id => id !== frameId),
    },
  };
}
