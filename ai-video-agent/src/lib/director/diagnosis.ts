import { access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { callAIVisionJson, isVisionUnavailableError } from '@/lib/ai/client';
import { getCurrentAIKeySnapshot } from '@/lib/ai-key-context';
import { rethrowIfAborted } from '@/lib/agents/cancellation';
import { createProjectStateHash } from '@/lib/projects/state-hash';
import { resolveDataUrlPath } from '@/lib/render/paths';
import { getFrameSourceForOutlineFrame } from '@/lib/video-source';
import type {
  ChatContextSnapshot,
  DirectorDiagnosis,
  FrameOutline,
  FrameSource,
  Outline,
  ProjectDetail,
  VideoSource,
} from '@/types';
import { collectDirectorEvidence, needsVisualDirectorEvidence, type DirectorEvidenceResult } from './evidence';

const VISION_DIAGNOSIS_SYSTEM = `你是一位只读的视频导演诊断助手。你只能根据提供的镜头摘要、规则检查结果和临时截图解释视觉问题，不得修改项目、生成 HTML、替换素材、生成配音或返回完整项目 JSON。
只返回一个 JSON 对象：{"summary":"一句总结","issues":[{"category":"visual|readability|asset|rhythm|content|audio","severity":"minor|important|blocking","userFacingExplanation":"普通用户能理解的具体解释","evidenceFrameIds":["frame-id"]}]}。
不要输出技术实现建议、DOM ID、模型协议、思维过程或截图数据。`;

export function shouldRunDirectorDiagnosis(content: string): boolean {
  return /不好看|太乱|拖沓|节奏(?:太)?慢|像\s*PPT|廉价|没重点|不协调|风格不统一|图片.*不相关|看不清|不好读/i.test(content);
}

export function canUseVisualDiagnosis(configuration = getCurrentAIKeySnapshot()): boolean {
  if (!configuration) return false;
  return !/deepseek/i.test(configuration.model) && !/deepseek/i.test(configuration.baseURL);
}

export async function diagnoseProject(input: {
  projectId: string;
  content: string;
  context: ChatContextSnapshot;
  abortSignal?: AbortSignal;
  collectEvidence?: typeof collectDirectorEvidence;
}): Promise<{ diagnosis: DirectorDiagnosis; context: ChatContextSnapshot; visualStatus: 'used' | 'unavailable' | 'not_needed' }> {
  const row = await prisma.project.findUnique({
    where: { uuid: input.projectId },
    select: {
      uuid: true,
      title: true,
      type: true,
      canvasPreset: true,
      workflow: true,
      styleId: true,
      contentStyle: true,
      gptOptimization: true,
      projectBrief: true,
      briefStatus: true,
      outline: true,
      videoSource: true,
      createdAt: true,
      updatedAt: true,
      assets: {
        where: { status: { not: 'deleted' } },
        orderBy: { id: 'asc' },
        select: { id: true, status: true, inferredUsage: true },
      },
    },
  });
  if (!row) throw new Error('项目不存在');
  const currentHash = createProjectStateHash({
    outline: row.outline,
    videoSource: row.videoSource,
    styleId: row.styleId,
    contentStyle: row.contentStyle,
    gptOptimization: row.gptOptimization,
    projectBrief: row.projectBrief,
    assetBindings: row.assets,
  });
  if (currentHash !== input.context.projectStateHash) throw new Error('项目已更新，请重新发起检查。');
  const project = toProjectDetail(row);
  const rules = await runDeterministicDirectorChecks(project, input.context);
  let visualIssues: DirectorDiagnosis['issues'] = [];
  let evidence: DirectorEvidenceResult = { records: [], images: [], cacheHits: 0 };
  let visualStatus: 'used' | 'unavailable' | 'not_needed' = needsVisualDirectorEvidence(input.content) ? 'unavailable' : 'not_needed';
  let visualNote = '';

  if (needsVisualDirectorEvidence(input.content)) {
    if (!canUseVisualDiagnosis()) {
      visualNote = '当前模型不可用于视觉诊断，已保留规则检查结果。';
    } else {
      try {
        evidence = await (input.collectEvidence ?? collectDirectorEvidence)({
          project,
          context: input.context,
          content: input.content,
          abortSignal: input.abortSignal,
        });
        if (evidence.images.length) {
          const response = await callAIVisionJson<{
            summary?: string;
            issues?: Array<{
              category?: string;
              severity?: string;
              userFacingExplanation?: string;
              evidenceFrameIds?: string[];
            }>;
          }>({
            stage: 'AI 导演视觉诊断',
            system: VISION_DIAGNOSIS_SYSTEM,
            user: buildVisionDiagnosisPrompt(input.content, project, input.context, rules),
            images: evidence.images,
            maxTokens: 1_200,
            abortSignal: input.abortSignal,
          });
          visualIssues = normalizeVisualIssues(response.issues, frameIdsForContext(project, input.context));
          visualStatus = 'used';
          visualNote = response.summary?.trim().slice(0, 300) || '';
        } else {
          visualNote = '当前画面没有可用截图，已完成规则检查。';
        }
      } catch (error) {
        rethrowIfAborted(error, input.abortSignal);
        visualNote = isVisionUnavailableError(error)
          ? '当前模型不支持视觉输入，已保留规则检查结果。'
          : '视觉复核暂时失败，已保留规则检查结果。';
      }
    }
  }

  const issues = dedupeIssues([...rules, ...visualIssues]);
  const scopeFrameIds = frameIdsForContext(project, input.context);
  const options = buildDiagnosisOptions(issues, scopeFrameIds.length);
  const summary = [
    issues.length
      ? `发现 ${issues.length} 个值得处理的问题，其中 ${issues.filter(issue => issue.severity === 'blocking').length} 个会明显影响观看。`
      : '规则检查没有发现明确故障，画面可以继续使用。',
    visualNote,
  ].filter(Boolean).join(' ');
  return {
    visualStatus,
    context: { ...input.context, ...(evidence.records.length ? { evidence: evidence.records } : {}) },
    diagnosis: {
      version: 'director-diagnosis-v1',
      scope: { type: input.context.resolvedScope, frameIds: scopeFrameIds },
      summary,
      issues,
      options,
      recommendedOptionId: 'recommended',
      baseStateHash: currentHash,
    },
  };
}

export async function runDeterministicDirectorChecks(
  project: ProjectDetail,
  context: ChatContextSnapshot,
): Promise<DirectorDiagnosis['issues']> {
  const frames = framesForContext(project.outline?.frames ?? [], context);
  const issues: DirectorDiagnosis['issues'] = [];
  const layoutSignatures = new Map<string, string[]>();
  for (const frame of frames) {
    const index = project.outline?.frames.findIndex(item => item.id === frame.id) ?? -1;
    const source = getFrameSourceForOutlineFrame(project.videoSource, frame.id, index);
    const duration = source?.audioDuration || frame.sceneSpec?.durationHint || Math.max(3, frame.narration.replace(/\s+/g, '').length / 4.2);
    if (!source || (!source.htmlCode && !source.imagePath && !frame.sceneSpec?.uiData)) {
      issues.push(ruleIssue(frame.id, 'empty-visual', 'visual', 'blocking', `第 ${index + 1} 镜还没有可用画面。`, { hasSource: Boolean(source) }));
    }
    if (duration < 1.5 || duration > 20) {
      issues.push(ruleIssue(frame.id, 'duration-outlier', 'rhythm', 'important', `第 ${index + 1} 镜时长约 ${duration.toFixed(1)} 秒，和常规观看节奏差异较大。`, { durationSeconds: duration }));
    }
    const narrationRate = frame.narration.replace(/\s+/g, '').length / Math.max(0.1, duration);
    if (narrationRate > 7) {
      issues.push(ruleIssue(frame.id, 'narration-density', 'rhythm', 'important', `第 ${index + 1} 镜旁白信息过密，观众可能来不及理解。`, { charactersPerSecond: Number(narrationRate.toFixed(2)) }));
    }
    if (source?.htmlCode) {
      const visibleTextLength = source.htmlCode
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, '').length;
      if (visibleTextLength > 220) {
        issues.push(ruleIssue(frame.id, 'screen-density', 'readability', 'important', `第 ${index + 1} 镜屏幕文字偏多，重点不够突出。`, { visibleTextLength }));
      }
      const signature = layoutSignature(source.htmlCode);
      layoutSignatures.set(signature, [...(layoutSignatures.get(signature) ?? []), frame.id]);
    }
    for (const layoutIssue of source?.qualityReport?.issues ?? []) {
      const category = layoutIssue.code === 'subtitle_safe_area' || layoutIssue.code === 'text_occluded'
        ? 'readability' : 'visual';
      issues.push(ruleIssue(
        frame.id,
        `layout-${layoutIssue.code}-${layoutIssue.elementId || 'frame'}`,
        category,
        layoutIssue.severity === 'critical' ? 'blocking' : layoutIssue.severity === 'major' ? 'important' : 'minor',
        layoutIssue.code === 'subtitle_safe_area'
          ? `第 ${index + 1} 镜有内容进入字幕区域，可能被旁白字幕遮住。`
          : `第 ${index + 1} 镜存在“${layoutIssue.label}”问题：${layoutIssue.detail}`,
        { code: layoutIssue.code, elementId: layoutIssue.elementId },
      ));
    }
    if (source?.imagePath) {
      const path = resolveDataUrlPath(source.imagePath);
      if (!path || !(await fileExists(path))) {
        issues.push(ruleIssue(frame.id, 'missing-image', 'asset', 'blocking', `第 ${index + 1} 镜引用的图片已经缺失或不可读取。`, {}));
      }
    }
  }
  if (context.resolvedScope === 'project') {
    for (const frameIds of layoutSignatures.values()) {
      if (frameIds.length < 3) continue;
      issues.push({
        id: `rule-repeated-layout-${createHash('sha1').update(frameIds.join(':')).digest('hex').slice(0, 10)}`,
        category: 'visual',
        severity: 'important',
        userFacingExplanation: `${frameIds.length} 个镜头使用了非常相似的画面结构，整片容易显得像连续翻页。`,
        evidenceFrameIds: frameIds,
        technicalEvidence: { repeatedFrameCount: frameIds.length },
      });
    }
    const renderModes = new Set(frames.map(frame => frame.sceneSpec?.renderMode || project.type));
    if (renderModes.size > 2) {
      issues.push({
        id: 'rule-style-inconsistency',
        category: 'visual',
        severity: 'important',
        userFacingExplanation: '全片混用了较多画面表现方式，风格连续性可能不足。',
        evidenceFrameIds: frames.map(frame => frame.id),
        technicalEvidence: { renderModeCount: renderModes.size },
      });
    }
  }
  return dedupeIssues(issues);
}

