import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import * as tencentcloud from 'tencentcloud-sdk-nodejs-tts';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { parseBuffer } from 'music-metadata';
import { env } from '@/lib/env';
import {
  getIndexTtsSettings,
  indexTtsEmotionNames,
  type IndexTtsSettings,
} from '@/lib/indextts-settings';
import type { TtsProvider } from '@/lib/tts-provider';

const TtsClient = tencentcloud.tts.v20190823.Client;
const MAX_SEGMENT_LENGTH = 140;
const INDEX_TTS_MIN_JOB_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TTS_GENERATION_ATTEMPTS = 3;
const execFileAsync = promisify(execFile);
let indexTtsQueue: Promise<void> = Promise.resolve();

export type GenerateTtsOptions = {
  projectId: string;
  frameId: string;
  text: string;
  voice?: string;
  provider?: TtsProvider;
  abortSignal?: AbortSignal;
};

type IndexTtsAudioResource = {
  id: string;
  url: string;
  format?: string;
  mimeType?: string;
  size?: number;
};

type IndexTtsJob = {
  jobId: string;
  status: 'queued' | 'loading' | 'running' | 'completed' | 'failed' | 'canceled';
  progress?: number;
  audio?: IndexTtsAudioResource | null;
  error?: string | null;
};

/**
 * 使用腾讯云语音合成生成旁白。
 *
 * 腾讯云基础合成单次最多支持 150 个中文字符。较长旁白会按自然标点切成
 * 多段分别合成，再拼接为一个 MP3，保持上层 API 和现有视频管线不变。
 */
