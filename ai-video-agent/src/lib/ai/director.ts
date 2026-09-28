import { callAIJson } from './client';
import type {
  CanvasPresetId,
  DirectorPlan,
  FrameOutline,
  Outline,
  SceneRelationship,
  SceneSpec,
} from '@/types';
import { isGPTOptimizationEnabled } from '@/lib/ai-key-context';
import { HTML_NATIVE_VISUAL_GUIDANCE } from '@/lib/prompts/html-native-visual';
import { withGPTVisualFreedom } from '@/lib/prompts/gpt-visual-freedom';
import { classifyVisualAsset } from './visual-asset-policy';
import { createFreeContentAnchor } from './content-anchor';
import { buildAdaptivePortraitDensityGuidance } from '@/lib/portrait-visual-system';

const FREE_VISUAL_DIRECTOR_TIMEOUT_MS = 120_000;

const RELATIONSHIPS: SceneRelationship[] = [
  'hook',
  'compare',
  'process',
  'hierarchy',
  'metric',
  'timeline',
  'quote',
  'cause',
  'spatial',
  'summary',
];

const UI_ACTIONS = [
  'highlight-anomaly',
  'open-detail',
  'filter',
  'expand-reason',
  'generate-suggestion',
  'confirm-execution',
] as const;

const DIRECTOR_SYSTEM = `你是一位视频编导，不是动画执行人员。你的任务是把已经完成的口播分镜转换为结构化场景意图。

核心规则：
- 口播决定节拍和顺序，素材与信息池决定画面密度。
- 每镜只聚焦一个想法；不要把整段旁白原样放到画面中。
- 每镜只能有一个视觉主角 focalElement；其他元素必须服务于它。
- revealStrategy 决定信息揭示：single 单观点、sequence 逐项、progressive 逐层、contrast 对照。
- composition 使用 establish / expand / conflict / turn / resolve，形成完整视觉句法。
- actionSemantics 必须来自内容：比较产生位移，流程产生状态推进，指标产生尺度变化，因果产生链式传递。
- assetStrategy 在 real-image / icon / chart / typography / css-svg 中选择；人物、地点、产品外观优先真实图片，数据优先图表，不要一律抽象动画。
- HTML 原生视觉不是默认选项。真实人物、历史人物、人物肖像、产品外观、包装、瓶子、设备、建筑、工厂、实验室、街道和真实历史场景，必须优先考虑 real-image；只有抽象关系、流程、数据结构、标题和结论才优先使用 chart、typography、icon 或 css-svg。
- 一部 8 镜头的视频通常规划 2-3 个真实图片镜头；不要因为是 HTML 模式就把所有镜头都归为 css-svg。
- visualRole 说明镜头的视觉职责：context / human-proof / physical-proof 才可进入真实素材候选；explain / emphasis / transition 必须使用 HTML 原生视觉。
- realImagePriority 使用 required / preferred / optional / never。图表、排版、CSS/SVG 和图标镜头必须为 never；real-image 通常为 preferred。
- imagePurpose 用一句中文说明真实图片若被采用，要承担什么叙事作用，而不是只说“作为背景”。
- 对 real-image 镜头，assetRequest 必须提供精确英文 query（3-10 个词）、fallbackQueries（1-3 个且不更泛）、requiredTerms（至少一个领域或主体词）、excludedTerms、subjectType、purpose 和 imageRequired。没有明确英文主体与场景时，不要编造 assetRequest，改用原生视觉。
- 品牌、型号、具体作品或具名建筑的外观不能由普通图库中的同类物冒充。若“身份/外观本身”是视觉主角，只允许请求可验证的精确素材，失败时退回不冒充身份的原生图解；若只是用同类实物建立场景，query、requiredTerms 和 purpose 必须改写为品类级语境，并明确图片“不代表旁白中的具体品牌或型号”。
- real-image 镜头若并列讲 2-4 个同等重要的真实人物、产品、零部件、地点或场景，必须在 assetSubjects 中逐项列出，每项给独立英文 query 和 fallbackQuery，required=true；最终画面会把这些图片等权并列。若旁白虽提到多个对象但 focalElement 明确只有一个重点，只列重点对象，不为陪衬对象凑图。
- assetSubjects 只描述必须分别检索并显示的具体主体，不要把标题、结论、抽象概念、同一物体的局部标签拆成多张图片。
- 识别内容关系，而不是提前指定 fade、zoom、rotate、clip-path 等具体动画或 CSS 手段。
- informationPool 应保留能支撑画面的数字、实体、案例、引用和因果关系，但不要自动把它们全部转成屏幕文字。
- screenText 默认使用空数组，因为分镜标题已经承担主要文字信息。只有不写就会产生歧义时，才放入一句完整结论或最多 1-2 个必要标签；微标签必须承担分类、状态、时间、数据口径或导航作用，不得用英文缩写填空、重复标题或重复旁白；不要把旁白拆成一串两三个字的短词。
- visualIntent 描述观众应该看懂什么，不描述技术实现。
- 全片共享一套 visualGrammar，但不同镜头可以依据内容采用不同构图。
- 禁止卡片墙、大段字幕、随机装饰、紫粉渐变、无意义漂浮和 emoji。
- 不要请求用户确认，不要输出解释文字。

relationship 只能是：hook / compare / process / hierarchy / metric / timeline / quote / cause / spatial / summary。

严格输出 JSON：
{
  "directorPlan": {
    "coreMessage": "整片唯一核心信息",
    "audience": "目标观众",
    "tone": "口吻",
    "pacing": "整体节奏",
    "visualGrammar": "跨镜头共享的构图和运动语法，不含具体颜色字体"
  },
  "frames": [
    {
      "index": 1,
      "sceneSpec": {
        "relationship": "hook",
        "focus": "本镜唯一焦点",
        "revealStrategy": "single",
        "focalElement": "唯一视觉主角",
        "composition": "establish",
        "actionSemantics": "动作如何表达内容关系",
        "assetStrategy": "typography",
        "visualRole": "emphasis",
        "realImagePriority": "never",
        "imagePurpose": "强化本镜唯一结论",
        "assetRequest": {
          "query": "offshore wind turbine maintenance technician",
          "fallbackQueries": ["wind turbine gearbox inspection"],
          "requiredTerms": ["wind", "turbine"],
          "optionalTerms": ["offshore", "maintenance"],
          "excludedTerms": ["office", "dental", "hospital"],
          "subjectType": "equipment",
          "purpose": "建立风机现场检修语境",
          "imageRequired": false
        },
        "assetSubjects": [
          {"name":"city commute","kind":"context","query":"car driving urban traffic","fallbackQuery":"city commuter car street","required":true},
          {"name":"highway travel","kind":"context","query":"car driving open highway","fallbackQuery":"road trip car highway","required":true}
        ],
        "informationPool": ["可视化事实或细节"],
        "visualIntent": "观众在这一镜应该看懂什么",
        "screenText": [],
        "assetHints": ["可选素材建议"],
        "durationHint": 6,
        "prohibitedPatterns": ["卡片墙", "emoji"]
      }
    }
  ]
}`;

