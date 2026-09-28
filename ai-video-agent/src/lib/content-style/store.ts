import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { z } from 'zod';
import {
  DEFAULT_PLANNER_CORE_PROMPT,
  DEFAULT_QUALITY_CORE_PROMPT,
  PLANNER_DEFAULT_VERSION,
  QUALITY_DEFAULT_VERSION,
} from './defaults';
import {
  BUILTIN_CONTENT_STYLE_PRESETS,
  buildDefaultPlannerPrompt,
  DEFAULT_CONTENT_STYLE_PRESET_ID,
  mergeContentStylePresets,
  plannerDefaultVersionForPreset,
} from './presets';
import type {
  ContentStyleAgent,
  ContentStylePreset,
  ContentStyleSettings,
  ContentStyleSettingsView,
  PromptValidationResult,
  PromptVersion,
} from './types';

const instructionSchema = z.string().max(20_000);
const promptSchema = z.string().trim().min(1).max(40_000);
const qualityRuleSchema = z.object({
  id: z.string().trim().min(1).max(80),
  rule: z.string().trim().min(1).max(1_000),
  severity: z.enum(['required', 'preferred']),
});
const customPresetSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(300),
  plannerGuidance: z.array(z.string().trim().min(1).max(1_000)).max(30),
  qualityChecks: z.array(qualityRuleSchema).max(30),
  exampleStructure: z.array(z.string().trim().min(1).max(300)).max(20),
  version: z.number().int().min(1),
  source: z.literal('custom'),
});
const promptOverrideSchema = z.object({
  versionId: z.string().uuid(),
  content: promptSchema,
  basedOnDefaultVersion: z.string().min(1),
  updatedAt: z.string().datetime(),
});
const settingsSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().min(0),
  activePresetId: z.string().min(1),
  customInstruction: instructionSchema,
  customPresets: z.array(customPresetSchema).max(30),
  plannerPresetOverrides: z.record(z.string(), promptOverrideSchema).optional(),
  plannerOverride: promptOverrideSchema.optional(),
  qualityOverride: promptOverrideSchema.optional(),
  updatedAt: z.string().datetime(),
});
const validationIssueSchema = z.object({
  code: z.string(),
  level: z.enum(['warning', 'error']),
  message: z.string(),
});
const validationSchema = z.object({
  level: z.enum(['valid', 'warning', 'invalid']),
  issues: z.array(validationIssueSchema),
});
const versionSchema = z.object({
  id: z.string().uuid(),
  agent: z.enum(['planner', 'quality']),
  presetId: z.string().optional(),
  content: z.string(),
  contentHash: z.string().length(64),
  source: z.enum(['save', 'reset', 'restore']),
  parentVersionId: z.string().optional(),
  basedOnDefaultVersion: z.string(),
  validation: validationSchema,
  createdAt: z.string().datetime(),
});
const versionFileSchema = z.object({ schemaVersion: z.literal(1), versions: z.array(versionSchema) });

export class ContentStyleStoreError extends Error {
  constructor(
    message: string,
    public readonly code: 'REVISION_CONFLICT' | 'INVALID_INPUT' | 'NOT_FOUND' | 'READ_FAILED' | 'WRITE_FAILED',
  ) {
    super(message);
    this.name = 'ContentStyleStoreError';
  }
}