export async function generateAndSaveTTS(opts: GenerateTtsOptions): Promise<{ url: string; duration: number; format: 'mp3' }> {
  const {
    projectId,
    frameId,
    text,
    provider = 'tencent',
    abortSignal,
  } = opts;

  const normalizedText = text?.trim();
  if (!normalizedText) throw new Error('TTS 文本为空');
  throwIfAborted(abortSignal);

  if (provider === 'none') {
    return {
      url: '',
      duration: estimateSilentDuration(normalizedText),
      format: 'mp3',
    };
  }

  if (provider === 'edge') {
    return generateWithEdgeTts({
      projectId,
      frameId,
      text: normalizedText,
      voice: opts.voice || env.EDGE_TTS_VOICE,
      abortSignal,
    });
  }

  if (provider === 'indextts') {
    // The local IndexTTS engine owns one GPU inference lock. Queue calls here so
    // their timeout does not burn down while another frame is still synthesizing.
    return runSerializedIndexTts(() => generateWithIndexTts({
      projectId,
      frameId,
      text: normalizedText,
      abortSignal,
    }));
  }

  const voice = opts.voice || env.TTS_VOICE;

  if (!env.TENCENTCLOUD_SECRET_ID || !env.TENCENTCLOUD_SECRET_KEY) {
    throw new Error(
      '腾讯云 TTS 未配置：请设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY',
    );
  }

  const voiceType = Number(voice);
  if (!Number.isInteger(voiceType) || voiceType <= 0) {
    throw new Error(`腾讯云 TTS 音色 ID 无效：${voice}`);
  }

  const client = new TtsClient({
    credential: {
      secretId: env.TENCENTCLOUD_SECRET_ID,
      secretKey: env.TENCENTCLOUD_SECRET_KEY,
    },
    region: env.TENCENTCLOUD_TTS_REGION,
    profile: {
      httpProfile: {
        endpoint: 'tts.tencentcloudapi.com',
      },
    },
  });

  try {
    const audioParts: Buffer[] = [];
    let duration = 0;

    for (const segment of splitTextForTencentTts(normalizedText)) {
      throwIfAborted(abortSignal);

      const response = await client.TextToVoice({
        Text: segment,
        SessionId: randomUUID(),
        VoiceType: voiceType,
        PrimaryLanguage: 1,
        SampleRate: env.TENCENTCLOUD_TTS_SAMPLE_RATE,
        Codec: 'mp3',
        Speed: env.TENCENTCLOUD_TTS_SPEED,
        Volume: env.TENCENTCLOUD_TTS_VOLUME,
      });

      throwIfAborted(abortSignal);
      if (!response.Audio) throw new Error('腾讯云 TTS 未返回音频');

      const part = Buffer.from(response.Audio, 'base64');
      if (part.length === 0) throw new Error('腾讯云 TTS 返回了空音频');

      audioParts.push(part);
      duration += await getDuration(part, segment);
    }

    const audio = Buffer.concat(audioParts);
    const dir = join(process.cwd(), 'data', 'audio', projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${frameId}.mp3`), audio);

    return {
      url: `/api/data/audio/${projectId}/${frameId}.mp3`,
      duration,
      format: 'mp3',
    };
  } catch (error) {
    if (abortSignal?.aborted) {
      throw abortSignal.reason ?? new Error('TTS 已取消');
    }
    throw new Error(`腾讯云 TTS 生成失败：${formatTencentCloudError(error)}`, {
      cause: error,
    });
  }
}

export async function generateAndSaveTTSWithRetry(
  opts: GenerateTtsOptions,
  attempts = DEFAULT_TTS_GENERATION_ATTEMPTS,
): Promise<{ url: string; duration: number; format: 'mp3' }> {
  let lastError: unknown;
  const totalAttempts = Math.max(1, attempts);

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      return await generateAndSaveTTS(opts);
    } catch (error) {
      if (opts.abortSignal?.aborted) throw error;
      lastError = error;
      if (attempt < totalAttempts) {
        console.warn(`[TTS] attempt ${attempt}/${totalAttempts} failed for frame ${opts.frameId}; retrying`, error);
        await delay(Math.min(4000, 750 * 2 ** (attempt - 1)), opts.abortSignal);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function runSerializedIndexTts<T>(operation: () => Promise<T>): Promise<T> {
  const run = indexTtsQueue.then(operation, operation);
  indexTtsQueue = run.then(() => undefined, () => undefined);
  return run;
}

function estimateSilentDuration(text: string): number {
  return Math.max(2, Math.ceil(Array.from(text).length / 4));
}

async function generateWithIndexTts(opts: {
  projectId: string;
  frameId: string;
  text: string;
  settings?: IndexTtsSettings;
  abortSignal?: AbortSignal;
}): Promise<{ url: string; duration: number; format: 'mp3' }> {
  const { projectId, frameId, text, abortSignal } = opts;
  const settings = opts.settings ?? await getIndexTtsSettings();
  if (settings.adapterMode === 'api') {
    return generateWithIndexTtsApi({ projectId, frameId, text, settings, abortSignal });
  }
  const baseUrl = (settings.gradioBaseUrl || settings.baseUrl).replace(/\/+$/, '');
  const referenceAudio = resolveIndexTtsReferenceAudio(settings);

  if (!referenceAudio) {
    throw new Error('IndexTTS 未配置参考音频，请在参数设置中填写参考音频路径或预设音色');
  }

  const dir = join(process.cwd(), 'data', 'audio', projectId);
  const outputPath = join(dir, `${frameId}.mp3`);

  try {
    await mkdir(dir, { recursive: true });
    await assertIndexTtsReachable(baseUrl, settings.timeoutMs, abortSignal);

    const submitConfig = await getGradioConfig(baseUrl, settings.timeoutMs, abortSignal);
    await syncIndexTtsGlossary(baseUrl, settings, submitConfig, abortSignal);
    const submitData = buildIndexTtsSubmitData(text, referenceAudio, settings);
    await postGradio(baseUrl, 'submit_task', submitData, submitConfig, settings.timeoutMs, abortSignal);

    const sourceAudioPath = await pollIndexTtsAudio(baseUrl, settings, abortSignal);
    if (!sourceAudioPath) throw new Error('IndexTTS 未返回音频');

    await saveIndexTtsAudio(sourceAudioPath, outputPath);
    const audio = await readFile(outputPath);

    return {
      url: `/api/data/audio/${projectId}/${frameId}.mp3`,
      duration: await getDuration(audio, text),
      format: 'mp3',
    };
  } catch (error) {
    if (abortSignal?.aborted) throw abortSignal.reason ?? new Error('TTS 已取消');
    throw new Error(`IndexTTS 生成失败：${formatIndexTtsError(error, baseUrl)}`, { cause: error });
  }
}

export async function generateIndexTtsPreview(opts: {
  text: string;
  settings: IndexTtsSettings;
  abortSignal?: AbortSignal;
}): Promise<{ url: string; duration: number; format: 'mp3' }> {
  return generateWithIndexTts({
    projectId: 'indextts-preview',
    frameId: randomUUID(),
    text: opts.text,
    settings: opts.settings,
    abortSignal: opts.abortSignal,
  });
}

async function generateWithIndexTtsApi(opts: {
  projectId: string;
  frameId: string;
  text: string;
  settings: IndexTtsSettings;
  abortSignal?: AbortSignal;
}): Promise<{ url: string; duration: number; format: 'mp3' }> {
  const { projectId, frameId, text, settings, abortSignal } = opts;
  const baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
  // Long narration can legitimately take several minutes on the local GPU.
  // Keep the user-configured timeout for short network calls, but never abandon
  // a queued synthesis job after only two minutes.
  const jobTimeoutMs = getIndexTtsJobTimeoutMs(settings.timeoutMs);
  const dir = join(process.cwd(), 'data', 'audio', projectId);
  const outputPath = join(dir, `${frameId}.mp3`);

  try {
    await mkdir(dir, { recursive: true });
    const payload = buildIndexTtsApiPayload(text, settings);
    const sourceAudio = await synthesizeIndexTtsApiAudio(baseUrl, payload, jobTimeoutMs, abortSignal);
    await saveIndexTtsApiAudio(sourceAudio, baseUrl, outputPath, jobTimeoutMs, abortSignal);
    const audio = await readFile(outputPath);

    return {
      url: `/api/data/audio/${projectId}/${frameId}.mp3`,
      duration: await getDuration(audio, text),
      format: 'mp3',
    };
  } catch (error) {
    if (abortSignal?.aborted) throw abortSignal.reason ?? new Error('TTS 已取消');
    throw new Error(`IndexTTS API 生成失败：${formatIndexTtsError(error, baseUrl)}`, { cause: error });
  }
}

export function getIndexTtsJobTimeoutMs(configuredTimeoutMs: number): number {
  return Math.max(configuredTimeoutMs, INDEX_TTS_MIN_JOB_TIMEOUT_MS);
}

async function synthesizeIndexTtsApiAudio(
  baseUrl: string,
  payload: ReturnType<typeof buildIndexTtsApiPayload>,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<IndexTtsAudioResource | { audioPath: string; format?: string }> {
  const job = await createIndexTtsJob(baseUrl, payload, timeoutMs, abortSignal);
  if (job) {
    const completed = await pollIndexTtsJob(baseUrl, job.jobId, timeoutMs, abortSignal);
    if (!completed.audio) throw new Error('IndexTTS API job completed without audio');
    return completed.audio;
  }

  const response = await fetchWithTimeout(
    `${baseUrl}/api/tts`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    timeoutMs,
    abortSignal,
  );
  const result = await response.json().catch(() => ({})) as {
    ok?: boolean;
    audio?: IndexTtsAudioResource;
    audioPath?: string;
    format?: string;
    detail?: string;
    error?: string;
  };
  if (!response.ok || (!result.audio && !result.audioPath)) {
    throw new Error(result.detail || result.error || `${response.status} ${response.statusText}`);
  }
  return result.audio ?? { audioPath: result.audioPath as string, format: result.format };
}

async function createIndexTtsJob(
  baseUrl: string,
  payload: ReturnType<typeof buildIndexTtsApiPayload>,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<IndexTtsJob | null> {
  const response = await fetchWithTimeout(
    `${baseUrl}/api/tts/jobs`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    Math.min(timeoutMs, 30000),
    abortSignal,
  ).catch(error => {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return null;
  });
  if (!response || response.status === 404 || response.status === 405) return null;
  const result = await response.json().catch(() => ({})) as IndexTtsJob & { detail?: string; error?: string };
  if (!response.ok || !result.jobId) {
    if (response.status === 404 || response.status === 405) return null;
    throw new Error(result.detail || result.error || `${response.status} ${response.statusText}`);
  }
  return result;
}

async function pollIndexTtsJob(
  baseUrl: string,
  jobId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<IndexTtsJob> {
  const startedAt = Date.now();
  const cancel = () => {
    fetch(`${baseUrl}/api/tts/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }).catch(() => undefined);
  };
  abortSignal?.addEventListener('abort', cancel, { once: true });

  try {
    while (Date.now() - startedAt < timeoutMs) {
      throwIfAborted(abortSignal);
      const response = await fetchWithTimeout(
        `${baseUrl}/api/tts/jobs/${encodeURIComponent(jobId)}`,
        { method: 'GET' },
        Math.min(timeoutMs, 30000),
        abortSignal,
      );
      const job = await response.json().catch(() => ({})) as IndexTtsJob & { detail?: string; error?: string };
      if (!response.ok) throw new Error(job.detail || job.error || `${response.status} ${response.statusText}`);
      if (job.status === 'completed') return job;
      if (job.status === 'failed') throw new Error(job.error || 'IndexTTS API job failed');
      if (job.status === 'canceled') throw new Error('IndexTTS API job was canceled');
      await delay(1200, abortSignal);
    }
  } finally {
    abortSignal?.removeEventListener('abort', cancel);
  }

  throw new Error('IndexTTS API job timed out');
}

