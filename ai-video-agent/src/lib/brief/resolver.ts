import type { AssetSummary, BriefQuestion, BriefStatus, ProjectBrief } from '@/types';

const AI_DECIDE_PATTERN = /让\s*AI\s*决定|你来决定|自动决定|按推荐|随你/i;
const CONFIRM_PATTERN = /按这个生成|确认(?:这个)?方案|就按这个|开始生成/i;
const MAX_CLARIFICATION_ROUNDS = 2;

export interface BriefResolution {
  brief: ProjectBrief;
  status: BriefStatus;
}

export function resolveProjectBrief(input: {
  content: string;
  assets?: AssetSummary[];
  existingBrief?: ProjectBrief | null;
}): BriefResolution {
  const content = input.content.trim();
  const assets = input.assets ?? [];
  const materialContext = [content, ...assets.map(asset => asset.summary?.digest || asset.summary?.title || '')]
    .filter(Boolean)
    .join('\n');
  const existing = input.existingBrief?.version === 'project-brief-v1' ? input.existingBrief : null;
  const answered = existing ? applyCurrentAnswer(existing, content) : null;
  const baseline = answered ?? existing;
  const currentQuestion = existing?.unresolvedQuestions[0];
  const answeredCurrentQuestion = Boolean(currentQuestion && answered && answered.unresolvedQuestions.length === 0);
  const explicitDuration = inferDurationSeconds(materialContext);
  const explicitPlatform = inferPlatform(materialContext);
  const goal = inferGoal(content, baseline?.goal);
  const brief: ProjectBrief = {
    version: 'project-brief-v1',
    goal,
    targetAudience: inferAudience(materialContext) || baseline?.targetAudience || '对这个主题感兴趣的普通观众',
    platform: explicitPlatform || baseline?.platform || 'general',
    durationSeconds: explicitDuration || baseline?.durationSeconds || 60,
    tone: inferTone(materialContext) || baseline?.tone || '清晰、有吸引力、不过度夸张',
    coreMessage: answeredCurrentQuestion && baseline
      ? baseline.coreMessage
      : inferCoreMessage(content, baseline?.coreMessage),
    desiredOutcome: inferDesiredOutcome(materialContext) || baseline?.desiredOutcome || '让观众快速理解主题并记住一个核心观点',
    ...(baseline?.callToAction ? { callToAction: baseline.callToAction } : {}),
    ...classifyAssets(assets, baseline),
    assumptions: [...(baseline?.assumptions ?? [])],
    unresolvedQuestions: [...(baseline?.unresolvedQuestions ?? [])],
    clarificationCount: baseline?.clarificationCount ?? 0,
  };

  const durationResolved = Boolean(explicitDuration)
    || Boolean(existing && (currentQuestion?.id !== 'brief-duration' || answeredCurrentQuestion));
  const platformResolved = Boolean(explicitPlatform)
    || Boolean(existing && (
      !currentQuestion
      || (currentQuestion.id === 'brief-platform' && answeredCurrentQuestion)
      || (currentQuestion.id !== 'brief-platform' && currentQuestion.id !== 'brief-duration')
    ));
  const askable = brief.clarificationCount < MAX_CLARIFICATION_ROUNDS && !AI_DECIDE_PATTERN.test(content);

  if (brief.unresolvedQuestions.length) {
    if (brief.clarificationCount < MAX_CLARIFICATION_ROUNDS) return { brief, status: 'needs_clarification' };
    const unresolved = brief.unresolvedQuestions[0];
    brief.unresolvedQuestions = [];
    if (unresolved.id === 'brief-duration') {
      brief.durationSeconds = 60;
      addAssumption(brief, 'durationSeconds', '60', '达到两轮澄清上限，采用 60 秒');
    }
    if (unresolved.id === 'brief-platform') {
      brief.platform = 'general';
      addAssumption(brief, 'platform', 'general', '达到两轮澄清上限，采用通用平台');
    }
  }

  if (!durationResolved && askable) {
    brief.unresolvedQuestions = [durationQuestion()];
    brief.clarificationCount += 1;
    return { brief, status: 'needs_clarification' };
  }
  if (!platformResolved && askable) {
    brief.unresolvedQuestions = [platformQuestion()];
    brief.clarificationCount += 1;
    return { brief, status: 'needs_clarification' };
  }

  if (!durationResolved) addAssumption(brief, 'durationSeconds', '60', '没有明确时长，采用适合短视频初版的 60 秒');
  if (!platformResolved) addAssumption(brief, 'platform', 'general', '没有明确平台，先按通用视频呈现');
  if (!inferAudience(materialContext)) addAssumption(brief, 'targetAudience', brief.targetAudience, '资料中没有明确受众，先面向普通观众');
  return { brief, status: 'ready' };
}

