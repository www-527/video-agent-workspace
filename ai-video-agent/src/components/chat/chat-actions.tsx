'use client';

import { Aperture, CheckCircle2, Download, ListTree, Mic, Palette, Play, RefreshCw, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCollaborationState } from '@/lib/collaboration';
import { cn } from '@/lib/utils';
import { getFrameSourceForOutlineFrame, isFrameSourceComplete } from '@/lib/video-source';
import type { MessageAction, MessageActionId, ProjectDetail } from '@/types';
import { isFrameVisualComplete } from '@/lib/scene-contract';

export type ProjectStage =
  | 'no_outline'
  | 'outline_ready'
  | 'plan_approved'
  | 'sample_generated'
  | 'visual_anchor_approved'
  | 'frames_generated'
  | 'ready_to_export';

const CONTEXT_ACTION_IDS = new Set<MessageActionId>([
  'view_outline',
  'regenerate_audio',
  'open_style_picker',
  'open_tts_provider',
]);
const GLOBAL_STAGE_ACTION_IDS = new Set<MessageActionId>(['approve_plan', 'generate_all', 'export_video']);

interface ChatActionsProps {
  project: ProjectDetail;
  metadataActions?: MessageAction[];
  hasOutlineCard?: boolean;
  onAction: (action: MessageAction) => void;
}

export function ChatActions({ project, metadataActions, hasOutlineCard = false, onAction }: ChatActionsProps) {
  const actions = metadataActions
    ? buildFrozenActions(metadataActions, project, { hasOutlineCard })
    : buildNextActions(project, [], { hasOutlineCard });

  if (!actions.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {actions.map(action => (
        <Button
          key={`${action.id}-${action.frameId || action.label}`}
          size="sm"
          variant={buttonVariant(action)}
          disabled={action.disabled}
          className={cn(
            'h-7 px-2 text-xs',
            action.completed && 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50',
          )}
          onClick={() => onAction(action)}
        >
          <ActionIcon id={action.id} completed={action.completed} forceVisual={action.forceVisual} />
          {action.label}
        </Button>
      ))}
    </div>
  );
}

export function buildFrozenActions(
  metadataActions: MessageAction[],
  project: ProjectDetail,
  options: { hasOutlineCard?: boolean } = {},
): MessageAction[] {
  const collaboration = getCollaborationState(project.outline);
  const approvedFrameIds = new Set(collaboration.approvedFrameIds);
  const hasApprovedAnchor = isVisualAnchorApproved(project);
  const allFramesGenerated = areAllFramesGenerated(project);
  const actions = metadataActions
    .filter(action => !GLOBAL_STAGE_ACTION_IDS.has(action.id))
    .filter(action => !(options.hasOutlineCard && action.id === 'view_outline'))
    .filter(action => action.id !== 'view_outline' || Boolean(project.outline))
    .filter(action => action.id !== 'export_video' || allFramesGenerated)
    .flatMap(action => {
      if (action.id === 'approve_plan' && collaboration.planApproved) {
        return [];
      }
      if (action.id === 'approve_frame' && action.frameId && approvedFrameIds.has(action.frameId)) {
        return [{
          ...action,
          label: '内容计划已确认',
          variant: 'secondary' as const,
          disabled: true,
          completed: true,
        }];
      }
      if (action.id === 'generate_sample' && action.forceVisual && hasApprovedAnchor) {
        return [{
          ...action,
          label: '主题风格已确认',
          variant: 'secondary' as const,
          disabled: true,
          completed: true,
        }];
      }
      return [action];
    });

  return dedupeActions(actions);
}

export function isVisualAnchorApproved(project: ProjectDetail) {
  return Boolean(project.outline?.visualAnchor?.approvedFrameIds.length);
}

