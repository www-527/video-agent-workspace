import { NextResponse } from 'next/server';
import { contentStyleErrorResponse } from '@/lib/content-style/api';
import { contentStyleStore } from '@/lib/content-style/store';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json(await contentStyleStore.getVersion(params.id));
  } catch (error) {
    return contentStyleErrorResponse(error);
  }
}

