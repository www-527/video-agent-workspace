/**
 * 分镜修改/新增的 AI 能力
 *
 * 提供：
 * - modifyFrameContent()    修改某个分镜的旁白/画面提示词
 * - generateNewFrameContent() 生成一个新分镜（标题/旁白/画面提示词）
 *
 * 这两个函数都只动 outline 层面的内容，不直接生成画面/声音。
 * 画面/声音由调用方通过 /api/frames/{image,html} + /api/tts 触发。
 */

import { v4 as uuid } from 'uuid';
import { callAIJson } from './client';
import type { FrameOutline, FrameStructureItemDraft, Outline, ProjectType, SceneSpec } from '@/types';
import { HTML_INTENT_OUTPUT_GUIDANCE } from '@/lib/prompts/html-native-visual';
import { withGPTVisualFreedom } from '@/lib/prompts/gpt-visual-freedom';
import { hasForbiddenMapVisual, NO_MAP_VISUAL_RULE } from '@/lib/ai/visual-constraints';

// =============================================================================
// 修改分镜内容
// =============================================================================

const MODIFY_FRAME_SYSTEM = `你是一位视频脚本编辑。你需要根据用户的修改需求，调整一个已有分镜的"旁白"和"画面提示词"。

## 输入
- 完整脚本（让 AI 理解上下文）
- 当前项目模式：image 或 html
- 当前分镜的标题/旁白/画面提示词
- 上一分镜、下一分镜的标题/旁白（保证衔接顺畅）
- 用户的修改需求

## 输出要求
- 输出严格 JSON：
{
  "title": "调整后的分镜标题（不超过 15 字）",
  "narration": "调整后的旁白（中文，15-60 字）",
  "imagePrompt": "调整后的画面提示词（image 模式：英文 30-100 词，包含全局画风前缀）",
  "htmlPrompt": "调整后的 HTML 动画画面提示词（自然语言描述布局、关键状态或变化及结果；不写 CSS/JS）",
  "sceneSpec": {
    "relationship": "hook/compare/process/hierarchy/metric/timeline/quote/cause/spatial/summary 之一",
    "focus": "本镜唯一焦点",
    "revealStrategy": "single/sequence/progressive/contrast",
    "focalElement": "唯一视觉主角",
    "composition": "establish/expand/conflict/turn/resolve",
    "actionSemantics": "内容关系产生的动作语义",
    "assetStrategy": "real-image/icon/chart/typography/css-svg",
    "informationPool": ["支撑画面的事实或细节"],
    "visualIntent": "观众应该看懂什么",
    "screenText": [],
    "assetHints": ["可选素材"],
    "durationHint": 6,
    "prohibitedPatterns": ["卡片墙", "emoji", "紫粉渐变"]
  }
}
- 如果当前项目模式是 image：必填 imagePrompt，不要输出 htmlPrompt 或 sceneSpec
- 如果当前项目模式是 html：必填 htmlPrompt 和 sceneSpec，不要输出 imagePrompt；htmlPrompt 必须遵守下方的 HTML 画面意图输出规范
- 如果修改的是第一镜，title 必须表达整条视频的主旨，并与视频总标题一致
- 修改后的内容要和上下文（上一镜/下一镜/整体脚本）自然衔接
- 输出前必须检查 htmlPrompt 是一段完整的自然语言画面说明，包含画面布局与关键状态、变化或结果；sceneSpec 的全部字段均已填写。screenText 可以为空数组，禁止以半句话或空对象结束
- 不要任何 JSON 之外的内容
`;