export class ContentStyleStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly settingsPath: string,
    private readonly versionsPath: string,
  ) {}

  async getSettings(): Promise<ContentStyleSettings> {
    return this.readSettings();
  }

  async getView(): Promise<ContentStyleSettingsView> {
    const settings = await this.readSettings();
    return { ...settings, presets: mergeContentStylePresets(settings.customPresets) };
  }

  updateSettings(input: {
    expectedRevision: number;
    activePresetId: string;
    customInstruction: string;
    customPresets?: ContentStylePreset[];
  }): Promise<ContentStyleSettingsView> {
    return this.mutate(async (settings) => {
      this.assertRevision(settings, input.expectedRevision);
      const parsedPresets = customPresetSchema.array().max(30).parse(input.customPresets || settings.customPresets);
      const customPresets = parsedPresets.map(preset => {
        const previous = settings.customPresets.find(item => item.id === preset.id);
        if (!previous) return { ...preset, version: 1 };
        const changed = presetComparable(previous) !== presetComparable(preset);
        return { ...preset, version: changed ? previous.version + 1 : previous.version };
      });
      this.assertCustomPresetIds(customPresets);
      const presets = mergeContentStylePresets(customPresets);
      if (!presets.some(preset => preset.id === input.activePresetId)) {
        throw new ContentStyleStoreError('所选内容风格不存在', 'INVALID_INPUT');
      }
      settings.activePresetId = input.activePresetId;
      settings.customInstruction = instructionSchema.parse(input.customInstruction).trim();
      settings.customPresets = customPresets;
      this.bump(settings);
    });
  }

  savePrompt(input: {
    agent: ContentStyleAgent;
    presetId?: string;
    content: string;
    expectedRevision: number;
    confirmWarnings?: boolean;
  }): Promise<{ settings: ContentStyleSettingsView; version: PromptVersion }> {
    let createdVersion!: PromptVersion;
    return this.mutate(async (settings, versions) => {
      this.assertRevision(settings, input.expectedRevision);
      const content = promptSchema.parse(input.content);
      const validation = validateAgentPrompt(input.agent, content);
      if (validation.level === 'invalid') {
        throw new ContentStyleStoreError(validation.issues.map(issue => issue.message).join('；'), 'INVALID_INPUT');
      }
      if (validation.level === 'warning' && !input.confirmWarnings) {
        throw new ContentStyleStoreError(validation.issues.map(issue => issue.message).join('；'), 'INVALID_INPUT');
      }
      const preset = input.agent === 'planner' && input.presetId
        ? this.requirePreset(settings, input.presetId)
        : undefined;
      const current = preset
        ? settings.plannerPresetOverrides?.[preset.id]
        : input.agent === 'planner' ? settings.plannerOverride : settings.qualityOverride;
      createdVersion = this.createVersion(input.agent, content, 'save', validation, current?.versionId, preset);
      versions.push(createdVersion);
      const override = {
        versionId: createdVersion.id,
        content,
        basedOnDefaultVersion: defaultVersion(input.agent, preset),
        updatedAt: createdVersion.createdAt,
      };
      if (preset) {
        settings.plannerPresetOverrides = { ...settings.plannerPresetOverrides, [preset.id]: override };
        if (preset.id === settings.activePresetId) delete settings.plannerOverride;
      } else if (input.agent === 'planner') settings.plannerOverride = override;
      else settings.qualityOverride = override;
      this.bump(settings);
    }).then(settings => ({ settings, version: createdVersion }));
  }

  resetPrompt(input: { agent: ContentStyleAgent; presetId?: string; expectedRevision: number }): Promise<ContentStyleSettingsView> {
    return this.mutate(async (settings, versions) => {
      this.assertRevision(settings, input.expectedRevision);
      const preset = input.agent === 'planner' && input.presetId
        ? this.requirePreset(settings, input.presetId)
        : undefined;
      const current = preset
        ? settings.plannerPresetOverrides?.[preset.id]
        : input.agent === 'planner' ? settings.plannerOverride : settings.qualityOverride;
      const content = defaultPrompt(input.agent, preset);
      versions.push(this.createVersion(input.agent, content, 'reset', validateAgentPrompt(input.agent, content), current?.versionId, preset));
      if (preset) {
        const overrides = { ...settings.plannerPresetOverrides };
        delete overrides[preset.id];
        settings.plannerPresetOverrides = overrides;
        if (preset.id === settings.activePresetId) delete settings.plannerOverride;
      } else if (input.agent === 'planner') delete settings.plannerOverride;
      else delete settings.qualityOverride;
      this.bump(settings);
    });
  }

  async listVersions(agent?: ContentStyleAgent): Promise<Omit<PromptVersion, 'content'>[]> {
    const versions = await this.readVersions();
    return versions
      .filter(version => !agent || version.agent === agent)
      .slice()
      .reverse()
      .map(({ content: _content, ...metadata }) => metadata);
  }

  async getVersion(id: string): Promise<PromptVersion> {
    const version = (await this.readVersions()).find(item => item.id === id);
    if (!version) throw new ContentStyleStoreError('Prompt 版本不存在', 'NOT_FOUND');
    return version;
  }

  restoreVersion(input: { id: string; expectedRevision: number }): Promise<ContentStyleSettingsView> {
    return this.mutate(async (settings, versions) => {
      this.assertRevision(settings, input.expectedRevision);
      const source = versions.find(version => version.id === input.id);
      if (!source) throw new ContentStyleStoreError('Prompt 版本不存在', 'NOT_FOUND');
      const preset = source.agent === 'planner' && source.presetId
        ? this.requirePreset(settings, source.presetId)
        : undefined;
      const restored = this.createVersion(source.agent, source.content, 'restore', source.validation, source.id, preset);
      versions.push(restored);
      const override = {
        versionId: restored.id,
        content: restored.content,
        basedOnDefaultVersion: defaultVersion(source.agent, preset),
        updatedAt: restored.createdAt,
      };
      if (preset) {
        settings.plannerPresetOverrides = { ...settings.plannerPresetOverrides, [preset.id]: override };
        if (preset.id === settings.activePresetId) delete settings.plannerOverride;
      } else if (source.agent === 'planner') settings.plannerOverride = override;
      else settings.qualityOverride = override;
      this.bump(settings);
    });
  }

  private async readSettings(): Promise<ContentStyleSettings> {
    try {
      return settingsSchema.parse(JSON.parse(await readFile(this.settingsPath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof z.ZodError || error instanceof SyntaxError) {
        return defaultSettings();
      }
      throw new ContentStyleStoreError('读取内容风格设置失败', 'READ_FAILED');
    }
  }

  private async readVersions(): Promise<PromptVersion[]> {
    try {
      return versionFileSchema.parse(JSON.parse(await readFile(this.versionsPath, 'utf8'))).versions;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof z.ZodError || error instanceof SyntaxError) return [];
      throw new ContentStyleStoreError('读取 Prompt 版本失败', 'READ_FAILED');
    }
  }

  private mutate(update: (settings: ContentStyleSettings, versions: PromptVersion[]) => Promise<void>): Promise<ContentStyleSettingsView> {
    const operation = this.mutationQueue.then(async () => {
      const [settings, versions] = await Promise.all([this.readSettings(), this.readVersions()]);
      await update(settings, versions);
      await Promise.all([
        this.writeJson(this.settingsPath, settingsSchema.parse(settings)),
        this.writeJson(this.versionsPath, versionFileSchema.parse({ schemaVersion: 1, versions: versions.slice(-100) })),
      ]);
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation.then(() => this.getView());
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, path);
    } catch {
      await unlink(temporaryPath).catch(() => undefined);
      throw new ContentStyleStoreError('保存内容风格设置失败', 'WRITE_FAILED');
    }
  }

  private assertRevision(settings: ContentStyleSettings, expectedRevision: number) {
    if (settings.revision !== expectedRevision) {
      throw new ContentStyleStoreError('设置已在其他窗口更新，请重新加载', 'REVISION_CONFLICT');
    }
  }

  private assertCustomPresetIds(presets: ContentStylePreset[]) {
    const builtinIds = new Set(BUILTIN_CONTENT_STYLE_PRESETS.map(preset => preset.id));
    const ids = new Set<string>();
    for (const preset of presets) {
      if (builtinIds.has(preset.id)) throw new ContentStyleStoreError('自定义预设不能覆盖内置预设', 'INVALID_INPUT');
      if (ids.has(preset.id)) throw new ContentStyleStoreError('自定义预设 ID 不能重复', 'INVALID_INPUT');
      ids.add(preset.id);
    }
  }

  private requirePreset(settings: ContentStyleSettings, presetId: string): ContentStylePreset {
    const preset = mergeContentStylePresets(settings.customPresets).find(item => item.id === presetId);
    if (!preset) throw new ContentStyleStoreError('所选表达方式不存在', 'INVALID_INPUT');
    return preset;
  }

  private bump(settings: ContentStyleSettings) {
    settings.revision += 1;
    settings.updatedAt = new Date().toISOString();
  }

  private createVersion(
    agent: ContentStyleAgent,
    content: string,
    source: PromptVersion['source'],
    validation: PromptValidationResult,
    parentVersionId?: string,
    preset?: ContentStylePreset,
  ): PromptVersion {
    return {
      id: randomUUID(), agent, presetId: preset?.id, content, contentHash: createHash('sha256').update(content).digest('hex'), source,
      parentVersionId, basedOnDefaultVersion: defaultVersion(agent, preset), validation,
      createdAt: new Date().toISOString(),
    };
  }
}