async function saveIndexTtsApiAudio(
  source: IndexTtsAudioResource | { audioPath: string; format?: string },
  baseUrl: string,
  outputPath: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<void> {
  if ('url' in source) {
    const audio = await downloadIndexTtsAudio(baseUrl, source.url, timeoutMs, abortSignal);
    await saveIndexTtsAudioBuffer(audio, outputPath, source.format);
    return;
  }
  await saveIndexTtsAudio(source.audioPath, outputPath);
}

async function downloadIndexTtsAudio(
  baseUrl: string,
  url: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<Buffer> {
  const absoluteUrl = new URL(url, `${baseUrl}/`).toString();
  const response = await fetchWithTimeout(absoluteUrl, { method: 'GET' }, timeoutMs, abortSignal);
  if (!response.ok) throw new Error(`IndexTTS audio download failed: ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

export function buildIndexTtsApiPayload(text: string, settings: IndexTtsSettings) {
  return {
    text,
    presetId: settings.presetId,
    referenceId: settings.referenceId,
    referenceAudio: settings.referenceAudio,
    voice: settings.voice || settings.speaker,
    speed: settings.speed,
    emotion: {
      mode: settings.emotion.mode,
      weight: settings.emotion.weight,
      preset: settings.emotion.preset,
      referenceId: settings.emotion.referenceId,
      referenceAudio: settings.emotion.referenceAudio,
      vector: settings.emotion.vector,
      vectorValues: indexTtsEmotionNames.map(name => settings.emotion.vector[name]),
      text: settings.emotion.text,
    },
    multiSpeaker: settings.multiSpeaker,
    glossary: settings.glossary,
    generation: settings.generation,
    sentence: settings.sentence,
  };
}

function buildIndexTtsSubmitData(text: string, referenceAudio: string, settings: IndexTtsSettings) {
  const emotionMode = getIndexTtsEmotionMode(settings);
  const emotionChoice = getIndexTtsEmotionChoice(settings);
  const emotionReferenceAudio = emotionMode === 1
    ? resolveIndexTtsAudioValue(settings.emotion.referenceAudio || settings.emotion.preset)
    : null;
  const emotionVector = emotionMode === 2
    ? indexTtsEmotionNames.map(name => settings.emotion.vector[name])
    : Array.from({ length: 8 }, () => 0);
  const emotionText = emotionMode === 3 ? settings.emotion.text : '';
  const generation = settings.generation;
  const multiSpeakerEnabled = settings.multiSpeaker.enabled && settings.multiSpeaker.roles.length > 0;
  const roles = Array.from({ length: 8 }).flatMap((_, index) => {
    const role = settings.multiSpeaker.roles[index];
    return role
      ? [role.name, resolveIndexTtsAudioValue(role.referenceAudio), role.speed]
      : ['', '', 1];
  });
  return [
    false,
    multiSpeakerEnabled,
    null,
    emotionChoice,
    referenceAudio,
    text,
    emotionReferenceAudio,
    settings.emotion.weight,
    ...emotionVector,
    emotionText,
    settings.speed,
    false,
    settings.sentence.sentenceMaxTokens,
    generation.doSample,
    generation.topP,
    generation.topK,
    generation.temperature,
    generation.lengthPenalty,
    generation.numBeams,
    generation.repetitionPenalty,
    generation.maxMelTokens,
    ...roles,
  ];
}

function resolveIndexTtsReferenceAudio(settings: IndexTtsSettings): string {
  const configured = settings.referenceAudio || settings.voice || settings.speaker;
  return resolveIndexTtsAudioValue(configured);
}

function resolveIndexTtsAudioValue(configured: string): string {
  if (!configured || configured === '---预设音色列表---') return '';
  if (/^[a-zA-Z]:[\\/]/.test(configured) || configured.startsWith('\\\\')) return configured;
  return join(
    process.cwd(),
    'local tts',
    'yzylauncher-win-Indextts20-260616',
    'win-unpacked',
    'python',
    'voices',
    configured,
  );
}

function getIndexTtsEmotionMode(settings: IndexTtsSettings): number {
  if (settings.emotion.mode === 'reference_audio') return 1;
  if (settings.emotion.mode === 'vector') return 2;
  if (settings.emotion.mode === 'text') return 3;
  return 0;
}

function getIndexTtsEmotionChoice(settings: IndexTtsSettings): string {
  if (settings.emotion.mode === 'reference_audio') return '使用情感参考音频';
  if (settings.emotion.mode === 'vector') return '使用情感向量控制';
  if (settings.emotion.mode === 'text') return '使用情感描述文本控制';
  return '与音色参考音频相同';
}

async function syncIndexTtsGlossary(
  baseUrl: string,
  settings: IndexTtsSettings,
  config: unknown,
  abortSignal?: AbortSignal,
): Promise<void> {
  if (!settings.glossary.enabled || !settings.glossary.terms.length) return;

  try {
    await postGradio(
      baseUrl,
      'on_glossary_checkbox_change',
      [true],
      config,
      Math.min(settings.timeoutMs, 10000),
      abortSignal,
    );
  } catch {
    // Some Gradio builds keep UI callbacks private; generation should still proceed.
  }

  for (const term of settings.glossary.terms) {
    try {
      await postGradio(
        baseUrl,
        'on_add_glossary_term',
        [term.term, term.zh, term.en],
        config,
        Math.min(settings.timeoutMs, 10000),
        abortSignal,
      );
    } catch {
      // The glossary is persisted in settings even if the running service does not expose this callback.
    }
  }
}

async function assertIndexTtsReachable(
  baseUrl: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<void> {
  const response = await fetchWithTimeout(`${baseUrl}/config`, { method: 'GET' }, Math.min(timeoutMs, 10000), abortSignal);
  if (!response.ok) {
    throw new Error(`IndexTTS 服务响应异常：${response.status} ${response.statusText}`);
  }
}

async function getGradioConfig(
  baseUrl: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<unknown> {
  const response = await fetchWithTimeout(`${baseUrl}/config`, { method: 'GET' }, Math.min(timeoutMs, 10000), abortSignal);
  if (!response.ok) throw new Error(`IndexTTS 服务响应异常：${response.status} ${response.statusText}`);
  return response.json();
}

async function postGradio(
  baseUrl: string,
  apiName: string,
  data: unknown[],
  config: unknown,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<unknown> {
  const candidates: Array<{ url: string; body: object }> = [
    ...getGradioApiPrefixes(config).flatMap(prefix => [
      { url: `${baseUrl}${prefix}/run/${apiName}`, body: { data } },
      { url: `${baseUrl}${prefix}/api/${apiName}`, body: { data } },
    ]),
  ];
  const fnIndex = findGradioFnIndex(config, apiName);
  if (fnIndex !== undefined) {
    candidates.push(
      ...getGradioApiPrefixes(config).flatMap(prefix => [
        { url: `${baseUrl}${prefix}/run/predict`, body: { data, fn_index: fnIndex } },
        { url: `${baseUrl}${prefix}/api/predict`, body: { data, fn_index: fnIndex } },
      ]),
    );
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const response = await fetchWithTimeout(
        candidate.url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(candidate.body),
        },
        timeoutMs,
        abortSignal,
      );
      if (response.status === 404) continue;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload) || `${response.status} ${response.statusText}`);
      }
      return payload;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`无法调用 IndexTTS 接口：${apiName}`);
}

function getGradioApiPrefixes(config: unknown): string[] {
  const configured = (config as { api_prefix?: unknown })?.api_prefix;
  const prefix = typeof configured === 'string' && configured ? configured.replace(/\/+$/, '') : '';
  return Array.from(new Set([prefix, '']));
}

function findGradioFnIndex(config: unknown, apiName: string): number | undefined {
  const dependencies = (config as { dependencies?: Array<Record<string, unknown>> })?.dependencies;
  if (!Array.isArray(dependencies)) return undefined;
  const match = dependencies.find(dep => {
    const depApiName = dep.api_name;
    if (depApiName === apiName || depApiName === `/${apiName}`) return true;
    const fn = dep.fn as string | undefined;
    return fn === apiName;
  });
  const index = match?.fn_index;
  return typeof index === 'number' ? index : undefined;
}

async function pollIndexTtsAudio(
  baseUrl: string,
  settings: IndexTtsSettings,
  abortSignal?: AbortSignal,
): Promise<string> {
  const startedAt = Date.now();
  let lastShownAudio: string | null = null;
  let lastPayload: unknown;

  while (Date.now() - startedAt < settings.timeoutMs) {
    throwIfAborted(abortSignal);
    await delay(2000, abortSignal);

    const config = await getGradioConfig(baseUrl, Math.min(settings.timeoutMs, 10000), abortSignal);
    const payload = await postGradio(
      baseUrl,
      'refresh_ui',
      [lastShownAudio],
      config,
      Math.min(settings.timeoutMs, 30000),
      abortSignal,
    );
    lastPayload = payload;

    const audioPath = findAudioPath(payload);
    if (audioPath && audioPath !== lastShownAudio) return audioPath;
    if (audioPath) lastShownAudio = audioPath;
  }

  throw new Error(`IndexTTS 合成超时，请检查模型是否加载完成。最后响应：${extractErrorMessage(lastPayload) || '无音频'}`);
}

function findAudioPath(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return /\.(wav|mp3)$/i.test(value) && !/\.srt$/i.test(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAudioPath(item);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const found = findAudioPath(item);
      if (found) return found;
    }
  }
  return undefined;
}

async function saveIndexTtsAudio(sourcePath: string, outputPath: string): Promise<void> {
  const audio = await readFile(sourcePath);
  if (!audio.length) throw new Error('IndexTTS 未返回音频');
  if (isMp3(audio)) {
    await writeFile(outputPath, audio);
    return;
  }
  if (isWav(audio)) {
    await convertAudioToMp3(sourcePath, outputPath);
    return;
  }
  await copyFile(sourcePath, outputPath);
}

async function saveIndexTtsAudioBuffer(audio: Buffer, outputPath: string, format?: string): Promise<void> {
  if (!audio.length) throw new Error('IndexTTS returned empty audio');
  if (isMp3(audio) || format === 'mp3') {
    await writeFile(outputPath, audio);
    return;
  }

  const sourcePath = `${outputPath}.${format === 'wav' || isWav(audio) ? 'wav' : 'audio'}`;
  await writeFile(sourcePath, audio);
  try {
    if (isWav(audio) || format === 'wav') {
      await convertAudioToMp3(sourcePath, outputPath);
      return;
    }
    await writeFile(outputPath, audio);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
  }
}

async function convertAudioToMp3(sourcePath: string, outputPath: string): Promise<void> {
  const candidates = [
    process.env.FFMPEG_PATH,
    join(
      process.cwd(),
      'local tts',
      'yzylauncher-win-Indextts20-260616',
      'win-unpacked',
      'python',
      'ffmpeg',
      'bin',
      'ffmpeg.exe',
    ),
    'ffmpeg',
  ].filter(Boolean) as string[];

  let lastError: unknown;
  for (const ffmpeg of candidates) {
    try {
      await execFileAsync(ffmpeg, ['-y', '-i', sourcePath, '-codec:a', 'libmp3lame', '-q:a', '2', outputPath]);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`IndexTTS 返回 wav，但转 mp3 失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function isMp3(audio: Buffer): boolean {
  return audio.subarray(0, 3).toString('ascii') === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0);
}

function isWav(audio: Buffer): boolean {
  return audio.subarray(0, 4).toString('ascii') === 'RIFF' && audio.subarray(8, 12).toString('ascii') === 'WAVE';
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(abortSignal?.reason);
  abortSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    abortSignal?.removeEventListener('abort', onAbort);
  }
}

function delay(ms: number, abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    abortSignal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abortSignal.reason ?? new Error('TTS 已取消'));
    }, { once: true });
  });
}