export async function modifyFrameContent(opts: {
  type: ProjectType;
  outline: Outline;
  frameIndex: number;       // 0-based 索引
  userModification: string;
  conversationContext?: string;
  baselineFrame?: FrameOutline;
  aiJsonCaller?: typeof callAIJson;
}): Promise<Partial<FrameOutline>> {
  const { type, outline, frameIndex, userModification, conversationContext, baselineFrame, aiJsonCaller = callAIJson } = opts;
  const frame = baselineFrame || outline.frames[frameIndex];
  if (!frame) throw new Error(`分镜索引越界: ${frameIndex}`);

  const prev = frameIndex > 0 ? outline.frames[frameIndex - 1] : null;
  const next = frameIndex < outline.frames.length - 1 ? outline.frames[frameIndex + 1] : null;
  const majorRewrite = isMajorRewriteRequest(userModification);

  if (type === 'html' && majorRewrite) {
    return rewriteHtmlFrameContent({
      outline,
      frameIndex,
      userModification,
      conversationContext,
      aiJsonCaller,
    });
  }

  const globalScript = outline.frames
    .map(f => `[#${f.index}] ${f.title}: ${f.narration}`)
    .join('\n');
  const stylePrefix = type === 'image' && outline.globalStyle
    ? `[全局画风] ${outline.globalStyle}\n\n`
    : '';
  const historyBlock = conversationContext
    ? `【对话历史上下文】\n${conversationContext}\n\n`
    : '';

  const userPrompt = `${stylePrefix}${historyBlock}【当前项目模式】
${type}

【完整脚本】
${globalScript}

【待修改分镜 (#${frame.index})】
标题：${frame.title}
旁白：${frame.narration}
${type === 'image' ? `画面提示词：${frame.imagePrompt || ''}` : `网页动画描述：${frame.htmlPrompt || ''}`}
${type === 'html' ? `当前 SceneSpec：${JSON.stringify(frame.sceneSpec || {})}` : ''}

【上一分镜】${prev ? `#${prev.index} ${prev.title}：${prev.narration}` : '（无）'}
【下一分镜】${next ? `#${next.index} ${next.title}：${next.narration}` : '（无）'}

【用户修改需求】
${userModification || '（无明确修改要求，请基于上下文做合理润色）'}

请按系统提示词要求，输出调整后的 JSON。`;

  const system = type === 'html'
    ? `${MODIFY_FRAME_SYSTEM}\n${HTML_INTENT_OUTPUT_GUIDANCE}\n${NO_MAP_VISUAL_RULE}`
    : MODIFY_FRAME_SYSTEM;
  const requestUpdate = (requestUser: string, stage: string, temperature: number) => aiJsonCaller<Partial<FrameOutline>>({
    stage,
    system,
    user: requestUser,
    temperature,
    maxTokens: 2200,
    noThinking: true,
    // Relay overloads are transient; retry twice before surfacing a failed frame edit.
    maxRetries: 2,
  });

  const majorRewriteRequirements = majorRewrite ? `

【这是“大改”，不是润色】
必须保留本镜的事实结论和主题，但必须重写，不得复用当前旁白或画面意图的句式、信息顺序、视觉隐喻或流程图结构。
- 标题必须重写但保持同一分镜主题；旁白必须换一个叙事切入点和信息组织方式，不能只替换开头、形容词或同义词。
- htmlPrompt 必须换一个视觉主角与内容关系；不得沿用原有对象、箭头路径、否定符号、屏幕文字组合或构图。
- sceneSpec 必须与新的 htmlPrompt 一致，focus、focalElement、relationship、composition、actionSemantics 都要重新设计。
- 输出前逐项对照“待修改分镜”：如果新旁白或画面意图仍可视为原文改写，继续重写后再输出。
` : '';

  let updated = await requestUpdate(`${userPrompt}${majorRewriteRequirements}`, majorRewrite ? '分镜大改' : '分镜修改', 0.6);
  if (type === 'html' && hasForbiddenMapVisual({ htmlPrompt: updated.htmlPrompt, sceneSpec: updated.sceneSpec })) {
    updated = await requestUpdate([
      userPrompt,
      majorRewriteRequirements,
      `【地图禁用重试】上一版包含被禁止的地理图形。${NO_MAP_VISUAL_RULE}`,
      '必须重新设计视觉主体；不得在 htmlPrompt、focalElement、actionSemantics、assetHints 或任何 SceneSpec 字段中提及或使用地图。只输出完整 JSON。',
    ].join('\n\n'), '分镜修改·移除地图', 0.75);
  }
  if (type === 'html' && hasForbiddenMapVisual({ htmlPrompt: updated.htmlPrompt, sceneSpec: updated.sceneSpec })) {
    throw new Error('AI 仍返回了被禁用的地图视觉，已阻止展示该草稿，请再次重试。');
  }
  if (majorRewrite && !isSubstantiallyDifferentFrameUpdate(frame, updated, type)) {
    updated = await requestUpdate([
      userPrompt,
      majorRewriteRequirements,
      '【重试：上一版不构成大改】上一版与当前分镜复用了过多原句或原有画面结构，不能交付。请从完全不同的叙事角度重做。',
      '硬性验收：新旁白与原旁白的连续表述不得高度重合；htmlPrompt 的主角、关系和屏幕文字不得沿用原方案。只输出完整 JSON。',
    ].join('\n\n'), '分镜大改·差异度重试', 0.8);
  }
  if (majorRewrite && !isSubstantiallyDifferentFrameUpdate(frame, updated, type)) {
    throw new Error('AI 未能生成与原稿明显不同的大改版本，已阻止将轻微润色作为“大改”展示，请重试');
  }
  if (type === 'html' && !isCompleteHtmlFrameUpdate(updated)) {
    updated = await requestUpdate([
      userPrompt,
      '【完整性修复】上一次结果的 htmlPrompt 被截断或 sceneSpec 不完整。请重新输出完整 JSON。',
      'htmlPrompt 必须是一段完整的自然语言画面说明，写清整体布局与关键状态、变化或结果；sceneSpec 不得为空且每个必填字段都要有值。screenText 允许为空数组。',
    ].join('\n\n'), '分镜修改·画面意图修复', 0.3);
  }
  if (type === 'html' && !isCompleteHtmlFrameUpdate(updated)) {
    throw new Error('AI 返回的画面意图不完整，已阻止生成错误草稿，请重试');
  }
  return frameIndex === 0 ? { ...updated, title: outline.title } : updated;
}

export interface RewriteFacts {
  frameNumber: number;
  metrics: string[];
  entities: string[];
  directions: string[];
  verifiedFacts: string[];
  previousFrame: { frameNumber: number; topic: string; narration: string } | null;
  nextFrame: { frameNumber: number; topic: string; narration: string } | null;
  sceneResponsibility: string;
  outlineResponsibilities: string[];
  directorContext: string[];
}

export interface OldVisualFingerprint {
  title: string;
  narration: string;
  visualSubject: string;
  actionSemantics: string;
  composition?: SceneSpec['composition'];
  assetStrategy?: SceneSpec['assetStrategy'];
  assetHints: string[];
}

interface RewriteCopy {
  title: string;
  narration: string;
}

interface RewriteVisual {
  htmlPrompt: string;
  sceneSpec: SceneSpec;
}

const REWRITE_COPY_SYSTEM = `你是一位视频脚本编辑。用户的原始修改要求拥有最高优先级；请结合完整上下文完成标题和旁白的改写。
不要输出 htmlPrompt 或 SceneSpec。
只输出严格 JSON：{"title":"重写后的标题","narration":"重写后的旁白"}。`;

const REWRITE_VISUAL_SYSTEM = `你是一位视频内容策划与 HTML 信息视觉导演，正在为一个已重写的分镜重新策划画面。
用户的原始修改要求拥有最高优先级。你会收到原始素材、整片内容大纲、创作简报、视觉总纲、相邻镜头职责和本镜重写后的标题/旁白；请自主决定最适合该内容的视觉表达，不要被预设构图、媒介、素材策略或旧方案限制。
只输出严格 JSON：
{
  "htmlPrompt":"用 1-3 句自然语言描述画面布局、关键元素状态或变化，以及最终结果；需要时自然写出屏幕文字",
  "sceneSpec":{
    "relationship":"内容关系",
    "focus":"本镜焦点",
    "revealStrategy":"信息揭示方式",
    "focalElement":"视觉主角",
    "composition":"构图意图",
    "actionSemantics":"画面如何表达内容",
    "assetStrategy":"自主选择的素材或表现策略",
    "informationPool":["支撑画面的信息"],
    "visualIntent":"观众应该看懂什么",
    "screenText":[],
    "assetHints":[],
    "durationHint":6,
    "prohibitedPatterns":["卡片墙","emoji","紫粉渐变","地图"]
  }
}`;

/**
 * Build the immutable fact guard for a fresh rewrite. Prefer original project material
 * and the information pool, so the old target draft is not used as creative input.
 */
export function buildRewriteFacts(outline: Outline, frameIndex: number): RewriteFacts {
  const frame = outline.frames[frameIndex];
  if (!frame) throw new Error(`分镜索引越界: ${frameIndex}`);
  const originalSource = [
    outline.sourceMaterial,
    ...(outline.informationPool || []).map(item => item.content),
  ].filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).join('\n');
  // Legacy projects may not retain source material. Keep their facts available,
  // but never pass the old draft's wording as a visual or copywriting baseline.
  const factSource = originalSource || `${frame.title}。${frame.narration}`;
  const metrics = uniqueMatches(factSource, /[+-]?\d+(?:\.\d+)?\s*(?:%|％|亿|万|千|百|美元|元|倍|年|个月|天|小时)?/g);
  const entities = extractFactEntities(factSource);
  const directions = uniqueMatches(factSource, /增长|上升|提升|增加|扩大|下降|减少|收缩|持平|突破|达到|超过|低于/g);
  const beatByFrame = new Map((outline.beats || []).map(beat => [beat.frameId, beat]));
  const beat = beatByFrame.get(frame.id);
  const chapter = outline.chapters?.find(item => item.id === beat?.chapterId);
  const factCandidates = (outline.informationPool || [])
    .filter(item => item.type === 'data' || item.type === 'fact' || item.type === 'entity')
    .map(item => sanitizeFactContext(item.content))
    .filter(content => content && [...metrics, ...entities].some(term => comparableIncludes(content, term)))
    .filter(content => normalizeComparableText(content) !== normalizeComparableText(frame.title)
      && normalizeComparableText(content) !== normalizeComparableText(frame.narration))
    .slice(0, 6);
  const rawResponsibility = sanitizeFactContext(beat?.purpose || chapter?.purpose || '');
  const responsibility = rawResponsibility
    && normalizeComparableText(rawResponsibility) !== normalizeComparableText(frame.title)
    ? rawResponsibility
    : `承接整片第 ${frame.index} 个论证节拍`;

  return {
    frameNumber: frame.index,
    metrics,
    entities,
    directions,
    verifiedFacts: [...new Set(factCandidates)],
    previousFrame: contextFrame(outline.frames[frameIndex - 1]),
    nextFrame: contextFrame(outline.frames[frameIndex + 1]),
    sceneResponsibility: responsibility,
    outlineResponsibilities: (outline.beats || [])
      .filter(item => item.frameId !== frame.id)
      .map(item => sanitizeFactContext(`#${item.order} ${item.purpose}`))
      .filter(Boolean),
    directorContext: [outline.directorPlan?.coreMessage, outline.directorPlan?.tone, outline.directorPlan?.pacing]
      .map(sanitizeFactContext)
      .filter(Boolean),
  };
}

