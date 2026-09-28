import { callAIJson } from './client';
import { normalizeOutline } from '@/lib/prompts/outline';
import type { CanvasPresetId, FrameOutline, Outline, ProjectType, ProjectWorkflow, ResearchSnapshot } from '@/types';
import { applyDirectorResult, directFreeHtmlOutline, directHtmlOutline } from './director';
import {
  executeResearchPlan,
  formatResearchForPrompt,
  planResearchForPrompt,
  type ResearchPlan,
} from '@/lib/research';
import { auditScript } from './content-audit';
import { createAgentInputHash, createAgentTaskInputHash } from '@/lib/agents/hash';
import { runAgentGraph, type ExecutableAgentTask } from '@/lib/agents/orchestrator';
import { artifact, createEphemeralAgentRun, startPersistentAgentRun } from '@/lib/agents/persistence';
import { rethrowIfAborted, throwIfAborted } from '@/lib/agents/cancellation';
import {
  auditRequirementAlignment,
  calibrateOutlineSceneDurations,
  estimateNarrationSeconds,
  extractDurationRequirement,
  formatDurationRequirement,
  needsNarrationDurationCalibration,
  resolveRequestedDuration,
} from './user-requirements';
import {
  compileAgentSystemPrompt,
  createContentStyleTrace,
  formatContentStyleUserContext,
  resolveContentStyle,
} from '@/lib/content-style/compiler';
import type { ContentStyleTrace, ProjectContentStyleConfig } from '@/lib/content-style/types';
import { buildPlannerFixedContract, QUALITY_FIXED_CONTRACT } from '@/lib/content-style/contracts';

export interface ContentQualityIssue {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  path?: string;
  evidenceIds?: string[];
}

export interface ContentQualityResult {
  decision: 'pass' | 'revise';
  issues: ContentQualityIssue[];
  correctedOutline?: Partial<Outline>;
}

const GPT_FREE_PLANNER_CONTRACT = `你是 GPT 自由创作的视频内容策划。把原始材料整理为适合口播的脚本、章节和逐拍分镜；内容驱动结构，不用模板化的页面、卡片、图表或布局语法约束创意。每章应有独立的叙事功能和节奏变化。不请求人工确认，不规划图片生成、图库搜索或外部素材。

你必须只输出一个符合以下既有 Outline 契约的 JSON 对象，不得自行设计字段或改用其他层级：
{
  "title": "视频标题",
  "totalDuration": 60,
  "script": "完整口播稿，按 beats.order 拼接",
  "creativeBrief": {
    "targetAudience": "具体受众",
    "viewerPainPoint": "具体痛点",
    "valuePromise": "明确收益",
    "coreMessage": "唯一主张",
    "hook": { "type": "question", "text": "开场钩子" },
    "proofPlan": "案例、对比或步骤",
    "cta": "一个具体行动"
  },
  "chapters": [{ "id": "chapter-1", "title": "章节标题", "purpose": "叙事作用", "beatIds": ["beat-1"] }],
  "beats": [{ "id": "beat-1", "chapterId": "chapter-1", "order": 1, "narration": "本拍旁白", "purpose": "本拍新增信息", "frameId": "frame-1" }],
  "frames": [{ "id": "frame-1", "index": 1, "title": "面向观众的内容标题", "narration": "本镜旁白", "imagePrompt": "可选图片画面意图", "htmlPrompt": "可选网页画面意图" }]
}

frames 是必填数组，至少包含一镜。每个 beat 必须对应一个 frame，且 beats[].frameId 与 frames[].id 相同；chapters[].beatIds 必须引用 beats[].id。不要在根级输出 hook、valuePromise 或 cta；它们必须置于 creativeBrief。不要使用 chapters[].shots、shots、narrative、durationSeconds、startTime、endTime、visual 或 voiceover 等自定义字段。`;

// 内容规划需要生成完整的脚本和分镜；为慢速 Responses 上游保留比常规 JSON 调用更长的完成窗口。
const CONTENT_PLANNER_TIMEOUT_MS = 240_000;

type VisualPromptRepairResult = {
  frames?: Array<{
    index?: number;
    htmlPrompt?: string;
  }>;
};

/**
 * A timeout or truncated response from the planner/director must not leave an
 * editable HTML prompt blank. Repair only the affected frames, preserving the
 * approved script and structured visual direction.
 */
