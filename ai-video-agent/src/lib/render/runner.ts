import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { once } from 'events';
import { createWriteStream } from 'fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { pathToFileURL } from 'url';
import { parseFile } from 'music-metadata';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { prisma } from '@/lib/db';
import { auditCoreVisualVisibility, sanitizeAiHtml, wrapHtmlWithWatchdog } from '@/lib/iframe-utils';
import { splitSubtitles } from '@/lib/subtitle';
import type { CanvasPresetId, FrameOutline, FrameSource, ProjectDetail, SceneSpec } from '@/types';
import { getFrameSourceForOutlineFrame } from '@/lib/video-source';
import { assertProjectQualityForExport } from '@/lib/quality/export-gate';
import { readCacheManifest, sceneCacheDirectory } from './cache';
import { buildRenderOptionsHash, buildSceneCacheKey, hashFile, sha256 } from './hash';
import { findChromiumExecutable, findFfmpegExecutable, findFfprobeExecutable, RENDER_JOB_ROOT, RENDER_OUTPUT_ROOT, RENDER_WORK_ROOT, resolveDataUrlPath } from './paths';
import { classifyHtmlCompatibility, injectRenderBridge } from './render-bridge';
import { getSubtitleVisualStyle } from '@/lib/subtitle-style';
import { buildSceneTimeline, buildSrt } from './timeline';
import {
  getOutputSpec,
  RENDER_PROTOCOL_VERSION,
  RENDERER_VERSION,
  RENDER_STRATEGY_VERSION,
  type RenderCacheManifest,
  type RenderCompatibility,
  type RenderJobOptions,
  type RenderJobSnapshot,
  type RenderSceneMetrics,
  type RenderSceneState,
  type SceneTimelineItem,
  type UISceneDocument,
} from './types';
import { getRenderRuntimeSettings, type FrameTransport, type RenderRuntimeSettings } from './runtime';
import { runBoundedTasks } from './scheduler';
import { renderUISceneHtml } from './ui-scene-html';
import { auditVisualRhythm } from './visual-audit';
import { resolveFrameImagePath, resolveSceneContract } from '@/lib/scene-contract';
import { getCanvasPreset } from '@/lib/canvas-presets';
import { buildVideoEncodingArgs, resolveVideoEncoder, type VideoEncoder } from './video-encoder';

interface ActiveRenderJob {
  snapshot: RenderJobSnapshot;
  controller: AbortController;
  options: Required<RenderJobOptions>;
  persistence: Promise<void>;
  isRecovery: boolean;
  videoEncoder: VideoEncoder;
}

interface RenderJobJournal {
  version: 1;
  snapshot: RenderJobSnapshot;
  options: Required<RenderJobOptions>;
}

interface PreparedScene {
  frame: FrameOutline;
  source: FrameSource;
  state: RenderSceneState;
  timeline: SceneTimelineItem;
  audioPath: string | null;
  contentHash: string;
  imageHash: string;
  audioHash: string;
  actualAudioDurationMs: number;
  subtitleHash: string;
  cacheKey: string;
  cacheDirectory: string;
}

const runnerState = globalThis as typeof globalThis & {
  __localRenderJobs?: Map<string, ActiveRenderJob>;
  __localRenderRecoveries?: Map<string, Promise<RenderJobSnapshot | null>>;
};

// Preserve active jobs across Next development module reloads.
const jobs = runnerState.__localRenderJobs ??= new Map<string, ActiveRenderJob>();
const recoveries = runnerState.__localRenderRecoveries ??= new Map<string, Promise<RenderJobSnapshot | null>>();
const sceneFlights = new Map<string, Promise<void>>();

export function getRenderJob(id: string): RenderJobSnapshot | null {
  const job = jobs.get(id);
  return job ? cloneSnapshot(job.snapshot) : null;
}

/** Restores a persisted job after the local render service restarts. */
export async function getOrRestoreRenderJob(id: string): Promise<RenderJobSnapshot | null> {
  const live = getRenderJob(id);
  if (live) return live;

  const existingRecovery = recoveries.get(id);
  if (existingRecovery) return existingRecovery;

  const recovery = restoreRenderJob(id).finally(() => recoveries.delete(id));
  recoveries.set(id, recovery);
  return recovery;
}