export function buildOldVisualFingerprint(frame: FrameOutline): OldVisualFingerprint {
  return {
    title: frame.title,
    narration: frame.narration,
    visualSubject: frame.sceneSpec?.focalElement || extractHtmlPromptField(frame.htmlPrompt, '主角'),
    actionSemantics: frame.sceneSpec?.actionSemantics || extractHtmlPromptField(frame.htmlPrompt, '关系'),
    composition: frame.sceneSpec?.composition,
    assetStrategy: frame.sceneSpec?.assetStrategy,
    assetHints: frame.sceneSpec?.assetHints || [],
  };
}

async function rewriteHtmlFrameContent(opts: {
  outline: Outline;
  frameIndex: number;
  userModification: string;
  conversationContext?: string;
  aiJsonCaller: typeof callAIJson;
}): Promise<Partial<FrameOutline>> {
  const { outline, frameIndex, userModification, conversationContext, aiJsonCaller } = opts;
  const facts = buildRewriteFacts(outline, frameIndex);
  const factsJson = JSON.stringify(facts, null, 2);
  const userRequestContext = buildUserRewriteContext(userModification, conversationContext);
  const copyPrompt = [
    userRequestContext,
    `【项目原始素材】\n${outline.sourceMaterial || '未保存原始素材；请只依据下方事实、分镜职责和相邻镜头重新创作。'}`,
    `【完整大纲】\n${freshRewriteOutlineContext(outline, frameIndex)}`,
    outline.creativeBrief ? `【创作简报】\n${JSON.stringify(outline.creativeBrief, null, 2)}` : '',
    outline.directorPlan ? `【整片视觉总纲】\n${JSON.stringify(outline.directorPlan, null, 2)}` : '',
    `【本镜在叙事中的职责】\n${facts.sceneResponsibility}`,
    `【相邻镜头】\n上一镜：${facts.previousFrame ? `#${facts.previousFrame.frameNumber} ${facts.previousFrame.topic}：${facts.previousFrame.narration}` : '无'}\n下一镜：${facts.nextFrame ? `#${facts.nextFrame.frameNumber} ${facts.nextFrame.topic}：${facts.nextFrame.narration}` : '无'}`,
    `【已提取的事实参考】\n${factsJson}`,
    '【任务】目标镜的旧标题、旧旁白、旧画面提示词和旧 SceneSpec 均已废弃。请基于上述信息从零创作新的标题和旁白，不要把旧稿当作改写对象。',
  ].join('\n\n');

  let copy = await aiJsonCaller<RewriteCopy>({
    stage: '分镜大改·文案重写',
    system: REWRITE_COPY_SYSTEM,
    user: copyPrompt,
    temperature: 0.7,
    maxTokens: 700,
    noThinking: true,
    maxRetries: 1,
  });
  if (!hasUsableRewriteCopy(copy)) {
    copy = await aiJsonCaller<RewriteCopy>({
      stage: '分镜大改·文案重试',
      system: REWRITE_COPY_SYSTEM,
      user: `${copyPrompt}\n\n【技术修复】上一版缺少标题或旁白字段。请仅补齐 JSON 字段。`,
      temperature: 0.8,
      maxTokens: 700,
      noThinking: true,
      maxRetries: 1,
  });
  }
  if (!hasUsableRewriteCopy(copy)) throw new Error('AI 未返回可编辑的标题和旁白，请重试“让 AI 大改一版”。');

  const visualBasePrompt = buildOutlineStageVisualPrompt({
    outline, frameIndex, copy, facts, factsJson, userRequestContext,
  });
  let visual = await aiJsonCaller<RewriteVisual>({
    stage: '分镜大改·视觉重构',
    system: `${REWRITE_VISUAL_SYSTEM}\n${HTML_INTENT_OUTPUT_GUIDANCE}\n${NO_MAP_VISUAL_RULE}`,
    user: visualBasePrompt,
    temperature: 0.75,
    maxTokens: 1800,
    noThinking: true,
    maxRetries: 1,
  });
  if (!hasUsableRewriteVisual(visual)) {
    visual = await aiJsonCaller<RewriteVisual>({
      stage: '分镜大改·视觉重试',
      system: `${REWRITE_VISUAL_SYSTEM}\n${HTML_INTENT_OUTPUT_GUIDANCE}\n${NO_MAP_VISUAL_RULE}`,
      user: `${visualBasePrompt}\n\n【技术修复】上一版缺少 htmlPrompt 或 sceneSpec 字段。请仅补齐 JSON 字段。`,
      temperature: 0.85,
      maxTokens: 1800,
      noThinking: true,
      maxRetries: 1,
    });
  }
  if (!hasUsableRewriteVisual(visual)) throw new Error('AI 未返回可编辑的画面意图，请重试“让 AI 大改一版”。');

  return { ...copy, ...visual };
}

