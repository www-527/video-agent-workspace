import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { imageSize } from 'image-size';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { throwIfAborted } from '@/lib/agents/cancellation';
import { readProjectCheckpoint } from '@/lib/projects/checkpoints';
import { PROJECT_ASSET_ROOT, resolveProjectAssetDirectory } from '@/lib/projects/storage-paths';
import type { AssetSummary, ProjectAssetUsage, ProjectBrief } from '@/types';
import { AssetValidationError } from './constants';
import { extractDocument, type DocumentDigest, type ExtractedDocument } from './document';
import { validateAssetUpload } from './validation';

export class AssetServiceError extends Error {
  constructor(readonly status: number, message: string, readonly code = 'asset_error') {
    super(message);
    this.name = 'AssetServiceError';
  }
}

export async function listProjectAssets(projectId: string): Promise<AssetSummary[]> {
  const assets = await prisma.projectAsset.findMany({
    where: { projectId, status: { not: 'deleted' } },
    orderBy: { createdAt: 'asc' },
  });
  return assets.map(toAssetSummary);
}

export async function createProjectAssetFromFile(input: {
  projectId: string;
  file: File;
  abortSignal?: AbortSignal;
}): Promise<{ asset: AssetSummary; deduplicated: boolean }> {
  throwIfAborted(input.abortSignal);
  const project = await prisma.project.findUnique({ where: { uuid: input.projectId }, select: { uuid: true } });
  if (!project) throw new AssetServiceError(404, '项目不存在', 'project_not_found');

  const buffer = Buffer.from(await input.file.arrayBuffer());
  throwIfAborted(input.abortSignal);
  const contentHash = createHash('sha256').update(buffer).digest('hex');
  const duplicate = await prisma.projectAsset.findUnique({
    where: { projectId_contentHash: { projectId: input.projectId, contentHash } },
  });
  if (duplicate && duplicate.status !== 'deleted') {
    return { asset: toAssetSummary(duplicate), deduplicated: true };
  }

  const id = duplicate?.id ?? randomUUID();
  const directory = resolveProjectAssetDirectory(input.projectId, id);
  const tempPath = resolve(directory, `${randomUUID()}.uploading`);
  await mkdir(directory, { recursive: true });
  await writeFile(tempPath, buffer, { flag: 'wx' });

  try {
    const validated = await validateAssetUpload({
      originalName: input.file.name,
      declaredMimeType: input.file.type,
      buffer,
    });
    throwIfAborted(input.abortSignal);
    const originalPath = resolve(directory, `original${validated.extension}`);
    await rename(tempPath, originalPath);
    const storagePath = relative(process.cwd(), originalPath).replaceAll('\\', '/');
    const inferredUsage = inferUsage(validated.kind, input.file.name);
    const asset = duplicate
      ? await prisma.projectAsset.update({
        where: { id },
        data: {
          kind: validated.kind,
          mimeType: validated.mimeType,
          originalName: safeOriginalName(input.file.name),
          storagePath,
          byteLength: buffer.length,
          status: 'processing',
          inferredUsage,
          summary: Prisma.JsonNull,
          metadata: Prisma.JsonNull,
          errorCode: null,
          errorMessage: null,
        },
      })
      : await prisma.projectAsset.create({
        data: {
          id,
          projectId: input.projectId,
          kind: validated.kind,
          mimeType: validated.mimeType,
          originalName: safeOriginalName(input.file.name),
          storagePath,
          contentHash,
          byteLength: buffer.length,
          status: 'processing',
          inferredUsage,
        },
      });
    const processed = await processProjectAsset(asset.id, input.abortSignal);
    return { asset: toAssetSummary(processed), deduplicated: false };
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    if (error instanceof AssetValidationError) {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
      throw new AssetServiceError(error.status, error.message, error.code);
    }
    throw error;
  }
}