export function validateAgentPrompt(agent: ContentStyleAgent, content: string): PromptValidationResult {
  const issues: PromptValidationResult['issues'] = [];
  const parsed = promptSchema.safeParse(content);
  if (!parsed.success) {
    issues.push({ code: 'INVALID_LENGTH', level: 'error', message: 'Prompt 不能为空且不能超过 40000 字符' });
  }
  if (/忽略.{0,12}(系统|固定|以上).{0,12}(指令|要求)|ignore.{0,20}(system|previous)/i.test(content)) {
    issues.push({ code: 'CONTRACT_CONFLICT', level: 'warning', message: 'Prompt 包含忽略系统或固定约束的表达' });
  }
  if (agent === 'quality' && !/(审校|检查|质量|review|quality)/i.test(content)) {
    issues.push({ code: 'ROLE_UNCLEAR', level: 'warning', message: 'Prompt 没有清楚描述内容质量审校职责' });
  }
  if (agent === 'planner' && !/(规划|脚本|大纲|内容|outline|script)/i.test(content)) {
    issues.push({ code: 'ROLE_UNCLEAR', level: 'warning', message: 'Prompt 没有清楚描述内容规划职责' });
  }
  return {
    level: issues.some(issue => issue.level === 'error') ? 'invalid' : issues.length ? 'warning' : 'valid',
    issues,
  };
}

function defaultPrompt(agent: ContentStyleAgent, preset?: ContentStylePreset): string {
  return agent === 'planner'
    ? preset ? buildDefaultPlannerPrompt(preset) : DEFAULT_PLANNER_CORE_PROMPT
    : DEFAULT_QUALITY_CORE_PROMPT;
}

function defaultVersion(agent: ContentStyleAgent, preset?: ContentStylePreset): string {
  return agent === 'planner'
    ? preset ? plannerDefaultVersionForPreset(preset) : PLANNER_DEFAULT_VERSION
    : QUALITY_DEFAULT_VERSION;
}

function defaultSettings(): ContentStyleSettings {
  return {
    schemaVersion: 1,
    revision: 0,
    activePresetId: DEFAULT_CONTENT_STYLE_PRESET_ID,
    customInstruction: '',
    customPresets: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function presetComparable(preset: ContentStylePreset): string {
  const { version: _version, ...content } = preset;
  return JSON.stringify(content);
}

export const contentStyleStore = new ContentStyleStore(
  join(process.cwd(), 'data', 'settings', 'content-style.json'),
  join(process.cwd(), 'data', 'settings', 'content-style-versions.json'),
);
