import type {
  AssetRequest,
  FrameOutline,
  ImageSubjectPlan,
  Outline,
  PersonImagePlan,
  RealImageAsset,
  SmartImageMode,
  SmartImagePlan,
} from '@/types';
import { getCurrentAITransportPolicy, getCurrentGPTOptimizationSettings, isGPTOptimizationEnabled } from '@/lib/ai-key-context';
import { classifyVisualAsset } from './visual-asset-policy';
import { throwIfAborted } from '@/lib/agents/cancellation';

export type RealImagePlan = SmartImagePlan;
export type { PersonImagePlan } from '@/types';

const MODE_DEADLINES: Record<SmartImageMode, number> = {
  fast: 5_000,
  balanced: 10_000,
  'asset-priority': 20_000,
};

export async function planRealImages(
  outline: Outline,
  existingSources: Array<{ id?: string; realImage?: RealImageAsset; realImages?: RealImageAsset[] }>,
  abortSignal?: AbortSignal,
  mode: SmartImageMode = 'balanced',
): Promise<SmartImagePlan[]> {
  throwIfAborted(abortSignal);
  const existing = new Set(existingSources.filter(source => source.realImage || source.realImages?.length).map(source => source.id));
  const frames = outline.frames.filter(frame => !existing.has(frame.id));
  if (!frames.length) return [];
  // SceneSpec already contains Director-authored asset semantics. Convert it
  // deterministically so the whole film no longer incurs a second AI pass.
  return applyGPTInternalSearchBudget(enforcePlanConstraints(frames, fallbackPlans(frames, mode), mode));
}

export function applyGPTInternalSearchBudget(plans: SmartImagePlan[]): SmartImagePlan[] {
  const settings = getCurrentGPTOptimizationSettings();
  if (!settings?.enabled) return plans;
  // GPT-free uses the same program-owned Pexels worker and Codex visual input,
  // but its bound key deliberately keeps the legacy "internal search" flag
  // false because the model itself never receives a web-search tool.
  const programOwnedGPTFreeSearch = getCurrentAITransportPolicy() === 'gpt-free-codex';
  if (!settings.internalImageSearch && !programOwnedGPTFreeSearch) {
    return plans.map(plan => plan.useRealImage
      ? { ...plan, useRealImage: false, reason: 'GPT 内部搜图已关闭；没有发起搜索' }
      : plan);
  }
  let remainingSearches = 20;
  return plans.map(plan => {
    if (!plan.useRealImage) return plan;
    const allowed = Math.min(2, remainingSearches);
    if (allowed <= 0) {
      return {
        ...plan,
        useRealImage: false,
        reason: plan.requirement?.attempt === 'required'
          ? '达到整片 20 次 GPT 内部搜图上限；required 素材进入待审核，未静默降级'
          : '达到整片 20 次 GPT 内部搜图上限；preferred 素材已记录受控降级',
      };
    }
    remainingSearches -= allowed;
    return {
      ...plan,
      fallbackQueries: (plan.fallbackQueries || []).slice(0, Math.max(0, allowed - 1)),
      fallbackQuery: allowed > 1 ? (plan.fallbackQueries?.[0] || plan.fallbackQuery) : plan.query,
    };
  });
}

/** Recovers only fully closed plan objects from a response truncated mid-JSON. */
export function extractCompletePlans(output: string): Array<Partial<SmartImagePlan>> {
  const plansKey = output.search(/"plans"\s*:/);
  const arrayStart = plansKey >= 0 ? output.indexOf('[', plansKey) : -1;
  if (arrayStart < 0) return [];

  const plans: Array<Partial<SmartImagePlan>> = [];
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = arrayStart + 1; index < output.length; index++) {
    const char = output[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) objectStart = index;
      depth++;
      continue;
    }
    if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0 && objectStart >= 0) {
        try {
          const candidate = JSON.parse(output.slice(objectStart, index + 1)) as Partial<SmartImagePlan>;
          if (candidate && typeof candidate === 'object') plans.push(candidate);
        } catch {
          // A malformed completed object is ignored; missing frames use recovery or deterministic fallback.
        }
        objectStart = -1;
      }
    }
    if (char === ']' && depth === 0) break;
  }
  return plans;
}

