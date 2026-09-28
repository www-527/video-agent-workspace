export type GPTReasoningProfile = 'auto' | 'fast' | 'balanced' | 'quality';
export type GPTCreativeFreedom = 'conservative' | 'balanced' | 'open';

export interface GPTOptimizationSettings {
  enabled: boolean;
  useResponsesAPI: boolean;
  allowChatFallback: boolean;
  reasoningProfile: GPTReasoningProfile;
  creativeFreedom: GPTCreativeFreedom;
  internalImageSearch: boolean;
}

export interface ProjectGPTOptimizationConfig {
  mode: 'inherit' | 'override';
  reasoningProfile?: GPTReasoningProfile;
  creativeFreedom?: GPTCreativeFreedom;
  internalImageSearch?: boolean;
  /** GPT-free only: pause after a complete first-frame sample until the user continues. */
  confirmFirstFrame?: boolean;
}

export const DEFAULT_GPT_OPTIMIZATION: Readonly<GPTOptimizationSettings> = Object.freeze({
  enabled: false,
  useResponsesAPI: true,
  allowChatFallback: true,
  reasoningProfile: 'auto',
  creativeFreedom: 'balanced',
  internalImageSearch: true,
});

export const DEFAULT_PROJECT_GPT_OPTIMIZATION: Readonly<ProjectGPTOptimizationConfig> = Object.freeze({
  mode: 'inherit',
});

/** Project settings can tune an enabled GPT path, but cannot turn that path on. */
export function resolveProjectGPTOptimization(
  globalSettings: GPTOptimizationSettings,
  projectSettings?: ProjectGPTOptimizationConfig | null,
): GPTOptimizationSettings {
  if (!globalSettings.enabled || !projectSettings || projectSettings.mode !== 'override') {
    return { ...globalSettings };
  }
  return {
    ...globalSettings,
    reasoningProfile: projectSettings.reasoningProfile ?? globalSettings.reasoningProfile,
    creativeFreedom: projectSettings.creativeFreedom ?? globalSettings.creativeFreedom,
    internalImageSearch: projectSettings.internalImageSearch ?? globalSettings.internalImageSearch,
  };
}
