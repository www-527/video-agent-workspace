import { NextResponse } from 'next/server';
import { z } from 'zod';
import { contentStyleErrorResponse } from '@/lib/content-style/api';
import { contentStyleStore } from '@/lib/content-style/store';

export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  expectedRevision: z.number().int().min(0),
  activePresetId: z.string().min(1),
  customInstruction: z.string().max(20_000),
  customPresets: z.array(z.any()).optional(),
});

export async function GET() {
  try {
    return NextResponse.json(await contentStyleStore.getView());
  } catch (error) {
    return contentStyleErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const input = updateSchema.parse(await request.json());
    return NextResponse.json(await contentStyleStore.updateSettings(input));
  } catch (error) {
    return contentStyleErrorResponse(error);
  }
}