export function isDirectorDiagnosisStale(diagnosis: DirectorDiagnosis, currentStateHash: string): boolean {
  return diagnosis.baseStateHash !== currentStateHash;
}

function toProjectDetail(row: any): ProjectDetail {
  return {
    uuid: row.uuid,
    title: row.title,
    type: row.type,
    canvasPreset: row.canvasPreset,
    workflow: row.workflow,
    styleId: row.styleId,
    contentStyle: row.contentStyle,
    gptOptimization: row.gptOptimization,
    projectBrief: row.projectBrief,
    briefStatus: row.briefStatus,
    outline: row.outline as Outline | null,
    videoSource: row.videoSource as VideoSource | null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    hasOutline: Boolean(row.outline),
  };
}

function framesForContext(frames: FrameOutline[], context: ChatContextSnapshot): FrameOutline[] {
  if (context.resolvedScope === 'project') return frames;
  const selected = frames.find(frame => frame.id === context.selectedFrameId);
  return selected ? [selected] : [];
}

function frameIdsForContext(project: ProjectDetail, context: ChatContextSnapshot): string[] {
  return framesForContext(project.outline?.frames ?? [], context).map(frame => frame.id);
}

function buildVisionDiagnosisPrompt(
  userFeedback: string,
  project: ProjectDetail,
  context: ChatContextSnapshot,
  rules: DirectorDiagnosis['issues'],
) {
  const frames = framesForContext(project.outline?.frames ?? [], context);
  return [
    `【用户反馈】${userFeedback}`,
    `【范围】${context.resolvedScope === 'project' ? '完整视频' : context.resolvedScope === 'element' ? '当前分镜的已选元素' : '当前分镜'}`,
    `【镜头摘要】${JSON.stringify(frames.map(frame => ({ id: frame.id, title: frame.title, narration: frame.narration.slice(0, 300) })))}`,
    `【规则检查】${JSON.stringify(rules.map(issue => ({ category: issue.category, severity: issue.severity, explanation: issue.userFacingExplanation, frameIds: issue.evidenceFrameIds })))}`,
    '请只补充截图能直接支持的问题，不要重复规则检查，不要假设截图之外的事实。',
  ].join('\n\n');
}