interface RawDirectorResult {
  directorPlan?: Partial<DirectorPlan>;
  frames?: Array<{ index?: number; sceneSpec?: Partial<SceneSpec> }>;
}

export async function directHtmlOutline(
  outline: Outline,
  sourceMaterial: string,
  abortSignal?: AbortSignal,
  canvasPreset?: CanvasPresetId,
): Promise<Outline> {
  const raw = await callAIJson<RawDirectorResult>({
    stage: '编导规划',
    system: withGPTVisualFreedom(`${DIRECTOR_SYSTEM}\n${HTML_NATIVE_VISUAL_GUIDANCE}
SceneSpec 必须采用降维后的可绘制方案；assetHints 不得重新引入被省略的复杂物体、品牌 Logo 或特效。
你只能输出结构化 JSON，绝对不得生成 React、CSS、JavaScript 或其他可执行脚本。
业务数据界面可选择 renderMode="ui-scene"，仅可使用 overview/master-detail/workflow/ai-approval 四种骨架、固定动作和 JSON uiData；模拟数据必须设置 isDemoData=true。
真实素材并不等于 renderMode="image"：需要标题、标签、并列多图、关系线或示意标注时必须使用 renderMode="html"，并通过 assetStrategy="real-image" 嵌入素材；只有单张照片本身就能完整承担整屏叙事、无需 HTML 信息层时才使用 renderMode="image"。`, 'director'),
    user: buildDirectorPrompt(outline, sourceMaterial, canvasPreset),
    temperature: 0.55,
    maxRetries: 1,
    abortSignal,
  });
  return applyDirectorResult(outline, raw);
}

