import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getTtsProviderFromRequest,
  TTS_PROVIDER_COOKIE,
  TTS_PROVIDERS,
} from '@/lib/tts-provider';

const schema = z.object({ provider: z.enum(TTS_PROVIDERS) });

export async function GET(req: NextRequest) {
  return NextResponse.json({ provider: getTtsProviderFromRequest(req) });
}

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: '不支持的 TTS 服务' }, { status: 400 });
  }

  const response = NextResponse.json({ provider: parsed.data.provider });
  response.cookies.set(TTS_PROVIDER_COOKIE, parsed.data.provider, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