export function listProjectRenderJobs(projectId: string): RenderJobSnapshot[] {
  return Array.from(jobs.values())
    .filter(job => job.snapshot.projectId === projectId)
    .map(job => cloneSnapshot(job.snapshot))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function startRenderJob(
  projectId: string,
  options: RenderJobOptions = {},
  resume?: { id: string; createdAt: string },
): Promise<RenderJobSnapshot> {
  const projectRecord = await prisma.project.findUnique({ where: { uuid: projectId } });
  if (!projectRecord) throw new Error('项目不存在。');
  const project = {
    uuid: projectRecord.uuid,
    title: projectRecord.title,
    type: projectRecord.type,
    workflow: projectRecord.workflow as ProjectDetail['workflow'],
    canvasPreset: projectRecord.canvasPreset as CanvasPresetId,
    styleId: projectRecord.styleId,
    outline: projectRecord.outline,
    videoSource: projectRecord.videoSource,
    createdAt: projectRecord.createdAt.toISOString(),
    updatedAt: projectRecord.updatedAt.toISOString(),
    hasOutline: Boolean(projectRecord.outline),
  } as ProjectDetail;
  if (!project.outline?.frames.length || !project.videoSource) throw new Error('项目还没有可导出的分镜。');
  if (!options.bypassQualityGate) assertProjectQualityForExport(project);
  const pendingAssetReviews = project.outline.frames.flatMap((frame, index) => {
    const source = getFrameSourceForOutlineFrame(project.videoSource, frame.id, index);
    return source?.imageSelection?.requiresHumanReview ? [`第 ${index + 1} 镜《${frame.title}》`] : [];
  });
  if (pendingAssetReviews.length) {
    throw new Error(`以下镜头的具体人物、产品或历史素材仍需人工确认：${pendingAssetReviews.join('、')}。请在“配图与备选”中确认当前素材后再导出。`);
  }

  const id = resume?.id ?? randomUUID();
  const now = new Date().toISOString();
  const outputSpec = getOutputSpec(project.canvasPreset);
  const normalizedOptions: Required<RenderJobOptions> = {
    canvasPreset: outputSpec.canvasPreset,
    width: outputSpec.width,
    height: outputSpec.height,
    designWidth: outputSpec.designWidth,
    designHeight: outputSpec.designHeight,
    fps: outputSpec.fps,
    subtitles: options.subtitles !== false,
    subtitleHorizontal: clamp(
      options.subtitleHorizontal ?? getCanvasPreset(project.canvasPreset).subtitle.horizontal,
      getCanvasPreset(project.canvasPreset).subtitle.horizontalRange[0],
      getCanvasPreset(project.canvasPreset).subtitle.horizontalRange[1],
    ),
    subtitleVertical: clamp(
      options.subtitleVertical ?? getCanvasPreset(project.canvasPreset).subtitle.vertical,
      getCanvasPreset(project.canvasPreset).subtitle.verticalRange[0],
      getCanvasPreset(project.canvasPreset).subtitle.verticalRange[1],
    ),
    allowRealtimeFallback: options.allowRealtimeFallback !== false,
    bypassQualityGate: options.bypassQualityGate === true,
    forceSceneIds: options.forceSceneIds ?? [],
    maxConcurrentScenes: clamp(
      options.maxConcurrentScenes ?? getRenderRuntimeSettings().maxConcurrentScenes,
      1,
      4,
    ),
    useGpuEncoding: options.useGpuEncoding === true,
    resolvedVideoEncoder: 'libx264',
  };
  const scenes = project.outline.frames.map((frame, index): RenderSceneState => ({
    id: frame.id,
    index,
    title: frame.title,
    stage: 'pending',
    renderMode: resolveSceneContract(project.type, frame).mode,
    warnings: [],
  }));
  const active: ActiveRenderJob = {
    controller: new AbortController(),
    options: normalizedOptions,
    persistence: Promise.resolve(),
    isRecovery: Boolean(resume),
    videoEncoder: 'libx264',
    snapshot: {
      id,
      projectId,
      stage: 'queued',
      progress: 0,
      message: '任务已加入本地渲染队列。',
      createdAt: resume?.createdAt ?? now,
      updatedAt: now,
      elapsedMs: 0,
      estimatedRemainingMs: null,
      cacheHits: 0,
      offlineRendered: 0,
      realtimeFallbacks: 0,
      failedScenes: 0,
      actualConcurrency: 1,
      peakConcurrency: 0,
      renderStrategyVersion: RENDER_STRATEGY_VERSION,
      metrics: {
        preparationMs: 0,
        sceneWallMs: 0,
        assemblyMs: 0,
        subtitleMuxMs: 0,
        validationMs: 0,
        totalMs: 0,
      },
      scenes,
      visualWarnings: auditVisualRhythm(project.outline.frames),
    },
  };
  if (resume) active.snapshot.message = '检测到本地服务重启，正在从已完成的分镜缓存继续渲染。';
  jobs.set(id, active);
  await persistJournal(active);
  setTimeout(() => {
    void runRenderJobOptimized(active, project).catch(error => failJob(active, error));
  }, 0);
  return cloneSnapshot(active.snapshot);
}

export function cancelRenderJob(id: string): RenderJobSnapshot | null {
  const job = jobs.get(id);
  if (!job) return null;
  if (isTerminal(job.snapshot.stage)) return cloneSnapshot(job.snapshot);
  job.controller.abort(new DOMException('用户取消导出。', 'AbortError'));
  updateJob(job, {
    stage: 'cancelling',
    message: '导出已取消；已完成的分镜缓存会保留。',
    estimatedRemainingMs: 0,
  });
  return cloneSnapshot(job.snapshot);
}

async function restoreRenderJob(id: string): Promise<RenderJobSnapshot | null> {
  const journal = await readJournal(id);
  if (!journal) return null;
  if (isTerminal(journal.snapshot.stage)) return cloneSnapshot(journal.snapshot);

  try {
    return await startRenderJob(journal.snapshot.projectId, journal.options, {
      id: journal.snapshot.id,
      createdAt: journal.snapshot.createdAt,
    });
  } catch (error) {
    const snapshot = cloneSnapshot(journal.snapshot);
    snapshot.stage = 'failed';
    snapshot.estimatedRemainingMs = 0;
    snapshot.updatedAt = new Date().toISOString();
    snapshot.error = error instanceof Error ? error.message : String(error);
    snapshot.message = `本地服务重启后无法恢复渲染：${snapshot.error}`;
    await writeJournal({ version: 1, snapshot, options: journal.options });
    return snapshot;
  }
}

async function runRenderJobOptimized(job: ActiveRenderJob, project: ProjectDetail) {
  const startedAt = Date.now();
  const preparationStartedAt = Date.now();
  const runtime = getRenderRuntimeSettings();
  runtime.maxConcurrentScenes = job.options.maxConcurrentScenes;
  const workDirectory = join(RENDER_WORK_ROOT, job.snapshot.id);
  const outputDirectory = join(RENDER_OUTPUT_ROOT, project.uuid);
  await Promise.all([mkdir(workDirectory, { recursive: true }), mkdir(outputDirectory, { recursive: true })]);
  throwIfAborted(job);

  updateJob(job, {
    stage: 'checking-compatibility',
    message: '正在读取音频时长、检查分镜兼容性和可复用缓存。',
    progress: 2,
    renderStrategyVersion: `${RENDER_STRATEGY_VERSION}:${runtime.frameTransport}`,
  });
  const ffmpeg = await findFfmpegExecutable();
  job.videoEncoder = await resolveVideoEncoder(ffmpeg, job.options.useGpuEncoding);
  job.options.resolvedVideoEncoder = job.videoEncoder;
  job.snapshot.renderStrategyVersion = `${RENDER_STRATEGY_VERSION}:${runtime.frameTransport}:${job.videoEncoder}`;
  const prepared = await prepareScenes(job, project);
  const ffprobe = await findFfprobeExecutable();
  const sceneOutputs = new Array<string>(prepared.length);
  const uncached: PreparedScene[] = [];

  const cacheResults = await Promise.all(prepared.map(async scene => {
    const cached = await readCacheManifest(project.uuid, scene.frame.id, scene.cacheKey, job.options);
    if (!cached || cached.failed) return null;
    if (job.isRecovery) {
      try {
        await validateMediaOutput(ffprobe, join(scene.cacheDirectory, 'scene.mp4'), scene.timeline.durationMs, 34, job.options);
      } catch {
        return null;
      }
    }
    return cached;
  }));

  for (let index = 0; index < prepared.length; index += 1) {
    const scene = prepared[index];
    const cached = cacheResults[index];
    const force = job.options.forceSceneIds.includes(scene.frame.id);
    if (cached && !force) {
      applyCacheHit(job, scene, cached);
      sceneOutputs[index] = join(scene.cacheDirectory, 'scene.mp4');
    } else {
      scene.state.compatibility = resolvePreparedCompatibility(scene).compatibility;
      scene.state.stage = 'waiting-resource';
      uncached.push(scene);
    }
  }

  job.snapshot.cacheHits = prepared.length - uncached.length;
  job.snapshot.metrics.preparationMs = Date.now() - preparationStartedAt;
  let completedScenes = job.snapshot.cacheHits;
  if (completedScenes) {
    updateProgress(job, completedScenes, prepared.length, startedAt, `已复用 ${completedScenes} 个分镜缓存。`);
  }

  const offlineScenes = uncached.filter(scene => resolvePreparedCompatibility(scene).controllable);
  const realtimeScenes = uncached.filter(scene => !resolvePreparedCompatibility(scene).controllable);
  const offlineConcurrency = Math.max(1, Math.min(runtime.maxConcurrentScenes, offlineScenes.length || 1));
  job.snapshot.actualConcurrency = offlineScenes.length ? offlineConcurrency : (realtimeScenes.length ? 1 : 0);
  const sceneStartedAt = Date.now();

  if (uncached.length) {
    const executablePath = await findChromiumExecutable();
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        executablePath,
        headless: true,
        args: ['--allow-file-access-from-files', '--disable-dev-shm-usage', '--hide-scrollbars'],
      });
      await runSceneQueue({
        scenes: offlineScenes,
        concurrency: offlineConcurrency,
        job,
        worker: scene => renderSceneWithSingleFlight({
          job, project, scene, browser: browser!, ffmpeg, ffprobe, workDirectory,
          transport: runtime.frameTransport,
          runtime,
        }),
        onSettled: scene => {
          completedScenes += 1;
          if (scene.state.stage === 'completed' || scene.state.stage === 'cache-hit') sceneOutputs[scene.state.index] = join(scene.cacheDirectory, 'scene.mp4');
          updateProgress(job, completedScenes, prepared.length, startedAt, `已处理 ${completedScenes}/${prepared.length} 个分镜。`);
        },
      });
      throwIfAborted(job);

      // Realtime fallbacks remain serial and do not overlap deterministic workers.
      await runSceneQueue({
        scenes: realtimeScenes,
        concurrency: 1,
        job,
        worker: scene => renderSceneWithSingleFlight({
          job, project, scene, browser: browser!, ffmpeg, ffprobe, workDirectory,
          transport: runtime.realtimeFallbackTransport,
          runtime,
        }),
        onSettled: scene => {
          completedScenes += 1;
          if (scene.state.stage === 'completed' || scene.state.stage === 'cache-hit') sceneOutputs[scene.state.index] = join(scene.cacheDirectory, 'scene.mp4');
          updateProgress(job, completedScenes, prepared.length, startedAt, `已处理 ${completedScenes}/${prepared.length} 个分镜。`);
        },
      });
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }
  job.snapshot.metrics.sceneWallMs = Date.now() - sceneStartedAt;
  throwIfAborted(job);

  const failed = prepared.filter(scene => scene.state.stage === 'failed');
  if (failed.length) {
    job.snapshot.metrics.totalMs = Date.now() - startedAt;
    updateJob(job, {
      stage: 'partial-failed',
      progress: 100,
      message: `${failed.length} 个分镜失败；已完成分镜和缓存均已保留，可单镜重试。`,
      failedScenes: failed.length,
      elapsedMs: job.snapshot.metrics.totalMs,
      estimatedRemainingMs: 0,
    });
    return;
  }
  if (sceneOutputs.some(output => !output)) {
    throw new RenderSceneError('assembly', '分镜输出列表不完整，已停止最终拼接。');
  }

  updateJob(job, { stage: 'generating-subtitles', progress: 91, message: '正在从统一时间轴生成字幕。' });
  const srtPath = join(workDirectory, 'subtitles.srt');
  const srt = buildSrt(project.outline!.frames, prepared.map(scene => scene.timeline));
  await writeFile(srtPath, srt, 'utf8');

  const assemblyStartedAt = Date.now();
  updateJob(job, { stage: 'assembling', progress: 94, message: '正在按原始分镜顺序拼接 H.264/AAC MP4。' });
  const concatPath = join(workDirectory, 'concat.txt');
  await writeFile(concatPath, sceneOutputs.map(path => `file '${ffmpegConcatPath(path)}'`).join('\n'), 'utf8');
  const assembledPath = join(workDirectory, 'assembled.mp4');
  await runProcess(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', '-movflags', '+faststart', assembledPath], {
    signal: job.controller.signal,
    logPath: join(workDirectory, 'assemble.log'),
  });
  job.snapshot.metrics.assemblyMs = Date.now() - assemblyStartedAt;

  const outputPath = join(outputDirectory, `${job.snapshot.id}.mp4`);
  const subtitleMuxStartedAt = Date.now();
  if (job.options.subtitles && srt.trim()) {
    await runProcess(ffmpeg, [
      '-y', '-i', assembledPath, '-i', srtPath,
      '-map', '0:v:0', '-map', '0:a:0?', '-map', '1:0',
      '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text',
      '-metadata:s:s:0', 'language=zho', '-movflags', '+faststart', outputPath,
    ], { signal: job.controller.signal, logPath: join(workDirectory, 'subtitle-mux.log') });
  } else {
    await copyFile(assembledPath, outputPath);
  }
  job.snapshot.metrics.subtitleMuxMs = Date.now() - subtitleMuxStartedAt;

  const validationStartedAt = Date.now();
  const expectedDurationMs = prepared.reduce((sum, scene) => sum + scene.timeline.durationMs, 0);
  await validateMediaOutput(ffprobe, outputPath, expectedDurationMs, 100, job.options);
  job.snapshot.metrics.validationMs = Date.now() - validationStartedAt;
  await copyFile(srtPath, join(outputDirectory, `${job.snapshot.id}.srt`));
  const elapsedMs = Date.now() - startedAt;
  job.snapshot.metrics.totalMs = elapsedMs;
  updateJob(job, {
    stage: 'completed',
    progress: 100,
    message: '本地离线导出完成。',
    elapsedMs,
    estimatedRemainingMs: 0,
    outputPath,
    outputUrl: `/api/data/render-output/${encodeURIComponent(project.uuid)}/${encodeURIComponent(job.snapshot.id)}.mp4`,
  });
  await job.persistence;
  await writeFile(join(outputDirectory, `${job.snapshot.id}.json`), JSON.stringify(job.snapshot, null, 2), 'utf8');
  await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
}