export function applyDirectorResult(outline: Outline, raw: RawDirectorResult): Outline {
  const byIndex = new Map(
    (raw.frames || [])
      .filter(item => Number.isFinite(item.index))
      .map(item => [Number(item.index), item.sceneSpec]),
  );

  return {
    ...outline,
    directorPlan: {
      coreMessage: cleanText(raw.directorPlan?.coreMessage, outline.title),
      audience: cleanText(raw.directorPlan?.audience, '对主题感兴趣的普通观众'),
      tone: cleanText(raw.directorPlan?.tone, '清晰、自然、有节奏'),
      pacing: cleanText(raw.directorPlan?.pacing, '开头迅速建立问题，中段展开，结尾收束'),
      visualGrammar: cleanText(raw.directorPlan?.visualGrammar, '以内容关系驱动画面变化，保持清晰层级'),
      layoutFamilies: cleanList(raw.directorPlan?.layoutFamilies, []).slice(0, 8),
      imagePlan: cleanOptionalText(raw.directorPlan?.imagePlan),
      uiScenePlan: cleanOptionalText(raw.directorPlan?.uiScenePlan),
      keyScenes: cleanList(raw.directorPlan?.keyScenes, []).slice(0, 8),
      quietScenes: cleanList(raw.directorPlan?.quietScenes, []).slice(0, 8),
      transitionRhythm: cleanOptionalText(raw.directorPlan?.transitionRhythm),
      styleRecommendation: cleanOptionalText(raw.directorPlan?.styleRecommendation),
    },
    frames: outline.frames.map(frame => ({
      ...frame,
      sceneSpec: normalizeSceneSpec(frame, byIndex.get(frame.index)),
    })),
  };
}

export function normalizeSceneSpec(
  frame: FrameOutline,
  raw?: Partial<SceneSpec>,
): SceneSpec {
  const relationship = RELATIONSHIPS.includes(raw?.relationship as SceneRelationship)
    ? raw!.relationship as SceneRelationship
    : inferRelationship(frame);
  const narrationSeconds = Math.max(3, Math.min(20, Math.round(frame.narration.length / 4.2)));
  const repairedRealImage = shouldRepairToRealImage(frame, relationship, raw);
  const assetStrategy = repairedRealImage
    ? 'real-image'
    : normalizeEnum(raw?.assetStrategy, ['real-image', 'icon', 'chart', 'typography', 'css-svg'], inferAssetStrategy(frame, relationship));
  const fallbackVisualRole = inferVisualRole(frame, relationship, assetStrategy);
  const visualRole = repairedRealImage
    ? fallbackVisualRole
    : normalizeEnum(raw?.visualRole, ['context', 'human-proof', 'physical-proof', 'explain', 'emphasis', 'transition'], fallbackVisualRole);
  const nativeOnly = assetStrategy !== 'real-image' || !['context', 'human-proof', 'physical-proof'].includes(visualRole);
  const assetPolicy = classifyVisualAsset({ ...frame, sceneSpec: { ...raw, assetStrategy } as SceneSpec });
  const imagePurpose = cleanText(raw?.imagePurpose, inferImagePurpose(visualRole, frame.title));
  const searchAction = nativeOnly ? undefined : normalizeSearchAction(raw?.searchAction, imagePurpose);
  const assetRequest = nativeOnly
    ? undefined
    : normalizeAssetRequest(raw?.assetRequest, imagePurpose) ?? searchActionToAssetRequest(searchAction);
  const assetSubjects = nativeOnly ? undefined : normalizeAssetSubjects(raw?.assetSubjects);
  const sanitizedUiData = raw?.renderMode === 'ui-scene' ? sanitizeUiData(raw.uiData) : undefined;
  const requestedUIScene = raw?.renderMode === 'ui-scene';
  const useUIScene = requestedUIScene && (!isGPTOptimizationEnabled()
    || Boolean(sanitizedUiData && Object.keys(sanitizedUiData).length));

  return {
    relationship,
    focus: cleanText(raw?.focus, frame.title),
    revealStrategy: normalizeEnum(raw?.revealStrategy, ['single', 'sequence', 'progressive', 'contrast'], relationship === 'compare' ? 'contrast' : 'single'),
    focalElement: cleanText(raw?.focalElement, raw?.focus || frame.title),
    composition: normalizeEnum(raw?.composition, ['establish', 'expand', 'conflict', 'turn', 'resolve'], inferComposition(frame, relationship)),
    actionSemantics: cleanText(raw?.actionSemantics, inferActionSemantics(relationship)),
    assetStrategy,
    informationPool: cleanList(raw?.informationPool, [frame.htmlPrompt || frame.narration]),
    // Do not promote a generic fallback sentence to a user-editable, highest-
    // priority prompt when visual planning is unavailable. The renderer can use
    // the structured scene data and narration instead.
    visualIntent: cleanText(raw?.visualIntent, frame.htmlPrompt || ''),
    screenText: cleanList(raw?.screenText, []).slice(0, 2),
    assetHints: cleanList(raw?.assetHints, []),
    durationHint: clampNumber(raw?.durationHint, narrationSeconds, 3, 20),
    prohibitedPatterns: cleanList(raw?.prohibitedPatterns, ['卡片墙', '大段字幕', 'emoji', '紫粉渐变', '随机装饰', '无意义漂浮']),
    visualRole,
    realImagePriority: assetPolicy.fidelity === 'required'
      ? 'required'
      : nativeOnly
      ? 'never'
      : normalizeEnum(raw?.realImagePriority, ['required', 'preferred', 'optional'] as const, 'preferred'),
    imagePurpose,
    assetRequest,
    searchAction,
    assetSubjects,
    assetRequirement: nativeOnly
      ? { attempt: 'never', failurePolicy: 'allow-native' }
      : assetPolicy.requirement,
    renderMode: useUIScene ? 'ui-scene' : normalizeEnum(requestedUIScene ? 'html' : raw?.renderMode, ['html', 'image'] as const, 'html'),
    uiArchetype: useUIScene
      ? normalizeEnum(raw?.uiArchetype, ['overview', 'master-detail', 'workflow', 'ai-approval'] as const, 'overview')
      : undefined,
    uiData: useUIScene ? sanitizedUiData : undefined,
    interactionSequence: useUIScene ? normalizeInteractions(raw?.interactionSequence) : undefined,
    uiSchemaVersion: useUIScene ? 1 : undefined,
    compositionTag: cleanOptionalText(raw?.compositionTag),
    visualType: normalizeOptionalEnum(raw?.visualType, ['diagram', 'photo', 'ui', 'typography', 'chart'] as const),
    isDemoData: useUIScene ? raw?.isDemoData !== false : undefined,
  };
}