async function ensureHtmlVisualPrompts(
  outline: Outline,
  sourceMaterial: string,
  abortSignal?: AbortSignal,
): Promise<Outline> {
  let completed = outline;

  for (let attempt = 1; attempt <= 2; attempt++) {
    throwIfAborted(abortSignal);
    const missing = completed.frames.filter(frame => !frame.htmlPrompt?.trim());
    if (!missing.length) return completed;

    const repairPrompt = [
      '你正在补全 HTML 视频大纲中缺失的画面提示词。不要改写标题、旁白、分镜顺序或 SceneSpec。',
      '只为下列 index 返回 htmlPrompt；每条都必须是 1–3 句完整的自然语言画面说明，依次写清画面布局、关键状态/变化和结果。不得写 CSS、JS、Markdown 或解释文字。',
      '严格输出 JSON：{"frames":[{"index":1,"htmlPrompt":"..."}]}。',
      `原始创作需求：${sourceMaterial.slice(0, 8_000)}`,
      `待补全分镜：${JSON.stringify(missing.map(frame => ({
        index: frame.index,
        title: frame.title,
        narration: frame.narration,
        sceneSpec: frame.sceneSpec,
      })), null, 2)}`,
      attempt === 2
        ? '【重试】上一版仍有空的 htmlPrompt。每个请求的 index 都必须返回非空 htmlPrompt；先逐项核对后再输出。'
        : '',
    ].filter(Boolean).join('\n\n');

    try {
      const repaired = await callAIJson<VisualPromptRepairResult>({
        stage: attempt === 1 ? '画面提示词补全' : '画面提示词补全重试',
        system: '你是 HTML 视频的视觉编辑。你的唯一工作是补全缺失的 htmlPrompt，且输出必须是严格 JSON。',
        user: repairPrompt,
        temperature: 0.35,
        maxTokens: 1_600,
        maxRetries: 1,
        abortSignal,
      });
      const byIndex = new Map(
        (repaired.frames || [])
          .filter(frame => Number.isFinite(frame.index) && typeof frame.htmlPrompt === 'string' && frame.htmlPrompt.trim())
          .map(frame => [Number(frame.index), frame.htmlPrompt!.trim()]),
      );
      completed = {
        ...completed,
        frames: completed.frames.map(frame => ({
          ...frame,
          htmlPrompt: frame.htmlPrompt?.trim() || byIndex.get(frame.index) || frame.htmlPrompt,
        })),
      };
    } catch (error) {
      rethrowIfAborted(error, abortSignal);
      if (attempt === 2) throw error;
    }
  }

  const stillMissing = completed.frames.filter(frame => !frame.htmlPrompt?.trim()).map(frame => frame.index);
  if (stillMissing.length) {
    throw new Error(`HTML 大纲有 ${stillMissing.length} 个分镜缺少画面提示词（#${stillMissing.join('、#')}）；已自动重试，未保存不完整大纲。`);
  }
  return completed;
}

function hasCompleteHtmlVisualPrompts(outline: Outline): boolean {
  return outline.frames.length > 0 && outline.frames.every(frame => Boolean(frame.htmlPrompt?.trim()));
}

