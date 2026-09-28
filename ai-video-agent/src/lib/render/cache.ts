import { readdir, readFile, rm, stat } from 'fs/promises';
import { join } from 'path';
import { RENDER_CACHE_ROOT } from './paths';
import type { RenderCacheManifest } from './types';
import { OUTPUT_SPEC } from './types';
import type { CanvasPresetId } from '@/types';

export type OutputDimensions = {
  canvasPreset?: CanvasPresetId;
  designWidth?: number;
  designHeight?: number;
  width: number;
  height: number;
  fps: number;
};

export function isCacheManifestCompatible(
  manifest: RenderCacheManifest,
  sceneId: string,
  cacheKey: string,
  outputSpec: OutputDimensions,
) {
  return manifest.sceneId === sceneId
    && manifest.cacheKey === cacheKey
    && !manifest.failed
    && (outputSpec.canvasPreset === undefined || manifest.canvasPreset === outputSpec.canvasPreset)
    && (outputSpec.designWidth === undefined || manifest.designWidth === outputSpec.designWidth)
    && (outputSpec.designHeight === undefined || manifest.designHeight === outputSpec.designHeight)
    && manifest.width === outputSpec.width
    && manifest.height === outputSpec.height
    && manifest.fps === outputSpec.fps
    && manifest.frameCount > 0;
}

export function sceneCacheDirectory(projectId: string, sceneId: string, cacheKey: string) {
  return join(RENDER_CACHE_ROOT, safeSegment(projectId), safeSegment(sceneId), safeSegment(cacheKey));
}

export async function readCacheManifest(
  projectId: string,
  sceneId: string,
  cacheKey: string,
  outputSpec: OutputDimensions = OUTPUT_SPEC,
): Promise<RenderCacheManifest | null> {
  const directory = sceneCacheDirectory(projectId, sceneId, cacheKey);
  try {
    const [manifestRaw, videoStat] = await Promise.all([
      readFile(join(directory, 'manifest.json'), 'utf8'),
      stat(join(directory, 'scene.mp4')),
    ]);
    if (!videoStat.isFile() || videoStat.size <= 0) return null;
    const manifest = JSON.parse(manifestRaw) as RenderCacheManifest;
    if (!isCacheManifestCompatible(manifest, sceneId, cacheKey, outputSpec)) return null;
    return manifest;
  } catch {
    return null;
  }
}

export async function getRenderCacheStats(projectId?: string) {
  const root = projectId ? join(RENDER_CACHE_ROOT, safeSegment(projectId)) : RENDER_CACHE_ROOT;
  let bytes = 0;
  let files = 0;
  let entries = 0;
  await walk(root, async (path, isDirectory) => {
    if (isDirectory) return;
    files += 1;
    const info = await stat(path);
    bytes += info.size;
    if (path.endsWith('manifest.json')) entries += 1;
  });
  return { bytes, files, entries };
}

export async function clearRenderCache(options?: { projectId?: string; failedOnly?: boolean }) {
  const root = options?.projectId ? join(RENDER_CACHE_ROOT, safeSegment(options.projectId)) : RENDER_CACHE_ROOT;
  if (!options?.failedOnly) {
    await rm(root, { recursive: true, force: true });
    return;
  }
  const manifests: string[] = [];
  await walk(root, async path => {
    if (path.endsWith('manifest.json')) manifests.push(path);
  });
  await Promise.all(manifests.map(async manifestPath => {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RenderCacheManifest;
      if (manifest.failed) await rm(join(manifestPath, '..'), { recursive: true, force: true });
    } catch {
      await rm(join(manifestPath, '..'), { recursive: true, force: true });
    }
  }));
}

async function walk(root: string, visit: (path: string, isDirectory: boolean) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    await visit(path, entry.isDirectory());
    if (entry.isDirectory()) await walk(path, visit);
  }
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
