import { createHash } from 'crypto';
import {
  CONTENT_STYLE_COMPILER_VERSION,
  DEFAULT_QUALITY_CORE_PROMPT,
  QUALITY_DEFAULT_VERSION,
  QUALITY_OUTPUT_CONTRACT,
} from './defaults';
import {
  buildDefaultPlannerPrompt,
  findContentStylePreset,
  plannerDefaultVersionForPreset,
} from './presets';
import type {
  CompiledAgentPrompt,
  ContentStyleAgent,
  ContentStyleTrace,
  ContentStylePreset,
  ContentStyleSettings,
  ProjectContentStyleConfig,
  ResolvedContentStyle,
} from './types';
import { contentStyleStore } from './store';

export async function resolveContentStyle(
  projectConfig?: ProjectContentStyleConfig | null,
): Promise<ResolvedContentStyle> {
  const settings = await contentStyleStore.getSettings();
  const useProjectOverride = projectConfig?.mode === 'override';
  const presetId = useProjectOverride && projectConfig.presetId
    ? projectConfig.presetId
    : settings.activePresetId;
  const preset = findContentStylePreset(presetId, settings.customPresets);
  const plannerPrompt = resolvePlannerPromptForPreset(settings, preset);
  return {
    preset,
    globalInstruction: settings.customInstruction.trim(),
    projectInstruction: useProjectOverride ? (projectConfig.customInstruction || '').trim() : '',
    plannerCorePrompt: plannerPrompt.content,
    qualityCorePrompt: settings.qualityOverride?.content || DEFAULT_QUALITY_CORE_PROMPT,
    plannerPromptVersionId: plannerPrompt.versionId,
    qualityPromptVersionId: settings.qualityOverride?.versionId || QUALITY_DEFAULT_VERSION,
    settingsRevision: settings.revision,
  };
}

export function resolvePlannerPromptForPreset(
  settings: ContentStyleSettings,
  preset: ContentStylePreset,
): { content: string; defaultContent: string; versionId: string; source: 'official' | 'custom'; updatedAt?: string } {
  const defaultContent = buildDefaultPlannerPrompt(preset);
  const presetOverride = settings.plannerPresetOverrides?.[preset.id];
  const legacyOverride = preset.id === settings.activePresetId ? settings.plannerOverride : undefined;
  const override = presetOverride || legacyOverride;
  return override ? {
    content: override.content,
    defaultContent,
    versionId: override.versionId,
    source: 'custom',
    updatedAt: override.updatedAt,
  } : {
    content: defaultContent,
    defaultContent,
    versionId: plannerDefaultVersionForPreset(preset),
    source: 'official',
  };
}

export function compileAgentSystemPrompt(options: {
  agent: ContentStyleAgent;
  fixedContract: string;
  resolved: ResolvedContentStyle;
}): CompiledAgentPrompt {
  const { agent, fixedContract, resolved } = options;
  const core = agent === 'planner' ? resolved.plannerCorePrompt : resolved.qualityCorePrompt;
  const styleContent = resolved.preset.qualityChecks.map((check, index) => (
      `${index + 1}. [${check.severity}] ${check.rule}`
    )).join('\n');
  const layers = [
    { id: 'fixed-contract', name: '固定运行契约', editable: false, content: fixedContract.trim() },
    { id: 'agent-core', name: 'Agent 核心提示词', editable: true, content: core.trim() },
  ];
  if (agent === 'quality') {
    layers.push({
      id: 'content-style',
      name: `内容风格：${resolved.preset.name}`,
      editable: false,
      content: styleContent || '当前预设不添加额外风格规则。',
    });
    layers.push({ id: 'quality-output', name: '审校输出契约', editable: false, content: QUALITY_OUTPUT_CONTRACT });
  }
  return {
    agent,
    system: layers.map(layer => `【${layer.name}】\n${layer.content}`).join('\n\n'),
    layers,
  };
}

export function formatContentStyleUserContext(resolved: ResolvedContentStyle): string {
  const parts = [
    `【当前内容风格】\n${resolved.preset.name}：${resolved.preset.description}`,
    resolved.globalInstruction ? `【全局附加内容要求】\n${resolved.globalInstruction}` : '',
    resolved.projectInstruction ? `【项目级临时要求】\n${resolved.projectInstruction}` : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

export function createContentStyleTrace(options: {
  resolved: ResolvedContentStyle;
  plannerPrompt: string;
  qualityPrompt: string;
}): ContentStyleTrace {
  const { resolved } = options;
  return {
    presetId: resolved.preset.id,
    presetVersion: resolved.preset.version,
    plannerPromptVersionId: resolved.plannerPromptVersionId,
    qualityPromptVersionId: resolved.qualityPromptVersionId,
    globalInstructionHash: resolved.globalInstruction ? hashContent(resolved.globalInstruction) : undefined,
    projectInstructionHash: resolved.projectInstruction ? hashContent(resolved.projectInstruction) : undefined,
    plannerPromptHash: hashContent(options.plannerPrompt),
    qualityPromptHash: hashContent(options.qualityPrompt),
    compilerVersion: CONTENT_STYLE_COMPILER_VERSION,
    generatedAt: new Date().toISOString(),
  };
}

export function hashContent(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
