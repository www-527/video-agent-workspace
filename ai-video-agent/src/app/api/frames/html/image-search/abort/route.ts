import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { abort } from '@/lib/ai/abort-registry';

const schema = z.object({ projectId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: '参数错误' }, { status: 400 });
  return NextResponse.json({ ok: abort(parsed.data.projectId, 'pexels') });
}