async function runSceneQueue(args: {
  scenes: PreparedScene[];
  concurrency: number;
  job: ActiveRenderJob;
  worker: (scene: PreparedScene) => Promise<void>;
  onSettled: (scene: PreparedScene) => void;
}) {
  if (!args.scenes.length) return;
  let active = 0;
  await runBoundedTasks({
    items: args.scenes,
    concurrency: args.concurrency,
    worker: async scene => {
      throwIfAborted(args.job);
      active += 1;
      args.job.snapshot.peakConcurrency = Math.max(args.job.snapshot.peakConcurrency, active);
      try {
        await args.worker(scene);
      } finally {
        active -= 1;
        args.onSettled(scene);
      }
    },
  });
  throwIfAborted(args.job);
}

function resolvePreparedCompatibility(scene: PreparedScene) {
  return scene.state.renderMode === 'html'
    ? classifyHtmlCompatibility(scene.source.htmlCode || '')
    : { compatibility: 'offline-compatible' as const, controllable: true, warnings: [] as string[] };
}

function applyCacheHit(job: ActiveRenderJob, scene: PreparedScene, cached: RenderCacheManifest) {
  scene.state.stage = 'cache-hit';
  scene.state.compatibility = cached.compatibility;
  scene.state.warnings = cached.warnings;
  scene.state.elapsedMs = cached.renderElapsedMs;
  job.snapshot.cacheHits += 1;
}

// Kept as a short-term whole-pipeline rollback while the pipe strategy is rolled out.
async function runRenderJobLegacy(job: ActiveRenderJob, project: ProjectDetail) {
  const startedAt = Date.now();
  const workDirectory = join(RENDER_WORK_ROOT, job.snapshot.id);
  const outputDirectory = join(RENDER_OUTPUT_ROOT, project.uuid);
  await Promise.all([mkdir(workDirectory, { recursive: true }), mkdir(outputDirectory, { recursive: true })]);
  throwIfAborted(job);

  updateJob(job, { stage: 'checking-compatibility', message: '正在读取实际音频时长并检查分镜兼容性。', progress: 2 });
  const executablePath = await findChromiumExecutable();
  const ffmpeg = await findFfmpegExecutable();
  job.videoEncoder = await resolveVideoEncoder(ffmpeg, job.options.useGpuEncoding);
  job.options.resolvedVideoEncoder = job.videoEncoder;
  const prepared = await prepareScenes(job, project);
  throwIfAborted(job);
  const ffprobe = await findFfprobeExecutable();
  let browser: Browser | null = null;
  const sceneOutputs: string[] = [];
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--allow-file-access-from-files', '--disable-dev-shm-usage', '--hide-scrollbars'],
    });
    for (let sceneIndex = 0; sceneIndex < prepared.length; sceneIndex += 1) {
      throwIfAborted(job);
      const scene = prepared[sceneIndex];
      const cached = await readCacheManifest(project.uuid, scene.frame.id, scene.cacheKey, job.options);
      const force = job.options.forceSceneIds.includes(scene.frame.id);
      if (cached && !force && !cached.failed) {
        scene.state.stage = 'cache-hit';
        scene.state.compatibility = cached.compatibility;
        scene.state.warnings = cached.warnings;
        job.snapshot.cacheHits += 1;
        sceneOutputs.push(join(scene.cacheDirectory, 'scene.mp4'));
        updateProgress(job, sceneIndex + 1, prepared.length, startedAt, `第 ${sceneIndex + 1} 镜命中缓存。`);
        continue;
      }
      await renderSceneLegacy({ job, project, scene, browser, ffmpeg, ffprobe, workDirectory });
      if (scene.state.stage === 'completed') {
        sceneOutputs.push(join(scene.cacheDirectory, 'scene.mp4'));
      }
      updateProgress(job, sceneIndex + 1, prepared.length, startedAt, `已完成第 ${sceneIndex + 1}/${prepared.length} 镜。`);
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  throwIfAborted(job);
  const failed = prepared.filter(scene => scene.state.stage === 'failed');
  if (failed.length) {
    updateJob(job, {
      stage: 'partial-failed',
      progress: 100,
      message: `${failed.length} 个分镜失败；已完成片段和缓存均已保留，可分镜重试。`,
      failedScenes: failed.length,
      estimatedRemainingMs: 0,
    });
    return;
  }

  updateJob(job, { stage: 'muxing-audio', progress: 90, message: '正在确认逐镜音频封装与统一时间轴。' });
  updateJob(job, { stage: 'generating-subtitles', progress: 91, message: '正在由统一时间轴生成字幕。' });
  const srtPath = join(workDirectory, 'subtitles.srt');
  const srt = buildSrt(project.outline!.frames, prepared.map(scene => scene.timeline));
  await writeFile(srtPath, srt, 'utf8');

  updateJob(job, { stage: 'assembling', progress: 94, message: '正在拼接分镜并封装 H.264/AAC MP4。' });
  const concatPath = join(workDirectory, 'concat.txt');
  await writeFile(concatPath, sceneOutputs.map(path => `file '${ffmpegConcatPath(path)}'`).join('\n'), 'utf8');
  const assembledPath = join(workDirectory, 'assembled.mp4');
  await runProcess(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', '-movflags', '+faststart', assembledPath], {
    signal: job.controller.signal,
    logPath: join(workDirectory, 'assemble.log'),
  });
  const outputPath = join(outputDirectory, `${job.snapshot.id}.mp4`);
  if (job.options.subtitles && srt.trim()) {
    await runProcess(ffmpeg, [
      '-y', '-i', assembledPath, '-i', srtPath,
      '-map', '0:v:0', '-map', '0:a:0?', '-map', '1:0',
      '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text',
      '-metadata:s:s:0', 'language=zho', '-movflags', '+faststart', outputPath,
    ], { signal: job.controller.signal, logPath: join(workDirectory, 'subtitle-mux.log') });
  } else {
    await copyFile(assembledPath, outputPath);
  }
  const expectedDurationMs = prepared.reduce((sum, scene) => sum + scene.timeline.durationMs, 0);
  await validateMediaOutput(ffprobe, outputPath, expectedDurationMs, 100, job.options);
  await copyFile(srtPath, join(outputDirectory, `${job.snapshot.id}.srt`));
  const elapsedMs = Date.now() - startedAt;
  updateJob(job, {
    stage: 'completed',
    progress: 100,
    message: '本地离线导出完成。',
    elapsedMs,
    estimatedRemainingMs: 0,
    outputPath,
    outputUrl: `/api/data/render-output/${encodeURIComponent(project.uuid)}/${encodeURIComponent(job.snapshot.id)}.mp4`,
  });
  await job.persistence;
  await writeFile(join(outputDirectory, `${job.snapshot.id}.json`), JSON.stringify(job.snapshot, null, 2), 'utf8');
  await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
}

