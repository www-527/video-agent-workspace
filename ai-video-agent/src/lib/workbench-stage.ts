import { getCollaborationState } from '@/lib/collaboration';
import { getFrameSourceForOutlineFrame, isFrameSourceComplete } from '@/lib/video-source';
import type { ProjectDetail } from '@/types';

export type WorkbenchStage =
  | 'no_outline'
  | 'outline_ready'
  | 'generating'
  | 'partial'
  | 'completed'
  | 'editing'
  | 'quality_blocked'
  | 'exporting';

export interface WorkbenchStageState {
  stage: WorkbenchStage;
  pendingFrameIds: string[];
  blockingIssueCount: number;
}

export function getPendingFrameIds(project: ProjectDetail): string[] {
  const frames = project.outline?.frames ?? [];
  const firstFrameId = frames[0]?.id;
  return frames
    .filter((frame, index) => {
      const source = getFrameSourceForOutlineFrame(project.videoSource, frame.id, index);
      if (source?.id && source.id !== frame.id) return true;
      if (project.type === 'html' && frame.id === firstFrameId && isFrameSourceComplete(source, project.type, frame)) return false;
      return !isFrameSourceComplete(source, project.type, frame);
    })
    .map(frame => frame.id);
}

export function resolveWorkbenchStage(
  project: ProjectDetail,
  state: {
    generating?: boolean;
    exporting?: boolean;
    editorDirty?: boolean;
    blockingIssueCount?: number;
  } = {},
): WorkbenchStageState {
  const blockingIssueCount = Math.max(0, state.blockingIssueCount ?? 0);
  const pendingFrameIds = getPendingFrameIds(project);
  let stage: WorkbenchStage;

  if (state.editorDirty) stage = 'editing';
  else if (state.exporting) stage = 'exporting';
  else if (state.generating) stage = 'generating';
  else if (!project.outline?.frames.length) stage = 'no_outline';
  else if (!getCollaborationState(project.outline).planApproved) stage = 'outline_ready';
  else if (pendingFrameIds.length) stage = 'partial';
  else if (blockingIssueCount) stage = 'quality_blocked';
  else stage = 'completed';

  return { stage, pendingFrameIds, blockingIssueCount };
}

export function getWorkbenchPrimaryLabel(state: WorkbenchStageState): string | null {
  switch (state.stage) {
    case 'no_outline': return null;
    case 'outline_ready': return '查看并确认大纲';
    case 'generating': return '生成中…';
    case 'partial': return `继续生成 ${state.pendingFrameIds.length} 个分镜`;
    case 'completed': return '导出视频';
    case 'editing': return null;
    case 'quality_blocked': return `全片剩余 ${state.blockingIssueCount} 个严重问题`;
    case 'exporting': return '导出中…';
  }
}
