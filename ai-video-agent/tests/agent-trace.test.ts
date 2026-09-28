import { describe, expect, it } from 'vitest';
import { runWithAgentExecutionContext } from '@/lib/agents/context';
import { AGENT_PIPELINE_VERSION } from '@/lib/agents/types';
import { publishAITrace, subscribeAITrace, type AITraceEvent } from '@/lib/ai/trace';

describe('agent trace context', () => {
  it('adds run, task and role metadata without changing callers', () => {
    let received: AITraceEvent | undefined;
    const unsubscribe = subscribeAITrace(event => { received = event; });
    runWithAgentExecutionContext({
      runId: 'run-1',
      taskId: 'research',
      agentRole: 'research',
    }, () => publishAITrace({
      id: 'trace-1',
      stage: 'test',
      model: 'model',
      system: 'system',
      user: 'user',
      reasoning: null,
      output: '{}',
      startedAt: new Date().toISOString(),
      durationMs: 1,
      attempt: 1,
      maxAttempts: 1,
    }));
    unsubscribe();

    expect(received).toMatchObject({
      runId: 'run-1',
      taskId: 'research',
      agentRole: 'research',
      category: 'legacy',
      pipelineVersion: AGENT_PIPELINE_VERSION,
    });
  });
});