export async function generateOutline(
  type: ProjectType,
  userInput: string,
  opts?: {
    conversationContext?: string;
    currentOutline?: Outline | null;
    projectId?: string;
    canvasPreset?: CanvasPresetId;
    contentStyle?: ProjectContentStyleConfig | null;
    abortSignal?: AbortSignal;
    workflow?: ProjectWorkflow;
  },
): Promise<Outline> {
  const baseSystem = opts?.workflow === 'gpt-free'
    ? GPT_FREE_PLANNER_CONTRACT
    : buildPlannerFixedContract(type, opts?.canvasPreset);
  const system = baseSystem;
  const resolvedContentStyle = await resolveContentStyle(opts?.contentStyle);
  const plannerPrompt = compileAgentSystemPrompt({
    agent: 'planner',
    fixedContract: system,
    resolved: resolvedContentStyle,
  });
  const qualityPrompt = compileAgentSystemPrompt({
    agent: 'quality',
    fixedContract: QUALITY_FIXED_CONTRACT,
    resolved: resolvedContentStyle,
  });
  const styleContext = formatContentStyleUserContext(resolvedContentStyle);
  const contentStyleTrace = createContentStyleTrace({
    resolved: resolvedContentStyle,
    plannerPrompt: `${plannerPrompt.system}\n\n${styleContext}`,
    qualityPrompt: `${qualityPrompt.system}\n\n${styleContext}`,
  });
  const { generatedAt: _generatedAt, ...contentStyleFingerprint } = contentStyleTrace;
  const promptSnapshot: Record<string, unknown> = {
    planner: { system: plannerPrompt.system },
    quality: { system: qualityPrompt.system },
  };
  const inputHash = createAgentInputHash({
    type,
    userInput,
    conversationContext: opts?.conversationContext,
    currentOutline: opts?.currentOutline,
    contentStyle: contentStyleFingerprint,
  });
  const run = opts?.projectId
    ? await startPersistentAgentRun({ projectId: opts.projectId, kind: 'outline', inputHash })
    : createEphemeralAgentRun();
  try {
    const result = await runAgentGraph({
      runId: run.id,
      tasks: buildContentTasks({
        type,
        userInput,
        plannerSystem: plannerPrompt.system,
        qualitySystem: qualityPrompt.system,
        styleContext,
        contentStyleTrace,
        promptSnapshot,
        conversationContext: opts?.conversationContext,
        currentOutline: opts?.currentOutline,
        canvasPreset: opts?.canvasPreset,
        workflow: opts?.workflow,
      }),
      concurrency: 2,
      abortSignal: opts?.abortSignal,
      hooks: run.hooks,
    });
    throwIfAborted(opts?.abortSignal);
    const finalArtifact = result.artifacts.get('director')
      || result.artifacts.get('content-quality')
      || result.artifacts.get('content-planner');
    const directorResult = result.results.get('director');
    if (finalArtifact && type === 'html' && (!directorResult?.artifact || !hasCompleteHtmlVisualPrompts(directorResult.artifact.data as Outline))) {
      const diagnostic = directorResult?.diagnostics.at(-1)?.message || '视觉总监或画面提示词补全未返回完整结果。';
      throw new Error(`HTML 大纲画面提示词补全失败，已自动重试且未保存不完整大纲：${diagnostic}`);
    }
    if (!finalArtifact) {
      const plannerFailure = result.results.get('content-planner');
      const lastDiagnostic = plannerFailure?.diagnostics.at(-1)?.message || '';
      if (/request was aborted/i.test(lastDiagnostic)) {
        const error = new Error('内容规划服务请求被中断，请稍后重试。');
        error.name = 'AIServiceUnavailableError';
        throw error;
      }
      throw new Error('内容规划未返回任何可用分镜，未保存不完整大纲；请重试。');
    }
    const outline = { ...(finalArtifact.data as Outline), contentStyleTrace };
    await run.finish(result.summary.failed ? 'partial_failed' : 'completed', {
      ...result.summary,
      contentStyleTrace,
      promptSnapshot,
    });
    return outline;
  } catch (error) {
    await run.finish(opts?.abortSignal?.aborted ? 'cancelled' : 'failed', {
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
}

function buildContentTasks(options: {
  type: ProjectType;
  userInput: string;
  plannerSystem: string;
  qualitySystem: string;
  styleContext: string;
  contentStyleTrace: ContentStyleTrace;
  promptSnapshot: Record<string, unknown>;
  conversationContext?: string;
  currentOutline?: Outline | null;
  canvasPreset?: CanvasPresetId;
  workflow?: ProjectWorkflow;
}): ExecutableAgentTask[] {
  const hash = (role: string, input: unknown) => createAgentTaskInputHash({ role, input });
  const plannerInput = {
    userInput: options.userInput,
    conversationContext: options.conversationContext,
    currentOutline: options.currentOutline,
    contentStyle: {
      presetId: options.contentStyleTrace.presetId,
      presetVersion: options.contentStyleTrace.presetVersion,
      plannerPromptVersionId: options.contentStyleTrace.plannerPromptVersionId,
      qualityPromptVersionId: options.contentStyleTrace.qualityPromptVersionId,
      globalInstructionHash: options.contentStyleTrace.globalInstructionHash,
      projectInstructionHash: options.contentStyleTrace.projectInstructionHash,
      plannerPromptHash: options.contentStyleTrace.plannerPromptHash,
      qualityPromptHash: options.contentStyleTrace.qualityPromptHash,
      compilerVersion: options.contentStyleTrace.compilerVersion,
    },
  };

  return [
    {
      id: 'research-plan',
      role: 'research-planner',
      dependencies: [],
      inputHash: hash('research-plan', options.userInput),
      async execute(context) {
        const plan = await planResearchForPrompt(options.userInput, context.abortSignal);
        return artifact<ResearchPlan>('research-plan', plan, plan.reason);
      },
    },
    {
      id: 'research',
      role: 'research-search',
      dependencies: ['research-plan'],
      inputHash: hash('research-search', options.userInput),
      async execute(context) {
        try {
          const plan = context.getArtifact<ResearchPlan>('research-plan')!.data;
          const research = await executeResearchPlan(options.userInput, plan, context.abortSignal);
          return artifact<ResearchSnapshot | null>(
            'research-snapshot',
            research,
            research ? `筛选 ${research.sources.length} 个来源` : '当前主题无需联网研究',
          );
        } catch (error) {
          rethrowIfAborted(error, context.abortSignal);
          console.error('[research] 联网研究失败，继续使用原始需求', error);
          return artifact<ResearchSnapshot | null>('research-snapshot', null, '联网研究失败，使用原始需求');
        }
      },
    },
    {
      id: 'content-planner',
      role: 'content-planner',
      dependencies: ['research'],
      inputHash: hash('content-planner', plannerInput),
      maxAttempts: 2,
      async execute(context) {
        throwIfAborted(context.abortSignal);
        const research = context.getArtifact<ResearchSnapshot | null>('research')?.data ?? null;
        const promptParts = [
          options.styleContext,
          options.conversationContext ? `【对话历史上下文】\n${options.conversationContext}` : '',
          options.currentOutline ? `【当前已有大纲】\n${summarizeOutline(options.currentOutline)}` : '',
          formatResearchForPrompt(research),
          `【时长硬约束】\n${formatDurationRequirement(extractDurationRequirement(options.userInput))}`,
          `【本次用户要求】\n${options.userInput}`,
        ].filter(Boolean);
        const plannerUser = promptParts.join('\n\n');
        options.promptSnapshot.planner = { system: options.plannerSystem, user: plannerUser };
        const raw = await callAIJson<Partial<Outline>>({
          stage: '内容规划 Agent',
          system: options.plannerSystem,
          user: plannerUser,
          temperature: 0.8,
          maxRetries: 1,
          timeoutMs: CONTENT_PLANNER_TIMEOUT_MS,
          abortSignal: context.abortSignal,
        });
        return artifact('outline', finalizeScriptOutline(
          raw,
          options.userInput,
          research,
          options.contentStyleTrace.presetId,
        ));
      },
    },
    {
      id: 'content-quality',
      role: 'content-quality',
      dependencies: ['content-planner'],
      inputHash: hash('content-quality', plannerInput),
      async execute(context) {
        const outline = context.getArtifact<Outline>('content-planner')!.data;
        try {
          const qualityUser = buildContentQualityPrompt(options.userInput, outline, options.styleContext);
          options.promptSnapshot.quality = { system: options.qualitySystem, user: qualityUser };
          const quality = await callAIJson<Partial<ContentQualityResult>>({
            stage: '内容质量 Agent',
            system: options.qualitySystem,
            user: qualityUser,
            temperature: 0.2,
            maxRetries: 1,
            abortSignal: context.abortSignal,
          });
          const normalized = normalizeContentQuality(quality);
          if (options.workflow === 'gpt-free' && needsNarrationDurationCalibration(outline.script || '', outline.totalDuration)) {
            const calibratedOutline = await calibrateNarrationDurationIfNeeded({
              outline,
              userInput: options.userInput,
              contentStylePresetId: options.contentStyleTrace.presetId,
              abortSignal: context.abortSignal,
            });
            if (calibratedOutline !== outline) {
              return artifact('outline', calibratedOutline, '已根据目标时长精简口播');
            }
          }
          if (normalized.decision === 'pass') {
            return artifact('outline', outline, '内容审校通过');
          }
          if (!isOutlineCandidate(normalized.correctedOutline)) {
            return artifact('outline', withQualityDegraded(outline, options.contentStyleTrace.presetId), '审校要求修订但未返回合法完整大纲');
          }
          return artifact(
            'outline',
            finalizeScriptOutline(
              normalized.correctedOutline,
              options.userInput,
              outline.research || null,
              options.contentStyleTrace.presetId,
            ),
            '内容审校在同一次响应中完成修订',
          );
        } catch (error) {
          rethrowIfAborted(error, context.abortSignal);
          console.error('[content review] AI 审校失败，保留确定性审校结果', error);
          return artifact('outline', withQualityDegraded(outline, options.contentStyleTrace.presetId), 'AI 审校失败，未阻塞大纲');
        }
      },
    },
    {
      id: 'director',
      role: 'director',
      dependencies: ['content-quality'],
      inputHash: hash('director', { ...plannerInput, type: options.type }),
      shouldRun() {
        return options.type === 'html';
      },
      async execute(context) {
        const outline = context.getArtifact<Outline>('content-quality')!.data;
        let directed: Outline;
        try {
          directed = options.workflow === 'gpt-free'
            ? await directFreeHtmlOutline(outline, options.userInput, context.abortSignal, options.canvasPreset)
            : await directHtmlOutline(outline, options.userInput, context.abortSignal, options.canvasPreset);
        } catch (error) {
          rethrowIfAborted(error, context.abortSignal);
          console.error('[director] 编导规划失败，使用确定性兜底', error);
          directed = applyDirectorResult(outline, {});
        }
        const repaired = await ensureHtmlVisualPrompts(directed, options.userInput, context.abortSignal);
        return artifact('outline', calibrateOutlineSceneDurations(repaired));
      },
    },
  ];
}

function finalizeScriptOutline(
  raw: Partial<Outline>,
  userInput: string,
  research: ResearchSnapshot | null,
  contentStylePresetId?: string,
): Outline {
  const normalized = normalizeOutline(raw);
  if (!normalized.frames.length) {
    throw new Error('内容规划未返回任何分镜，未保存不完整大纲；请重试。');
  }
  const durationRequirement = extractDurationRequirement(userInput);
  const totalDuration = resolveRequestedDuration(normalized.totalDuration, durationRequirement);
  const deterministicAudit = auditScript(
    userInput,
    normalized.script || '',
    normalized.informationPool || [],
    research,
    normalized.frames,
    normalized.creativeBrief,
    contentAuditPolicy(contentStylePresetId),
  );
  const requirementIssues = auditRequirementAlignment({
    userInput,
    totalDuration,
    script: normalized.script || '',
    frameCount: normalized.frames.length,
  });
  return {
    ...normalized,
    totalDuration,
    sourceMaterial: userInput,
    contentAudit: {
      ...deterministicAudit,
      issues: [...new Set([...(deterministicAudit.issues || []), ...requirementIssues])],
    },
    research: research || undefined,
  };
}

async function calibrateNarrationDurationIfNeeded(input: {
  outline: Outline;
  userInput: string;
  contentStylePresetId?: string;
  abortSignal?: AbortSignal;
}): Promise<Outline> {
  const { outline } = input;
  if (!needsNarrationDurationCalibration(outline.script || '', outline.totalDuration)) return outline;

  const estimatedSeconds = Math.round(estimateNarrationSeconds(outline.script || ''));
  const targetSeconds = Math.round(outline.totalDuration);
  try {
    const raw = await callAIJson<Partial<Outline>>({
      stage: '时长校准 Agent',
      system: '你只负责校准中文口播时长，不负责重做内容策划或视觉设计。保留标题、章节、分镜数量、分镜 id/index/title、每镜画面提示和所有用户明确要求；仅精简或补足 script、beats[].narration 与 frames[].narration。不得仅修改 totalDuration 数字。输出完整且兼容现有 Outline 契约的 JSON。',
      user: [
        `原始需求：${input.userInput}`,
        `固定总时长：${targetSeconds} 秒。当前口播估算：${estimatedSeconds} 秒。`,
        `目标：把口播估算收敛到 ${Math.round(targetSeconds * 0.9)}-${Math.round(targetSeconds * 1.1)} 秒，并保留原有叙事顺序和信息覆盖。`,
        `待校准大纲：${JSON.stringify(outline)}`,
      ].join('\n\n').slice(0, 30_000),
      temperature: 0.2,
      maxRetries: 1,
      abortSignal: input.abortSignal,
    });
    if (!isOutlineCandidate(raw) || raw.frames?.length !== outline.frames.length) return outline;
    const sameFrames = raw.frames.every((frame, index) => frame.id === outline.frames[index]?.id && frame.index === outline.frames[index]?.index);
    if (!sameFrames) return outline;

    const calibrated = finalizeScriptOutline(raw, input.userInput, outline.research || null, input.contentStylePresetId);
    const currentDistance = Math.abs(estimateNarrationSeconds(outline.script || '') - targetSeconds);
    const calibratedDistance = Math.abs(estimateNarrationSeconds(calibrated.script || '') - targetSeconds);
    return calibratedDistance < currentDistance ? calibrated : outline;
  } catch (error) {
    rethrowIfAborted(error, input.abortSignal);
    console.warn('[duration calibration] keeping the original outline after calibration failed', error);
    return outline;
  }
}

function normalizeContentQuality(raw: Partial<ContentQualityResult>): ContentQualityResult {
  const issues = Array.isArray(raw.issues)
    ? raw.issues.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const issue = item as Partial<ContentQualityIssue>;
      if (typeof issue.message !== 'string' || !issue.message.trim()) return [];
      return [{
        code: cleanQualityText(issue.code, 'CONTENT_QUALITY'),
        severity: issue.severity === 'error' ? 'error' as const : 'warning' as const,
        message: cleanQualityText(issue.message, '内容需要检查'),
        path: typeof issue.path === 'string' ? issue.path.slice(0, 300) : undefined,
        evidenceIds: Array.isArray(issue.evidenceIds)
          ? issue.evidenceIds.filter((id): id is string => typeof id === 'string').slice(0, 8)
          : undefined,
      }];
    }).slice(0, 12)
    : [];
  return {
    decision: raw.decision === 'revise' && issues.length ? 'revise' : 'pass',
    issues,
    correctedOutline: raw.correctedOutline,
  };
}

function cleanQualityText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 2_000) : fallback;
}