/** Restore the same story and planning context available during outline generation. */
function buildOutlineStageVisualPrompt(input: {
  outline: Outline;
  frameIndex: number;
  copy: RewriteCopy;
  facts: RewriteFacts;
  factsJson: string;
  userRequestContext: string;
}): string {
  const { outline, frameIndex, copy, facts, factsJson, userRequestContext } = input;
  const target = outline.frames[frameIndex];
  const sourceMaterial = (outline.sourceMaterial || '')
    .trim()
    .slice(0, 8_000);
  const framePlan = outline.frames
    .map(frame => `#${frame.index} ${frame.id === target?.id ? '【本镜已重写，见下方】' : `${frame.title}：${frame.narration}`}`)
    .join('\n')
    .slice(0, 12_000);
  const chapterPlan = (outline.chapters || []).map(chapter => ({
    title: chapter.title,
    purpose: chapter.purpose,
    beatIds: chapter.beatIds,
  }));

  return [
    userRequestContext,
    sourceMaterial ? `【原始素材】\n${sourceMaterial}` : '',
    `【整片内容大纲】\n${framePlan}`,
    outline.creativeBrief ? `【创作简报】\n${JSON.stringify(outline.creativeBrief, null, 2)}` : '',
    chapterPlan.length ? `【章节结构】\n${JSON.stringify(chapterPlan, null, 2)}` : '',
    outline.directorPlan ? `【整片视觉总纲】\n${JSON.stringify(outline.directorPlan, null, 2)}` : '',
    `【本镜在叙事中的职责】\n${facts.sceneResponsibility}`,
    `【相邻镜头】\n上一镜：${facts.previousFrame ? `#${facts.previousFrame.frameNumber} ${facts.previousFrame.topic}：${facts.previousFrame.narration}` : '无'}\n下一镜：${facts.nextFrame ? `#${facts.nextFrame.frameNumber} ${facts.nextFrame.topic}：${facts.nextFrame.narration}` : '无'}`,
    `【需保留的事实】\n${factsJson}`,
    `【本镜已重写文案】\n${JSON.stringify(copy, null, 2)}`,
    '【任务】请为本镜输出 htmlPrompt 和 sceneSpec。请完成阶段 B。',
  ].filter(Boolean).join('\n\n');
}

function freshRewriteOutlineContext(outline: Outline, targetFrameIndex: number): string {
  return outline.frames
    .map((frame, index) => index === targetFrameIndex
      ? `#${frame.index} 【本镜待重新策划；不要参考旧标题、旧旁白或旧视觉方案】`
      : `#${frame.index} ${frame.title}：${frame.narration}`)
    .join('\n');
}

