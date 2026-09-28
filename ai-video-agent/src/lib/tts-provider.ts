import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';

export const TTS_PROVIDER_COOKIE = 'tts-provider';
export const TTS_PROVIDERS = ['none', 'edge', 'tencent', 'indextts'] as const;

export type TtsProvider = (typeof TTS_PROVIDERS)[number];

export function normalizeTtsProvider(value?: string | null): TtsProvider {
  return TTS_PROVIDERS.includes(value as TtsProvider) ? (value as TtsProvider) : 'tencent';
}

export function getTtsProviderFromRequest(req: NextRequest): TtsProvider {
  return normalizeTtsProvider(
    req.cookies.get(TTS_PROVIDER_COOKIE)?.value || env.TTS_PROVIDER,
  );
}
