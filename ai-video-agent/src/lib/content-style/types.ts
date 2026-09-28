export type ContentStyleAgent = 'planner' | 'quality';

export type ContentStyleSource = 'builtin' | 'custom';

export interface ContentStyleQualityRule {
  id: string;
  rule: string;
  severity: 'required' | 'preferred';
}

export interface ContentStylePreset {
  id: string;
  name: string;
  description: string;
  plannerGuidance: string[];
  qualityChecks: ContentStyleQualityRule[];
  exampleStructure: string[];
  version: number;
  source: ContentStyleSource;
}

export interface PromptOverride {
  versionId: string;
  content: string;
  basedOnDefaultVersion: string;
  updatedAt: string;
}

export interface ContentStyleSettings {
  schemaVersion: 1;
  revision: number;
  activePresetId: string;
  customInstruction: string;
  customPresets: ContentStylePreset[];
  plannerPresetOverrides?: Record<string, PromptOverride>;
  plannerOverride?: PromptOverride;
  qualityOverride?: PromptOverride;
  updatedAt: string;
}

export interface ContentStyleSettingsView extends ContentStyleSettings {
  presets: ContentStylePreset[];
}

export interface ProjectContentStyleConfig {
  mode: 'inherit' | 'override';
  presetId?: string;
  customInstruction?: string;
}

export interface PromptValidationIssue {
  code: string;
  level: 'warning' | 'error';
  message: string;
}

export interface PromptValidationResult {
  level: 'valid' | 'warning' | 'invalid';
  issues: PromptValidationIssue[];
}

export interface PromptVersion {
  id: string;
  agent: ContentStyleAgent;
  presetId?: string;
  content: string;
  contentHash: string;
  source: 'save' | 'reset' | 'restore';
  parentVersionId?: string;
  basedOnDefaultVersion: string;
  validation: PromptValidationResult;
  createdAt: string;
}

export interface ResolvedContentStyle {
  preset: ContentStylePreset;
  globalInstruction: string;
  projectInstruction: string;
  plannerCorePrompt: string;
  qualityCorePrompt: string;
  plannerPromptVersionId: string;
  qualityPromptVersionId: string;
  settingsRevision: number;
}

export interface ContentStyleTrace {
  presetId: string;
  presetVersion: number;
  plannerPromptVersionId: string;
  qualityPromptVersionId: string;
  globalInstructionHash?: string;
  projectInstructionHash?: string;
  plannerPromptHash: string;
  qualityPromptHash: string;
  compilerVersion: string;
  generatedAt: string;
}

export interface CompiledAgentPrompt {
  agent: ContentStyleAgent;
  system: string;
  layers: Array<{
    id: string;
    name: string;
    editable: boolean;
    content: string;
  }>;
}

export interface ContentStylePromptView {
  defaults: Record<ContentStyleAgent, { content: string; versionId: string }>;
  effective: {
    plannerCore: string;
    qualityCore: string;
    plannerPromptVersionId: string;
    qualityPromptVersionId: string;
    plannerSource: 'official' | 'custom';
    qualitySource: 'official' | 'custom';
    plannerUpdatedAt?: string;
    qualityUpdatedAt?: string;
  };
  plannerPresets: Record<string, {
    defaultContent: string;
    effectiveContent: string;
    versionId: string;
    source: 'official' | 'custom';
    updatedAt?: string;
  }>;
  preset: ContentStylePreset;
  instructionContext: string;
  compiled: Record<ContentStyleAgent, CompiledAgentPrompt>;
  promptHashes: Record<ContentStyleAgent, string>;
}
