import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { prisma } from '@/lib/db';
import { createProjectStateHash, projectStatePayload, type ProjectStateInput } from './state-hash';
import { PROJECT_CHECKPOINT_ROOT, resolveProjectCheckpointPath } from './storage-paths';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const MAX_CHECKPOINTS_PER_PROJECT = 20;
const MAX_CHECKPOINT_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export interface ProjectCheckpointSnapshot extends ProjectStateInput {
  version: 'project-checkpoint-v1';
  projectId: string;
  capturedAt: string;
  briefStatus?: string;
}

export async function loadCurrentProjectState(projectId: string): Promise<{
  project: NonNullable<Awaited<ReturnType<typeof findProjectState>>>;
  state: ProjectStateInput;
  stateHash: string;
}> {
  const project = await findProjectState(projectId);
  if (!project) throw new Error('项目不存在');
  const assetBindings = project.assets.map(asset => ({
    id: asset.id,
    status: asset.status,
    inferredUsage: asset.inferredUsage,
  }));
  const state = projectStatePayload({ ...project, assetBindings });
  return { project, state, stateHash: createProjectStateHash(state) };
}

export async function createProjectCheckpoint(input: {
  projectId: string;
  reason: string;
  changeSetId?: string;
  summary?: Record<string, unknown>;
}): Promise<{ id: string; stateHash: string; snapshotHash: string; snapshotPath: string }> {
  const { project, state, stateHash } = await loadCurrentProjectState(input.projectId);
  const id = randomUUID();
  const snapshot: ProjectCheckpointSnapshot = {
    version: 'project-checkpoint-v1',
    projectId: input.projectId,
    capturedAt: new Date().toISOString(),
    briefStatus: project.briefStatus,
    ...state,
  };
  const compressed = await gzipAsync(Buffer.from(JSON.stringify(snapshot), 'utf8'));
  const snapshotHash = sha256(compressed);
  const absolutePath = resolveProjectCheckpointPath(input.projectId, id);
  const tempPath = `${absolutePath}.${randomUUID()}.tmp`;
  await mkdir(dirname(absolutePath), { recursive: true });
  try {
    await writeFile(tempPath, compressed, { flag: 'wx' });
    await rename(tempPath, absolutePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }

  const snapshotPath = relative(process.cwd(), absolutePath).replaceAll('\\', '/');
  try {
    await prisma.projectCheckpoint.create({
      data: {
        id,
        projectId: input.projectId,
        reason: input.reason.slice(0, 191),
        stateHash,
        snapshotPath,
        snapshotHash,
        summary: (input.summary ?? {}) as any,
        changeSetId: input.changeSetId,
      },
    });
  } catch (error) {
    await unlink(absolutePath).catch(() => {});
    throw error;
  }

  await pruneProjectCheckpoints(input.projectId).catch(() => {});
  return { id, stateHash, snapshotHash, snapshotPath };
}

export async function readProjectCheckpoint(projectId: string, checkpointId: string): Promise<ProjectCheckpointSnapshot> {
  const checkpoint = await prisma.projectCheckpoint.findFirst({
    where: { id: checkpointId, projectId },
  });
  if (!checkpoint) throw new Error('检查点不存在');
  const absolutePath = resolveStoredCheckpointPath(checkpoint.snapshotPath);
  const compressed = await readFile(absolutePath);
  if (sha256(compressed) !== checkpoint.snapshotHash) throw new Error('检查点校验失败');
  const parsed = JSON.parse((await gunzipAsync(compressed)).toString('utf8')) as ProjectCheckpointSnapshot;
  if (parsed.version !== 'project-checkpoint-v1' || parsed.projectId !== projectId) {
    throw new Error('检查点内容无效');
  }
  if (createProjectStateHash(parsed) !== checkpoint.stateHash) throw new Error('检查点状态哈希不匹配');
  return parsed;
}

export async function pruneProjectCheckpoints(projectId: string): Promise<void> {
  const checkpoints = await prisma.projectCheckpoint.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, snapshotPath: true, createdAt: true, changeSetId: true },
  });
  const cutoff = Date.now() - MAX_CHECKPOINT_AGE_MS;
  const removable = checkpoints.filter((checkpoint, index) => (
    !checkpoint.changeSetId && (index >= MAX_CHECKPOINTS_PER_PROJECT || checkpoint.createdAt.getTime() < cutoff)
  ));
  for (const checkpoint of removable) {
    await prisma.projectCheckpoint.delete({ where: { id: checkpoint.id } });
    await unlink(resolveStoredCheckpointPath(checkpoint.snapshotPath)).catch(() => {});
  }
}

async function findProjectState(projectId: string) {
  return prisma.project.findUnique({
    where: { uuid: projectId },
    select: {
      uuid: true,
      updatedAt: true,
      outline: true,
      videoSource: true,
      styleId: true,
      contentStyle: true,
      gptOptimization: true,
      projectBrief: true,
      briefStatus: true,
      assets: {
        where: { status: { not: 'deleted' } },
        orderBy: { id: 'asc' },
        select: { id: true, status: true, inferredUsage: true },
      },
    },
  });
}

function resolveStoredCheckpointPath(snapshotPath: string): string {
  const root = resolve(PROJECT_CHECKPOINT_ROOT);
  const target = resolve(process.cwd(), snapshotPath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error('检查点路径越界');
  return target;
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