export async function processProjectAsset(assetId: string, abortSignal?: AbortSignal) {
  const asset = await prisma.projectAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.status === 'deleted') throw new AssetServiceError(404, '附件不存在', 'asset_not_found');
  try {
    throwIfAborted(abortSignal);
    const originalPath = resolveStoredAssetPath(asset.projectId, asset.id, asset.storagePath);
    const buffer = await readFile(originalPath);
    throwIfAborted(abortSignal);
    if (asset.kind === 'image') {
      const dimensions = imageSize(buffer);
      if (!dimensions.width || !dimensions.height) throw new AssetValidationError('invalid_image', '无法读取图片尺寸。');
      return await prisma.projectAsset.update({
        where: { id: asset.id },
        data: {
          status: 'ready',
          summary: {
            width: dimensions.width,
            height: dimensions.height,
            digest: `${dimensions.width} × ${dimensions.height} ${asset.mimeType.replace('image/', '').toUpperCase()} 图片`,
          },
          metadata: { width: dimensions.width, height: dimensions.height },
          errorCode: null,
          errorMessage: null,
        },
      });
    }

    const { extracted, digest } = await extractDocument(buffer, asset.mimeType as Parameters<typeof extractDocument>[1], asset.originalName);
    throwIfAborted(abortSignal);
    const directory = resolveProjectAssetDirectory(asset.projectId, asset.id);
    await Promise.all([
      writePrivateJson(resolve(directory, 'extracted.json'), extracted),
      writePrivateJson(resolve(directory, 'digest.json'), digest),
    ]);
    return await prisma.projectAsset.update({
      where: { id: asset.id },
      data: {
        status: 'ready',
        summary: digest as any,
        metadata: { characterCount: digest.characterCount, chunkCount: digest.chunkCount },
        errorCode: null,
        errorMessage: null,
      },
    });
  } catch (error) {
    if (abortSignal?.aborted) throw error;
    const message = error instanceof Error ? error.message : '附件处理失败';
    const code = error instanceof AssetValidationError ? error.code : 'processing_failed';
    await prisma.projectAsset.update({
      where: { id: asset.id },
      data: { status: 'failed', errorCode: code, errorMessage: message.slice(0, 2_000) },
    });
    return (await prisma.projectAsset.findUnique({ where: { id: asset.id } }))!;
  }
}

export async function retryProjectAsset(projectId: string, assetId: string, abortSignal?: AbortSignal): Promise<AssetSummary> {
  const asset = await prisma.projectAsset.findFirst({ where: { id: assetId, projectId, status: 'failed' } });
  if (!asset) throw new AssetServiceError(404, '没有可重试的附件', 'asset_not_retryable');
  await prisma.projectAsset.update({
    where: { id: assetId },
    data: { status: 'processing', errorCode: null, errorMessage: null },
  });
  return toAssetSummary(await processProjectAsset(assetId, abortSignal));
}

export async function updateProjectAssetUsage(input: {
  projectId: string;
  assetId: string;
  usage: 'must' | 'optional' | 'reference' | 'excluded';
}): Promise<AssetSummary> {
  const asset = await prisma.projectAsset.findFirst({ where: { id: input.assetId, projectId: input.projectId, status: { not: 'deleted' } } });
  if (!asset) throw new AssetServiceError(404, '附件不存在', 'asset_not_found');
  const project = await prisma.project.findUnique({ where: { uuid: input.projectId }, select: { projectBrief: true } });
  const brief = project?.projectBrief as unknown as ProjectBrief | null;
  await prisma.$transaction(async tx => {
    await tx.projectAsset.update({
      where: { id: input.assetId },
      data: {
        metadata: {
          ...(asset.metadata && typeof asset.metadata === 'object' ? asset.metadata as Record<string, unknown> : {}),
          userUsage: input.usage,
        } as any,
      },
    });
    if (brief?.version === 'project-brief-v1') {
      const remove = (values: string[]) => values.filter(id => id !== input.assetId);
      const next: ProjectBrief = {
        ...brief,
        mustUseAssetIds: remove(brief.mustUseAssetIds),
        optionalAssetIds: remove(brief.optionalAssetIds),
        excludedAssetIds: remove(brief.excludedAssetIds),
      };
      if (input.usage === 'must') next.mustUseAssetIds.push(input.assetId);
      if (input.usage === 'optional') next.optionalAssetIds.push(input.assetId);
      if (input.usage === 'excluded') next.excludedAssetIds.push(input.assetId);
      await tx.project.update({ where: { uuid: input.projectId }, data: { projectBrief: next as any } });
    }
  });
  return toAssetSummary((await prisma.projectAsset.findUnique({ where: { id: input.assetId } }))!);
}

export async function deleteProjectAsset(projectId: string, assetId: string): Promise<void> {
  const asset = await prisma.projectAsset.findFirst({ where: { id: assetId, projectId, status: { not: 'deleted' } } });
  if (!asset) throw new AssetServiceError(404, '附件不存在', 'asset_not_found');
  if (await isAssetReferenced(projectId, assetId)) {
    throw new AssetServiceError(409, '该附件仍被当前视频或检查点引用，暂时不能删除。', 'asset_in_use');
  }
  await prisma.projectAsset.update({ where: { id: assetId }, data: { status: 'deleted' } });
  await rm(resolveProjectAssetDirectory(projectId, assetId), { recursive: true, force: true });
}