/** Pure normalization and whole-film rhythm constraints, exported for tests. */
export function enforcePlanConstraints(
  frames: FrameOutline[],
  rawPlans: Array<Partial<SmartImagePlan>>,
  mode: SmartImageMode = 'balanced',
): SmartImagePlan[] {
  const byId = new Map(rawPlans.filter(item => typeof item.frameId === 'string').map(item => [item.frameId!, item]));
  const maxSelected = selectionLimit(frames.length, mode);
  const result: SmartImagePlan[] = [];
  let selected = 0;
  let consecutive = 0;

  for (const frame of frames) {
    const policy = classifyVisualAsset(frame);
    const fallback = fallbackPlan(frame, mode);
    const raw = { ...fallback, ...(byId.get(frame.id) || {}) };
    const request = raw.assetRequest || fallback.assetRequest;
    const restrictedEvent = hasRestrictedEvent(frame);
    const nativeVisual = isNativeVisual(frame);
    const blockedByPriority = frame.sceneSpec?.realImagePriority === 'never';
    const required = policy.fidelity === 'required' || request?.imageRequired === true;
    const eligibleRole = required || ['context', 'human-proof', 'physical-proof'].includes(frame.sceneSpec?.visualRole || fallbackRole(frame));
    const withinRhythm = required || (selected < maxSelected && consecutive < 2);
    const requested = Boolean(request) && isSearchable(raw.query);
    const useRealImage = requested && withinRhythm && !restrictedEvent && !blockedByPriority && (!nativeVisual || required)
      && eligibleRole && (prefersRealImage(frame) || required);

    if (useRealImage) {
      selected++;
      consecutive++;
    } else {
      consecutive = 0;
    }

    const fallbackQueries = normalizeFallbackQueries(raw, fallback);
    result.push({
      frameId: frame.id,
      useRealImage,
      priority: clampNumber(raw.priority, fallback.priority, 0, 100),
      reason: exclusionReason({ restrictedEvent, nativeVisual, eligibleRole, requested, withinRhythm, required, blockedByPriority }) || text(raw.reason, fallback.reason),
      purpose: text(raw.purpose, frame.sceneSpec?.imagePurpose || fallback.purpose),
      query: safeQuery(raw.query, fallback.query),
      fallbackQueries,
      fallbackQuery: fallbackQueries[0] || fallback.query,
      subject: text(raw.subject, fallback.subject),
      composition: layout(raw.composition),
      textPosition: raw.textPosition === 'right' ? 'right' : 'left',
      imageMotion: motion(raw.imageMotion, fallback.imageMotion),
      visualGroup: safeGroup(raw.visualGroup, fallback.visualGroup),
      deadlineMs: clampNumber(raw.deadlineMs, MODE_DEADLINES[mode], 2_000, 30_000),
      people: people(raw.people),
      subjects: subjects(raw.subjects, fallback.subjects),
      assetClass: policy.assetClass,
      fidelity: required ? 'required' : 'preferred',
      fallbackPolicy: policy.fallbackPolicy,
      assetRequest: request,
      requirement: frame.sceneSpec?.assetRequirement || policy.requirement,
      minimumVerification: policy.minimumVerification,
    });
  }
  return result;
}

export function selectionLimit(frameCount: number, mode: SmartImageMode): number {
  if (mode === 'fast') {
    if (frameCount <= 2) return 0;
    if (frameCount <= 4) return 0;
    if (frameCount <= 8) return 1;
    return Math.max(1, Math.ceil(frameCount * 0.2));
  }
  if (mode === 'asset-priority') {
    if (frameCount <= 4) return 1;
    if (frameCount <= 6) return 2;
    if (frameCount <= 8) return 3;
    return Math.max(2, Math.floor(frameCount * 0.45));
  }
  if (frameCount <= 2) return 0;
  if (frameCount <= 4) return 1;
  if (frameCount <= 6) return 2;
  if (frameCount <= 8) return 3;
  return Math.max(2, Math.round(frameCount / 3));
}

function fallbackPlans(frames: FrameOutline[], mode: SmartImageMode) {
  return frames.map(frame => fallbackPlan(frame, mode));
}

