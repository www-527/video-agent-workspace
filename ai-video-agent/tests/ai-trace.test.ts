import { describe, expect, it } from 'vitest';
import { isLocalDebugRequest, publishAITrace, subscribeAITrace, type AITraceEvent } from '@/lib/ai/trace';

const event = (id: string): AITraceEvent => ({
  id, stage: '测试', model: 'test-model', system: 'system', user: 'user', reasoning: null,
  output: '{}', startedAt: new Date(0).toISOString(), durationMs: 12, attempt: 1, maxAttempts: 1,
});

describe('AI trace channel', () => {
  it('keeps concurrent call ids separate', () => {
    const received: string[] = [];
    const unsubscribe = subscribeAITrace(item => received.push(item.id));
    publishAITrace(event('call-a'));
    publishAITrace(event('call-b'));
    unsubscribe();
    expect(received).toEqual(['call-a', 'call-b']);
  });

  it('only accepts local debug requests', () => {
    expect(isLocalDebugRequest(new Headers({ host: '127.0.0.1:3000' }))).toBe(true);
    expect(isLocalDebugRequest(new Headers({ host: 'localhost:3000', 'x-forwarded-for': '10.0.0.2' }))).toBe(false);
    expect(isLocalDebugRequest(new Headers({ host: 'example.com' }))).toBe(false);
  });
});
