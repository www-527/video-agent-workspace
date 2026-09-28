import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { captureVisualRepairSamples, type VisualRepairSampleRenderer } from '@/lib/quality/visual-self-repair';
import { resolveDataUrlPath } from '@/lib/render/paths';
import type { AIHtmlImageInput } from '@/lib/ai/client';
import type { ChatContextSnapshot, FrameOutline, ProjectDetail } from '@/types';
import { getFrameSourceForOutlineFrame } from '@/lib/video-source';

const EVIDENCE_CACHE_VERSION = 'director-evidence-v1';
const CACHE_TTL_MS = 10 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 80;
const MAX_VISION_EVIDENCE_IMAGES = 10;

interface CachedEvidence {
  createdAt: number;
  image: AIHtmlImageInput;
  imageHash: string;
  frameId: string;
  progress: number;
}

const globalEvidenceCache = globalThis as typeof globalThis & {
  __directorEvidenceCache?: Map<string, CachedEvidence>;
};
const evidenceCache = globalEvidenceCache.__directorEvidenceCache ??= new Map<string, CachedEvidence>();

export interface DirectorEvidenceResult {
  records: NonNullable<ChatContextSnapshot['evidence']>;
  images: AIHtmlImageInput[];
  cacheHits: number;
}

export function needsVisualDirectorEvidence(content: string): boolean {
  return /不好看|太乱|像\s*PPT|廉价|没重点|图片.*不相关|视觉|画面|风格不统一|不协调|不好读/i.test(content);
}

export async function collectDirectorEvidence(input: {
  project: ProjectDetail;
  context: ChatContextSnapshot;
  content: string;
  abortSignal?: AbortSignal;
  renderer?: VisualRepairSampleRenderer;
}): Promise<DirectorEvidenceResult> {
  if (!needsVisualDirectorEvidence(input.content) || !input.project.outline) {
    return { records: [], images: [], cacheHits: 0 };
  }
  pruneEvidenceCache();
  const targetFrames = framesForScope(input.project.outline.frames, input.context).slice(0, MAX_VISION_EVIDENCE_IMAGES);
  const records: DirectorEvidenceResult['records'] = [];
  const images: AIHtmlImageInput[] = [];
  let cacheHits = 0;
  for (const frame of targetFrames) {
    if (input.abortSignal?.aborted) throw input.abortSignal.reason;
    const frameIndex = input.project.outline.frames.findIndex(item => item.id === frame.id);
    const source = getFrameSourceForOutlineFrame(input.project.videoSource, frame.id, frameIndex);
    if (!source) continue;
    const risk = Boolean(source.qualityReport?.issues.some(issue => issue.severity === 'critical' || issue.severity === 'major'));
    const samplePoints = input.context.resolvedScope === 'project' && risk
      ? [0.35, 0.7, 1]
      : [currentProgress(input.context, source.audioDuration || frame.sceneSpec?.durationHint || 3)];
    for (const progress of samplePoints) {
      if (images.length >= MAX_VISION_EVIDENCE_IMAGES) break;
      const evidence = source.htmlCode
        ? await htmlEvidence({
          frame,
          htmlCode: source.htmlCode,
          progress,
          canvasPreset: input.project.canvasPreset,
          durationSeconds: source.audioDuration || frame.sceneSpec?.durationHint || 3,
          abortSignal: input.abortSignal,
          renderer: input.renderer,
        })
        : source.imagePath ? await imageEvidence(frame.id, source.imagePath, progress) : null;
      if (!evidence) continue;
      if (evidence.cacheHit) cacheHits += 1;
      images.push(evidence.cached.image);
      records.push({
        frameId: frame.id,
        progress,
        imageHash: evidence.cached.imageHash,
        capturedAt: new Date(evidence.cached.createdAt).toISOString(),
      });
    }
  }
  return { records, images, cacheHits };
}

async function htmlEvidence(input: {
  frame: FrameOutline;
  htmlCode: string;
  progress: number;
  canvasPreset: ProjectDetail['canvasPreset'];
  durationSeconds: number;
  abortSignal?: AbortSignal;
  renderer?: VisualRepairSampleRenderer;
}) {
  const contentHash = sha256(Buffer.from(input.htmlCode));
  const key = `${EVIDENCE_CACHE_VERSION}:html:${contentHash}:${input.canvasPreset}:${input.progress}`;
  const existing = getCachedEvidence(key);
  if (existing) return { cached: existing, cacheHit: true };
  const samples = await captureVisualRepairSamples({
    htmlCode: input.htmlCode,
    durationSeconds: input.durationSeconds,
    canvasPreset: input.canvasPreset,
    abortSignal: input.abortSignal,
    samplePoints: [input.progress],
    includeImages: true,
    renderer: input.renderer,
  });
  const sample = samples.samples[0];
  if (!sample?.image) return null;
  const imageHash = sha256(Buffer.from(sample.image.dataUrl));
  const cached: CachedEvidence = {
    createdAt: Date.now(),
    frameId: input.frame.id,
    progress: input.progress,
    imageHash,
    image: {
      dataUrl: sample.image.dataUrl,
      mimeType: sample.image.mimeType,
      byteLength: sample.image.byteLength,
      label: `frameId=${input.frame.id};progress=${input.progress}`,
    },
  };
  evidenceCache.set(key, cached);
  return { cached, cacheHit: false };
}

async function imageEvidence(frameId: string, imagePath: string, progress: number) {
  const path = resolveDataUrlPath(imagePath);
  if (!path) return null;
  const bytes = await readFile(path);
  const contentHash = sha256(bytes);
  const key = `${EVIDENCE_CACHE_VERSION}:image:${contentHash}:${progress}`;
  const existing = getCachedEvidence(key);
  if (existing) return { cached: existing, cacheHit: true };
  const mimeType = mimeForExtension(extname(path));
  if (!mimeType) return null;
  const cached: CachedEvidence = {
    createdAt: Date.now(),
    frameId,
    progress,
    imageHash: contentHash,
    image: {
      dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
      mimeType,
      byteLength: bytes.length,
      label: `frameId=${frameId};progress=${progress}`,
    },
  };
  evidenceCache.set(key, cached);
  return { cached, cacheHit: false };
}

function framesForScope(frames: FrameOutline[], context: ChatContextSnapshot): FrameOutline[] {
  if (context.resolvedScope === 'project') return frames;
  const frame = frames.find(item => item.id === context.selectedFrameId);
  return frame ? [frame] : [];
}

function currentProgress(context: ChatContextSnapshot, durationSeconds: number): number {
  if (context.playbackTimeMs === undefined) return 0.7;
  return Math.max(0.05, Math.min(1, context.playbackTimeMs / Math.max(100, durationSeconds * 1_000)));
}

function getCachedEvidence(key: string): CachedEvidence | null {
  const cached = evidenceCache.get(key);
  if (!cached || Date.now() - cached.createdAt > CACHE_TTL_MS) {
    evidenceCache.delete(key);
    return null;
  }
  return cached;
}

function pruneEvidenceCache() {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [key, value] of evidenceCache) {
    if (value.createdAt < cutoff) evidenceCache.delete(key);
  }
  while (evidenceCache.size > MAX_CACHE_ENTRIES) {
    const oldest = evidenceCache.keys().next().value as string | undefined;
    if (!oldest) break;
    evidenceCache.delete(oldest);
  }
}

function mimeForExtension(extension: string): AIHtmlImageInput['mimeType'] | null {
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return null;
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
