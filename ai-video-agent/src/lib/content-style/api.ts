import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ContentStyleStoreError } from './store';

export function contentStyleErrorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: '参数错误', details: error.flatten() }, { status: 400 });
  }
  if (error instanceof ContentStyleStoreError) {
    const status = error.code === 'REVISION_CONFLICT' ? 409
      : error.code === 'NOT_FOUND' ? 404
        : error.code === 'INVALID_INPUT' ? 422
          : 500;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  console.error('[content-style]', error);
  return NextResponse.json({ error: '内容风格设置操作失败' }, { status: 500 });
}

