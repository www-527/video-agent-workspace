import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { env } from '@/lib/env';

const SETTINGS_PATH = join(process.cwd(), 'data', 'settings', 'indextts.json');

export const indexTtsEmotionModes = ['same_voice', 'reference_audio', 'vector', 'text'] as const;
export const indexTtsAdapterModes = ['api', 'gradio'] as const;
export const indexTtsEmotionNames = ['喜', '怒', '哀', '惧', '厌恶', '低落', '惊喜', '平静'] as const;

const trimString = z.string().trim();
const optionalTrimmedString = trimString.optional().default('');
const emotionVectorSchema = z.object(
  Object.fromEntries(indexTtsEmotionNames.map(name => [name, z.coerce.number().min(0).max(1).default(0)])) as Record<
    (typeof indexTtsEmotionNames)[number],
    z.ZodDefault<z.ZodNumber>
  >,
);

export const indexTtsSettingsSchema = z.object({
  baseUrl: trimString.url('服务地址必须是有效 URL'),
  apiBaseUrl: trimString.url('API 服务地址必须是有效 URL'),
  gradioBaseUrl: trimString.url('Gradio 服务地址必须是有效 URL'),
  adapterMode: z.enum(indexTtsAdapterModes).default('api'),
  speaker: optionalTrimmedString,
  voice: optionalTrimmedString,
  presetId: optionalTrimmedString,
  referenceId: optionalTrimmedString,
  referenceAudio: optionalTrimmedString,
  speed: z.coerce.number().min(0.5).max(1.5).default(1),
  temperature: z.coerce.number().min(0.1).max(2).default(0.8),
  topP: z.coerce.number().min(0).max(1).default(0.8),
  topK: z.coerce.number().int().min(0).max(100).default(30),
  format: z.enum(['mp3', 'wav']).default('mp3'),
  timeoutMs: z.coerce.number().int().min(1000).max(600000).default(120000),
  emotion: z.object({
    mode: z.enum(indexTtsEmotionModes).default('same_voice'),
    weight: z.coerce.number().min(0).max(1).default(0.65),
    preset: optionalTrimmedString,
    referenceId: optionalTrimmedString,
    referenceAudio: optionalTrimmedString,
    vector: emotionVectorSchema.default({}),
    text: optionalTrimmedString,
  }).default({}),
  multiSpeaker: z.object({
    enabled: z.boolean().default(false),
    roles: z.array(z.object({
      name: optionalTrimmedString,
      referenceId: optionalTrimmedString,
      referenceAudio: optionalTrimmedString,
      speed: z.coerce.number().min(0.5).max(1.5).default(1),
    })).default([]).transform(roles => roles.filter(role => role.name || role.referenceId || role.referenceAudio)),
  }).default({}),
  glossary: z.object({
    enabled: z.boolean().default(false),
    terms: z.array(z.object({
      term: optionalTrimmedString,
      zh: optionalTrimmedString,
      en: optionalTrimmedString,
    })).default([]).transform(terms => terms.filter(term => term.term && (term.zh || term.en))),
  }).default({}),
  generation: z.object({
    doSample: z.boolean().default(false),
    temperature: z.coerce.number().min(0.1).max(2).default(0.8),
    topP: z.coerce.number().min(0).max(1).default(0.8),
    topK: z.coerce.number().int().min(0).max(100).default(30),
    numBeams: z.coerce.number().int().min(1).max(20).default(3),
    repetitionPenalty: z.coerce.number().min(0).max(30).default(10),
    lengthPenalty: z.coerce.number().min(-10).max(10).default(0),
    maxMelTokens: z.coerce.number().int().min(1).max(5000).default(1500),
  }).default({}),
  sentence: z.object({
    sentenceMaxTokens: z.coerce.number().int().min(1).max(500).default(120),
  }).default({}),
});

export type IndexTtsSettings = z.infer<typeof indexTtsSettingsSchema>;

export const defaultIndexTtsSettings: IndexTtsSettings = indexTtsSettingsSchema.parse({
  baseUrl: env.INDEXTTS_GRADIO_BASE_URL,
  apiBaseUrl: env.INDEXTTS_API_BASE_URL,
  gradioBaseUrl: env.INDEXTTS_GRADIO_BASE_URL,
  adapterMode: env.INDEXTTS_ADAPTER_MODE,
  speaker: env.INDEXTTS_VOICE,
  voice: env.INDEXTTS_VOICE,
  referenceAudio: env.INDEXTTS_REFERENCE_AUDIO,
  speed: env.INDEXTTS_SPEED,
  temperature: env.INDEXTTS_TEMPERATURE,
  topP: env.INDEXTTS_TOP_P,
  topK: env.INDEXTTS_TOP_K,
  format: env.INDEXTTS_FORMAT,
  timeoutMs: env.INDEXTTS_TIMEOUT_MS,
  generation: {
    temperature: env.INDEXTTS_TEMPERATURE,
    topP: env.INDEXTTS_TOP_P,
    topK: env.INDEXTTS_TOP_K,
  },
});

function mergeIndexTtsSettings(value: unknown): unknown {
  const incoming = value && typeof value === 'object' ? value as Partial<IndexTtsSettings> : {};
  const gradioBaseUrl = incoming.gradioBaseUrl || incoming.baseUrl || defaultIndexTtsSettings.gradioBaseUrl;
  return {
    ...defaultIndexTtsSettings,
    ...incoming,
    baseUrl: gradioBaseUrl,
    apiBaseUrl: incoming.apiBaseUrl || defaultIndexTtsSettings.apiBaseUrl,
    gradioBaseUrl,
    adapterMode: incoming.adapterMode || defaultIndexTtsSettings.adapterMode,
    emotion: {
      ...defaultIndexTtsSettings.emotion,
      ...incoming.emotion,
      vector: {
        ...defaultIndexTtsSettings.emotion.vector,
        ...incoming.emotion?.vector,
      },
    },
    multiSpeaker: {
      ...defaultIndexTtsSettings.multiSpeaker,
      ...incoming.multiSpeaker,
    },
    glossary: {
      ...defaultIndexTtsSettings.glossary,
      ...incoming.glossary,
    },
    generation: {
      ...defaultIndexTtsSettings.generation,
      temperature: incoming.temperature ?? defaultIndexTtsSettings.generation.temperature,
      topP: incoming.topP ?? defaultIndexTtsSettings.generation.topP,
      topK: incoming.topK ?? defaultIndexTtsSettings.generation.topK,
      ...incoming.generation,
    },
    sentence: {
      ...defaultIndexTtsSettings.sentence,
      ...incoming.sentence,
    },
  };
}

export function normalizeIndexTtsSettings(value: unknown): IndexTtsSettings {
  return indexTtsSettingsSchema.parse(mergeIndexTtsSettings(value));
}

export async function getIndexTtsSettings(): Promise<IndexTtsSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf8');
    return normalizeIndexTtsSettings(JSON.parse(raw));
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'ENOENT') throw error;
    return defaultIndexTtsSettings;
  }
}

export async function saveIndexTtsSettings(settings: IndexTtsSettings): Promise<void> {
  const normalized = normalizeIndexTtsSettings(settings);
  await mkdir(join(process.cwd(), 'data', 'settings'), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(normalized, null, 2), 'utf8');
}