export function isBriefConfirmation(content: string): boolean {
  return CONFIRM_PATTERN.test(content.trim());
}

export function confirmProjectBrief(brief: ProjectBrief, now = new Date()): ProjectBrief {
  return { ...brief, unresolvedQuestions: [], confirmedAt: now.toISOString() };
}

export function compileProjectBriefForOutline(input: {
  brief: ProjectBrief;
  assets?: AssetSummary[];
  originalRequest?: string;
}): string {
  const brief = input.brief;
  const assetLines = (input.assets ?? []).map(asset => {
    const usage = brief.mustUseAssetIds.includes(asset.id)
      ? '必须使用'
      : brief.excludedAssetIds.includes(asset.id)
        ? '不要使用'
        : asset.usage === 'reference' || asset.inferredUsage === 'reference' ? '只供参考' : '可以使用';
    const digest = asset.summary?.digest || asset.summary?.title || (asset.kind === 'image' ? '已验证图片' : '已验证文档');
    return `- [${usage}] ${asset.originalName}: ${String(digest).slice(0, 1_500)}`;
  });
  return [
    '请根据以下已确认创作简报生成视频内容计划。不要再次询问模型、协议、渲染模式或并发设置。',
    input.originalRequest ? `【用户原始需求】\n${input.originalRequest}` : '',
    '【已确认创作简报】',
    `目标：${brief.goal}`,
    `受众：${brief.targetAudience}`,
    `平台：${platformLabel(brief.platform)}`,
    `目标时长：${brief.durationSeconds} 秒`,
    `语气：${brief.tone}`,
    `核心主张：${brief.coreMessage}`,
    `期望结果：${brief.desiredOutcome}`,
    brief.callToAction ? `行动引导：${brief.callToAction}` : '',
    brief.assumptions.length ? `默认假设：${brief.assumptions.map(item => `${item.field}=${item.value}（${item.reason}）`).join('；')}` : '',
    assetLines.length ? `【附件摘要】\n${assetLines.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export function clarificationActions(question: BriefQuestion) {
  return question.choices.map(choice => ({
    id: 'brief_clarify' as const,
    label: choice.label,
    value: choice.id,
    variant: choice.id === 'ai-decide' ? 'secondary' as const : 'outline' as const,
  }));
}

function applyCurrentAnswer(brief: ProjectBrief, content: string): ProjectBrief {
  const question = brief.unresolvedQuestions[0];
  if (!question) return brief;
  const choice = question.choices.find(item => item.id === content || item.label === content);
  const aiDecide = AI_DECIDE_PATTERN.test(content) || choice?.id === 'ai-decide';
  const hasTypedAnswer = question.id === 'brief-duration'
    ? Boolean(inferDurationSeconds(content))
    : question.id === 'brief-platform' ? Boolean(inferPlatform(content)) : false;
  if (!choice && !aiDecide && !hasTypedAnswer) return brief;
  const next = { ...brief, assumptions: [...brief.assumptions], unresolvedQuestions: [] };
  if (question.id === 'brief-duration') {
    const duration = inferDurationSeconds(content) || durationFromChoice(choice?.id) || 60;
    next.durationSeconds = duration;
    if (aiDecide) addAssumption(next, 'durationSeconds', String(duration), '用户选择让 AI 决定时长');
  }
  if (question.id === 'brief-platform') {
    const platform = inferPlatform(content) || platformFromChoice(choice?.id) || 'general';
    next.platform = platform;
    if (aiDecide) addAssumption(next, 'platform', platform, '用户选择让 AI 决定发布平台');
  }
  return next;
}

function durationQuestion(): BriefQuestion {
  return {
    id: 'brief-duration',
    question: '你希望成片大约多长？这会直接影响信息取舍和节奏。',
    choices: [
      { id: 'duration-30', label: '约 30 秒', effect: '只保留一个最有力的观点，节奏更快' },
      { id: 'duration-60', label: '约 60 秒', effect: '兼顾解释和观看节奏' },
      { id: 'ai-decide', label: '让 AI 决定', effect: '根据资料密度选择合适时长' },
    ],
  };
}

function platformQuestion(): BriefQuestion {
  return {
    id: 'brief-platform',
    question: '这条视频主要准备发在哪里？平台会影响开场和信息密度。',
    choices: [
      { id: 'platform-short', label: '抖音或视频号', effect: '更快进入重点，强化前几秒吸引力' },
      { id: 'platform-long', label: 'B站或 YouTube', effect: '允许更完整的解释和铺垫' },
      { id: 'ai-decide', label: '让 AI 决定', effect: '先按通用发布方式规划' },
    ],
  };
}

function inferDurationSeconds(value: string): number | null {
  const minute = value.match(/(\d+(?:\.\d+)?)\s*(?:分钟|分(?:钟)?)/i);
  if (minute) return clampDuration(Math.round(Number(minute[1]) * 60));
  const second = value.match(/(\d+)\s*(?:秒|s\b)/i);
  return second ? clampDuration(Number(second[1])) : null;
}

function clampDuration(value: number): number {
  return Math.max(10, Math.min(1_800, Math.round(value)));
}

function inferPlatform(value: string): ProjectBrief['platform'] | null {
  if (/抖音|douyin|tiktok/i.test(value)) return 'douyin';
  if (/视频号|微信视频/i.test(value)) return 'video-account';
  if (/哔哩哔哩|\bB站\b|bilibili/i.test(value)) return 'bilibili';
  if (/youtube|油管/i.test(value)) return 'youtube';
  return null;
}

function inferAudience(value: string): string | null {
  const match = value.match(/(?:面向|给|目标受众(?:是|为)?)([^，。；\n]{2,40})(?:看|观看|，|。|；|$)/);
  return match?.[1]?.trim() || null;
}

function inferGoal(content: string, fallback?: string): string {
  const cleaned = content
    .replace(/^(?:帮我|请|我想|我们想|需要)\s*/i, '')
    .replace(/^(?:做|制作|生成|规划)(?:一个|一条|一期)?\s*/i, '')
    .trim();
  if (!cleaned || /^(?:让\s*AI\s*决定|按这个生成|修改方案)$/i.test(cleaned)) return fallback || '根据提供的主题和资料制作一条易懂的视频';
  return cleaned.slice(0, 240);
}

function inferCoreMessage(content: string, fallback?: string): string {
  const sentence = content.split(/[。！？!?\n]/).map(item => item.trim()).find(Boolean);
  return sentence?.slice(0, 160) || fallback || '用清晰的叙事把主题讲明白';
}

function inferTone(value: string): string | null {
  if (/专业|权威|严谨/.test(value)) return '专业、可信、表达清晰';
  if (/轻松|幽默|有趣/.test(value)) return '轻松、有趣、节奏明快';
  if (/高级|克制|简洁/.test(value)) return '克制、简洁、有质感';
  if (/热血|激昂|震撼/.test(value)) return '有力量、节奏鲜明';
  return null;
}

function inferDesiredOutcome(value: string): string | null {
  if (/购买|下单|转化|产品|推广|发布/.test(value)) return '让观众理解产品价值并愿意进一步了解或行动';
  if (/科普|介绍|解释|知识/.test(value)) return '让观众快速理解主题并记住核心知识';
  if (/汇报|方案|提案/.test(value)) return '让观众理解方案价值并支持下一步行动';
  return null;
}

function classifyAssets(assets: AssetSummary[], baseline?: ProjectBrief | null) {
  if (!assets.length && baseline) {
    return {
      mustUseAssetIds: [...baseline.mustUseAssetIds],
      optionalAssetIds: [...baseline.optionalAssetIds],
      excludedAssetIds: [...baseline.excludedAssetIds],
    };
  }
  const incomingIds = new Set(assets.map(asset => asset.id));
  const keepExisting = (values: string[]) => values.filter(id => !incomingIds.has(id));
  return {
    mustUseAssetIds: [
      ...keepExisting(baseline?.mustUseAssetIds ?? []),
      ...assets.filter(asset => asset.usage === 'must' || (!asset.usage && asset.inferredUsage === 'brand')).map(asset => asset.id),
    ],
    optionalAssetIds: [
      ...keepExisting(baseline?.optionalAssetIds ?? []),
      ...assets.filter(asset => asset.usage === 'optional' || (!asset.usage && asset.inferredUsage !== 'brand' && asset.inferredUsage !== 'reference')).map(asset => asset.id),
    ],
    excludedAssetIds: [
      ...keepExisting(baseline?.excludedAssetIds ?? []),
      ...assets.filter(asset => asset.usage === 'excluded').map(asset => asset.id),
    ],
  };
}

function addAssumption(brief: ProjectBrief, field: string, value: string, reason: string) {
  if (brief.assumptions.some(item => item.field === field && item.value === value)) return;
  brief.assumptions.push({ field, value, reason });
}

function durationFromChoice(choiceId?: string): number | null {
  if (choiceId === 'duration-30') return 30;
  if (choiceId === 'duration-60') return 60;
  return null;
}

function platformFromChoice(choiceId?: string): ProjectBrief['platform'] | null {
  if (choiceId === 'platform-short') return 'douyin';
  if (choiceId === 'platform-long') return 'bilibili';
  return null;
}

function platformLabel(platform: ProjectBrief['platform']): string {
  return ({
    douyin: '抖音',
    'video-account': '视频号',
    bilibili: 'B站',
    youtube: 'YouTube',
    general: '通用平台',
  })[platform];
}
