import { createHash } from 'node:crypto';
import { stableSerialize } from '@/lib/agents/hash';

export interface ProjectStateInput {
  outline: unknown;
  videoSource: unknown;
  styleId: string | null;
  contentStyle: unknown;
  gptOptimization: unknown;
  projectBrief: unknown;
  assetBindings?: unknown;
}

export function projectStatePayload(project: ProjectStateInput): ProjectStateInput {
  return {
    outline: project.outline ?? null,
    videoSource: project.videoSource ?? null,
    styleId: project.styleId ?? null,
    contentStyle: project.contentStyle ?? null,
    gptOptimization: project.gptOptimization ?? null,
    projectBrief: project.projectBrief ?? null,
    assetBindings: project.assetBindings ?? null,
  };
}

export function createProjectStateHash(project: ProjectStateInput): string {
  return createHash('sha256').update(stableSerialize(projectStatePayload(project))).digest('hex');
}
