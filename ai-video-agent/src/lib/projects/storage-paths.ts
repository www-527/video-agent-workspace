import { resolve, sep } from 'node:path';
import { rm } from 'node:fs/promises';

export const PROJECT_ASSET_ROOT = resolve(process.cwd(), 'data', 'project-assets');
export const PROJECT_CHECKPOINT_ROOT = resolve(process.cwd(), 'data', 'project-checkpoints');

export function assertSafeStorageSegment(value: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) {
    throw new Error(`${label} 非法`);
  }
  return value;
}

export function resolveInside(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...segments);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('存储路径越界');
  }
  return target;
}

export function resolveProjectAssetDirectory(projectId: string, assetId?: string): string {
  const segments = [assertSafeStorageSegment(projectId, '项目 ID')];
  if (assetId) segments.push(assertSafeStorageSegment(assetId, '附件 ID'));
  return resolveInside(PROJECT_ASSET_ROOT, ...segments);
}

export function resolveProjectCheckpointPath(projectId: string, checkpointId: string): string {
  return resolveInside(
    PROJECT_CHECKPOINT_ROOT,
    assertSafeStorageSegment(projectId, '项目 ID'),
    `${assertSafeStorageSegment(checkpointId, '检查点 ID')}.json.gz`,
  );
}

export async function removeProjectPrivateStorage(projectId: string): Promise<void> {
  const safeProjectId = assertSafeStorageSegment(projectId, '项目 ID');
  const assetDirectory = resolveInside(PROJECT_ASSET_ROOT, safeProjectId);
  const checkpointDirectory = resolveInside(PROJECT_CHECKPOINT_ROOT, safeProjectId);
  await Promise.all([
    rm(assetDirectory, { recursive: true, force: true }),
    rm(checkpointDirectory, { recursive: true, force: true }),
  ]);
}