/** A skill-inspired director pass for the isolated GPT-free workflow. */
export async function directFreeHtmlOutline(
  outline: Outline,
  sourceMaterial: string,
  abortSignal?: AbortSignal,
  canvasPreset?: CanvasPresetId,
): Promise<Outline> {
  const anchoredOutline = {
    ...outline,
    freeContentAnchor: createFreeContentAnchor(outline),
  };
  const system = `你是网页视频的自由创作总监。你要先确立整片独特的视觉母题、章节节奏和媒介变化，再为每个镜头给出可由 HTML/CSS/SVG/Canvas 实现的开放画面意图。不要使用固定布局、节点连线、卡片数量或元素预算；不要规划图片生成或任意外部访问。首镜是全片锚点，后续镜头应继承气质而不是复制构图。\n\n只输出结构化 JSON，字段必须兼容既有 directorPlan 与 frames[index, sceneSpec] 契约。`;
  const raw = await callAIJson<RawDirectorResult>({
    stage: 'GPT 自由视觉总监',
    system: `${system}\n\n【图库素材已解封】当镜头需要真实人物、品牌、产品、地点、历史档案或现实场景时，在 sceneSpec 中输出精确的 assetRequest、assetSubjects 或 searchAction(tool=search_visual_assets)。程序负责从图库检索、缓存和下载；你不下载、不生成图片，也不访问外部网址。`,
    user: `${buildDirectorPrompt(anchoredOutline, sourceMaterial, canvasPreset)}\n\n【自由模式】请让每一镜都有独立、可感知的视觉选择；内容计划仍由既有程序流程统一确认。`,
    temperature: 0.9,
    maxRetries: 1,
    // Free visual direction has to plan the complete film before any frame can
    // render. It routinely needs more than the relay's generic 75 s JSON budget.
    timeoutMs: FREE_VISUAL_DIRECTOR_TIMEOUT_MS,
    abortSignal,
  });
  const directed = applyDirectorResult(anchoredOutline, raw);
  const firstFrame = directed.frames[0];
  return {
    ...directed,
    freeCreativeBrief: {
      visualMotif: directed.directorPlan?.visualGrammar || directed.directorPlan?.coreMessage || outline.title,
      mediaStrategy: 'HTML / CSS / SVG / Canvas 原生组合；按章节改变媒介与构图，不使用外部图片素材。',
      chapterStrategy: directed.directorPlan?.keyScenes?.join('；') || '每章围绕一个信息转折建立独立画面语法。',
      rhythm: directed.directorPlan?.pacing || '开场建立张力，中段递进，结尾收束。',
    },
    freeFirstChapterAnchor: firstFrame ? {
      frameId: firstFrame.id,
      summary: [firstFrame.title, firstFrame.sceneSpec?.visualIntent || firstFrame.sceneSpec?.focalElement || firstFrame.htmlPrompt].filter(Boolean).join('：'),
    } : undefined,
    frames: directed.frames.map(frame => ({
      ...frame,
      sceneSpec: frame.sceneSpec ? { ...frame.sceneSpec, renderMode: 'html' } : frame.sceneSpec,
    })),
  };
}

