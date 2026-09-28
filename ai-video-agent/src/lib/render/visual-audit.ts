import type {
  FrameOutline,
  GPTVideoQualityCategory,
  GPTVideoQualityIssue,
  GPTVideoQualityReport,
  Outline,
  VideoSource,
} from '@/types';
import { QUALITY_AUDIT_VERSION } from '@/lib/quality/audit-version';

export interface VisualAuditIssue {
  sceneId: string;
  message: string;
}

export function auditVisualRhythm(frames: FrameOutline[]): VisualAuditIssue[] {
  const issues: VisualAuditIssue[] = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const spec = frame.sceneSpec;
    if (spec?.renderMode === 'ui-scene' && spec.isDemoData !== true) {
      issues.push({ sceneId: frame.id, message: 'UI 模拟数据未标记为“演示数据”。' });
    }
    if (spec?.visualType === 'photo' && !spec.imagePurpose) {
      issues.push({ sceneId: frame.id, message: '图片缺少 imagePurpose，无法确认叙事用途。' });
    }
    if (index >= 2) {
      const composition = frames.slice(index - 2, index + 1).map(item => item.sceneSpec?.compositionTag).filter(Boolean);
      if (composition.length === 3 && new Set(composition).size === 1) {
        issues.push({ sceneId: frame.id, message: `构图“${composition[0]}”连续出现 3 个镜头。` });
      }
      const abstractCount = frames.slice(index - 2, index + 1).filter(item =>
        ['diagram', 'typography', 'chart'].includes(item.sceneSpec?.visualType || '')).length;
      if (abstractCount === 3) {
        issues.push({ sceneId: frame.id, message: '抽象卡片类画面连续达到 3 个镜头，建议下一镜切换画面类型。' });
      }
    }
    if (index >= 4) {
      const visualTypes = frames.slice(index - 4, index + 1).map(item => item.sceneSpec?.visualType || item.sceneSpec?.renderMode || 'html');
      if (new Set(visualTypes).size === 1) {
        issues.push({ sceneId: frame.id, message: '最近 5 个镜头没有明显画面类型变化。' });
      }
    }
  }
  return dedupe(issues);
}