function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const error = record.error || record.detail || record.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') return JSON.stringify(error);
  return '';
}

function formatIndexTtsError(error: unknown, baseUrl: string): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'IndexTTS 合成超时，请检查模型是否加载完成';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ECONNREFUSED|Failed to fetch/i.test(message)) {
    return `IndexTTS 服务未启动或地址错误（${baseUrl}）`;
  }
  return message;
}

async function generateWithEdgeTts(opts: {
  projectId: string;
  frameId: string;
  text: string;
  voice: string;
  abortSignal?: AbortSignal;
}): Promise<{ url: string; duration: number; format: 'mp3' }> {
  const { projectId, frameId, text, voice, abortSignal } = opts;
  const tts = new MsEdgeTTS();
  let audioStream: NodeJS.ReadableStream | undefined;

  const abort = () => {
    tts.close();
    if (audioStream && 'destroy' in audioStream) {
      (audioStream as NodeJS.ReadableStream & { destroy(error?: Error): void }).destroy(
        new Error('TTS 已取消'),
      );
    }
  };
  abortSignal?.addEventListener('abort', abort, { once: true });

  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const streamResult = tts.toStream(escapeXml(text), { rate: env.EDGE_TTS_RATE });
    audioStream = streamResult.audioStream;

    const chunks: Buffer[] = [];
    for await (const chunk of streamResult.audioStream) {
      throwIfAborted(abortSignal);
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const audio = Buffer.concat(chunks);
    if (!audio.length) throw new Error('Edge TTS 未返回音频');

    const dir = join(process.cwd(), 'data', 'audio', projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${frameId}.mp3`), audio);

    return {
      url: `/api/data/audio/${projectId}/${frameId}.mp3`,
      duration: await getDuration(audio, text),
      format: 'mp3',
    };
  } catch (error) {
    if (abortSignal?.aborted) throw abortSignal.reason ?? new Error('TTS 已取消');
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Edge TTS 生成失败：${message}`, { cause: error });
  } finally {
    abortSignal?.removeEventListener('abort', abort);
    tts.close();
  }
}