function buildUserRewriteContext(userModification: string, conversationContext?: string): string {
  return [
    `【用户原始大改要求（最高优先级，必须作为本次改写依据）】\n${userModification || '请基于当前分镜进行改写。'}`,
    conversationContext ? `【对话上下文】\n${conversationContext}` : '',
  ].filter(Boolean).join('\n\n');
}

function hasUsableRewriteCopy(copy: Partial<RewriteCopy>): copy is RewriteCopy {
  return Boolean(copy?.title?.trim() && copy.narration?.trim());
}

function hasUsableRewriteVisual(visual: Partial<RewriteVisual>): visual is RewriteVisual {
  return Boolean(visual?.htmlPrompt?.trim() && visual.sceneSpec && typeof visual.sceneSpec === 'object');
}

function isSemanticallyDifferentVisual(old: OldVisualFingerprint, visual: Partial<RewriteVisual>): boolean {
  if (hasForbiddenMapVisual({ htmlPrompt: visual.htmlPrompt, sceneSpec: visual.sceneSpec })) return false;
  const subject = visual.sceneSpec?.focalElement || extractHtmlPromptField(visual.htmlPrompt, '主角');
  const action = visual.sceneSpec?.actionSemantics || extractHtmlPromptField(visual.htmlPrompt, '关系');
  if (!subject || !action) return false;
  if (semanticVisualReuse(old.visualSubject, subject, 'subject')) return false;
  if (semanticVisualReuse(old.actionSemantics, action, 'action')) return false;
  if (old.composition && old.assetStrategy
    && old.composition === visual.sceneSpec?.composition
    && old.assetStrategy === visual.sceneSpec?.assetStrategy) return false;

  const oldKeywords = visualConcepts(`${old.visualSubject} ${old.assetHints.join(' ')}`, 'subject');
  const newVisualFields = [visual.htmlPrompt, visual.sceneSpec?.focalElement, visual.sceneSpec?.actionSemantics,
    visual.sceneSpec?.visualIntent, ...(visual.sceneSpec?.assetHints || [])].join(' ');
  const newConcepts = visualConcepts(newVisualFields, 'subject');
  return !oldKeywords.some(keyword => newConcepts.includes(keyword));
}

function semanticVisualReuse(before: string, after: string, kind: 'subject' | 'action'): boolean {
  if (!before.trim()) return false;
  const beforeConcepts = visualConcepts(before, kind);
  const afterConcepts = visualConcepts(after, kind);
  if (beforeConcepts.some(concept => afterConcepts.includes(concept))) return true;
  return textReuseRatioIgnoringFacts(before, after) >= 0.55;
}

function visualConcepts(text: string, kind: 'subject' | 'action'): string[] {
  const groups: Array<[string, RegExp]> = kind === 'subject'
    ? [
        ['map', /地图|地理轮廓|地理剪影|国界|省份轮廓|map(?:[-_ ]?outline)?/i],
        ['bar', /柱状|条形|柱形|bar(?:\s*chart)?/i],
        ['big-number', /大数字|巨型数字|数字主角|数值排版/i],
        ['scale', /刻度|标尺|仪表盘|量尺|scale|gauge/i],
        ['timeline', /时间线|时间轴|年份轴|timeline/i],
        ['flow', /流程|路径|传送带|flow|pipeline/i],
        ['hierarchy', /层级|树状|组织树|hierarchy|tree/i],
        ['quote', /引文|引用|引号|quote/i],
        ['card', /卡片|面板|窗口|card|panel/i],
        ['box', /盒子|盒体|容器|方盒|box|container/i],
        ['arrow', /箭头|指向|arrow/i],
        ['pie', /饼图|扇形|圆环|pie|donut/i],
      ]
    : [
        ['grow', /长出|生长|升高|拉长|扩张|grow|rise|expand/i],
        ['appear', /出现|浮现|显现|淡入|揭示|appear|reveal|fade/i],
        ['connect', /连接|接入|串联|连线|connect|link/i],
        ['converge', /汇入|汇聚|合流|收束|converge|merge/i],
        ['advance', /推进|流动|传递|抵达|advance|move|flow/i],
        ['compare', /对比|并列|拉开差距|compare|contrast/i],
        ['highlight', /强调|高亮|放大|highlight|emphasize/i],
      ];
  return groups.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function contextFrame(frame?: FrameOutline): RewriteFacts['previousFrame'] {
  if (!frame) return null;
  return {
    frameNumber: frame.index,
    topic: sanitizeFactContext(frame.title),
    narration: sanitizeFactContext(frame.narration),
  };
}

function sanitizeFactContext(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/(?:中国|世界|全球|省份|区域)?地图(?:轮廓|剪影)?/gi, '数据范围')
    .replace(/map(?:[-_\s]*(?:outline|shape|silhouette|chart))?/gi, 'data view')
    .replace(/(?:中心)?(?:长出|出现|浮现)?(?:柱状条|柱状图)/g, '数值变化')
    .trim();
}

