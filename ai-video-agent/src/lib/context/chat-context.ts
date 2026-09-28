import { prisma } from '@/lib/db';
import { extractEditableElements } from '@/lib/editor-command';
import { createProjectStateHash } from '@/lib/projects/state-hash';
import type { AgentActionRequest, ChatContextSnapshot, FrameOutline, Outline, VideoSource } from '@/types';

const PROJECT_SCOPE_PATTERN = /整个视频|整条视频|完整视频|全片|整体|前半段|后半段|所有镜头|全局/;
const PROJECT_CONCEPT_PATTERN = /节奏|风格一致|一致性|开头|结尾|片头|片尾/;
const DEICTIC_PATTERN = /这个|这里|这张图|这幅图|刚才那个|当前(?:画面|镜头)?|它/;
const ELEMENT_PATTERN = /标题|卡片|图片|图像|文字|按钮|元素|字号|小一点|大一点|位置|颜色/;

export class ContextValidationError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'ContextValidationError';
  }
}

export interface ResolvedChatContext {
  snapshot: ChatContextSnapshot;
  ambiguous: boolean;
}

export async function createChatContextSnapshot(input: {
  projectId: string;
  content: string;
  context: AgentActionRequest['context'];
}): Promise<ResolvedChatContext> {
  const project = await prisma.project.findUnique({
    where: { uuid: input.projectId },
    select: {
      uuid: true,
      type: true,
      updatedAt: true,
      outline: true,
      videoSource: true,
      styleId: true,
      contentStyle: true,
      gptOptimization: true,
      projectBrief: true,
      assets: {
        where: { status: { not: 'deleted' } },
        orderBy: { id: 'asc' },
        select: { id: true, status: true, inferredUsage: true },
      },
    },
  });
  if (!project) throw new ContextValidationError('项目不存在');
  const outline = project.outline as unknown as Outline | null;
  const videoSource = project.videoSource as unknown as VideoSource | null;
  const frames = outline?.frames ?? [];
  const selectedFrame = resolveSelectedFrame(input.content, input.context.selectedFrameId, frames);
  if (input.context.selectedFrameId && !frames.some(frame => frame.id === input.context.selectedFrameId)) {
    throw new ContextValidationError('当前选择的分镜已经变化，请刷新后重新选择。');
  }

  const explicitFrameIndex = parseExplicitFrameIndex(input.content);
  if (explicitFrameIndex !== null && !frames[explicitFrameIndex]) {
    throw new ContextValidationError(`第 ${explicitFrameIndex + 1} 镜不存在，请检查当前内容计划。`);
  }

  const stateHash = createProjectStateHash({
    outline: project.outline,
    videoSource: project.videoSource,
    styleId: project.styleId,
    contentStyle: project.contentStyle,
    gptOptimization: project.gptOptimization,
    projectBrief: project.projectBrief,
    assetBindings: project.assets,
  });
  const resolution = resolveScope({
    content: input.content,
    scopeHint: input.context.scopeHint,
    selectedFrame,
    selectedElementIds: input.context.selectedElementIds ?? [],
    explicitFrame: explicitFrameIndex === null ? null : frames[explicitFrameIndex],
  });
  const targetFrame = resolution.frame;
  const source = targetFrame ? videoSource?.frames.find(frame => frame.id === targetFrame.id) : undefined;
  const elementSummary = resolution.scope === 'element'
    ? validateElements(source?.htmlCode, input.context.selectedElementIds ?? [])
    : undefined;
  const playbackTimeMs = targetFrame && input.context.playbackTimeMs !== undefined
    ? Math.max(0, Math.round(input.context.playbackTimeMs))
    : undefined;

  return {
    ambiguous: resolution.ambiguous,
    snapshot: {
      version: 'chat-context-v1',
      projectId: project.uuid,
      projectUpdatedAt: project.updatedAt.toISOString(),
      projectStateHash: stateHash,
      resolvedScope: resolution.scope,
      ...(targetFrame ? { selectedFrameId: targetFrame.id } : {}),
      ...(elementSummary?.length ? { selectedElementIds: elementSummary.map(element => element.id) } : {}),
      ...(playbackTimeMs !== undefined ? { playbackTimeMs } : {}),
      ...(targetFrame ? {
        frameSummary: {
          title: targetFrame.title,
          narration: targetFrame.narration,
          durationSeconds: frameDurationSeconds(targetFrame, source?.audioDuration),
          renderMode: targetFrame.sceneSpec?.renderMode || project.type,
        },
      } : {}),
      ...(elementSummary?.length ? { elementSummary } : {}),
    },
  };
}

