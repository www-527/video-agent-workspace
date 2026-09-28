import type { FrameRepairJob, VideoSource } from '@/types';

const globalRepairJobs = globalThis as typeof globalThis & {
  qualityRepairAbortControllers?: Map<string, AbortController>;
};

const repairAbortControllers = globalRepairJobs.qualityRepairAbortControllers ?? new Map<string, AbortController>();

if (!globalRepairJobs.qualityRepairAbortControllers) {
  globalRepairJobs.qualityRepairAbortControllers = repairAbortControllers;
}

export function getRepairJob(source: VideoSource, jobId: string) {
  return source.repairJobs?.[jobId];
}

export function isRepairJobRunning(source: VideoSource, jobId: string, frameId: string) {
  const job = getRepairJob(source, jobId);
  return Boolean(job && job.frameId === frameId && job.status === 'running');
}

export function withRepairJob(source: VideoSource, jobId: string, job: FrameRepairJob): VideoSource {
  return {
    ...source,
    repairJobs: { ...(source.repairJobs ?? {}), [jobId]: job },
  };
}

export function registerRepairJobAbort(jobId: string, controller: AbortController) {
  repairAbortControllers.get(jobId)?.abort();
  repairAbortControllers.set(jobId, controller);
}

export function abortRepairJob(jobId: string) {
  repairAbortControllers.get(jobId)?.abort();
}

export function unregisterRepairJobAbort(jobId: string, controller: AbortController) {
  if (repairAbortControllers.get(jobId) === controller) repairAbortControllers.delete(jobId);
}