function extractFactEntities(text: string): string[] {
  const explicitMarkets = uniqueMatches(text, /(?:中国|美国|欧洲|亚洲|全球|国内|海外|国际)(?:市场|地区)?/g);
  const quoted = Array.from(text.matchAll(/[“「『\"]([^”」』\"]{2,20})[”」』\"]/g)).map(match => match[1]);
  const named = uniqueMatches(text, /[A-Za-z][A-Za-z0-9 .&+-]{1,24}|[\p{Script=Han}]{2,12}(?:市场|行业|公司|集团|用户|客户|产品)/gu)
    .map(item => item.replace(/^(?:在|其|该|这个|本次)/, ''));
  return [...new Set([...explicitMarkets, ...quoted, ...named].map(item => item.trim()).filter(Boolean))].slice(0, 8);
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  return [...new Set(Array.from(text.matchAll(pattern)).map(match => match[0].replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

function extractHtmlPromptField(prompt: string | undefined, field: string): string {
  if (!prompt) return '';
  return prompt.match(new RegExp(`${field}：([^；]+)`))?.[1]?.trim() || '';
}

function comparableIncludes(text: string, term: string): boolean {
  return normalizeComparableText(text).includes(normalizeComparableText(term));
}

/** UI 的“大改一版”会以自然语言进入此处，统一识别为强制重写模式。 */
export function isMajorRewriteRequest(request: string): boolean {
  return /(?:大改|重写|完全不同|不要只做轻微(?:润色|微调))/.test(request);
}

/** A replacement shot starts without the current draft or its visual history. */
export function isFreshFrameGenerationRequest(request: string): boolean {
  return /(?:空白(?:的)?新镜头|空白镜头|首次生成链路)/.test(request);
}

/**
 * 防止模型只在原稿前面加一句话便冒充“大改”。中文场景下用最长公共子序列衡量
 * 原文被保留的程度；同时要求 HTML 画面意图也换掉，而不是仅替换旁白开头。
 */
export function isSubstantiallyDifferentFrameUpdate(
  current: FrameOutline,
  updated: Partial<FrameOutline>,
  type: ProjectType,
): boolean {
  const titleChanged = textReuseRatioIgnoringFacts(current.title, updated.title || '') < 0.8;
  const narrationChanged = textReuseRatioIgnoringFacts(current.narration, updated.narration || '') < 0.72;
  if (!titleChanged || !narrationChanged) return false;
  if (type === 'image') return textReuseRatio(current.imagePrompt || '', updated.imagePrompt || '') < 0.72;
  if (hasForbiddenMapVisual({ htmlPrompt: updated.htmlPrompt, sceneSpec: updated.sceneSpec })) return false;
  return isSemanticallyDifferentVisual(buildOldVisualFingerprint(current), {
    htmlPrompt: updated.htmlPrompt || '',
    sceneSpec: updated.sceneSpec as SceneSpec | undefined,
  });
}

function textReuseRatio(before: string, after: string): number {
  const left = normalizeComparableText(before);
  const right = normalizeComparableText(after);
  if (!left || !right) return 1;
  const rows = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      rows[i][j] = left[i - 1] === right[j - 1]
        ? rows[i - 1][j - 1] + 1
        : Math.max(rows[i - 1][j], rows[i][j - 1]);
    }
  }
  return rows[left.length][right.length] / Math.max(left.length, right.length);
}

function textReuseRatioIgnoringFacts(before: string, after: string): number {
  const stripFacts = (value: string) => value.replace(/[+-]?\d+(?:\.\d+)?\s*(?:%|％|亿|万|千|百|美元|元|倍|年|个月|天|小时)?/g, '');
  return textReuseRatio(stripFacts(before), stripFacts(after));
}

function normalizeComparableText(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

export function isCompleteHtmlFrameUpdate(update: Partial<FrameOutline>): boolean {
  const htmlPrompt = typeof update.htmlPrompt === 'string' ? update.htmlPrompt.trim() : '';
  const hasScreenTextField = htmlPrompt.includes('屏幕文字：') || htmlPrompt.includes('屏幕短词：');
  const isLegacyFieldFormat = htmlPrompt.includes('主角：') && htmlPrompt.includes('关系：') && hasScreenTextField;
  const isNaturalAnimationDescription = htmlPrompt.length >= 30 && /[。；]/.test(htmlPrompt);
  if (!isLegacyFieldFormat && !isNaturalAnimationDescription) {
    return false;
  }

  const spec = update.sceneSpec as Partial<SceneSpec> | undefined;
  if (!spec || typeof spec !== 'object') return false;
  if (hasForbiddenMapVisual({ htmlPrompt, sceneSpec: spec })) return false;
  const requiredText = [spec.relationship, spec.focus, spec.revealStrategy, spec.focalElement, spec.composition,
    spec.actionSemantics, spec.assetStrategy, spec.visualIntent];
  if (requiredText.some(value => typeof value !== 'string' || !value.trim())) return false;
  if (!Array.isArray(spec.informationPool) || spec.informationPool.length < 1) return false;
  if (!Array.isArray(spec.screenText) || spec.screenText.length > 2) return false;
  if (!Array.isArray(spec.assetHints) || !Array.isArray(spec.prohibitedPatterns)) return false;
  return typeof spec.durationHint === 'number' && Number.isFinite(spec.durationHint) && spec.durationHint > 0;
}

// =============================================================================
// 新增分镜内容
// =============================================================================

const ADD_FRAME_SYSTEM = `你是一位视频脚本编辑。你需要根据当前视频的脚本和已有大纲，并结合用户的需求，创作一个**新的分镜**。

## 输入
- 当前视频的完整脚本（逐字稿 + 分镜大纲）
- 当前项目模式：image 或 html
- 用户的新分镜需求（可能指定了位置，也可能只描述了内容）
- 用户指定的插入位置 afterIndex（1-based，表示"在第 N 镜之后插入"；0 表示未指定）

## 输出要求
- 输出严格 JSON：
{
  "title": "新分镜标题（不超过 15 字）",
  "narration": "新分镜旁白（中文，15-60 字）",
  "imagePrompt": "画面提示词（image 模式：英文 30-100 词，包含全局画风前缀）",
  "htmlPrompt": "HTML 动画画面提示词（自然语言描述布局、关键状态或变化及结果；不写 CSS/JS）",
  "sceneSpec": {
    "relationship": "hook/compare/process/hierarchy/metric/timeline/quote/cause/spatial/summary 之一",
    "focus": "本镜唯一焦点",
    "revealStrategy": "single/sequence/progressive/contrast",
    "focalElement": "唯一视觉主角",
    "composition": "establish/expand/conflict/turn/resolve",
    "actionSemantics": "内容关系产生的动作语义",
    "assetStrategy": "real-image/icon/chart/typography/css-svg",
    "informationPool": ["支撑画面的事实或细节"],
    "visualIntent": "观众应该看懂什么",
    "screenText": [],
    "assetHints": ["可选素材"],
    "durationHint": 6,
    "prohibitedPatterns": ["卡片墙", "emoji", "紫粉渐变"]
  },
  "afterIndex": 在第几镜之后插入（1-based；如果 afterIndex=0 则 AI 自己决定最合适的位置）
}
- 旁白和画面提示词要和上下文衔接自然，不要重复已有分镜的内容
- 如果当前项目模式是 image：必填 imagePrompt，不要输出 htmlPrompt 或 sceneSpec
- 如果当前项目模式是 html：必填 htmlPrompt 和 sceneSpec，不要输出 imagePrompt；htmlPrompt 必须遵守下方的 HTML 画面意图输出规范
- 保持与全局画风/视觉风格一致
- 不要任何 JSON 之外的内容
`;

export interface NewFrameContent {
  title: string;
  narration: string;
  imagePrompt?: string;
  htmlPrompt?: string;
  sceneSpec?: SceneSpec;
  afterIndex: number;       // 1-based，AI 决定时也回填
}

export async function generateNewFrameContent(opts: {
  type: ProjectType;
  outline: Outline;
  userHint: string;
  afterIndex: number;       // 1-based；0 表示未指定
  conversationContext?: string;
}): Promise<NewFrameContent> {
  const { type, outline, userHint, afterIndex, conversationContext } = opts;

  const globalScript = outline.frames
    .map(f => `[#${f.index}] ${f.title}: ${f.narration}`)
    .join('\n');
  const stylePrefix = type === 'image' && outline.globalStyle
    ? `[全局画风] ${outline.globalStyle}\n\n`
    : '';
  const historyBlock = conversationContext
    ? `【对话历史上下文】\n${conversationContext}\n\n`
    : '';

  const userPrompt = `${stylePrefix}${historyBlock}【当前项目模式】
${type}

【当前视频脚本】
${globalScript}

【已有分镜大纲】
${outline.frames.map(f => `#${f.index} ${f.title}: ${f.narration}`).join('\n')}

【用户指定插入位置】在第 ${afterIndex === 0 ? '?（未指定，由你决定）' : afterIndex} 镜之后

【用户对新分镜的需求】
${userHint || '（未明确，由你根据上下文判断合适的内容）'}

请按系统提示词要求，输出新分镜的 JSON（务必回填 afterIndex 字段）。`;

  return callAIJson<NewFrameContent>({
    stage: '分镜新增',
    system: type === 'html'
      ? withGPTVisualFreedom(`${ADD_FRAME_SYSTEM}\n${HTML_INTENT_OUTPUT_GUIDANCE}`, 'director')
      : ADD_FRAME_SYSTEM,
    user: userPrompt,
    temperature: 0.7,
    maxRetries: 1,
  });
}

// =============================================================================
// 拆分 / 合并分镜内容
// =============================================================================

const STRUCTURE_FRAME_SYSTEM = `你是一位视频脚本结构编辑。你需要把已有分镜拆成多个连续分镜，或把多个连续分镜合并成一个分镜。

输出严格 JSON：
{
  "frames": [{
    "title": "分镜标题（不超过15字）",
    "narration": "旁白（中文15-80字）",
    "imagePrompt": "image 模式画面提示词",
    "htmlPrompt": "html 模式画面内容意图",
    "sceneSpec": {}
  }]
}

要求：
- split：输出指定数量的连续分镜，完整覆盖原分镜信息，各镜职责清楚、内容不重复、前后衔接自然。
- merge：只输出一个分镜，保留所有关键事实，删除重复表达，控制单镜信息密度。
- image 模式只输出 imagePrompt；html 模式只输出 htmlPrompt 和完整 sceneSpec。
- 如果目标包含第一镜，输出 frames[0].title 必须与视频总标题一致。
- 不要输出 JSON 之外的文字。`;

export async function generateFrameStructureContent(opts: {
  type: ProjectType;
  outline: Outline;
  operation: 'split' | 'merge';
  targetIndexes: number[];
  parts?: number;
  userModification: string;
  conversationContext?: string;
}): Promise<{ frames: FrameStructureItemDraft[] }> {
  const { type, outline, operation, targetIndexes, parts = 2, userModification, conversationContext } = opts;
  const targets = targetIndexes.map(index => outline.frames[index]).filter(Boolean);
  if (targets.length !== targetIndexes.length) throw new Error('目标分镜不存在');

  const previous = targetIndexes[0] > 0 ? outline.frames[targetIndexes[0] - 1] : null;
  const lastIndex = targetIndexes[targetIndexes.length - 1];
  const next = lastIndex < outline.frames.length - 1 ? outline.frames[lastIndex + 1] : null;
  const historyBlock = conversationContext ? `【对话历史】\n${conversationContext}\n\n` : '';
  const styleBlock = type === 'image' && outline.globalStyle ? `【全局画风】\n${outline.globalStyle}\n\n` : '';
  const prompt = `${styleBlock}${historyBlock}【项目模式】${type}
【视频总标题】${outline.title}
【操作】${operation === 'split' ? `把目标拆成 ${parts} 个连续分镜` : '把所有目标合并成 1 个分镜'}
【目标分镜】
${targets.map(frame => `#${frame.index} ${frame.title}\n旁白：${frame.narration}\n画面意图：${type === 'image' ? frame.imagePrompt || '' : frame.htmlPrompt || frame.sceneSpec?.visualIntent || ''}`).join('\n\n')}

【上一镜】${previous ? `#${previous.index} ${previous.title}：${previous.narration}` : '无'}
【下一镜】${next ? `#${next.index} ${next.title}：${next.narration}` : '无'}
【用户要求】${userModification || '按内容逻辑合理处理'}

请输出 ${operation === 'split' ? parts : 1} 条 frames。`;

  const result = await callAIJson<{ frames: FrameStructureItemDraft[] }>({
    stage: operation === 'split' ? '分镜拆分' : '分镜合并',
    system: type === 'html'
      ? withGPTVisualFreedom(`${STRUCTURE_FRAME_SYSTEM}\n${HTML_INTENT_OUTPUT_GUIDANCE}`, 'director')
      : STRUCTURE_FRAME_SYSTEM,
    user: prompt,
    temperature: 0.6,
    maxRetries: 1,
  });

  const expected = operation === 'split' ? parts : 1;
  if (!Array.isArray(result.frames) || result.frames.length !== expected) {
    throw new Error(`AI 应返回 ${expected} 个分镜，实际返回 ${result.frames?.length ?? 0} 个`);
  }
  if (targetIndexes[0] === 0) result.frames[0].title = outline.title;
  return result;
}

// =============================================================================
// 大纲操作工具
// =============================================================================

/**
 * 在 outline.frames 的指定位置之后插入新分镜（1-based afterIndex）
 * - 同步重排 index（1-based 顺序号）
 * - 返回新的 outline 和插入位置在 outline.frames 中的 0-based 索引
 */
export function insertFrameIntoOutline(
  outline: Outline,
  newFrame: FrameOutline,
  afterIndex: number,     // 1-based
): { outline: Outline; insertAt: number } {
  // 1-based afterIndex → 0-based 插入点（在第 N 镜之后 = 插在 0-based 位置 N）
  // 边界：afterIndex=0 → 插到最前面；afterIndex>=total → 插到最后面
  const total = outline.frames.length;
  const insertAt = Math.max(0, Math.min(afterIndex, total));

  const newId = newFrame.id || uuid();
  const newFrames: FrameOutline[] = [
    ...outline.frames.slice(0, insertAt),
    { ...newFrame, id: newId },
    ...outline.frames.slice(insertAt),
  ].map((f, i) => ({ ...f, index: i + 1 }));

  return {
    outline: syncOutlineContent({ ...outline, frames: newFrames }),
    insertAt,
  };
}

/**
 * 删除指定分镜（1-based frameIndex），并同步重排 index / script / beats / chapters。
 */
export function deleteFrameFromOutline(
  outline: Outline,
  frameIndex: number,
): { outline: Outline; deletedFrame: FrameOutline; deleteAt: number } {
  const deleteAt = frameIndex - 1;
  const deletedFrame = outline.frames[deleteAt];
  if (!deletedFrame) {
    throw new Error(`分镜编号 ${frameIndex} 不存在`);
  }

  const newFrames = outline.frames
    .filter((_, index) => index !== deleteAt)
    .map((frame, index) => ({ ...frame, index: index + 1 }));

  return {
    outline: syncOutlineContent({ ...outline, frames: newFrames }),
    deletedFrame,
    deleteAt,
  };
}

/** 保持 script / beats / chapters 与扁平 frames 的兼容视图同步。 */
export function syncOutlineContent(outline: Outline): Outline {
  const previousBeats = new Map((outline.beats || []).map(beat => [beat.frameId, beat]));
  const fallbackChapterId = outline.chapters?.[0]?.id || 'chapter-1';
  const beats = outline.frames.map((frame, index) => {
    const previous = previousBeats.get(frame.id);
    return {
      id: previous?.id || `beat-${frame.id}`,
      chapterId: previous?.chapterId || fallbackChapterId,
      order: index + 1,
      narration: frame.narration,
      purpose: previous?.purpose || frame.title,
      frameId: frame.id,
    };
  });
  const chapters = (outline.chapters?.length ? outline.chapters : [{
    id: fallbackChapterId, title: outline.title, purpose: '完整讲述主题', beatIds: [],
  }]).map(chapter => ({
    ...chapter,
    beatIds: beats.filter(beat => beat.chapterId === chapter.id).map(beat => beat.id),
  }));
  const unassigned = beats.filter(beat => !chapters.some(chapter => chapter.id === beat.chapterId));
  if (unassigned.length) chapters[0].beatIds.push(...unassigned.map(beat => beat.id));
  return { ...outline, script: beats.map(beat => beat.narration).join('\n'), beats, chapters };
}

/**
 * 重排 videoSource.frames 使其与 outline.frames 对齐
 * - 如果 outline 多了/少了帧，对应位置补 {id} 或 删除
 */
export function realignVideoSource(
  outline: Outline,
  videoSource: { frames: Array<{ id: string; [k: string]: unknown }> },
): typeof videoSource {
  const oldById = new Map(videoSource.frames.map(f => [f.id, f]));
  const newFrames = outline.frames.map(f => {
    const existing = oldById.get(f.id);
    return existing ? { ...existing } : { id: f.id };
  });
  return { frames: newFrames };
}