async function prepareScenes(job: ActiveRenderJob, project: ProjectDetail): Promise<PreparedScene[]> {
  const durations: Array<{ id: string; durationMs: number }> = [];
  const inputs: Array<{
    frame: FrameOutline;
    source: FrameSource;
    state: RenderSceneState;
    audioPath: string | null;
    actualAudioDurationMs: number;
    audioHash: string;
    imageHash: string;
    contentHash: string;
    subtitleHash: string;
  }> = [];
  for (let index = 0; index < project.outline!.frames.length; index += 1) {
    throwIfAborted(job);
    const frame = project.outline!.frames[index];
    const source = getFrameSourceForOutlineFrame(project.videoSource, frame.id, index) ?? { id: frame.id };
    const state = job.snapshot.scenes[index];
    const audioPath = resolveDataUrlPath(source.audioPath);
    const actualDurationMs = await readActualAudioDurationMs(audioPath, audioPath ? source.audioDuration : undefined, frame.sceneSpec?.durationHint);
    state.durationMs = actualDurationMs;
    const content = sceneContentForHash(project, frame, source);
    durations.push({ id: frame.id, durationMs: actualDurationMs });
    inputs.push({
      frame,
      source,
      state,
      audioPath,
      actualAudioDurationMs: actualDurationMs,
      audioHash: await hashFile(audioPath),
      imageHash: await hashSceneImages(source),
      contentHash: sha256(content),
      subtitleHash: sha256(frame.narration || ''),
    });
  }
  const timeline = buildSceneTimeline(durations, job.options.fps);
  return inputs.map((input, index) => {
    const cacheKey = buildSceneCacheKey({
      contentHash: input.contentHash,
      imageHash: input.imageHash,
      audioHash: input.audioHash,
      actualAudioDurationMs: input.actualAudioDurationMs,
      subtitleHash: input.subtitleHash,
      themeHash: sha256(project.styleId || 'default'),
      renderOptionsHash: buildRenderOptionsHash(job.options),
      outputSpec: job.options,
    });
    input.state.cacheKey = cacheKey;
    input.state.frameCount = timeline[index].frameCount;
    return {
      ...input,
      timeline: timeline[index],
      cacheKey,
      cacheDirectory: sceneCacheDirectory(project.uuid, input.frame.id, cacheKey),
    };
  });
}

async function renderSceneWithSingleFlight(args: Parameters<typeof renderSceneOptimized>[0]) {
  const key = args.scene.cacheDirectory;
  const existing = sceneFlights.get(key);
  if (existing) {
    args.scene.state.stage = 'waiting-resource';
    await waitForPromiseWithAbort(existing, args.job.controller.signal);
    const force = args.job.options.forceSceneIds.includes(args.scene.frame.id);
    const cached = await readCacheManifest(args.project.uuid, args.scene.frame.id, args.scene.cacheKey, args.job.options);
    if (cached && !cached.failed && !force) {
      applyCacheHit(args.job, args.scene, cached);
      return;
    }
    return renderSceneWithSingleFlight(args);
  }
  const flight = renderSceneOptimized(args);
  sceneFlights.set(key, flight);
  try {
    await flight;
  } finally {
    if (sceneFlights.get(key) === flight) sceneFlights.delete(key);
  }
}

async function waitForPromiseWithAbort(promise: Promise<void>, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    promise.then(
      () => { cleanup(); resolve(); },
      error => { cleanup(); reject(error); },
    );
  });
}

async function renderSceneOptimized(args: {
  job: ActiveRenderJob;
  project: ProjectDetail;
  scene: PreparedScene;
  browser: Browser;
  ffmpeg: string;
  ffprobe: string;
  workDirectory: string;
  transport: FrameTransport;
  runtime: RenderRuntimeSettings;
}) {
  const { job, project, scene, browser, ffmpeg, ffprobe, workDirectory, transport, runtime } = args;
  const sceneStartedAt = Date.now();
  const frameDirectory = join(workDirectory, `scene-${String(scene.state.index + 1).padStart(4, '0')}`);
  const logPath = join(scene.cacheDirectory, 'render.log');
  const partialOutputPath = join(scene.cacheDirectory, `.scene-${job.snapshot.id}.partial.mp4`);
  const partialPreviewPath = join(scene.cacheDirectory, `.preview-${job.snapshot.id}.partial.png`);
  const outputPath = join(scene.cacheDirectory, 'scene.mp4');
  const previewPath = join(scene.cacheDirectory, 'preview.png');
  const metrics = createEmptySceneMetrics();
  scene.state.metrics = metrics;
  const existingCache = await readCacheManifest(project.uuid, scene.frame.id, scene.cacheKey, job.options);
  await mkdir(scene.cacheDirectory, { recursive: true });
  if (transport === 'png') await mkdir(frameDirectory, { recursive: true });

  scene.state.stage = 'rendering';
  updateJob(job, {
    stage: 'rendering-scenes',
    message: `正在渲染第 ${scene.state.index + 1}/${job.snapshot.scenes.length} 镜。`,
  });
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let encoder: ScenePipeEncoder | null = null;
  let previewBuffer: Buffer | null = null;
  try {
    const compatibility = resolvePreparedCompatibility(scene);
    scene.state.compatibility = compatibility.compatibility;
    scene.state.warnings = [...compatibility.warnings];
    if (!compatibility.controllable && !job.options.allowRealtimeFallback) {
      throw new RenderSceneError('compatibility', '该分镜需要实时回退，但任务已禁用回退。');
    }
    if (!compatibility.controllable) {
      scene.state.stage = 'realtime-fallback';
      job.snapshot.realtimeFallbacks += 1;
    }

    const pageSetupStartedAt = Date.now();
    context = await browser.newContext({
      viewport: { width: job.options.designWidth, height: job.options.designHeight },
      deviceScaleFactor: 1.5,
    });
    page = await context.newPage();
    const html = await buildSceneHtml(project, scene, job.options);
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    metrics.pageSetupMs = Date.now() - pageSetupStartedAt;

    const assetWaitStartedAt = Date.now();
    if (compatibility.controllable) {
      await page.waitForFunction(() => {
        const status = window.__renderBridge?.getStatus();
        return status?.ready === true || status?.assets === 'failed';
      }, undefined, { timeout: 30_000 });
      const readyStatus = await page.evaluate(() => window.__renderBridge?.getStatus());
      if (readyStatus?.assets === 'failed') {
        throw new RenderSceneError('resource', readyStatus.warnings.join('；') || '分镜素材加载失败。');
      }
    } else {
      await page.evaluate(() => document.documentElement.setAttribute('data-ai-playback', 'true'));
      await page.waitForTimeout(150);
    }
    metrics.assetWaitMs = Date.now() - assetWaitStartedAt;

    if (transport === 'pipe') {
      encoder = await startScenePipeEncoder({
        ffmpeg,
        audioPath: scene.audioPath,
        durationMs: scene.timeline.durationMs,
        outputPath: partialOutputPath,
        signal: job.controller.signal,
        logPath,
        width: job.options.width,
        height: job.options.height,
        fps: job.options.fps,
        videoEncoder: job.videoEncoder,
      });
    }

    for (let frameIndex = 0; frameIndex < scene.timeline.frameCount; frameIndex += 1) {
      throwIfAborted(job);
      const controlStartedAt = Date.now();
      const timeMs = frameIndex * 1000 / job.options.fps;
      if (compatibility.controllable) {
        await page.evaluate(async ms => {
          if (!window.__renderBridge) throw new Error('RenderBridge 未注入。');
          await window.__renderBridge.setTime(ms);
        }, timeMs);
      } else if (frameIndex > 0) {
        await page.waitForTimeout(1000 / job.options.fps);
      }
      metrics.frameControlMs += Date.now() - controlStartedAt;

      const screenshotStartedAt = Date.now();
      const frame = await page.screenshot({ type: 'png', animations: 'allow' });
      metrics.screenshotMs += Date.now() - screenshotStartedAt;
      if (!previewBuffer) previewBuffer = Buffer.from(frame);

      if (transport === 'pipe') {
        metrics.backpressureMs += await encoder!.writeFrame(Buffer.from(frame));
      } else {
        const writeStartedAt = Date.now();
        await writeFile(join(frameDirectory, `frame-${String(frameIndex + 1).padStart(6, '0')}.png`), frame);
        metrics.pngWriteMs += Date.now() - writeStartedAt;
        metrics.temporaryBytes += frame.byteLength;
      }
    }
    await assertSceneVisibility(page, scene);

    if (!previewBuffer) throw new RenderSceneError('render', '分镜没有产生任何画面帧。');
    const previewWriteStartedAt = Date.now();
    await writeFile(partialPreviewPath, previewBuffer);
    metrics.pngWriteMs += Date.now() - previewWriteStartedAt;

    scene.state.stage = 'encoding';
    updateJob(job, { stage: 'encoding-scenes', message: `正在完成第 ${scene.state.index + 1} 镜编码。` });
    if (encoder) {
      metrics.encoderWallMs = await encoder.finish();
      encoder = null;
    } else {
      const encoderStartedAt = Date.now();
      await encodeScene(ffmpeg, frameDirectory, scene.audioPath, scene.timeline.durationMs, partialOutputPath, job.controller.signal, logPath, job.options, job.videoEncoder);
      metrics.encoderWallMs = Date.now() - encoderStartedAt;
    }

    const validationStartedAt = Date.now();
    await validateMediaOutput(ffprobe, partialOutputPath, scene.timeline.durationMs, 34, job.options);
    metrics.validationMs = Date.now() - validationStartedAt;
    const bridgeStatus = compatibility.controllable
      ? await page.evaluate(() => window.__renderBridge?.getStatus())
      : null;
    const finalCompatibility = (bridgeStatus?.compatibility || compatibility.compatibility) as RenderCompatibility;
    const warnings = [...new Set([...scene.state.warnings, ...(bridgeStatus?.warnings || [])])];
    metrics.totalMs = Date.now() - sceneStartedAt;
    const manifest: RenderCacheManifest = {
      sceneId: scene.frame.id,
      cacheKey: scene.cacheKey,
      canvasPreset: job.options.canvasPreset,
      designWidth: job.options.designWidth,
      designHeight: job.options.designHeight,
      protocolVersion: RENDER_PROTOCOL_VERSION,
      rendererVersion: RENDERER_VERSION,
      inputHashes: {
        content: scene.contentHash,
        image: scene.imageHash,
        audio: scene.audioHash,
        subtitle: scene.subtitleHash,
      },
      actualAudioDurationMs: scene.actualAudioDurationMs,
      outputDurationMs: scene.timeline.durationMs,
      frameCount: scene.timeline.frameCount,
      width: job.options.width,
      height: job.options.height,
      fps: job.options.fps,
      compatibility: finalCompatibility,
      warnings,
      renderElapsedMs: metrics.totalMs,
      createdAt: new Date().toISOString(),
    };

    await replaceFileAtomically(partialOutputPath, outputPath);
    await replaceFileAtomically(partialPreviewPath, previewPath);
    await writeJsonAtomically(join(scene.cacheDirectory, 'compatibility.json'), { compatibility: finalCompatibility, warnings }, job.snapshot.id);
    await writeJsonAtomically(join(scene.cacheDirectory, 'manifest.json'), manifest, job.snapshot.id);
    scene.state.compatibility = finalCompatibility;
    scene.state.warnings = warnings;
    scene.state.elapsedMs = metrics.totalMs;
    scene.state.stage = 'completed';
    job.snapshot.offlineRendered += compatibility.controllable ? 1 : 0;
    updateSlowestScene(job, scene);
  } catch (error) {
    encoder?.abort();
    await encoder?.waitForExit().catch(() => undefined);
    const normalized = normalizeError(error);
    scene.state.elapsedMs = Date.now() - sceneStartedAt;
    metrics.totalMs = scene.state.elapsedMs;
    if (job.controller.signal.aborted) {
      scene.state.stage = 'cancelled';
    } else {
      scene.state.stage = 'failed';
      scene.state.error = { ...normalized, logPath };
      job.snapshot.failedScenes += 1;
      await appendRenderLog(logPath, `\n[${normalized.type}] ${normalized.message}\n`);
      if (!existingCache || existingCache.failed) {
        const failureManifest: RenderCacheManifest = {
          sceneId: scene.frame.id,
          cacheKey: scene.cacheKey,
          canvasPreset: job.options.canvasPreset,
          designWidth: job.options.designWidth,
          designHeight: job.options.designHeight,
          protocolVersion: RENDER_PROTOCOL_VERSION,
          rendererVersion: RENDERER_VERSION,
          inputHashes: { content: scene.contentHash, image: scene.imageHash, audio: scene.audioHash, subtitle: scene.subtitleHash },
          actualAudioDurationMs: scene.actualAudioDurationMs,
          outputDurationMs: 0,
          frameCount: 0,
          width: job.options.width,
          height: job.options.height,
          fps: job.options.fps,
          compatibility: 'failed',
          warnings: scene.state.warnings,
          renderElapsedMs: metrics.totalMs,
          failed: normalized,
          createdAt: new Date().toISOString(),
        };
        await writeJsonAtomically(join(scene.cacheDirectory, 'manifest.json'), failureManifest, job.snapshot.id).catch(() => undefined);
      }
      updateSlowestScene(job, scene);
    }
  } finally {
    await context?.close().catch(() => undefined);
    await Promise.all([
      rm(frameDirectory, { recursive: true, force: true }).catch(() => undefined),
      rm(partialOutputPath, { force: true }).catch(() => undefined),
      rm(partialPreviewPath, { force: true }).catch(() => undefined),
    ]);
  }
}