export function resolveScope(input: {
  content: string;
  scopeHint?: AgentActionRequest['context']['scopeHint'];
  selectedFrame?: FrameOutline | null;
  selectedElementIds?: string[];
  explicitFrame?: FrameOutline | null;
}): { scope: 'project' | 'frame' | 'element'; frame: FrameOutline | null; ambiguous: boolean } {
  const selectedFrame = input.explicitFrame || input.selectedFrame || null;
  const selectedElements = input.selectedElementIds ?? [];
  if (PROJECT_SCOPE_PATTERN.test(input.content)) return { scope: 'project', frame: null, ambiguous: false };
  if (input.explicitFrame) return { scope: 'frame', frame: input.explicitFrame, ambiguous: false };
  if (selectedFrame && selectedElements.length && DEICTIC_PATTERN.test(input.content) && ELEMENT_PATTERN.test(input.content)) {
    return { scope: 'element', frame: selectedFrame, ambiguous: false };
  }
  if (selectedFrame && DEICTIC_PATTERN.test(input.content)) return { scope: 'frame', frame: selectedFrame, ambiguous: false };
  if (selectedFrame && selectedElements.length && ELEMENT_PATTERN.test(input.content)) {
    return { scope: 'element', frame: selectedFrame, ambiguous: false };
  }
  if (PROJECT_CONCEPT_PATTERN.test(input.content)) return { scope: 'project', frame: null, ambiguous: false };
  if (input.scopeHint === 'project') return { scope: 'project', frame: null, ambiguous: false };
  if (input.scopeHint === 'element' && selectedFrame && selectedElements.length) {
    return { scope: 'element', frame: selectedFrame, ambiguous: false };
  }
  if (input.scopeHint === 'frame' && selectedFrame) return { scope: 'frame', frame: selectedFrame, ambiguous: false };
  if (selectedFrame) return { scope: 'frame', frame: selectedFrame, ambiguous: true };
  return { scope: 'project', frame: null, ambiguous: true };
}

function resolveSelectedFrame(content: string, selectedFrameId: string | undefined, frames: FrameOutline[]): FrameOutline | null {
  const explicitIndex = parseExplicitFrameIndex(content);
  if (explicitIndex !== null) return frames[explicitIndex] ?? null;
  return selectedFrameId ? frames.find(frame => frame.id === selectedFrameId) ?? null : null;
}

function parseExplicitFrameIndex(content: string): number | null {
  const match = content.match(/第\s*(\d+)\s*[镜幕]/);
  return match ? Number(match[1]) - 1 : null;
}

function validateElements(htmlCode: string | undefined, requestedIds: string[]) {
  if (!requestedIds.length) return [];
  if (!htmlCode) throw new ContextValidationError('当前分镜还没有可定位的画面元素。');
  const extracted = extractEditableElements(htmlCode);
  const byId = new Map(extracted.map(element => [element.id, element]));
  const missing = requestedIds.filter(id => !hasElementId(htmlCode, id));
  if (missing.length) throw new ContextValidationError('当前选择的画面元素已经变化，请重新选择。');
  return requestedIds.map(id => {
    const element = byId.get(id);
    return { id, label: element?.label || '已选元素', type: element?.type || 'visual' };
  });
}

function hasElementId(htmlCode: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`data-(?:editor|element)-id=["']${escaped}["']`, 'i').test(htmlCode);
}

function frameDurationSeconds(frame: FrameOutline, audioDuration?: number): number {
  if (audioDuration && Number.isFinite(audioDuration)) return Math.max(0.1, audioDuration);
  if (frame.sceneSpec?.durationHint) return Math.max(0.1, frame.sceneSpec.durationHint);
  return Math.max(3, Math.round(frame.narration.replace(/\s+/g, '').length / 4.2));
}
