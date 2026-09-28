import { AsyncLocalStorage } from 'async_hooks';
import { AGENT_PIPELINE_VERSION, classifyAgentRole, type AgentCategory, type AgentRole } from './types';

export interface AgentExecutionContext {
  runId: string;
  taskId: string;
  agentRole: AgentRole;
  category: AgentCategory;
  pipelineVersion: string;
}

const agentExecutionContext = new AsyncLocalStorage<AgentExecutionContext>();

export function runWithAgentExecutionContext<T>(
  context: Pick<AgentExecutionContext, 'runId' | 'taskId' | 'agentRole'>
    & Partial<Pick<AgentExecutionContext, 'category' | 'pipelineVersion'>>,
  task: () => T,
): T {
  return agentExecutionContext.run({
    ...context,
    category: context.category || classifyAgentRole(context.agentRole),
    pipelineVersion: context.pipelineVersion || AGENT_PIPELINE_VERSION,
  }, task);
}

export function getCurrentAgentExecutionContext(): AgentExecutionContext | undefined {
  return agentExecutionContext.getStore();
}