interface ScenePipeEncoder {
  writeFrame(frame: Buffer): Promise<number>;
  finish(): Promise<number>;
  abort(): void;
  waitForExit(): Promise<void>;
}

async function startScenePipeEncoder(args: {
  ffmpeg: string;
  audioPath: string | null;
  durationMs: number;
  outputPath: string;
  signal: AbortSignal;
  logPath: string;
  width: number;
  height: number;
  fps: number;
  videoEncoder: VideoEncoder;
}): Promise<ScenePipeEncoder> {
  await mkdir(dirname(args.logPath), { recursive: true });
  const duration = (args.durationMs / 1000).toFixed(6);
  const ffmpegArgs = ['-y', '-f', 'image2pipe', '-framerate', String(args.fps), '-vcodec', 'png', '-i', 'pipe:0'];
  if (args.audioPath) ffmpegArgs.push('-i', args.audioPath);
  else ffmpegArgs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  ffmpegArgs.push(
    '-t', duration,
    ...buildVideoEncodingArgs(args.videoEncoder),
    '-vf', `scale=${args.width}:${args.height}:flags=lanczos`,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-af', `apad=pad_dur=${duration}`,
    '-movflags', '+faststart', args.outputPath,
  );
  const startedAt = Date.now();
  const child = spawn(args.ffmpeg, ffmpegArgs, { windowsHide: true });
  const log = createWriteStream(args.logPath, { flags: 'w' });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let closed = false;
  let closeError: unknown = null;
  child.stdin.on('error', error => {
    closeError = closeError || error;
  });
  log.on('error', error => {
    closeError = closeError || error;
    child.kill();
  });
  const abort = () => {
    child.stdin.destroy();
    child.kill();
  };
  args.signal.addEventListener('abort', abort, { once: true });
  const exitPromise = new Promise<void>((resolve, reject) => {
    child.on('error', error => {
      closeError = error;
      reject(error);
    });
    child.on('close', code => {
      closed = true;
      args.signal.removeEventListener('abort', abort);
      log.end();
      if (args.signal.aborted) {
        closeError = args.signal.reason || new DOMException('任务已取消。', 'AbortError');
        reject(closeError);
      } else if (code === 0) {
        resolve();
      } else {
        closeError = new RenderSceneError('ffmpeg', `${basename(args.ffmpeg)} 退出码 ${code}。`);
        reject(closeError);
      }
    });
  });
  void exitPromise.catch(() => undefined);

  return {
    async writeFrame(frame) {
      if (closed || child.stdin.destroyed) throw closeError || new RenderSceneError('ffmpeg', 'FFmpeg 输入管道已关闭。');
      if (child.stdin.write(frame)) return 0;
      const waitStartedAt = Date.now();
      await Promise.race([
        once(child.stdin, 'drain').then(() => undefined),
        exitPromise.then(() => { throw new RenderSceneError('ffmpeg', 'FFmpeg 在全部帧写入前退出。'); }),
      ]);
      return Date.now() - waitStartedAt;
    },
    async finish() {
      if (!child.stdin.destroyed) child.stdin.end();
      await exitPromise;
      if (!log.closed) await once(log, 'close').catch(() => undefined);
      return Date.now() - startedAt;
    },
    abort,
    waitForExit: () => exitPromise,
  };
}

function createEmptySceneMetrics(): RenderSceneMetrics {
  return {
    pageSetupMs: 0,
    assetWaitMs: 0,
    frameControlMs: 0,
    screenshotMs: 0,
    pngWriteMs: 0,
    backpressureMs: 0,
    encoderWallMs: 0,
    validationMs: 0,
    totalMs: 0,
    temporaryBytes: 0,
  };
}

function updateSlowestScene(job: ActiveRenderJob, scene: PreparedScene) {
  const elapsedMs = scene.state.elapsedMs || 0;
  if (!job.snapshot.slowestScene || elapsedMs > job.snapshot.slowestScene.elapsedMs) {
    job.snapshot.slowestScene = { sceneId: scene.frame.id, title: scene.frame.title, elapsedMs };
  }
}

