export const PROJECT_WORKFLOW = 'gpt-free' as const;

/** The former standard/DeepSeek project pipeline is retired. */
export function isSupportedProjectWorkflow(workflow: string | null | undefined): workflow is typeof PROJECT_WORKFLOW {
  return workflow === PROJECT_WORKFLOW;
}

export const RETIRED_WORKFLOW_MESSAGE = '该项目使用的旧 DeepSeek 工作流已下线，无法继续编辑或生成。请创建新的 GPT 自由创作项目。';