function buildContentQualityPrompt(userInput: string, outline: Outline, styleContext: string): string {
  const evidence = outline.research?.evidenceCards || [];
  return [
    styleContext,
    `【原始要求】\n${userInput}`,
    `【允许使用的证据】\n${evidence.length ? JSON.stringify(evidence, null, 2) : '没有证据卡；具体数字、日期、价格和人物现职必须保守表达。'}`,
    `【待审校大纲】\n${JSON.stringify(outline, null, 2)}`,
  ].join('\n\n').slice(0, 30_000);
}

function isOutlineCandidate(value: unknown): value is Partial<Outline> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Outline>;
  return typeof candidate.title === 'string'
    && candidate.title.trim().length > 0
    && Array.isArray(candidate.frames)
    && candidate.frames.length > 0;
}

function withQualityDegraded(outline: Outline, presetId?: string): Outline {
  const issues = new Set([...(outline.contentAudit?.issues || []), 'QUALITY_DEGRADED：AI 内容审校不可用，已保留本地审计结果']);
  return {
    ...outline,
    contentAudit: {
      ...(outline.contentAudit || auditScript(
        outline.sourceMaterial || '',
        outline.script || outline.frames.map(frame => frame.narration).join(''),
        outline.informationPool || [],
        outline.research || null,
        outline.frames,
        outline.creativeBrief,
        contentAuditPolicy(presetId || outline.contentStyleTrace?.presetId),
      )),
      issues: [...issues],
      repaired: false,
    },
  };
}

function contentAuditPolicy(presetId?: string) {
  const strongRetention = presetId === 'strong-retention' || !presetId;
  return {
    requireHook: strongRetention,
    requireEarlyValuePromise: strongRetention,
    requireActionableCta: strongRetention,
    requireAdjacentInformationGain: presetId !== 'custom-only',
  };
}

function summarizeOutline(outline: Outline): string {
  return outline.frames
    .map((frame: FrameOutline) => `#${frame.index} ${frame.title}: ${frame.narration}`)
    .join('\n');
}
