import { prisma } from '@/lib/db';
import { normalizeVideoSourceForFrames } from '@/lib/video-source';
import { getRepairJob, withRepairJob } from './repair-jobs';
import type { FrameRepairJob, Outline, VideoSource } from '@/types';

const REPAIR_JOB_COMMIT_ATTEMPTS = 5;

/**
 * Merges one repair job into the latest VideoSource with an optimistic lock.
 * Batch repair can register or cancel several frame jobs at once; a plain
 * read-then-update would otherwise let the last request erase sibling jobs.
 */
export async function commitRepairJobState(options: {
  projectId: string;
  frameId: string;
  jobId: string;
  status: FrameRepairJob['status'];
}): Promise<FrameRepairJob> {
  for (let attempt = 0; attempt < REPAIR_JOB_COMMIT_ATTEMPTS; attempt++) {
    const project = await prisma.project.findUnique({
      where: { uuid: options.projectId },
      select: { outline: true, videoSource: true, updatedAt: true },
    });
    if (!project?.outline) throw new Error('项目或大纲不存在');

    const outline = project.outline as unknown as Outline;
    if (!outline.frames.some(frame => frame.id === options.frameId)) throw new Error('当前分镜不存在');
    const source = normalizeVideoSourceForFrames(project.videoSource as unknown as VideoSource | null, outline.frames);
    const existing = getRepairJob(source, options.jobId);
    if (existing && existing.frameId !== options.frameId) throw new Error('修复任务与分镜不匹配');

    const now = new Date().toISOString();
    const job: FrameRepairJob = {
      frameId: options.frameId,
      status: options.status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const updated = await prisma.project.updateMany({
      where: { uuid: options.projectId, updatedAt: project.updatedAt },
      data: { videoSource: withRepairJob(source, options.jobId, job) as any },
    });
    if (updated.count === 1) return job;
  }
  throw new Error('修复任务状态提交冲突，请重试');
}