function normalizeAssetSubjects(value: unknown): SceneSpec['assetSubjects'] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowedKinds = new Set(['person', 'product', 'architecture', 'natural-object', 'place', 'historical-scene', 'artwork-document', 'context']);
  const subjects = value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const name = cleanOptionalText(raw.name)?.slice(0, 80);
    const query = validEnglishQuery(raw.query) ? raw.query.trim().toLowerCase().replace(/\s+/g, ' ') : '';
    if (!name || !query) return [];
    const fallbackQuery = validEnglishQuery(raw.fallbackQuery)
      ? raw.fallbackQuery.trim().toLowerCase().replace(/\s+/g, ' ')
      : query;
    return [{
      name,
      kind: allowedKinds.has(String(raw.kind)) ? String(raw.kind) as NonNullable<SceneSpec['assetSubjects']>[number]['kind'] : 'context' as const,
      query,
      fallbackQuery,
      required: raw.required !== false,
    }];
  }).slice(0, 4);
  return subjects.length ? subjects : undefined;
}

function normalizeAssetRequest(value: unknown, fallbackPurpose: string): SceneSpec['assetRequest'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Partial<NonNullable<SceneSpec['assetRequest']>>;
  const query = validEnglishQuery(raw.query) ? raw.query.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  const requiredTerms = englishTerms(raw.requiredTerms);
  if (!query || !requiredTerms.length) return undefined;
  const fallbackQueries = Array.isArray(raw.fallbackQueries)
    ? raw.fallbackQueries.filter(validEnglishQuery).map(item => item.trim().toLowerCase().replace(/\s+/g, ' ')).filter(item => item !== query).slice(0, 3)
    : [];
  const subjectType = ['person', 'equipment', 'place', 'environment'].includes(raw.subjectType || '')
    ? raw.subjectType as NonNullable<SceneSpec['assetRequest']>['subjectType'] : 'environment';
  return {
    query, fallbackQueries, requiredTerms,
    optionalTerms: englishTerms(raw.optionalTerms),
    excludedTerms: englishTerms(raw.excludedTerms),
    subjectType,
    purpose: cleanText(raw.purpose, fallbackPurpose),
    imageRequired: raw.imageRequired === true,
  };
}

function normalizeSearchAction(value: unknown, fallbackPurpose: string): SceneSpec['searchAction'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.tool !== 'search_visual_assets' || !validEnglishQuery(raw.query)) return undefined;
  const subjectTypes = new Set(['person', 'equipment', 'place', 'environment']);
  const orientation = ['landscape', 'portrait', 'square'].includes(String(raw.orientation))
    ? raw.orientation as NonNullable<SceneSpec['searchAction']>['orientation']
    : undefined;
  return {
    tool: 'search_visual_assets',
    query: String(raw.query).trim().toLowerCase().replace(/\s+/g, ' '),
    purpose: cleanText(raw.purpose, fallbackPurpose),
    requiredTerms: englishTerms(raw.requiredTerms).slice(0, 8),
    avoidTerms: englishTerms(raw.avoidTerms).slice(0, 12),
    orientation,
    subjectType: subjectTypes.has(String(raw.subjectType))
      ? raw.subjectType as NonNullable<SceneSpec['searchAction']>['subjectType']
      : 'environment',
    sourcePriority: cleanList(raw.sourcePriority, ['project', 'pexels']).slice(0, 5),
    required: raw.required === true,
    maxResults: clampNumber(raw.maxResults, 8, 1, 8),
  };
}

