import { describe, expect, it } from 'vitest';
import { artifact } from '@/lib/agents/persistence';
import {
  createSerialCommitter,
  runAgentGraph,
  runRecordedAgentTask,
  type ExecutableAgentTask,
} from '@/lib/agents/orchestrator';
import type { AgentArtifact } from '@/lib/agents/types';

describe('multi-agent orchestrator', () => {
  it('runs independent agents in parallel and waits for dependencies', async () => {
    const events: string[] = [];
    let releaseResearch!: () => void;
    let releaseBrief!: () => void;
    let markStarted!: () => void;
    let startedCount = 0;
    const bothStarted = new Promise<void>(resolve => {
      markStarted = () => {
        startedCount += 1;
        if (startedCount === 2) resolve();
      };
    });
    const researchGate = new Promise<void>(resolve => { releaseResearch = resolve; });
    const briefGate = new Promise<void>(resolve => { releaseBrief = resolve; });

    const tasks: ExecutableAgentTask[] = [
      {
        id: 'research', role: 'research', dependencies: [], inputHash: 'r',
        async execute() {
          events.push('research:start');
          markStarted();
          await researchGate;
          events.push('research:end');
          return artifact('research', { facts: 1 });
        },
      },
      {
        id: 'brief', role: 'creative-brief', dependencies: [], inputHash: 'b',
        async execute() {
          events.push('brief:start');
          markStarted();
          await briefGate;
          events.push('brief:end');
          return artifact('brief', { audience: 'test' });
        },
      },
      {
        id: 'script', role: 'script', dependencies: ['research', 'brief'], inputHash: 's',
        async execute(context) {
          events.push('script:start');
          expect(context.getArtifact<{ facts: number }>('research')?.data.facts).toBe(1);
          expect(context.getArtifact<{ audience: string }>('brief')?.data.audience).toBe('test');
          return artifact('outline', { ok: true });
        },
      },
    ];

    const running = runAgentGraph({ runId: 'run-1', tasks, concurrency: 2 });
    await bothStarted;
    expect(events).toEqual(expect.arrayContaining(['research:start', 'brief:start']));
    expect(events).not.toContain('script:start');
    releaseResearch();
    releaseBrief();

    const result = await running;
    expect(result.results.get('script')?.status).toBe('completed');
    expect(events.indexOf('script:start')).toBeGreaterThan(events.indexOf('research:end'));
    expect(events.indexOf('script:start')).toBeGreaterThan(events.indexOf('brief:end'));
  });

  it('isolates failed branches and supports conditional repair tasks', async () => {
    const tasks: ExecutableAgentTask[] = [
      {
        id: 'audio', role: 'audio', dependencies: [], inputHash: 'a',
        async execute() { throw Object.assign(new Error('bad request'), { status: 400 }); },
      },
      {
        id: 'asset', role: 'asset', dependencies: [], inputHash: 'b',
        async execute() { return artifact('asset', { path: '/image.png' }); },
      },
      {
        id: 'visual', role: 'visual-composer', dependencies: ['audio', 'asset'],
        allowFailedDependencies: true, inputHash: 'c',
        async execute(context) {
          expect(context.getArtifact('audio')).toBeUndefined();
          return artifact('html', '<!DOCTYPE html>');
        },
      },
      {
        id: 'repair', role: 'repair', dependencies: ['visual'], inputHash: 'd',
        shouldRun: () => false,
        async execute() { throw new Error('must not run'); },
      },
    ];

    const result = await runAgentGraph({ runId: 'run-2', tasks, concurrency: 2 });
    expect(result.results.get('audio')?.status).toBe('failed');
    expect(result.results.get('asset')?.status).toBe('completed');
    expect(result.results.get('visual')?.status).toBe('completed');
    expect(result.results.get('repair')?.status).toBe('skipped');
  });

  it('cancels pending work while preserving completed artifacts', async () => {
    const controller = new AbortController();
    const tasks: ExecutableAgentTask[] = [
      {
        id: 'done', role: 'research', dependencies: [], inputHash: 'a',
        async execute() {
          controller.abort();
          return artifact('done', 1);
        },
      },
      {
        id: 'pending', role: 'script', dependencies: ['done'], inputHash: 'b',
        async execute() { return artifact('unexpected', 2); },
      },
    ];

    const result = await runAgentGraph({
      runId: 'run-3',
      tasks,
      concurrency: 1,
      abortSignal: controller.signal,
    });
    expect(result.results.get('done')?.status).toBe('completed');
    expect(result.artifacts.get('done')?.data).toBe(1);
    expect(result.results.get('pending')?.status).toBe('cancelled');
  });

  it('serializes project commits without dropping concurrent patches', async () => {
    const commit = createSerialCommitter();
    const order: number[] = [];
    await Promise.all([
      commit(async () => { await Promise.resolve(); order.push(1); }),
      commit(async () => { order.push(2); }),
      commit(async () => { order.push(3); }),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('enforces dependencies for individually recorded tasks and shares artifacts', async () => {
    const artifacts = new Map<string, AgentArtifact>();
    const child = {
      id: 'child',
      role: 'validator' as const,
      dependencies: ['parent'],
      inputHash: 'child-hash',
    };

    await expect(runRecordedAgentTask({
      runId: 'run-4',
      task: child,
      artifacts,
      execute: async () => artifact('validation', { ok: true }),
    })).rejects.toThrow('started before dependencies completed: parent');

    await runRecordedAgentTask({
      runId: 'run-4',
      task: {
        id: 'parent',
        role: 'asset-planner',
        dependencies: [],
        inputHash: 'parent-hash',
      },
      artifacts,
      execute: async () => artifact('asset-plan', { count: 1 }),
    });

    const result = await runRecordedAgentTask({
      runId: 'run-4',
      task: child,
      artifacts,
      execute: async context => {
        expect(context.getArtifact<{ count: number }>('parent')?.data.count).toBe(1);
        return artifact('validation', { ok: true });
      },
    });

    expect(result.status).toBe('completed');
    expect(artifacts.get('child')?.kind).toBe('validation');
  });
});