async function appendRenderLog(path: string, value: string) {
  const stream = createWriteStream(path, { flags: 'a' });
  stream.end(value);
  await once(stream, 'close').catch(() => undefined);
}

async function writeJsonAtomically(path: string, value: unknown, token: string) {
  const temporaryPath = `${path}.${token}.next`;
  await writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  await replaceFileAtomically(temporaryPath, path);
}

async function replaceFileAtomically(source: string, target: string) {
  const backup = `${target}.${randomUUID()}.old`;
  let backedUp = false;
  try {
    await rename(target, backup);
    backedUp = true;
  } catch {
    // The target normally does not exist for a cache miss.
  }
  try {
    await rename(source, target);
    if (backedUp) await rm(backup, { force: true });
  } catch (error) {
    if (backedUp) await rename(backup, target).catch(() => undefined);
    throw error;
  }
}

async function renderSceneLegacy(args: {
  job: ActiveRenderJob;
  project: ProjectDetail;
  scene: PreparedScene;
  browser: Browser;
  ffmpeg: string;
  ffprobe: string;
  workDirectory: string;
}) {
  const { job, project, scene, browser, ffmpeg, ffprobe, workDirectory } = args;
  const sceneStartedAt = Date.now();
  const frameDirectory = join(workDirectory, `scene-${String(scene.state.index + 1).padStart(4, '0')}`);
  const logPath = join(scene.cacheDirectory, 'render.log');
  await Promise.all([mkdir(frameDirectory, { recursive: true }), mkdir(scene.cacheDirectory, { recursive: true })]);
  scene.state.stage = 'rendering';
  updateJob(job, {
    stage: 'rendering-scenes',
    message: `正在渲染第 ${scene.state.index + 1}/${job.snapshot.scenes.length} 镜。`,
  });
  let page: Page | null = null;
  try {
    const renderMode = scene.state.renderMode;
    const compatibility = renderMode === 'html'
      ? classifyHtmlCompatibility(scene.source.htmlCode || '')
      : { compatibility: 'offline-compatible' as const, controllable: true, warnings: [] };
    scene.state.compatibility = compatibility.compatibility;
    scene.state.warnings = [...compatibility.warnings];
    if (compatibility.compatibility === 'realtime-fallback' && !job.options.allowRealtimeFallback) {
      throw new RenderSceneError('compatibility', '该分镜需要实时回退，但任务已禁用回退。');
    }
    if (compatibility.compatibility === 'realtime-fallback') {
      scene.state.stage = 'realtime-fallback';
      job.snapshot.realtimeFallbacks += 1;
    }

    page = await browser.newPage({
      viewport: { width: job.options.designWidth, height: job.options.designHeight },
      deviceScaleFactor: 1.5,
    });
    const html = await buildSceneHtml(project, scene, job.options);
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (compatibility.controllable) {
      await page.waitForFunction(() => {
        const status = window.__renderBridge?.getStatus();
        return status?.ready === true || status?.assets === 'failed';
      }, undefined, { timeout: 30_000 });
      const readyStatus = await page.evaluate(() => window.__renderBridge?.getStatus());
      if (readyStatus?.assets === 'failed') {
        throw new RenderSceneError('resource', readyStatus.warnings.join('；') || '分镜素材加载失败。');
      }
    } else {
      await page.evaluate(() => document.documentElement.setAttribute('data-ai-playback', 'true'));
      await page.waitForTimeout(150);
    }

    for (let frameIndex = 0; frameIndex < scene.timeline.frameCount; frameIndex += 1) {
      throwIfAborted(job);
      const timeMs = frameIndex * 1000 / job.options.fps;
      if (compatibility.controllable) {
        await page.evaluate(async ms => {
          if (!window.__renderBridge) throw new Error('RenderBridge 未注入。');
          await window.__renderBridge.setTime(ms);
        }, timeMs);
      } else if (frameIndex > 0) {
        await page.waitForTimeout(1000 / job.options.fps);
      }
      await page.screenshot({
        path: join(frameDirectory, `frame-${String(frameIndex + 1).padStart(6, '0')}.png`),
        type: 'png',
        animations: 'allow',
      });
    }
    await assertSceneVisibility(page, scene);
    await copyFile(join(frameDirectory, 'frame-000001.png'), join(scene.cacheDirectory, 'preview.png'));
    updateJob(job, { stage: 'encoding-scenes', message: `正在编码第 ${scene.state.index + 1} 镜。` });
    const outputPath = join(scene.cacheDirectory, 'scene.mp4');
    await encodeScene(ffmpeg, frameDirectory, scene.audioPath, scene.timeline.durationMs, outputPath, job.controller.signal, logPath, job.options, job.videoEncoder);
    await validateMediaOutput(ffprobe, outputPath, scene.timeline.durationMs, 34, job.options);
    const bridgeStatus = compatibility.controllable
      ? await page.evaluate(() => window.__renderBridge?.getStatus())
      : null;
    const finalCompatibility = (bridgeStatus?.compatibility || compatibility.compatibility) as RenderCompatibility;
    const warnings = [...new Set([...scene.state.warnings, ...(bridgeStatus?.warnings || [])])];
    const manifest: RenderCacheManifest = {
      sceneId: scene.frame.id,
      cacheKey: scene.cacheKey,
      canvasPreset: job.options.canvasPreset,
      designWidth: job.options.designWidth,
      designHeight: job.options.designHeight,
      protocolVersion: RENDER_PROTOCOL_VERSION,
      rendererVersion: RENDERER_VERSION,
      inputHashes: {
        content: scene.contentHash,
        image: scene.imageHash,
        audio: scene.audioHash,
        subtitle: scene.subtitleHash,
      },
      actualAudioDurationMs: scene.actualAudioDurationMs,
      outputDurationMs: scene.timeline.durationMs,
      frameCount: scene.timeline.frameCount,
      width: job.options.width,
      height: job.options.height,
      fps: job.options.fps,
      compatibility: finalCompatibility,
      warnings,
      renderElapsedMs: Date.now() - sceneStartedAt,
      createdAt: new Date().toISOString(),
    };
    await Promise.all([
      writeFile(join(scene.cacheDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8'),
      writeFile(join(scene.cacheDirectory, 'compatibility.json'), JSON.stringify({ compatibility: finalCompatibility, warnings }, null, 2), 'utf8'),
    ]);
    scene.state.compatibility = finalCompatibility;
    scene.state.warnings = warnings;
    scene.state.elapsedMs = manifest.renderElapsedMs;
    scene.state.stage = 'completed';
    job.snapshot.offlineRendered += compatibility.controllable ? 1 : 0;
  } catch (error) {
    const normalized = normalizeError(error);
    scene.state.stage = 'failed';
    scene.state.error = { ...normalized, logPath };
    scene.state.elapsedMs = Date.now() - sceneStartedAt;
    job.snapshot.failedScenes += 1;
    await writeFile(logPath, `[${normalized.type}] ${normalized.message}\n`, 'utf8').catch(() => undefined);
    const failureManifest: RenderCacheManifest = {
      sceneId: scene.frame.id,
      cacheKey: scene.cacheKey,
      canvasPreset: job.options.canvasPreset,
      designWidth: job.options.designWidth,
      designHeight: job.options.designHeight,
      protocolVersion: RENDER_PROTOCOL_VERSION,
      rendererVersion: RENDERER_VERSION,
      inputHashes: { content: scene.contentHash, image: scene.imageHash, audio: scene.audioHash, subtitle: scene.subtitleHash },
      actualAudioDurationMs: scene.actualAudioDurationMs,
      outputDurationMs: 0,
      frameCount: 0,
      width: job.options.width,
      height: job.options.height,
      fps: job.options.fps,
      compatibility: 'failed',
      warnings: scene.state.warnings,
      renderElapsedMs: scene.state.elapsedMs,
      failed: normalized,
      createdAt: new Date().toISOString(),
    };
    await writeFile(join(scene.cacheDirectory, 'manifest.json'), JSON.stringify(failureManifest, null, 2), 'utf8').catch(() => undefined);
  } finally {
    await page?.close().catch(() => undefined);
    await rm(frameDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function buildSceneHtml(project: ProjectDetail, scene: PreparedScene, options: Required<RenderJobOptions>) {
  const subtitleMarkup = options.subtitles
    ? buildSubtitleMarkup(
        scene.frame.narration,
        scene.timeline.durationMs,
        options.subtitleHorizontal,
        options.subtitleVertical,
        options.canvasPreset,
      )
    : '';
  if (scene.state.renderMode === 'image') {
    const imagePath = resolveDataUrlPath(resolveFrameImagePath(scene.source));
    if (!imagePath) throw new RenderSceneError('resource', '图片分镜缺少本地图片文件。');
    const html = buildImageSceneHtml(imagePath, scene.timeline.durationMs, scene.source, subtitleMarkup, options.canvasPreset);
    return injectRenderBridge(html, { compatibility: 'offline-compatible', canvasPreset: options.canvasPreset });
  }
  if (scene.state.renderMode === 'ui-scene') {
    const spec = scene.frame.sceneSpec;
    if (!spec?.uiArchetype || spec.uiSchemaVersion !== 1) {
      throw new RenderSceneError('schema', 'ui-scene 缺少 uiArchetype 或 uiSchemaVersion=1。');
    }
    const document: UISceneDocument = {
      archetype: spec.uiArchetype,
      data: spec.uiData || {},
      interactions: normalizeInteractions(spec),
      isDemoData: spec.isDemoData === true,
    };
    return injectRenderBridge(appendToBody(renderUISceneHtml(document, options.canvasPreset), subtitleMarkup), {
      compatibility: 'offline-compatible',
      canvasPreset: options.canvasPreset,
    });
  }
  if (!scene.source.htmlCode) throw new RenderSceneError('resource', 'HTML 分镜缺少 htmlCode。');
  const compatibility = classifyHtmlCompatibility(scene.source.htmlCode);
  // page.setContent() runs several render workers concurrently. Fetching the
  // same /api/data assets through the local Next server can leave image loads
  // pending, so make persisted image assets self-contained before rendering.
  const selfContainedHtml = forceEagerImageLoading(await inlineLocalDataUrls(scene.source.htmlCode));
  const htmlWithSubtitle = appendToBody(sanitizeAiHtml(selfContainedHtml, options.canvasPreset), subtitleMarkup);
  if (!compatibility.controllable) {
    return wrapHtmlWithWatchdog(htmlWithSubtitle, Math.ceil(scene.timeline.durationMs) + 2_000, {
      canvasPreset: options.canvasPreset,
    });
  }
  return injectRenderBridge(htmlWithSubtitle, {
    compatibility: compatibility.compatibility,
    warnings: compatibility.warnings,
    baseUrl: 'http://127.0.0.1:3000/',
    canvasPreset: options.canvasPreset,
  });
}

async function assertSceneVisibility(page: Page, scene: PreparedScene) {
  if (scene.state.renderMode !== 'html') return;
  const status = await page.evaluate(auditCoreVisualVisibility);
  if (status.candidateCount > 0 && status.visibleCount === 0) {
    throw new RenderSceneError(
      'invisible',
      `第 ${scene.state.index + 1} 镜包含视觉元素，但动画结束检查时仍全部不可见。`,
    );
  }
}

function buildImageSceneHtml(
  imagePath: string,
  durationMs: number,
  source: FrameSource,
  subtitleMarkup: string,
  canvasPreset: CanvasPresetId,
) {
  const canvas = getCanvasPreset(canvasPreset);
  const motion = source.realImage?.imageMotion || 'slow-push-in';
  const from = source.realImage?.scaleFrom ?? 1;
  const to = source.realImage?.scaleTo ?? (motion === 'static' ? 1 : 1.08);
  const transform = motion === 'slow-pan'
    ? `translate3d(-2%,0,0) scale(${from})`
    : `translate3d(0,0,0) scale(${from})`;
  const transformTo = motion === 'slow-pan'
    ? `translate3d(2%,0,0) scale(${to})`
    : `translate3d(0,0,0) scale(${to})`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${canvas.design.width}px;height:${canvas.design.height}px;overflow:hidden;background:#000}
  .image-stage{position:absolute;inset:0;overflow:hidden;background:#000}
  .image-stage img{width:100%;height:100%;object-fit:${source.realImage?.fitMode || 'cover'};transform:${transform};animation:camera ${durationMs}ms linear both;will-change:transform}
  .image-stage:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.03),rgba(0,0,0,.13));pointer-events:none}
  @keyframes camera{from{transform:${transform}}to{transform:${transformTo}}}
  </style></head><body><div class="image-stage"><img src="${pathToFileURL(imagePath).href}" alt=""></div>${subtitleMarkup}</body></html>`;
}

function buildSubtitleMarkup(
  narration: string,
  durationMs: number,
  horizontal: number,
  vertical: number,
  canvasPreset: CanvasPresetId,
) {
  const subtitleStyle = getSubtitleVisualStyle(canvasPreset);
  const cues = splitSubtitles(narration, durationMs / 1000);
  if (!cues.length) return '';
  return `<div data-render-subtitle-root style="position:absolute;z-index:2147483000;left:${horizontal}%;bottom:${vertical}%;translate:-50% 0;width:${subtitleStyle.maxWidth}px;pointer-events:none;text-align:center">
  ${cues.map((cue, index) => `<p data-render-cue="${index}" data-start="${cue.startTime * 1000}" data-end="${cue.endTime * 1000}" style="display:none;margin:0;color:#fff;font:600 ${subtitleStyle.fontSize}px/${subtitleStyle.lineHeight} Inter,'Microsoft YaHei',sans-serif;letter-spacing:${subtitleStyle.letterSpacing};text-shadow:${subtitleStyle.textShadow}">${escapeHtml(cue.text)}</p>`).join('')}
  </div><script data-render-subtitle-script>
  window.addEventListener('renderbridge:time',function(event){document.querySelectorAll('[data-render-cue]').forEach(function(cue){var ms=event.detail.ms;cue.style.display=ms>=Number(cue.dataset.start)&&ms<Number(cue.dataset.end)?'block':'none'})});
  </script>`;
}

async function encodeScene(
  ffmpeg: string,
  frameDirectory: string,
  audioPath: string | null,
  durationMs: number,
  outputPath: string,
  signal: AbortSignal,
  logPath: string,
  outputSpec: Pick<Required<RenderJobOptions>, 'width' | 'height' | 'fps'>,
  videoEncoder: VideoEncoder,
) {
  const args = ['-y', '-framerate', String(outputSpec.fps), '-i', join(frameDirectory, 'frame-%06d.png')];
  if (audioPath) args.push('-i', audioPath);
  else args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  args.push(
    '-t', (durationMs / 1000).toFixed(6),
    ...buildVideoEncodingArgs(videoEncoder),
    '-vf', `scale=${outputSpec.width}:${outputSpec.height}:flags=lanczos`,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-af', `apad=pad_dur=${(durationMs / 1000).toFixed(6)}`,
    '-movflags', '+faststart', outputPath,
  );
  await runProcess(ffmpeg, args, { signal, logPath });
}

async function readActualAudioDurationMs(
  audioPath: string | null,
  savedDuration?: number,
  durationHint?: number,
) {
  if (audioPath) {
    try {
      const metadata = await parseFile(audioPath, { duration: true });
      if (metadata.format.duration && Number.isFinite(metadata.format.duration)) {
        return Math.max(1, metadata.format.duration * 1000);
      }
    } catch {
      // Use the explicit fallback only when the local file cannot be parsed.
    }
  }
  return Math.max(100, (savedDuration || durationHint || 3) * 1000);
}

async function runProcess(
  command: string,
  args: string[],
  options: { signal: AbortSignal; logPath: string },
) {
  await mkdir(dirname(options.logPath), { recursive: true });
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const logs: Buffer[] = [];
    child.stdout.on('data', chunk => logs.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => logs.push(Buffer.from(chunk)));
    const abort = () => child.kill();
    options.signal.addEventListener('abort', abort, { once: true });
    child.on('error', reject);
    child.on('close', code => {
      options.signal.removeEventListener('abort', abort);
      void writeFile(options.logPath, Buffer.concat(logs));
      if (options.signal.aborted) {
        reject(options.signal.reason || new DOMException('任务已取消。', 'AbortError'));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new RenderSceneError('ffmpeg', `${basename(command)} 退出码 ${code}。`));
      }
    });
  });
}

async function validateMediaOutput(
  ffprobe: string,
  path: string,
  expectedDurationMs: number,
  toleranceMs: number,
  outputSpec: Pick<Required<RenderJobOptions>, 'width' | 'height' | 'fps'>,
) {
  const raw = await runCapture(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_frames,sample_rate,channels,start_time,duration',
    '-of', 'json',
    path,
  ]);
  const probe = JSON.parse(raw) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
      r_frame_rate?: string;
      avg_frame_rate?: string;
      nb_frames?: string;
      sample_rate?: string;
      channels?: number;
      start_time?: string;
      duration?: string;
    }>;
  };
  const video = probe.streams?.find(stream => stream.codec_type === 'video');
  const audio = probe.streams?.find(stream => stream.codec_type === 'audio');
  if (!video || video.width !== outputSpec.width || video.height !== outputSpec.height) {
    throw new RenderSceneError('output-spec', `输出分辨率不是 ${outputSpec.width}×${outputSpec.height}。`);
  }
  if (video.r_frame_rate !== `${outputSpec.fps}/1`) {
    throw new RenderSceneError('output-spec', `输出帧率不是 ${outputSpec.fps}fps。`);
  }
  if (video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p') {
    throw new RenderSceneError('output-spec', '输出视频必须为 H.264 / yuv420p。');
  }
  if (!audio || audio.codec_name !== 'aac' || audio.sample_rate !== '48000' || audio.channels !== 2) {
    throw new RenderSceneError('output-spec', '输出音频必须为 AAC、48kHz、双声道。');
  }
  const expectedFrameCount = Math.max(1, Math.round(expectedDurationMs / 1000 * outputSpec.fps));
  if (video.nb_frames && Number(video.nb_frames) !== expectedFrameCount) {
    throw new RenderSceneError('output-spec', `输出帧数 ${video.nb_frames} 与时间轴 ${expectedFrameCount} 不一致。`);
  }
  const durationMs = Number(probe.format?.duration || 0) * 1000;
  if (!Number.isFinite(durationMs) || Math.abs(durationMs - expectedDurationMs) > toleranceMs) {
    throw new RenderSceneError(
      'av-sync',
      `输出时长 ${durationMs.toFixed(1)}ms 与时间轴 ${expectedDurationMs.toFixed(1)}ms 偏差超过 ${toleranceMs}ms。`,
    );
  }
  const videoDurationMs = Number(video.duration || 0) * 1000;
  const audioDurationMs = Number(audio.duration || 0) * 1000;
  if (videoDurationMs > 0 && audioDurationMs > 0 && Math.abs(videoDurationMs - audioDurationMs) > Math.max(34, toleranceMs)) {
    throw new RenderSceneError('av-sync', `音视频流时长偏差 ${Math.abs(videoDurationMs - audioDurationMs).toFixed(1)}ms 超过允许范围。`);
  }
}

async function runCapture(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
      else reject(new RenderSceneError('ffprobe', Buffer.concat(stderr).toString('utf8').trim() || `${basename(command)} 退出码 ${code}。`));
    });
  });
}

function sceneContentForHash(project: ProjectDetail, frame: FrameOutline, source: FrameSource) {
  return JSON.stringify({
    projectType: project.type,
    html: source.htmlCode || '',
    imagePath: resolveFrameImagePath(source) || '',
    sceneSpec: frame.sceneSpec || null,
    realImage: source.realImage || null,
    realImages: source.realImages || null,
  });
}

async function hashSceneImages(source: FrameSource): Promise<string> {
  const urls = [...new Set([
    source.imagePath,
    source.realImage?.localPath,
    ...(source.realImages || []).map(asset => asset.localPath),
  ].filter((value): value is string => Boolean(value)))];
  if (!urls.length) return 'none';
  const hashes = await Promise.all(urls.map(async url => ({
    url,
    hash: await hashFile(resolveDataUrlPath(url)),
  })));
  return sha256(JSON.stringify(hashes));
}

function normalizeInteractions(spec: SceneSpec) {
  return [...(spec.interactionSequence || [])]
    .filter(step => Number.isFinite(step.atMs) && step.atMs >= 0 && typeof step.target === 'string')
    .sort((left, right) => left.atMs - right.atMs);
}

function updateProgress(job: ActiveRenderJob, completed: number, total: number, startedAt: number, message: string) {
  const elapsedMs = Date.now() - startedAt;
  const progress = Math.min(89, Math.round(5 + (completed / total) * 84));
  const estimatedRemainingMs = completed > 0 ? Math.max(0, Math.round((elapsedMs / completed) * (total - completed))) : null;
  updateJob(job, { progress, elapsedMs, estimatedRemainingMs, message });
}

function updateJob(job: ActiveRenderJob, patch: Partial<RenderJobSnapshot>) {
  Object.assign(job.snapshot, patch, { updatedAt: new Date().toISOString() });
  void persistJournal(job);
}

function failJob(job: ActiveRenderJob, error: unknown) {
  if (job.controller.signal.aborted || job.snapshot.stage === 'cancelling' || job.snapshot.stage === 'cancelled') {
    for (const scene of job.snapshot.scenes) {
      if (['pending', 'waiting-resource', 'rendering', 'encoding', 'realtime-fallback'].includes(scene.stage)) {
        scene.stage = 'cancelled';
      }
    }
    updateJob(job, {
      stage: 'cancelled',
      message: '导出已取消；已完成的分镜缓存会保留。',
      estimatedRemainingMs: 0,
      elapsedMs: job.snapshot.metrics?.totalMs || job.snapshot.elapsedMs,
    });
    return;
  }
  const normalized = normalizeError(error);
  updateJob(job, {
    stage: 'failed',
    progress: job.snapshot.progress,
    message: normalized.message,
    error: normalized.message,
    estimatedRemainingMs: 0,
  });
}

function throwIfAborted(job: ActiveRenderJob) {
  if (job.controller.signal.aborted) {
    throw job.controller.signal.reason || new DOMException('任务已取消。', 'AbortError');
  }
}

function cloneSnapshot(snapshot: RenderJobSnapshot) {
  return JSON.parse(JSON.stringify(snapshot)) as RenderJobSnapshot;
}

function isTerminal(stage: RenderJobSnapshot['stage']) {
  return ['completed', 'cancelled', 'failed', 'partial-failed'].includes(stage);
}

function journalPath(id: string) {
  return join(RENDER_JOB_ROOT, `${id}.json`);
}

async function readJournal(id: string): Promise<RenderJobJournal | null> {
  try {
    const parsed = JSON.parse(await readFile(journalPath(id), 'utf8')) as Partial<RenderJobJournal>;
    if (parsed.version !== 1 || !parsed.snapshot || !parsed.options || parsed.snapshot.id !== id) return null;
    return parsed as RenderJobJournal;
  } catch {
    return null;
  }
}

async function persistJournal(job: ActiveRenderJob) {
  const journal: RenderJobJournal = {
    version: 1,
    snapshot: cloneSnapshot(job.snapshot),
    options: { ...job.options, forceSceneIds: [...job.options.forceSceneIds] },
  };
  job.persistence = job.persistence
    .then(() => writeJournal(journal))
    .catch(() => undefined);
  await job.persistence;
}

async function writeJournal(journal: RenderJobJournal) {
  await mkdir(RENDER_JOB_ROOT, { recursive: true });
  const path = journalPath(journal.snapshot.id);
  const temporaryPath = `${path}.next`;
  await writeFile(temporaryPath, JSON.stringify(journal, null, 2), 'utf8');
  await rename(temporaryPath, path);
}

function ffmpegConcatPath(path: string) {
  return path.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function appendToBody(html: string, content: string) {
  if (!content) return html;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${content}</body>`) : `${html}${content}`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function inlineLocalDataUrls(html: string): Promise<string> {
  const pattern = /(["'])\/api\/data\/([^"'?#]+)(?:[?#][^"']*)?\1/gi;
  const replacements = await Promise.all(Array.from(html.matchAll(pattern)).map(async match => {
    const localUrl = `/api/data/${match[2]}`;
    const localPath = resolveDataUrlPath(localUrl);
    if (!localPath) throw new RenderSceneError('resource', `无法解析本地素材地址：${localUrl}`);
    try {
      const content = await readFile(localPath);
      const mime = imageMimeType(localPath);
      return { source: match[0], value: `${match[1]}data:${mime};base64,${content.toString('base64')}${match[1]}` };
    } catch (error) {
      throw new RenderSceneError('resource', `无法读取本地素材：${localUrl}（${error instanceof Error ? error.message : String(error)}）`);
    }
  }));
  let index = 0;
  return html.replace(pattern, () => replacements[index++]?.value || '');
}

function forceEagerImageLoading(html: string): string {
  // A lazy image may remain pending forever in the off-screen render page even
  // after it has been embedded as a data URL. Every image is needed for a video
  // frame, so lazy loading has no value in the exporter.
  return html.replace(/\bloading\s*=\s*(["'])lazy\1/gi, 'loading="eager"');
}

function imageMimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeError(error: unknown) {
  if (error instanceof RenderSceneError) return { type: error.type, message: error.message };
  if (error instanceof Error) return { type: error.name || 'render', message: error.message };
  return { type: 'render', message: String(error) };
}

class RenderSceneError extends Error {
  constructor(public readonly type: string, message: string) {
    super(message);
    this.name = 'RenderSceneError';
  }
}

declare global {
  interface Window {
    __renderBridge?: {
      version: 1;
      setTime(ms: number): Promise<void>;
      getStatus(): {
        ready: boolean;
        assets: 'loading' | 'ready' | 'failed';
        controllable: boolean;
        compatibility: RenderCompatibility;
        warnings: string[];
      };
    };
  }
}
