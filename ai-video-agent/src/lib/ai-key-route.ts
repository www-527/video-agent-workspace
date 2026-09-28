import { NextResponse } from 'next/server';
import { AIKeyStoreError } from '@/lib/ai-key-store';
import { runWithActiveAIKey } from '@/lib/ai-key-context';

export function withAIKeyRoute<TArguments extends unknown[]>(
  handler: (...args: TArguments) => Promise<Response>,
): (...args: TArguments) => Promise<Response> {
  return async (...args) => {
    try {
      return await runWithActiveAIKey(() => handler(...args));
    } catch (error) {
      if (error instanceof AIKeyStoreError && error.code === 'NOT_FOUND') {
        return NextResponse.json(
          { error: '请先在 Key 管理中添加并选择 API Key', code: 'AI_KEY_NOT_CONFIGURED' },
          { status: 409 },
        );
      }
      throw error;
    }
  };
}