function fallbackPlan(frame: FrameOutline, mode: SmartImageMode): SmartImagePlan {
  const policy = classifyVisualAsset(frame);
  const role = frame.sceneSpec?.visualRole || fallbackRole(frame);
  const request = resolveAssetRequest(frame, policy.assetClass, policy.fidelity, role);
  const required = policy.fidelity === 'required' || request?.imageRequired === true;
  const use = Boolean(request) && frame.sceneSpec?.realImagePriority !== 'never'
    && !hasRestrictedEvent(frame) && (!isNativeVisual(frame) || required)
    && (prefersRealImage(frame) || required)
    && (required || ['context', 'human-proof', 'physical-proof'].includes(role));
  const query = request?.query || '';
  return {
    frameId: frame.id,
    useRealImage: use,
    priority: policy.fidelity === 'required' || frame.sceneSpec?.realImagePriority === 'required' ? 100 : frame.sceneSpec?.realImagePriority === 'preferred' ? 80 : 55,
    reason: use ? policy.reason : '该镜头更适合用 HTML 原生视觉表达。',
    purpose: request?.purpose || frame.sceneSpec?.imagePurpose || defaultPurpose(role, frame.title),
    query,
    fallbackQueries: request?.fallbackQueries || [],
    fallbackQuery: request?.fallbackQueries?.[0] || query,
    subject: frame.sceneSpec?.focus || frame.title,
    composition: 'editorial-split',
    textPosition: 'left',
    imageMotion: 'slow-push-in',
    visualGroup: safeGroup(role, 'general'),
    deadlineMs: MODE_DEADLINES[mode],
    people: undefined,
    subjects: defaultSubjects(frame, policy.assetClass, query),
    assetClass: policy.assetClass,
    fidelity: policy.fidelity === 'required' ? 'required' : 'preferred',
    fallbackPolicy: policy.fallbackPolicy,
    assetRequest: request,
    requirement: frame.sceneSpec?.assetRequirement || policy.requirement,
    minimumVerification: policy.minimumVerification,
  };
}

/**
 * New projects receive a full AssetRequest from the Director. This narrow
 * compatibility path recovers older real-image/high-fidelity scenes only when
 * a deterministic English query can be produced; abstract scenes still stay
 * native instead of receiving a generic stock-photo placeholder.
 */
function resolveAssetRequest(
  frame: FrameOutline,
  assetClass: SmartImagePlan['assetClass'],
  fidelity: 'required' | 'preferred' | 'native',
  role: string,
): AssetRequest | undefined {
  if (frame.sceneSpec?.realImagePriority === 'never') return undefined;
  const authored = frame.sceneSpec?.assetRequest;
  const gptOptimized = isGPTOptimizationEnabled();
  if (authored && isSearchable(authored.query)) {
    if (!gptOptimized || (authored.requiredTerms?.length || 0) > 0) return authored;
    return {
      ...authored,
      requiredTerms: tokenizeQuery(authored.query).slice(0, 2),
    };
  }
  const mayRecover = fidelity === 'required' || frame.sceneSpec?.assetStrategy === 'real-image';
  if (!mayRecover || fidelity === 'native') return undefined;
  const content = `${frame.title} ${frame.narration} ${frame.htmlPrompt || ''}`;
  const hintedQuery = frame.sceneSpec?.assetHints?.find(isSearchable);
  const query = safeQuery(hintedQuery, englishQuery(content, role));
  if (!isSearchable(query)) return undefined;
  if (gptOptimized && !hintedQuery && isGenericRecoveryQuery(query)) return undefined;
  return {
    query,
    fallbackQueries: [],
    requiredTerms: gptOptimized ? tokenizeQuery(query).slice(0, 2) : [],
    optionalTerms: tokenizeQuery(query).slice(0, 5),
    excludedTerms: [],
    subjectType: subjectTypeForAssetClass(assetClass),
    purpose: frame.sceneSpec?.imagePurpose || defaultPurpose(role, frame.title),
    imageRequired: fidelity === 'required' || frame.sceneSpec?.realImagePriority === 'required',
  };
}

function subjectTypeForAssetClass(assetClass?: string): AssetRequest['subjectType'] {
  if (assetClass === 'named-person' || assetClass === 'generic-person') return 'person';
  if (assetClass === 'place' || assetClass === 'architecture') return 'place';
  if (assetClass === 'product' || assetClass === 'natural-object') return 'equipment';
  return 'environment';
}

function tokenizeQuery(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) || [])];
}

function isGenericRecoveryQuery(value: string): boolean {
  return [
    'people working authentic documentary',
    'professional equipment physical detail',
    'modern workplace documentary scene',
  ].includes(value.trim().toLowerCase());
}

function prefersRealImage(frame: FrameOutline) {
  if (frame.sceneSpec?.assetStrategy === 'real-image') return true;
  if (frame.sceneSpec?.realImagePriority === 'never' || isNativeVisual(frame)) return false;
  return Boolean(frame.sceneSpec?.assetRequest);
}

function fallbackRole(frame: FrameOutline): string {
  const content = `${frame.title} ${frame.narration} ${frame.htmlPrompt || ''}`;
  if (/人物|员工|工人|医生|学生|家庭|团队|用户|顾客/.test(content)) return 'human-proof';
  if (/设备|机器|产品|实物|器材|建筑|空间|自然/.test(content)) return 'physical-proof';
  return frame.sceneSpec?.assetStrategy === 'real-image' ? 'context' : 'explain';
}

