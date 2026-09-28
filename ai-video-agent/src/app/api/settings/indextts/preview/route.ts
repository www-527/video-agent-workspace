import { NextResponse } from 'next/server';
import { generateIndexTtsPreview } from '@/lib/ai/tts';
import { indexTtsSettingsSchema } from '@/lib/indextts-settings';

const DEFAULT_PREVIEW_TEXT = '这是一段 IndexTTS 音色试听。';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = indexTtsSettingsSchema.safeParse(body.settings ?? body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'IndexTTS 参数无效' },
      { status: 400 },
    );
  }

  if (!parsed.data.voice) {
    return NextResponse.json({ error: '请先选择音色' }, { status: 400 });
  }

  const text = typeof body.text === 'string' && body.text.trim()
    ? body.text.trim()
    : DEFAULT_PREVIEW_TEXT;

  try {
    const result = await generateIndexTtsPreview({
      text,
      settings: parsed.data,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