function dedupe(issues: VisualAuditIssue[]) {
  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = `${issue.sceneId}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function auditGPTVideoQuality(outline: Outline, videoSource: VideoSource): GPTVideoQualityReport {
  const sources = new Map(videoSource.frames.map(source => [source.id, source]));
  const issues: GPTVideoQualityIssue[] = [];
  const auditedFrameCount = outline.frames.filter(frame => isCurrentFrameAudit(sources.get(frame.id)?.qualityReport, sources.get(frame.id)?.htmlCode || '')).length;
  const auditStatus = auditedFrameCount === outline.frames.length ? 'complete' as const : 'pending' as const;
  const layouts = outline.frames.map(frame => frame.sceneSpec?.compositionTag
    || frame.sceneSpec?.visualType
    || frame.sceneSpec?.renderMode
    || frame.sceneSpec?.assetStrategy
    || 'html');
  const add = (
    code: string,
    category: GPTVideoQualityCategory,
    severity: GPTVideoQualityIssue['severity'],
    frameIds: string[],
    message: string,
  ) => issues.push({ code, category, severity, frameIds, message });

  for (let index = 2; index < layouts.length; index++) {
    if (layouts[index] === layouts[index - 1] && layouts[index] === layouts[index - 2]) {
      add('three_consecutive_same_layout', 'visualRichness', 'major', outline.frames.slice(index - 2, index + 1).map(frame => frame.id), '连续三镜使用同一构图家族。');
    }
  }
  const layoutFamilyCount = new Set(layouts).size;
  if (outline.frames.length >= 10 && layoutFamilyCount < 3) {
    add('insufficient_layout_families', 'visualRichness', 'major', outline.frames.map(frame => frame.id), `全片只有 ${layoutFamilyCount} 种构图家族；10–15 镜应通常达到至少 3 种。`);
  }

  const htmlSources = outline.frames.map(frame => sources.get(frame.id)?.htmlCode || '');
  const palettes = htmlSources.map(extractPaletteSignature).filter(Boolean);
  if (outline.frames.length >= 6 && layoutFamilyCount <= 2 && palettes.length >= 6 && new Set(palettes).size === 1) {
    add('same_visual_system_without_variation', 'visualRichness', 'major', outline.frames.map(frame => frame.id), '全片背景、字体、强调色和结构几乎没有变化，视觉变化接近“同一卡片换文字”。');
  }

  for (const frame of outline.frames) {
    const source = sources.get(frame.id);
    const html = source?.htmlCode || '';
    const sceneSpec = frame.sceneSpec;
    if (!sceneSpec?.visualIntent?.trim()) {
      add('missing_visual_intent', 'semantic', 'major', [frame.id], '分镜缺少可执行的画面意图，不能验证视觉元素是否服务于旁白。');
    }
    // GPT-free HTML is intentionally schema-free. Reading hierarchy is a
    // human-facing design quality, not a required DOM role or object count.
    const requirement = frame.sceneSpec?.assetRequirement;
    const assets = source?.realImages?.length ? source.realImages : source?.realImage ? [source.realImage] : [];
    if (requirement?.attempt === 'required' && !assets.length) {
      add('required_asset_missing', 'assets', requirement.failurePolicy === 'block' ? 'critical' : 'major', [frame.id], 'required 图片缺失；必须重新搜索、待审核或按明确策略降级。');
    }
    if (source?.imageSelection?.status === 'needs-review' || source?.imageSelection?.requiresHumanReview) {
      add('asset_needs_review', 'assets', 'major', [frame.id], '素材与旁白语义或主体身份尚未完成验证。');
    }
    if (hasConnector(html) && !['process', 'cause', 'hierarchy', 'timeline'].includes(frame.sceneSpec?.relationship || '')) {
      add('meaningless_connector_risk', 'semantic', 'major', [frame.id], '画面使用连接线，但本镜语义不是流程、因果、层级或时间关系。');
    }
    const duration = (source?.audioPath ? source.audioDuration : undefined)
      || frame.sceneSpec?.durationHint
      || 0;
    const animationEnd = latestAnimationEndSeconds(html);
    if (duration >= 10 && animationEnd > 0 && animationEnd <= 2 && frame.sceneSpec?.revealStrategy !== 'single') {
      add('animation_ends_too_early', 'rhythm', 'major', [frame.id], '长镜头的主要动画在前 2 秒结束，后段可能长时间静止。');
    }
  }

  for (let index = 1; index < outline.frames.length; index++) {
    if (narrationSimilarity(outline.frames[index - 1].narration, outline.frames[index].narration) >= 0.72) {
      add('repeated_fact', 'semantic', 'minor', [outline.frames[index - 1].id, outline.frames[index].id], '相邻镜头表达了大量重复事实。');
    }
  }

  const research = outline.research;
  if (research && (research.sources?.length || 0) <= 1
    && (research.evidenceCards || []).some(card => card.confidence === 'low')) {
    add('single_low_confidence_source', 'semantic', 'major', [], '内容研究依赖单一且低置信度来源。');
  }

  const technicalScores = outline.frames.flatMap(frame => {
    const source = sources.get(frame.id);
    return isCurrentFrameAudit(source?.qualityReport, source?.htmlCode || '') ? [source!.qualityReport!.scoreAfter] : [];
  });
  const technicalBase = technicalScores.length
    ? Math.round(technicalScores.reduce((sum, score) => sum + score, 0) / technicalScores.length)
    : null;
  const assetAuditApplies = outline.frames.some(frame => ['required', 'optional'].includes(frame.sceneSpec?.assetRequirement?.attempt || 'never'));
  const scores = {
    technical: technicalBase === null ? null : deductScore(technicalBase, issues, 'technical'),
    semantic: deductScore(100, issues, 'semantic'),
    visualRichness: deductScore(100, issues, 'visualRichness'),
    rhythm: deductScore(100, issues, 'rhythm'),
    assets: assetAuditApplies ? deductScore(100, issues, 'assets') : null,
    creative: 0,
    overall: null as number | null,
  };
  const creativeScores = [scores.semantic, scores.visualRichness, scores.rhythm, scores.assets].filter((score): score is number => score !== null);
  scores.creative = Math.round(creativeScores.reduce((sum, score) => sum + score, 0) / creativeScores.length);
  scores.overall = auditStatus === 'complete' && scores.technical !== null
    ? Math.round((scores.technical + scores.creative) / 2)
    : null;
  return {
    generatedAt: new Date().toISOString(),
    modelScope: 'gpt-only',
    scores,
    stats: {
      frameCount: outline.frames.length,
      auditedFrameCount,
      auditStatus,
      layoutFamilyCount,
      realImageCount: videoSource.frames.reduce((count, source) => count + (source.realImages?.length || (source.realImage ? 1 : 0)), 0),
    },
    issues: dedupeGPTIssues(issues),
  };
}

function isCurrentFrameAudit(report: VideoSource['frames'][number]['qualityReport'] | undefined, html: string): boolean {
  if (!report || !html) return false;
  if (report.auditVersion !== QUALITY_AUDIT_VERSION || report.htmlHash !== qualityHtmlHash(html)) return false;
  return !report.issues.some(issue => issue.code === 'audit_timeout');
}

function qualityHtmlHash(html: string): string {
  let hash = 2166136261;
  for (let index = 0; index < html.length; index += 1) {
    hash ^= html.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function deductScore(base: number, issues: GPTVideoQualityIssue[], category: GPTVideoQualityCategory): number {
  const weights = { critical: 30, major: 16, minor: 6 } as const;
  const deduction = issues.filter(issue => issue.category === category).reduce((sum, issue) => sum + weights[issue.severity], 0);
  return Math.max(0, Math.min(100, base - deduction));
}

function hasConnector(html: string): boolean {
  return /data-role=["']connector["']|class=["'][^"']*\bconnector\b/i.test(html);
}

function extractPaletteSignature(html: string): string {
  const colors = [...html.matchAll(/#[0-9a-f]{6}\b/gi)].slice(0, 4).map(match => match[0].toLowerCase());
  const font = html.match(/font-family\s*:\s*([^;}]+)/i)?.[1]?.trim().toLowerCase() || '';
  return colors.length ? `${colors.join('|')}|${font}` : '';
}

function latestAnimationEndSeconds(html: string): number {
  let latest = 0;
  for (const match of html.matchAll(/animation(?:-duration)?\s*:[^;}]*?(\d+(?:\.\d+)?)(ms|s)(?:[^;}]*?(\d+(?:\.\d+)?)(ms|s))?/gi)) {
    const duration = Number(match[1]) * (match[2].toLowerCase() === 'ms' ? 0.001 : 1);
    const delay = match[3] ? Number(match[3]) * (match[4]?.toLowerCase() === 'ms' ? 0.001 : 1) : 0;
    latest = Math.max(latest, duration + delay);
  }
  return latest;
}

function narrationSimilarity(left: string, right: string): number {
  const tokenize = (value: string) => new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []));
  const a = tokenize(left);
  const b = tokenize(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter(token => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

function dedupeGPTIssues(issues: GPTVideoQualityIssue[]): GPTVideoQualityIssue[] {
  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = `${issue.code}:${issue.frameIds.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