function isNativeVisual(frame: FrameOutline) {
  if (frame.sceneSpec?.assetStrategy === 'real-image') return false;
  const content = `${frame.title} ${frame.narration} ${frame.htmlPrompt || ''}`;
  return /标题|总结|结论|引用|图表|数据|流程|层级|因果|抽象概念|时间线|对比图|关系图/.test(content)
    || ['chart', 'typography', 'css-svg', 'icon'].includes(frame.sceneSpec?.assetStrategy || '')
    || ['explain', 'emphasis', 'transition'].includes(frame.sceneSpec?.visualRole || '');
}

function hasRestrictedEvent(frame: FrameOutline) {
  const content = `${frame.title} ${frame.narration} ${frame.htmlPrompt || ''}`;
  return /(?:新闻|发布会|事故|赛事|事件)[：:\s]*[\w\u4e00-\u9fff-]{2,}/i.test(content);
}

function englishQuery(value: string, role: string) {
  const mappings: Array<[RegExp, string]> = [
    [/CVT|无级变速|钢带|锥轮/i, 'CVT transmission pulley belt close up'],
    [/DCT|双离合/i, 'dual clutch transmission cutaway close up'],
    [/AT(?:自动)?变速箱|液力变矩器/i, 'automatic transmission torque converter close up'],
    [/发动机|活塞|曲轴|火花塞/i, 'car engine mechanical components close up'],
    [/变速箱|齿轮箱|汽车零部件/i, 'car transmission mechanical assembly close up'],
    [/圣诞老人|Santa(?:\s+Claus)?/i, 'Santa Claus red suit portrait'],
    [/可可豆荚/, 'cocoa pod isolated close up'],
    [/可口可乐|可乐|饮料/, 'Coca Cola bottle product'],
    [/药剂师|药房|实验室/, 'pharmacist laboratory'],
    [/发明|创始人|历史人物/, 'historical inventor portrait'],
    [/品牌|包装|瓶子/, 'beverage product packaging'],
    [/工厂|生产线/, 'beverage factory production line'],
    [/建筑|城市|街道/, 'city architecture documentary'],
  ];
  const mapped = mappings.find(([pattern]) => pattern.test(value));
  if (mapped) return mapped[1];
  const words = value.match(/[a-zA-Z]{3,}/g)?.slice(0, 8) || [];
  if (words.length >= 3) return words.join(' ').toLowerCase();
  if (role === 'human-proof') return 'people working authentic documentary';
  if (role === 'physical-proof') return 'professional equipment physical detail';
  return 'modern workplace documentary scene';
}

function defaultSubjects(frame: FrameOutline, assetClass: string, query: string): ImageSubjectPlan[] | undefined {
  const content = `${frame.title} ${frame.narration} ${frame.htmlPrompt || ''}`;
  const required = classifyVisualAsset(frame).fidelity === 'required';
  const authored = subjects(frame.sceneSpec?.assetSubjects);
  if (authored?.length) return authored;
  // Equal-weight driving scenarios need independent, side-by-side evidence.
  // A single generic gear-shifter photo cannot represent all three choices.
  if (/市区|城市|通勤/.test(content) && /长途|公路|烂路/.test(content)
    && /操控|赛道|驾驶乐趣/.test(content) && /CVT/i.test(content) && /AT/i.test(content) && /DCT/i.test(content)) {
    return [
      { name: 'city commute', kind: 'context', query: 'car driving urban traffic commute', fallbackQuery: 'city commuter car street', required: true },
      { name: 'highway travel', kind: 'context', query: 'car driving open highway travel', fallbackQuery: 'road trip car highway', required: true },
      { name: 'performance driving', kind: 'context', query: 'performance car driving race track', fallbackQuery: 'sports car track driving', required: true },
    ];
  }
  // Deterministic multi-object coverage for the common "source shape -> design"
  // pattern. The AI planner can supply richer subjects for other comparisons.
  if (/可可豆荚/.test(content) && /可口可乐|可乐|弧线瓶|瓶身/.test(content)) {
    return [
      { name: 'cocoa pod', kind: 'natural-object', query: 'cocoa pod isolated close up', fallbackQuery: 'cacao fruit pod side view', required: true },
      { name: 'Coca Cola contour bottle', kind: 'product', query: 'Coca Cola contour glass bottle isolated', fallbackQuery: 'vintage cola contour bottle product', required: true },
    ];
  }
  if (!required) return undefined;
  const kind = normalizeSubjectKind(assetClass);
  return [{ name: frame.sceneSpec?.focalElement || frame.title, kind, query, fallbackQuery: query, required: true }];
}

