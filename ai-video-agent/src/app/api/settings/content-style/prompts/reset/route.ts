import { NextResponse } from 'next/server';
import { z } from 'zod';
import { contentStyleErrorResponse } from '@/lib/content-style/api';
import { contentStyleStore } from '@/lib/content-style/store';

const schema = z.object({
  agent: z.enum(['planner', 'quality']),
  presetId: z.string().optional(),
  expectedRevision: z.number().int().min(0),
});

export async function POST(request: Request) {
  try {
    return NextResponse.json(await contentStyleStore.resetPrompt(schema.parse(await request.json())));
  } catch (error) {
    return contentStyleErrorResponse(error);
  }
}
