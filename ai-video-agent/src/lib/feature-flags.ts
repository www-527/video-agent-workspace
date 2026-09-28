export const AI_DIALOG_FEATURE_FLAGS = {
  NOVICE_AGENT_V2: true,
  PROJECT_ASSETS_V1: true,
  PROJECT_BRIEF_V1: true,
  CHAT_CONTEXT_V1: true,
  DIRECTOR_DIAGNOSIS_V1: true,
  PROJECT_CHANGESET_V1: true,
  PERSISTENT_CHAT_RUNS_V1: true,
} as const;

export type AIDialogFeatureFlag = keyof typeof AI_DIALOG_FEATURE_FLAGS;

export function isAIDialogFeatureEnabled(flag: AIDialogFeatureFlag): boolean {
  const configured = process.env[flag];
  if (configured === undefined || configured === '') return AI_DIALOG_FEATURE_FLAGS[flag];
  return !['0', 'false', 'off', 'no'].includes(configured.trim().toLowerCase());
}

export function usesNoviceAgentV2(project: { briefStatus?: string | null }): boolean {
  return isAIDialogFeatureEnabled('NOVICE_AGENT_V2')
    && isAIDialogFeatureEnabled('PROJECT_BRIEF_V1')
    && project.briefStatus !== 'empty';
}