function normalizeSubjectKind(value: string): ImageSubjectPlan['kind'] {
  if (value === 'named-person' || value === 'generic-person') return 'person';
  if (value === 'product' || value === 'architecture' || value === 'natural-object' || value === 'place'
    || value === 'historical-scene' || value === 'artwork-document') return value;
  return 'context';
}

function defaultPurpose(role: string, title: string) {
  if (role === 'human-proof') return `证明人物正在经历或执行“${title}”`;
  if (role === 'physical-proof') return `呈现与“${title}”有关的真实物体或空间`;
  return `建立“${title}”发生的真实场景`;
}

function exclusionReason(input: { restrictedEvent: boolean; nativeVisual: boolean; eligibleRole: boolean; requested: boolean; withinRhythm: boolean; required: boolean; blockedByPriority: boolean }) {
  if (input.restrictedEvent) return '具体时效事件不使用无法验证现场的图库素材。';
  if (input.blockedByPriority) return '该镜头已明确禁用真实图片，固定采用 HTML 原生视觉。';
  if ((input.nativeVisual && !input.required) || !input.eligibleRole) return '本镜承担解释、强调或转场职责，固定采用 HTML 原生视觉。';
  if (!input.requested) return '';
  if (!input.withinRhythm) return '为保持全片视觉节奏，本镜采用 HTML 原生视觉。';
  return '';
}

function normalizeFallbackQueries(raw: Partial<SmartImagePlan>, fallback: SmartImagePlan): string[] {
  const values = [
    ...(Array.isArray(raw.fallbackQueries) ? raw.fallbackQueries : []),
    raw.fallbackQuery,
    ...fallback.fallbackQueries,
  ];
  return [...new Set(values.filter(isSearchable).map(value => safeQuery(value, fallback.query)))]
    .filter(value => value !== safeQuery(raw.query, fallback.query))
    .slice(0, 3);
}

function isSearchable(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9 ,'-]{3,160}$/.test(value.trim());
}
function safeQuery(value: unknown, fallback: string) {
  return isSearchable(value) ? value.trim().toLowerCase().replace(/\s+/g, ' ') : fallback;
}
function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : fallback;
}
function layout(value: unknown): RealImageAsset['layout'] {
  return value === 'full-bleed' || value === 'framed-focus' ? value : 'editorial-split';
}
function motion(value: unknown, fallback: SmartImagePlan['imageMotion']): SmartImagePlan['imageMotion'] {
  return value === 'slow-pan' || value === 'static' || value === 'slow-push-in' ? value : fallback;
}
function safeGroup(value: unknown, fallback: string) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{2,40}$/.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}
function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}
function people(value: unknown): PersonImagePlan[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<PersonImagePlan>;
    const name = text(candidate.name, '');
    const query = safeQuery(candidate.query, `${name} portrait`);
    if (!name || !isSearchable(query)) return [];
    return [{ name, query, fallbackQuery: safeQuery(candidate.fallbackQuery, `${name} headshot`) }];
  }).slice(0, 4);
  return result.length > 1 ? result : undefined;
}

function subjects(value: unknown, fallback?: ImageSubjectPlan[]): ImageSubjectPlan[] | undefined {
  if (!Array.isArray(value)) return fallback;
  const allowed = new Set<ImageSubjectPlan['kind']>(['person', 'product', 'architecture', 'natural-object', 'place', 'historical-scene', 'artwork-document', 'context']);
  const result = value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<ImageSubjectPlan>;
    const name = text(candidate.name, '');
    const kind = allowed.has(candidate.kind as ImageSubjectPlan['kind']) ? candidate.kind as ImageSubjectPlan['kind'] : 'context';
    if (!name || !isSearchable(candidate.query)) return [];
    return [{
      name,
      kind,
      query: safeQuery(candidate.query, ''),
      fallbackQuery: safeQuery(candidate.fallbackQuery, candidate.query),
      required: candidate.required !== false,
    }];
  }).slice(0, 4);
  if (!fallback?.length) return result.length ? result : undefined;
  if (fallback.length === 1 && result.length) {
    return result.map(item => ({ ...item, required: fallback[0].required || item.required })).slice(0, 4);
  }
  const merged = [...fallback];
  for (const item of result) {
    const index = merged.findIndex(existing => existing.name.toLowerCase() === item.name.toLowerCase());
    if (index >= 0) merged[index] = { ...merged[index], ...item, required: merged[index].required || item.required };
    else merged.push(item);
  }
  return merged.slice(0, 4);
}
