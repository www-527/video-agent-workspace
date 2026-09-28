import { prisma } from '@/lib/db';
import { normalizeVideoSourceForFrames } from '@/lib/video-source';
import type { FrameOutline, FrameSource, Outline, VideoSource, VisualAnchor } from '@/types';

const COMMIT_ATTEMPTS = 3;

export class AgentCommitConflictError extends Error {
  readonly code = 'AGENT_COMMIT_CONFLICT';

  constructor(message = '项目在生成期间被其他操作修改，请重试当前分镜') {
    super(message);
    this.name = 'AgentCommitConflictError';
  }
}

/**
 * Applies one frame patch to freshly-read project state and uses updatedAt as
 * an optimistic lock. This prevents concurrent frame generation, tuning, and
 * quality repair from replacing one another's VideoSource changes.
 */
export async function commitFrameSourcePatch(options: {
  projectId: string;
  frameId: string;
  patch: Partial<FrameSource>;
  fallbackFrames: FrameOutline[];
  expected?: {
    htmlCode?: string;
    imageSelectionUpdatedAt?: string;
  };
}): Promise<FrameSource[]> {
  for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt++) {
    const project = await prisma.project.findUnique({
      where: { uuid: options.projectId },
      select: { outline: true, videoSource: true, updatedAt: true },
    });
    if (!project) throw new Error('项目不存在');
    const outline = project.outline as unknown as Outline | null;
    const frames = outline?.frames?.length ? outline.frames : options.fallbackFrames;
    const currentVideoSource = normalizeVideoSourceForFrames(
      project.videoSource as unknown as VideoSource | null,
      frames,
    );
    const sources = currentVideoSource.frames;
    const sourceIndex = sources.findIndex(source => source.id === options.frameId);
    if (sourceIndex < 0) throw new AgentCommitConflictError('目标分镜已被删除或替换，未提交陈旧生成结果');
    if (options.expected) {
      const current = sources[sourceIndex];
      if (options.expected.htmlCode !== undefined && current.htmlCode !== options.expected.htmlCode) {
        throw new AgentCommitConflictError('画面在换图期间已被修改，请刷新后重试');
      }
      if (
        options.expected.imageSelectionUpdatedAt !== undefined
        && current.imageSelection?.updatedAt !== options.expected.imageSelectionUpdatedAt
      ) {
        throw new AgentCommitConflictError('候选图片列表已更新，请刷新后重试');
      }
    }
    sources[sourceIndex] = { ...sources[sourceIndex], ...options.patch, id: options.frameId };

    const updated = await prisma.project.updateMany({
      where: { uuid: options.projectId, updatedAt: project.updatedAt },
      data: { videoSource: { ...currentVideoSource, frames: sources } as any },
    });
    if (updated.count === 1) return sources;
  }
  throw new AgentCommitConflictError();
}

export async function commitVisualAnchor(options: {
  projectId: string;
  visualAnchor: VisualAnchor;
}): Promise<void> {
  for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt++) {
    const project = await prisma.project.findUnique({
      where: { uuid: options.projectId },
      select: { outline: true, updatedAt: true },
    });
    if (!project?.outline) throw new Error('项目大纲不存在');
    const outline = project.outline as unknown as Outline;
    const updated = await prisma.project.updateMany({
      where: { uuid: options.projectId, updatedAt: project.updatedAt },
      data: { outline: { ...outline, visualAnchor: options.visualAnchor } as any },
    });
    if (updated.count === 1) return;
  }
  throw new AgentCommitConflictError('视觉锚点提交发生冲突，请重试样片生成');
}