export async function getProjectAssetFile(projectId: string, assetId: string): Promise<{
  path: string;
  mimeType: string;
  byteLength: number;
  originalName: string;
}> {
  const asset = await prisma.projectAsset.findFirst({ where: { id: assetId, projectId, status: 'ready' } });
  if (!asset) throw new AssetServiceError(404, '附件预览不存在', 'asset_not_found');
  return {
    path: resolveStoredAssetPath(projectId, assetId, asset.storagePath),
    mimeType: asset.mimeType,
    byteLength: asset.byteLength,
    originalName: asset.originalName,
  };
}

export async function readAssetDigest(projectId: string, assetId: string): Promise<DocumentDigest | null> {
  const asset = await prisma.projectAsset.findFirst({ where: { id: assetId, projectId, status: 'ready' } });
  if (!asset || asset.kind !== 'document') return null;
  const path = resolve(resolveProjectAssetDirectory(projectId, assetId), 'digest.json');
  return JSON.parse(await readFile(path, 'utf8')) as DocumentDigest;
}

export async function readAssetExtraction(projectId: string, assetId: string): Promise<ExtractedDocument | null> {
  const asset = await prisma.projectAsset.findFirst({ where: { id: assetId, projectId, status: 'ready' } });
  if (!asset || asset.kind !== 'document') return null;
  const path = resolve(resolveProjectAssetDirectory(projectId, assetId), 'extracted.json');
  return JSON.parse(await readFile(path, 'utf8')) as ExtractedDocument;
}

export function toAssetSummary(asset: {
  id: string;
  kind: string;
  mimeType: string;
  originalName: string;
  byteLength: number;
  status: string;
  inferredUsage: string | null;
  metadata?: unknown;
  summary: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AssetSummary {
  return {
    id: asset.id,
    kind: asset.kind as AssetSummary['kind'],
    mimeType: asset.mimeType,
    originalName: asset.originalName,
    byteLength: asset.byteLength,
    status: asset.status as AssetSummary['status'],
    ...(asset.inferredUsage ? { inferredUsage: asset.inferredUsage as ProjectAssetUsage } : {}),
    ...(asset.metadata && typeof asset.metadata === 'object' && typeof (asset.metadata as Record<string, unknown>).userUsage === 'string'
      ? { usage: (asset.metadata as Record<string, unknown>).userUsage as AssetSummary['usage'] }
      : {}),
    ...(asset.summary && typeof asset.summary === 'object' ? { summary: asset.summary as AssetSummary['summary'] } : {}),
    ...(asset.errorCode ? { errorCode: asset.errorCode } : {}),
    ...(asset.errorMessage ? { errorMessage: asset.errorMessage } : {}),
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

async function writePrivateJson(path: string, value: unknown) {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tempPath, JSON.stringify(value), { flag: 'wx' });
  await rename(tempPath, path);
}

async function isAssetReferenced(projectId: string, assetId: string): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { uuid: projectId },
    select: { outline: true, videoSource: true, projectBrief: true },
  });
  if (JSON.stringify(project ?? {}).includes(assetId)) return true;
  const checkpoints = await prisma.projectCheckpoint.findMany({
    where: { projectId },
    select: { id: true },
  });
  for (const checkpoint of checkpoints) {
    const snapshot = await readProjectCheckpoint(projectId, checkpoint.id);
    if (JSON.stringify(snapshot).includes(assetId)) return true;
  }
  return false;
}

function resolveStoredAssetPath(projectId: string, assetId: string, storagePath: string): string {
  const root = resolveProjectAssetDirectory(projectId, assetId);
  const target = resolve(process.cwd(), storagePath);
  const privateRoot = resolve(PROJECT_ASSET_ROOT);
  if (!target.startsWith(`${root}${sep}`) || !target.startsWith(`${privateRoot}${sep}`)) {
    throw new AssetServiceError(400, '附件存储路径越界', 'path_traversal');
  }
  return target;
}

function safeOriginalName(value: string): string {
  return basename(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240) || 'unnamed';
}

function inferUsage(kind: 'image' | 'document', originalName: string): ProjectAssetUsage {
  if (kind === 'document') return 'content';
  return /logo|brand|品牌|标志|商标/i.test(originalName) ? 'brand' : 'visual';
}