export function getProjectStage(project: ProjectDetail): ProjectStage {
  const outline = project.outline;
  if (!outline?.frames.length) return 'no_outline';

  const collaboration = getCollaborationState(outline);
  if (!collaboration.planApproved) return 'outline_ready';

  if (areAllFramesGenerated(project)) return 'frames_generated';

  if (project.type === 'image') return 'plan_approved';

  const hasApprovedAnchor = isVisualAnchorApproved(project);
  if (hasApprovedAnchor) return 'visual_anchor_approved';

  if (hasFirstFrameSample(project)) return 'sample_generated';

  return 'plan_approved';
}

export function buildNextActions(
  project: ProjectDetail,
  metadataActions: MessageAction[] = [],
  options: { hasOutlineCard?: boolean } = {},
): MessageAction[] {
  const contextActions = metadataActions
    .filter(action => CONTEXT_ACTION_IDS.has(action.id))
    .filter(action => !(options.hasOutlineCard && action.id === 'view_outline'))
    .filter(action => action.id !== 'view_outline' || Boolean(project.outline));

  return dedupeActions(contextActions);
}

function buildStageActions(project: ProjectDetail, stage: ProjectStage): MessageAction[] {
  switch (stage) {
    case 'no_outline':
      return [];
    case 'outline_ready':
      return [{ id: 'approve_plan', label: '确认大纲并生成完整视频', variant: 'default' }];
    case 'plan_approved':
      return [{ id: 'generate_all', label: '继续生成完整视频', variant: 'default' }];
    case 'sample_generated':
      return [{ id: 'generate_all', label: '继续生成完整视频', variant: 'default' }];
    case 'visual_anchor_approved':
      return [{ id: 'generate_all', label: '继续生成完整视频', variant: 'default' }];
    case 'frames_generated':
    case 'ready_to_export':
      return [{ id: 'export_video', label: '导出视频', variant: 'default' }];
  }
}

function areAllFramesGenerated(project: ProjectDetail) {
  const frames = project.outline?.frames ?? [];
  if (!frames.length) return false;

  return frames.every((frame, index) => {
    const source = getFrameSourceForOutlineFrame(project.videoSource, frame.id, index);
    if (source?.id && source.id !== frame.id) return false;
    return isFrameSourceComplete(source, project.type, frame);
  });
}

function hasFirstFrameSample(project: ProjectDetail) {
  const firstFrame = project.outline?.frames[0];
  const firstSource = getFrameSourceForOutlineFrame(project.videoSource, firstFrame?.id, 0);
  if (!firstFrame || !firstSource) return false;
  if (firstSource.id && firstSource.id !== firstFrame.id) return false;
  return isFrameVisualComplete(firstSource, project.type, firstFrame);
}

function dedupeActions(actions: MessageAction[]) {
  const seen = new Set<string>();
  const result: MessageAction[] = [];

  for (const action of actions) {
    const key = action.id === 'regenerate_audio' || action.id === 'approve_frame'
      ? `${action.id}:${action.frameId || ''}`
      : action.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }

  return result;
}

function buttonVariant(action: MessageAction & { completed?: boolean }) {
  if (action.completed) return 'secondary';
  if (action.variant === 'default') return 'default';
  if (action.variant === 'secondary') return 'secondary';
  return 'outline';
}

function ActionIcon({ id, completed, forceVisual }: { id: MessageActionId; completed?: boolean; forceVisual?: boolean }) {
  const className = 'mr-1 h-3.5 w-3.5';
  if (completed) return <CheckCircle2 className={className} />;

  switch (id) {
    case 'view_outline':
      return <ListTree className={className} />;
    case 'approve_plan':
    case 'approve_frame':
    case 'confirm_visual_anchor':
      return <CheckCircle2 className={className} />;
    case 'generate_sample':
      return forceVisual ? <RefreshCw className={className} /> : <Aperture className={className} />;
    case 'generate_all':
      return <Play className={className} />;
    case 'regenerate_audio':
      return <Volume2 className={className} />;
    case 'open_style_picker':
      return <Palette className={className} />;
    case 'open_tts_provider':
      return <Mic className={className} />;
    case 'export_video':
      return <Download className={className} />;
    default:
      return null;
  }
}