function normalizeVisualIssues(
  value: Array<{
    category?: string;
    severity?: string;
    userFacingExplanation?: string;
    evidenceFrameIds?: string[];
  }> | undefined,
  allowedFrameIds: string[],
): DirectorDiagnosis['issues'] {
  const categories = new Set(['content', 'rhythm', 'visual', 'readability', 'asset', 'audio']);
  const severities = new Set(['minor', 'important', 'blocking']);
  const allowed = new Set(allowedFrameIds);
  return (value ?? []).slice(0, 12).flatMap((issue, index) => {
    const explanation = issue.userFacingExplanation?.trim().slice(0, 500);
    const frameIds = (issue.evidenceFrameIds ?? []).filter(id => allowed.has(id));
    if (!explanation || !frameIds.length || !categories.has(issue.category || '') || !severities.has(issue.severity || '')) return [];
    return [{
      id: `vision-${index + 1}-${createHash('sha1').update(`${explanation}:${frameIds.join(',')}`).digest('hex').slice(0, 8)}`,
      category: issue.category as DirectorDiagnosis['issues'][number]['category'],
      severity: issue.severity as DirectorDiagnosis['issues'][number]['severity'],
      userFacingExplanation: explanation,
      evidenceFrameIds: frameIds,
    }];
  });
}

