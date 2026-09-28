import { NextResponse } from 'next/server';
import { z } from 'zod';
import { contentStyleErrorResponse } from '@/lib/content-style/api';
import { contentStyleStore } from '@/lib/content-style/store';

const schema = z.object({ expectedRevision: z.number().int().min(0) });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { expectedRevision } = schema.parse(await request.json());
    return NextResponse.json(await contentStyleStore.restoreVersion({ id: params.id, expectedRevision }));
  } catch (error) {
    return contentStyleErrorResponse(error);
  }
}

