import { describe, expect, it } from 'vitest';
import { getProjectAITraceHistory, publishAITrace, runWithAITraceProjectContext } from '@/lib/ai/trace';

function createTrace(id: string) {
  return {
    id,
    stage: 'agent.chat',
    model: 'gpt-test',
    relayBaseURL: 'https://relay.example.test/v1',
    system: 'System prompt',
    user: 'User input',
    reasoning: 'Reasoning',
    output: 'Agent output',
    startedAt: new Date().toISOString(),
    durationMs: 12,
    attempt: 1,
    maxAttempts: 1,
  };
}

describe('project AI trace history', () => {
  it('keeps relay calls scoped to the project and limits the project history to 100 records', () => {
    const projectId = `project-${Date.now()}-${Math.random()}`;
    const otherProjectId = `project-${Date.now()}-${Math.random()}`;

    runWithAITraceProjectContext(projectId, () => {
      for (let index = 0; index < 101; index += 1) publishAITrace(createTrace(`event-${index}`));
    });
    runWithAITraceProjectContext(otherProjectId, () => publishAITrace(createTrace('other-event')));

    const history = getProjectAITraceHistory(projectId);
    expect(history).toHaveLength(100);
    expect(history[0]?.id).toBe('event-1');
    expect(history.at(-1)?.projectId).toBe(projectId);
    expect(getProjectAITraceHistory(otherProjectId)).toHaveLength(1);
  });
});