function searchActionToAssetRequest(action: SceneSpec['searchAction']): SceneSpec['assetRequest'] | undefined {
  if (!action) return undefined;
  return {
    query: action.query,
    fallbackQueries: [],
    requiredTerms: action.requiredTerms,
    optionalTerms: [],
    excludedTerms: action.avoidTerms,
    subjectType: action.subjectType ?? 'environment',
    purpose: action.purpose,
    imageRequired: action.required,
  };
}

function validEnglishQuery(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const words = value.trim().match(/[a-z][a-z'-]*/gi) || [];
  return words.length >= 3 && words.length <= 10 && /^[a-z0-9 ,'-]+$/i.test(value.trim());
}

function englishTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(item => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(item => /^[a-z][a-z '-]{1,60}$/i.test(item)))].slice(0, 8);
}

function buildDirectorPrompt(outline: Outline, sourceMaterial: string, canvasPreset?: CanvasPresetId): string {
  const frames = outline.frames.map(frame => [
    `#${frame.index} ${frame.title}`,
    `旁白：${frame.narration}`,
    frame.htmlPrompt ? `已有画面意图：${frame.htmlPrompt}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  const research = outline.research
    ? `【已核实证据｜只能使用下列事实】\n${(outline.research.evidenceCards || [])
        .map(card => `${card.id} ${card.finding}（来源：${card.sourceIds.join('、')}，可信度：${card.confidence}）`)
        .join('\n') || '没有可用证据卡，避免展示具体数字、日期和参数。'}`
    : '';
  const canvas = canvasPreset === 'douyin-portrait-9-16'
    ? `9:16 竖屏独立构图。${buildAdaptivePortraitDensityGuidance(canvasPreset).trim()}`
    : '16:9 横屏。';
  const contentAnchor = outline.freeContentAnchor
    ? `【内容锚点（只防跑题，不规定章节、镜头或画面手法）】\n主题：${outline.freeContentAnchor.topic}\n核心主张：${outline.freeContentAnchor.coreMessage}\n所有画面都应服务于这个命题，不能用泛化科技意象替代具体内容。\n\n`
    : '';
  return `【原始需求或素材】\n${sourceMaterial.slice(0, 12_000)}\n\n${research}\n\n${contentAnchor}【视频】\n标题：${outline.title}\n预计时长：${outline.totalDuration} 秒\n画幅：${canvas}\n\n【口播分镜】\n${frames}`.slice(0, 30_000);
}

function inferRelationship(frame: FrameOutline): SceneRelationship {
  const text = `${frame.title} ${frame.narration}`;
  if (/对比|相比|但是|而是|差异|vs/i.test(text)) return 'compare';
  if (/步骤|首先|然后|最后|流程|阶段/.test(text)) return 'process';
  if (/时间|年份|过去|未来|演变|历程/.test(text)) return 'timeline';
  if (/数据|比例|倍|%|％|增长|下降|数字/.test(text)) return 'metric';
  if (/因为|因此|导致|所以|原因|结果|影响/.test(text)) return 'cause';
  if (/总结|所以|结论|记住/.test(text)) return 'summary';
  return frame.index === 1 ? 'hook' : 'spatial';
}

function inferComposition(frame: FrameOutline, relationship: SceneRelationship): SceneSpec['composition'] {
  if (frame.index === 1 || relationship === 'hook') return 'establish';
  if (relationship === 'compare' || relationship === 'cause') return 'conflict';
  if (relationship === 'summary') return 'resolve';
  return 'expand';
}

function inferActionSemantics(relationship: SceneRelationship): string {
  const semantics: Record<SceneRelationship, string> = {
    hook: '从空白中快速建立唯一问题', compare: '两方沿同一基线产生可比较位移',
    process: '状态沿明确路径逐步推进', hierarchy: '结构从主干向分支展开',
    metric: '数值通过尺度、长度或位置变化被感知', timeline: '事件沿时间轴依次抵达',
    quote: '引用成为唯一文字主角并保留呼吸空间', cause: '原因触发结果的链式传递',
    spatial: '对象通过相对位置建立空间关系', summary: '分散信息收束为一个结论',
  };
  return semantics[relationship];
}

function inferAssetStrategy(frame: FrameOutline, relationship: SceneRelationship): SceneSpec['assetStrategy'] {
  const text = `${frame.title} ${frame.narration} ${frame.htmlPrompt || ''}`;
  if (/人物|照片|地点|建筑|产品外观|实拍|发动机|变速箱|离合器|汽车零部件/.test(text) && relationship !== 'process') return 'real-image';
  if (relationship === 'metric' || relationship === 'compare') return 'chart';
  if (relationship === 'quote' || relationship === 'hook' || relationship === 'summary') return 'typography';
  if (/图标|符号|功能/.test(text)) return 'icon';
  return 'css-svg';
}

function shouldRepairToRealImage(frame: FrameOutline, relationship: SceneRelationship, raw?: Partial<SceneSpec>): boolean {
  if (raw?.assetStrategy === 'real-image') return true;
  if (relationship === 'metric' && !/产品|瓶|设备|建筑|人物|场景|工厂|实验室/.test(`${frame.title} ${frame.narration}`)) return false;
  const content = `${frame.title} ${frame.narration} ${frame.htmlPrompt || ''}`;
  if (relationship !== 'process' && relationship !== 'hook' && relationship !== 'summary'
    && /发动机|变速箱|离合器|液力变矩器|钢带|锥轮|齿轮箱|汽车零部件|机械总成/.test(content)) return true;
  return /人物|肖像|创始人|发明者|药剂师|医生|专家|产品|包装|瓶子|饮料|可乐|品牌|设备|机器|实物|建筑|工厂|实验室|街道|城市|地点|历史场景|真实场景|实拍|照片/.test(content);
}

function inferVisualRole(
  frame: FrameOutline,
  relationship: SceneRelationship,
  assetStrategy: SceneSpec['assetStrategy'],
): NonNullable<SceneSpec['visualRole']> {
  if (assetStrategy === 'typography') return 'emphasis';
  if (assetStrategy === 'icon') return relationship === 'hook' || relationship === 'summary' ? 'transition' : 'explain';
  if (assetStrategy === 'chart' || assetStrategy === 'css-svg') return 'explain';
  const content = `${frame.title} ${frame.narration} ${frame.htmlPrompt || ''}`;
  if (/人物|员工|工人|医生|学生|家庭|用户|顾客|团队|人群/.test(content)) return 'human-proof';
  if (/设备|机器|产品|实物|器材|建筑|空间|自然|发动机|变速箱|离合器|液力变矩器|钢带|锥轮|齿轮箱|汽车零部件/.test(content)) return 'physical-proof';
  return 'context';
}

function inferImagePurpose(role: NonNullable<SceneSpec['visualRole']>, title: string): string {
  if (role === 'human-proof') return `证明人物正在经历或执行“${title}”`;
  if (role === 'physical-proof') return `呈现与“${title}”有关的真实物体或空间`;
  if (role === 'context') return `建立“${title}”发生的真实场景`;
  if (role === 'emphasis') return `强化“${title}”的核心结论`;
  if (role === 'transition') return `承接“${title}”的章节节奏`;
  return `解释“${title}”中的关系与信息`;
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function cleanList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback.filter(Boolean);
  const result = value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean);
  return result.length ? result : fallback.filter(Boolean);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function normalizeOptionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : undefined;
}

function cleanOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sanitizeUiData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (/<script\b|\bfunction\b|=>|javascript:/i.test(serialized)) return {};
  return JSON.parse(serialized) as Record<string, unknown>;
}

function normalizeInteractions(value: unknown): SceneSpec['interactionSequence'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const step = item as Record<string, unknown>;
    const action = typeof step.action === 'string' ? step.action : '';
    if (!Number.isFinite(Number(step.atMs)) || Number(step.atMs) < 0) return [];
    if (!UI_ACTIONS.includes(action as typeof UI_ACTIONS[number])) return [];
    if (typeof step.target !== 'string' || !step.target.trim()) return [];
    return [{
      atMs: Math.round(Number(step.atMs)),
      action: action as typeof UI_ACTIONS[number],
      target: step.target.trim(),
      payload: sanitizeUiData(step.payload),
    }];
  }).sort((left, right) => left.atMs - right.atMs);
}
