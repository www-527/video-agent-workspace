import { NextResponse } from 'next/server';
import {
  getIndexTtsSettings,
  indexTtsSettingsSchema,
  saveIndexTtsSettings,
} from '@/lib/indextts-settings';

export async function GET() {
  return NextResponse.json(await getIndexTtsSettings());
}

export async function POST(req: Request) {
  const parsed = indexTtsSettingsSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'IndexTTS 参数无效' },
      { status: 400 },
    );
  }

  await saveIndexTtsSettings(parsed.data);
  return NextResponse.json(parsed.data);
}