function buildDiagnosisOptions(issues: DirectorDiagnosis['issues'], frameCount: number): DirectorDiagnosis['options'] {
  const blocking = issues.filter(issue => issue.severity === 'blocking').length;
  return [
    {
      id: 'light',
      label: '轻微调整',
      description: '只处理最明显的可读性和节奏问题，尽量保留现有画面。',
      intensity: 'light',
      expectedImpact: `预计影响 ${Math.min(frameCount, Math.max(1, blocking || 1))} 个镜头。`,
    },
    {
      id: 'recommended',
      label: '推荐方案',
      description: '优先修复重要问题，并重做确实影响观感的画面。',
      intensity: 'recommended',
      expectedImpact: `预计检查并按需调整 ${Math.max(1, frameCount)} 个镜头。`,
    },
    {
      id: 'redesign',
      label: '重新设计',
      description: '保留核心内容，明显改变受影响镜头的视觉表达。',
      intensity: 'redesign',
      expectedImpact: `可能重做 ${Math.max(1, frameCount)} 个镜头的画面。`,
    },
  ];
}

function ruleIssue(
  frameId: string,
  code: string,
  category: DirectorDiagnosis['issues'][number]['category'],
  severity: DirectorDiagnosis['issues'][number]['severity'],
  explanation: string,
  technicalEvidence: Record<string, unknown>,
): DirectorDiagnosis['issues'][number] {
  return {
    id: `rule-${code}-${frameId}`,
    category,
    severity,
    userFacingExplanation: explanation,
    evidenceFrameIds: [frameId],
    technicalEvidence,
  };
}

function dedupeIssues(issues: DirectorDiagnosis['issues']): DirectorDiagnosis['issues'] {
  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = `${issue.category}:${issue.userFacingExplanation}:${issue.evidenceFrameIds.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function layoutSignature(htmlCode: string): string {
  const structure = htmlCode
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/>[^<]+</g, '><')
    .replace(/\s(?:data-editor-id|id)=["'][^"']+["']/gi, '')
    .replace(/\s+/g, ' ')
    .slice(0, 8_000);
  return createHash('sha1').update(structure).digest('hex');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