export function splitTextForTencentTts(
  text: string,
  maxLength = MAX_SEGMENT_LENGTH,
): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const clauses = normalized.match(/[^。！？!?；;，,\n]+[。！？!?；;，,\n]?/gu) ?? [normalized];
  const segments: string[] = [];
  let current = '';

  const flush = () => {
    const value = current.trim();
    if (value) segments.push(value);
    current = '';
  };

  for (const clause of clauses) {
    const cleaned = clause.trim();
    if (!cleaned) continue;

    const chars = Array.from(cleaned);
    if (chars.length > maxLength) {
      flush();
      for (let start = 0; start < chars.length; start += maxLength) {
        segments.push(chars.slice(start, start + maxLength).join(''));
      }
      continue;
    }

    if (Array.from(current + cleaned).length > maxLength) flush();
    current += cleaned;
  }

  flush();
  return segments;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('TTS 已取消');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatTencentCloudError(error: unknown): string {
  const cloudError = error as { code?: string; message?: string };
  const code = cloudError?.code ?? '';

  if (code === 'UnsupportedOperation.PkgExhausted') {
    return '当前音色对应的资源包已耗尽，请更换音色、购买资源包或开通后付费';
  }
  if (code === 'UnsupportedOperation.NoFreeAccount') {
    return '免费额度已用尽，请购买资源包或开通后付费';
  }
  if (code.startsWith('AuthFailure')) {
    return '鉴权失败，请检查腾讯云 SecretId、SecretKey 和子账号权限';
  }
  if (code === 'InvalidParameterValue.VoiceType') {
    return `音色 ID 不可用，请检查 TTS_VOICE（${env.TTS_VOICE}）`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return code ? `${code}: ${message}` : message;
}

async function getDuration(audio: Buffer, text: string): Promise<number> {
  try {
    const metadata = await parseBuffer(audio, 'audio/mpeg', { duration: true });
    if (metadata.format.duration) return metadata.format.duration;
  } catch {
    // 极少数 MP3 响应无法解析时，退回中文旁白估算值。
  }
  return Math.max(2, Math.ceil(Array.from(text).length / 4));
}
