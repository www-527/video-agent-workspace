import { callAIHtml, isVisionUnavailableError, type AIHtmlImageInput, type AIHtmlResult } from './client';
import type { CanvasPresetId, DirectorPlan, FrameOutline, GPTVisualBible, Outline, RealImageAsset, ThemeTokens, VisualAnchor, VisualContract, VisionImageReview } from '@/types';
import { normalizeSceneSpec } from './director';
import {
  HTML_NATIVE_VISUAL_GUIDANCE,
  buildHtmlRenderQualityGuidance,
} from '@/lib/prompts/html-native-visual';
import { enforceProtectedLayout, stripLegacyAutoFitGuard } from '@/lib/layout-safety';
import { deriveChartSpec, materializeDeterministicChart, type ChartSpec } from '@/lib/charts/chart-engine';
import { hasForbiddenMapHtmlVisual, NO_MAP_VISUAL_RULE } from '@/lib/ai/visual-constraints';
import { getProtectedLayout } from '@/lib/layout-geometry';
import { canvasPromptSummary, getCanvasPreset } from '@/lib/canvas-presets';
import { buildAdaptivePortraitDensityGuidance } from '@/lib/portrait-visual-system';
import { readLocalPexelsImageInput } from '@/lib/pexels/local-asset';
import { MAX_CODEX_TEST_IMAGES_PER_MESSAGE, MAX_CODEX_TEST_REQUEST_IMAGE_BYTES } from './codex-test-images';

export function buildStructuredLayoutConstraints(canvasPreset?: CanvasPresetId | string | null): string {
  const preset = getCanvasPreset(canvasPreset);
  const layout = getProtectedLayout(canvasPreset);
  const splitText = layout.split.text;
  const splitVisual = layout.split.visual;
  const relationshipLayout = preset.id === 'douyin-portrait-9-16'
    ? 'Let content relationships determine composition: comparison uses top/bottom contrast, process/cause/timeline use top-to-bottom progression, hierarchy places the root above its children, and data uses a centered scale change.'
    : 'Let content relationships determine composition: comparison uses left/right contrast, process uses horizontal progression, and data uses scale change.';
  const minimumType = preset.id === 'douyin-portrait-9-16'
    ? 'Body text is at least 26px; titles are at least 56px; necessary short labels are at least 20px.'
    : 'Body text is at least 24px; titles are at least 48px.';
  return `
## Structured layout contract (mandatory)
- Canvas is exactly ${layout.canvas.width} x ${layout.canvas.height} (${preset.aspectRatio}). The subtitle-safe area is y=${layout.subtitle.top}..${layout.subtitle.bottom}; all authored scene content must end at y=${layout.content.bottom} or above.
- The root <main> must choose exactly one protected layout with data-layout="split" or data-layout="stack". Do not invent a third coordinate system.
- Both zones must be direct children of <main>: <section data-role="text-zone"> and <section data-role="visual-zone">. Never place callouts, labels, SVG lines, or decorative objects outside these two zones.
- visual-zone must contain exactly one non-animated wrapper marked data-role="visual-content". Put the complete visual composition inside it; do not position visual objects as direct children of visual-zone.
- split layout is fixed: text-zone x=${splitText.left}..${splitText.left + splitText.width}, y=${splitText.top}..${splitText.top + splitText.height}; visual-zone x=${splitVisual.left}..${splitVisual.left + splitVisual.width}, y=${splitVisual.top}..${splitVisual.top + splitVisual.height}. Keep the inter-zone gutter empty.
- stack layout has a protected adaptive handoff: both zones use x=${layout.stack.left}..${layout.stack.left + layout.stack.width}; visual-zone ends at y=${layout.content.bottom} and its top is chosen from y=${layout.stack.visualTopMin}..${layout.stack.visualTopMax} after measuring the actual text bottom plus a ${layout.stack.gap}px gutter. Compose for the smallest ${layout.content.bottom - layout.stack.visualTopMax}px visual height, but use the extra space when the title ends high. A stack title may use at most two lines.
- Zone positions are enforced by the application. Design every child in local coordinates relative to its own zone; never use viewport coordinates to bridge zones.
- The application also owns each protected zone's box model: text-zone and visual-zone always have padding:0 and margin:0. Put intentional breathing room on an inner content wrapper or its children; never depend on zone padding for alignment.
- Keep every child inside its parent zone. SVG viewBox, connector lines, pseudo-elements, translated elements, and absolute labels may not cross a zone edge. Before finalizing, calculate the rendered title's actual wrapped line count, line-height, and any parent padding against the zone height. If content does not fit, simplify secondary elements or reduce type only down to the stated minimum—never crop readable text.
- visual-content itself must remain width:100%; height:100%; transform:none. It is a stable local coordinate container, so animate descendants instead of visual-content.
- Intentional overlap inside visual-zone is allowed when multiple parts visibly combine into one semantic object (for example screen + bezel + stand = one monitor). Wrap that object in a single container marked data-role="composite" and keep all overlapping parts inside it.
- A composite may overlap its own non-text parts, but may not cover readable text, unrelated labels, another semantic object, the inter-zone gutter, or the subtitle-safe area. Accidental overlap remains forbidden.
- Use composites only for low-complexity objects with at most 8 primitive parts, at most 2 primitive shape families, and one local overlap layer. If recognizability depends on a complex contour, precise mechanical proportions, or a real-world identity, do not approximate it with a larger composite: simplify to a diagram/chart/UI or use a verified real image.
- Mark every purely decorative element with <div data-role="decoration">. Decoration must remain below the text layer and may never cross the text zone.
- Any independently adjustable timeline, divider, horizontal rule, axis, or connector must be a real element with its own stable data-editor-id and data-editor-label. Mark connector-only overlay containers and SVGs with data-role="connector" and pointer-events:none; keep meaningful nodes and labels outside that overlay. Never draw such an element only with a parent border, box-shadow, ::before, or ::after pseudo-element; those cannot be selected in the editor.
- Separate semantic objects by at least 24px. A full-width conclusion strip must occupy its own grid/flex row and may not share the same y band with comparison cards, labels, charts, or images. When space is tight, remove secondary labels or use stack layout instead of overlapping content.
- ${minimumType} Never solve overflow by shrinking text.
- 中文标题排版协议：标题最多两行；不得把“的、与、和、及、并、或”等虚词或连接词单独放在行首或行尾。必须按完整语义短语断行，禁止按字符数硬折行。
- 两行标题的视觉宽度应接近：短行至少达到长行约 60%；若不能满足，改为“引子 + 核心短语 + 补充信息”的三层标题，或缩小辅助行，不得把整句同级放大。核心短语最大，辅助文字缩小。
- 标题块（含行高与内边距）不得超过 text-zone 可用高度的 70%，并为 visual-zone 留出明确呼吸空间；不得用 overflow 裁切、ellipsis 或极小字号解决标题溢出。使用 text-wrap: balance 或 text-wrap: pretty，并配合固定 max-width。
- 标题强调色只能用于一个完整关键词或完整语义词组，且必须使用 themeTokens.colors.accent（映射后的 accent CSS Token）；其余标题文字使用 foreground。禁止随机换色，也不得只突出无意义的单个汉字。
- Use one visual protagonist only. Mark its outermost stable container data-role="focal" and give that container a stable data-editor-id. Do not use random absolute placement or meaningless floating shapes.
- Use one background color, one body-text color, and one accent color. Prefer editorial whitespace and a single focal point.
- Never lower opacity on a container that contains readable text. Keep text and its ancestors at opacity:1; express hierarchy with an explicit readable color, and apply transparency only to decoration, strokes, or backgrounds.
- ${relationshipLayout}
- Process, timeline, hierarchy, and cause nodes must be aligned by one Grid/Flex container with explicit gap and shared rows/columns. Never arrange semantic nodes with unrelated absolute/fixed coordinates. Absolute positioning is reserved for a bounded connector overlay inside visual-content.
- Avoid card walls, purple-pink gradients, emoji, random circles, and simultaneous fade-in of every element.
- Animation must reveal information. Do not use z-index to hide an accidental collision; only parts of the same data-role="composite" may intentionally layer over one another.
- Do not use GSAP, anime.js, D3, external animation libraries, CDN scripts, or any undefined global libraries. Use only inline CSS keyframes and plain JavaScript.
- When supplied real image assets are present, use every local /api/data/pexels/ path in an <img> inside visual-zone. Keep alt text, preserve aspect ratio, and never replace a supplied person portrait with a work, building, or CSS imitation.
- When multiple supplied assets are labelled as named people, render one equally prominent portrait per person in a clean row or grid. Do not use initials, blank cards, or a single work image in place of people.
- A real-image visual-zone must keep every supplied image as a visible primary layer. Small semantic overlays, masks, color transitions, comparison dividers, and lightweight SVG/CSS annotations are allowed when they are necessary to express the scene action, but they must not obscure the subject. Keep long text and the main title in text-zone.
`;
}

export const STRUCTURED_LAYOUT_CONSTRAINTS = buildStructuredLayoutConstraints();

const HTML_GENERATION_ATTEMPTS = 3;
const MIN_HTML_LENGTH = 300;
const COMPACT_HTML_TARGET = '7000-10000';
const FREE_FRAME_UPSTREAM_RETRY_DELAY_MS = 350;
const FREE_FRAME_SOURCE_EXCERPT_MAX_CHARS = 600;
const FREE_FRAME_PROMPT_TEXT_MAX_CHARS = 280;

interface LocalRealImageInputResult {
  inputs: Map<string, AIHtmlImageInput>;
  omitted: Array<{ photoId: number; reason: 'not-local' | 'unavailable' | 'budget' }>;
}

export const FRAME_HTML_SYSTEM = `你是一位网页动画视频设计工程师。你需要根据结构化编导意图，为视频的单个分镜设计一段 HTML 动画。

## 输入
- 全局脚本
- 视觉风格（用户选择或默认）
- 当前分镜的标题、旁白、画面提示词
- 整片编导计划与当前镜头 SceneSpec
- 已确认的 VisualAnchor（如有）

## 输入优先级
- “用户当前画面提示词”是本次生成的最高优先级内容要求，必须保留它的核心语义；但不得因此违反 HTML 原生画面翻译规则和稳定美观渲染协议
- 如果用户当前画面提示词与旧 SceneSpec、整片编导计划或已有画面冲突，以用户当前画面提示词为准
- 不得沿用与用户当前画面提示词冲突的旧构图、旧对象或旧屏幕文字

## 输出要求
- 只输出完整 HTML 文档，从 <!DOCTYPE html> 开始，到 </html> 结束
- 不要 Markdown，不要代码围栏，不要解释文字，不要 JSON
- 不要输出思考过程、分析、设计说明或草稿；直接输出最终 HTML
- HTML 文档必须是完整可独立运行的（含 <!DOCTYPE html>）
- 用 HTML + CSS + JS（内联）实现动画；可用 SVG、Canvas
- 动画必须在输入给定的时长内完成，结束后保持最终状态
- 文字要大（标题 ≥ 48px，正文 ≥ 24px），主色对比强
- 适配视频画面（16:9，宽 1280px，高 720px）
- 不要使用任何外部 CDN 或外部资源（除 inline）
- 不要使用 alert/prompt/confirm
- 不循环动画，不依赖用户点击，不使用随机数；同样输入应得到可重复播放的结果
- 颜色、字体和基础气质严格服从视觉风格；构图和运动服从 SceneSpec 的内容关系
- 先寻找内容的内在动作：比较用空间对照，流程用状态推进，数字用尺度或计数变化，层级用结构展开；只有找不到内在动作时才使用简单入场
- informationPool 用于增加画面细节，但不得把整段旁白原样铺到屏幕上
- 分镜标题是默认的主要屏幕文字；sceneSpec.screenText 为空时不得擅自补充短词。screenText 非空时也只显示其中真正必要的内容，不再派生额外标签；禁止大段正文、碎片短词堆叠、无意义装饰、emoji、紫粉渐变模板和圆角彩边卡片堆叠
- 允许少量具有分类、状态、时间、数据口径或导航作用的中英文微标签，但每镜最多 2 个，并标记 data-role="micro-label"；不得用英文缩写填空、重复标题或重复旁白。图例、坐标轴、数据单位和必要表头不属于微标签
- 每个可独立编辑的可见元素都必须有稳定且唯一的 data-editor-id 和易懂的 data-editor-label（同一分镜重新生成时语义相同的元素沿用 ID）；组合事物的根容器同时标记 data-role="composite"。不要给 main、text-zone、visual-zone 或 visual-content 标记为可编辑元素
- assetStrategy=real-image 时只建立清晰的真实素材占位区，不得用 CSS 轮廓冒充人物、地点或产品
- 真实图片不是装饰背景，必须承担输入中的 purpose；构图遵守 layout，运动遵守 imageMotion，并与文字区建立明确的信息关系
- full-bleed 仅用于简单宽场景并把文字放在安全空白侧；editorial-split 必须让信息区与图片区分栏；framed-focus 用于人物、设备或局部实体并保持主体完整
- 严格执行 revealStrategy、focalElement、composition 和 actionSemantics；每镜只有一个视觉主角，其最外层稳定容器必须标记 data-role="focal" 和稳定的 data-editor-id

## 严格 HTML 输出
<!DOCTYPE html>
<html>
...
</html>
`;

export function buildFrameHtmlSystem(canvasPreset?: CanvasPresetId | string | null): string {
  const preset = getCanvasPreset(canvasPreset);
  return FRAME_HTML_SYSTEM.replace(
    '- 适配视频画面（16:9，宽 1280px，高 720px）',
    `- 适配视频画面（${preset.aspectRatio}，宽 ${preset.design.width}px，高 ${preset.design.height}px）\n- 构图提示：${canvasPromptSummary(canvasPreset)}`,
  );
}

export function formatCurrentVisualPrompt(currentVisualPrompt: string): string {
  const prompt = currentVisualPrompt.trim() || '请根据当前分镜内容设计画面';
  return `【用户当前画面提示词（最高内容优先级，必须保留核心语义）】\n${prompt}\n若它与下面的旧结构化信息冲突，忽略冲突部分并按这条提示词重新设计画面；若它包含写实、复杂或不可稳定绘制的表现形式，必须按 HTML 原生规则降维翻译，不得字面照画。`;
}

export async function generateFrameHtml(opts: {
  globalScript: string;
  stylePrompt: string;
  frame: FrameOutline;
  directorPlan?: DirectorPlan;
  durationSeconds?: number;
  themeTokens?: ThemeTokens;
  visualAnchor?: VisualAnchor;
  visualContract?: VisualContract;
  canvasPreset?: CanvasPresetId;
  realImage?: RealImageAsset;
  realImages?: RealImageAsset[];
  visionReview?: VisionImageReview;
  /** Keep image-assisted and native fallback generations inside one request budget. */
  allowNativeImageFallback?: boolean;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const { globalScript, stylePrompt, frame, directorPlan } = opts;
  const currentVisualPrompt = frame.htmlPrompt?.trim() || '';
  const sceneSpec = normalizeSceneSpec(frame, currentVisualPrompt
    ? {
        ...frame.sceneSpec,
        visualIntent: currentVisualPrompt,
        informationPool: [currentVisualPrompt],
      }
    : frame.sceneSpec);
  const durationSeconds = Math.max(3, Math.min(30, opts.durationSeconds || sceneSpec.durationHint));
  const realImages = opts.realImages?.length ? opts.realImages : opts.realImage ? [opts.realImage] : [];
  const realImageInputResult = await loadLocalRealImageInputs(realImages);
  const realImageInputs = realImageInputResult.inputs;
  const buildBaseUserPrompt = (images: RealImageAsset[]) => {
    const realImagePrompt = images.length ? `\n\n【已提供真实图片（优先使用）】\n${images.map((image, index) => `${index + 1}. 路径：${image.localPath}\n   alt：${image.alt || 'Pexels image'}\n   叙事用途：${image.purpose || frame.sceneSpec?.imagePurpose || '建立真实场景参照'}\n   构图：${image.layout}；文字位置：${image.layout === 'full-bleed' ? '放在画面安全空白侧' : '独立 text-zone'}；object-fit: ${image.fitMode}\n   运动：${image.imageMotion || 'slow-push-in'}；scale ${image.scaleFrom} to ${image.scaleTo}；视觉组：${image.visualGroup || 'general'}`).join('\n')}\n每个给定路径必须出现在 visual-zone 内各自的 <img> 中，并用构图、文字关系或前后动作兑现其叙事用途；不得把图片仅作为无意义背景。不得使用任何外部图片 URL、不得替换为其他图片。允许为表达转变、对比和时间推进而添加少量遮罩、颜色层、分隔线或轻量 SVG/CSS 标注，但不得遮住图片主体；主标题和长文字仍放在 text-zone。若这些是人物介绍，请让每张肖像具有同等视觉权重，禁止用作品图、建筑图、首字母卡片或空白卡片代替人物。${buildVisionCompositionGuidance(opts.visionReview)}${buildVisionInputFallbackNote(images, realImageInputResult)}` : '';
    const fallbackNote = !images.length && realImages.length
      ? '\n\n【素材降级】给定图片版本未通过生成或校验，本次改用 HTML 原生视觉。不得编造或替换成其他真实人物、产品、地点或时效现场。'
      : '';
    return `【全局脚本】\n${globalScript}\n\n【整片编导计划】\n${JSON.stringify(directorPlan || {}, null, 2)}\n\n【视觉风格】\n${stylePrompt}\n\n【主题 Token】\n${JSON.stringify(opts.themeTokens || {}, null, 2)}\n\n【已确认 VisualAnchor】\n${JSON.stringify(opts.visualAnchor || {}, null, 2)}\n锚点只统一字体、色彩、留白、标签和动作气质，不复制旧镜头构图。\n\n【当前分镜】\n标题：${frame.title}\n旁白：${frame.narration}\n实际可用时长：${durationSeconds.toFixed(2)} 秒\n\n${formatCurrentVisualPrompt(currentVisualPrompt)}\n\n【本次 SceneSpec】\n${JSON.stringify(sceneSpec, null, 2)}${realImagePrompt}${fallbackNote}\n\n请按系统提示词要求，只输出完整 HTML 文档。必须从 <!DOCTYPE html> 开始，到 </html> 结束。不要 JSON，不要 Markdown，不要代码围栏，不要解释文字。`;
  };

  let lastError: unknown;
  let lastRaw = '';
  let lastFinishReason: string | null = null;
  let compactMode = false;
  let useNativeFallback = false;
  for (let attempt = 1; attempt <= HTML_GENERATION_ATTEMPTS; attempt++) {
    const activeImages = useNativeFallback ? [] : realImages;
    const userPrompt = buildHtmlAttemptPrompt({
      baseUserPrompt: buildBaseUserPrompt(activeImages),
      attempt,
      lastError,
      lastRaw,
      lastFinishReason,
      compactMode,
    });
    let result: AIHtmlResult;
    try {
      result = await callAIHtml({
        stage: 'HTML 生成',
        system: `${buildFrameHtmlSystem(opts.canvasPreset)}\n${HTML_NATIVE_VISUAL_GUIDANCE}\n${buildHtmlRenderQualityGuidance(opts.canvasPreset)}\n${buildStructuredLayoutConstraints(opts.canvasPreset)}\n${NO_MAP_VISUAL_RULE}`,
        user: userPrompt,
        temperature: compactMode ? 0.35 : 0.45,
        maxRetries: 0,
        allowEmptyOutput: true,
        traceAttempt: attempt,
        traceMaxAttempts: HTML_GENERATION_ATTEMPTS,
        abortSignal: opts.abortSignal,
        images: activeImages.flatMap(image => realImageInputs.get(image.localPath) || []),
        requiresVision: activeImages.some(image => realImageInputs.has(image.localPath)),
      });
    } catch (error) {
      lastError = error;
      console.warn(`[HTML generation] call attempt ${attempt}/${HTML_GENERATION_ATTEMPTS} failed`, error);
      if (opts.abortSignal?.aborted) throw error;
      if (realImages.length && opts.allowNativeImageFallback !== false && attempt >= 2) useNativeFallback = true;
      continue;
    }
    lastRaw = result.output;
    lastFinishReason = result.finishReason;
    if (isLengthLimitedEmptyHtmlResult(result)) {
      lastError = new HtmlValidationError([
        `AI HTML output was empty because the model hit the output limit (finish_reason=${result.finishReason}, reasoning.length=${result.reasoningLength}).`,
        'Retry with compact HTML mode instead of repeating the same long generation.',
      ]);
      compactMode = true;
      console.warn(`[HTML generation] length-limited empty output on attempt ${attempt}/${HTML_GENERATION_ATTEMPTS}; switching to compact HTML mode`);
      continue;
    }
    try {
      const chartSpec = deriveChartSpec(sceneSpec, frame.title, currentVisualPrompt);
      return prepareGeneratedHtml(result.output, activeImages, chartSpec, opts.canvasPreset);
    } catch (error) {
      lastError = error;
      if (result.lengthLimited) compactMode = true;
      console.warn(`[HTML generation] validation attempt ${attempt}/${HTML_GENERATION_ATTEMPTS} failed finish_reason=${result.finishReason ?? 'unknown'} output.length=${result.outputLength}`, error);
      if (opts.abortSignal?.aborted) throw error;
      // Give the image-assisted composition one repair attempt with the exact
      // validation error. Falling back after the first miss made localized
      // candidates visible in the editor but impossible to use in the frame.
      if (realImages.length && opts.allowNativeImageFallback !== false && attempt >= 2) useNativeFallback = true;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('HTML 生成失败');
}

/** GPT-free projects trade the standard editor geometry for creative latitude. */
export const FREE_FRAME_HTML_SYSTEM = `你是电影感网页视频的创意总监兼前端动画设计师。为单个视频镜头直接创作大胆、独特、内容驱动的网页画面。

先理解当前旁白的关系、张力、尺度变化或转折，再决定最合适的媒介、构图、信息密度与运动语言。画面必须真正演示内容，避免模板化卡片墙、默认流程图、无意义装饰和“标题加几块安全卡片”的答案。允许自由使用 HTML、CSS、SVG、Canvas、排版、模拟 UI、抽象图形与动画。若输入提供了本地真实素材，必须在画面中使用这些指定路径；不得下载、搜索、生成或替换图片。

旁白决定节拍，信息池与原始素材决定画面细节。屏幕只展示最值得放大的内容，不复写整段旁白。相邻镜头应有可感知的尺度、媒介、构图或节奏变化，但不得为了变化添加无语义元素。允许少量具有分类、状态、时间、数据口径或导航作用的中英文微标签，但每镜最多 2 个，并标记 data-role="micro-label"；不得用英文缩写填空、重复标题或重复旁白。图例、坐标轴、数据单位和必要表头不属于微标签。

运行底线：输出完整独立 HTML（<!DOCTYPE html> 到 </html>）；用 main 承载整镜画面；画布为输入尺寸；底部字幕安全区不得放置关键内容；不得使用外部 URL、CDN、联网 API、随机数、弹窗或用户交互；不得使用循环动画或计时轮询；动画在给定时长内完成并保持终态。为主画面根元素和需要独立检查或编辑的关键语义元素添加稳定、唯一的 data-editor-id 与 data-editor-label；这些属性只是审计钩子，不规定标签结构、布局方式或对象数量。不要输出解释、Markdown 或代码围栏。`;

export function buildFreeFrameHtmlSystem(canvasPreset?: CanvasPresetId | string | null): string {
  return `${FREE_FRAME_HTML_SYSTEM}${buildAdaptivePortraitDensityGuidance(canvasPreset)}`;
}

export interface FreeFrameHtmlOptions {
  globalScript: string;
  frame: FrameOutline;
  directorPlan?: DirectorPlan;
  visualBible: GPTVisualBible;
  contentAnchor?: Outline['freeContentAnchor'];
  firstFrameVisualAnchor?: Outline['freeFirstChapterAnchor'];
  sourceMaterial?: string;
  creativeBrief?: Record<string, unknown>;
  visualAnchor?: VisualAnchor;
  neighboringScenes?: Array<{ index?: number; title: string; visualIntent?: string }>;
  durationSeconds?: number;
  canvasPreset?: CanvasPresetId;
  realImages?: RealImageAsset[];
  visionReview?: VisionImageReview;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}

export function buildFreeFrameHtmlPrompt(opts: FreeFrameHtmlOptions): string {
  const canvas = getCanvasPreset(opts.canvasPreset);
  const duration = Math.max(3, Math.min(30, opts.durationSeconds || opts.frame.sceneSpec?.durationHint || 8));
  const informationPool = opts.frame.sceneSpec?.informationPool || [];
  const realImages = opts.realImages || [];
  const sourceExcerpt = selectRelevantSourceExcerpt(
    opts.sourceMaterial || '',
    opts.frame,
    informationPool,
    FREE_FRAME_SOURCE_EXCERPT_MAX_CHARS,
  );
  const neighboringContext = buildFreeFrameNeighboringContext(opts.frame.index, opts.neighboringScenes || []);
  const narrativeContext = buildFreeFrameNarrativeContext(opts);
  const scriptContext = buildFreeFrameScriptContext(opts.globalScript, opts.frame.index);
  const visualDirection = buildCompactFreeVisualDirection(opts.visualBible);
  const visualAnchor = buildCompactVisualAnchor(opts.visualAnchor);
  const sceneSpec = opts.frame.sceneSpec;
  const screenText = sceneSpec?.screenText?.length ? `\n屏幕文字：${sceneSpec.screenText.join(' / ')}` : '';
  return [
    narrativeContext,
    scriptContext,
    visualDirection,
    visualAnchor,
    opts.firstFrameVisualAnchor
      ? `【首镜画面锚点】\n${opts.firstFrameVisualAnchor.summary}\n保持可辨识的视觉连续性，但不要复制首镜的对象、布局或表面构图。`
      : '',
    neighboringContext,
    `【当前镜头】\n标题：${opts.frame.title}\n旁白：${opts.frame.narration}\n画面提示词：${compactFreeFrameText(opts.frame.htmlPrompt || sceneSpec?.visualIntent || '由旁白自行寻找最有张力的视觉表达')}\n内容关系：${sceneSpec?.relationship || '由内容判断'}\n动作语义：${compactFreeFrameText(sceneSpec?.actionSemantics || '由内容判断')}\n关键事实：${informationPool.slice(0, 4).map(compactFreeFrameText).join('；') || '无额外事实'}${screenText}\n时长：${duration.toFixed(2)} 秒；画布：${canvas.design.width}×${canvas.design.height} (${canvas.aspectRatio})；普通内容结束于 y=${canvas.contentArea.bottom} 前，字幕区 y=${canvas.subtitleArea.top}–${canvas.subtitleArea.bottom}。`,
    realImages.length ? `【已提供的真实素材】\n${realImages.map((image, index) => `${index + 1}. 本地路径：${image.localPath}\n   内容：${image.alt || 'Pexels image'}\n   叙事用途：${image.purpose || opts.frame.sceneSpec?.imagePurpose || '建立真实场景参照'}\n   建议裁切：object-fit ${image.fitMode}；构图 ${image.layout}`).join('\n')}\n每个指定路径都必须作为画面内的 <img> 使用，并以裁切、层次、标注或运动兑现叙事用途；不得将它们替换成外部 URL 或无意义背景。${buildVisionCompositionGuidance(opts.visionReview)}` : '',
    sourceExcerpt ? `【原始素材相关片段】\n${sourceExcerpt}` : '',
    '请直接输出最终 HTML。保留真正服务叙事的复杂度，让本镜形成清晰、完整且独特的视觉句子。',
  ].filter(Boolean).join('\n\n');
}

/** Keep the regeneration prompt focused on only the cross-shot constraints that affect this frame. */
function buildFreeFrameNarrativeContext(opts: FreeFrameHtmlOptions): string {
  const coreMessage = opts.contentAnchor?.coreMessage
    || opts.directorPlan?.coreMessage
    || textRecordValue(opts.creativeBrief, 'coreMessage');
  const topic = opts.contentAnchor?.topic || opts.frame.title;
  return `【叙事锚点】\n主题：${compactFreeFrameText(topic)}\n核心主张：${compactFreeFrameText(coreMessage || opts.frame.narration)}\n当前镜必须服务于此，不用泛化科技意象替代具体内容。`;
}

/**
 * Preserve the current beat's narrative position without sending an unbounded
 * long-form script. Project scripts are structured as [#N] title: narration.
 */
function buildFreeFrameScriptContext(globalScript: string, frameIndex: number): string {
  const beats = globalScript.split(/\r?\n/).map(line => line.trim()).filter(line => /^\[#\d+\]/.test(line));
  if (!beats.length) return '';

  const currentIndex = beats.findIndex(line => line.startsWith(`[#${frameIndex}]`));
  const fallbackIndex = Math.max(0, Math.min(beats.length - 1, frameIndex > 0 ? frameIndex - 1 : 0));
  const position = (currentIndex >= 0 ? currentIndex : fallbackIndex) + 1;

  // The current beat is already present below and the adjacent beats are
  // summarized separately. Repeating every narration line in every frame made
  // the common 6-12 shot case grow quadratically without adding new guidance.
  return `【全片位置】\n当前为第 ${position}/${beats.length} 镜；承接前镜并推进到后镜，不复用其他镜头的表面构图。`;
}

/** The raw Visual Bible repeats token values in both JSON and prose; transmit each constraint once. */
function buildCompactFreeVisualDirection(visualBible: GPTVisualBible): string {
  visualBible.tokens ??= {
    colors: { background: '#0f172a', surface: '#1e293b', foreground: '#f8fafc', muted: '#94a3b8', accent: '#8b5cf6', accentSecondary: '#22d3ee' },
    typography: { display: 'system-ui', body: 'system-ui', mono: 'ui-monospace', titleSize: '64px', bodySize: '24px' },
    spacing: { safeArea: '8%', gap: '24px' },
    shape: { radius: '24px', borderWidth: '1px' },
    motion: { duration: '700ms', easing: 'ease-out', stagger: '80ms' },
    signature: 'clean editorial motion design',
  };
  visualBible.prohibitedProblems ??= (visualBible as any).prohibitions || [];
  visualBible.rhythm ??= (visualBible as any).pacing || 'steady';
  const { colors, typography, spacing, shape, motion, signature } = visualBible.tokens;
  return [
    '【设计令】',
    `主题：${visualBible.themeId}；视觉语言：${compactFreeFrameText(visualBible.visualLanguage)}`,
    `颜色：背景 ${colors.background}，前景 ${colors.foreground}，强调 ${colors.accent}；字体：标题 ${typography.display} ${typography.titleSize}，正文 ${typography.body} ${typography.bodySize}`,
    `空间：安全区 ${spacing.safeArea}，间距 ${spacing.gap}，圆角 ${shape.radius}；动作：${motion.duration} / ${motion.easing} / ${motion.stagger}`,
    `气质：${compactFreeFrameText(signature)}；母题：${visualBible.motifs.slice(0, 2).map(compactFreeFrameText).join('、') || '无'}；节奏：${compactFreeFrameText(visualBible.rhythm)}`,
    `禁用：${visualBible.prohibitedProblems.slice(0, 6).map(compactFreeFrameText).join('、') || '无'}。保持风格一致，但当前镜自行选择媒介与构图。`,
  ].join('\n');
}

function buildCompactVisualAnchor(anchor?: VisualAnchor): string {
  if (!anchor?.themeId) return '';
  return `【已确认视觉锚点】\n主题：${anchor.themeId}；标题：${compactFreeFrameText(anchor.titleTreatment)}；留白：${anchor.whitespaceRatio}；动作：${anchor.motionTempo}；禁用：${anchor.prohibitedPatterns.slice(0, 5).map(compactFreeFrameText).join('、')}。只继承气质，不复制既有构图。`;
}

function textRecordValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function compactFreeFrameText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, FREE_FRAME_PROMPT_TEXT_MAX_CHARS);
}

export async function generateFreeFrameHtml(opts: FreeFrameHtmlOptions): Promise<string> {
  const realImages = opts.realImages || [];
  const realImageInputResult = await loadLocalRealImageInputs(realImages);
  const realImageInputs = realImageInputResult.inputs;
  const user = `${buildFreeFrameHtmlPrompt(opts)}${buildVisionInputFallbackNote(realImages, realImageInputResult)}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    throwIfFreeFrameAborted(opts.abortSignal);
    try {
      const result = await callAIHtml({
        stage: 'GPT 自由视觉生成', system: buildFreeFrameHtmlSystem(opts.canvasPreset), user,
        temperature: 0.85, maxRetries: 0, abortSignal: opts.abortSignal, timeoutMs: opts.timeoutMs,
        images: [...realImageInputs.values()],
        requiresVision: realImageInputs.size > 0,
      });
      throwIfFreeFrameAborted(opts.abortSignal);
      const html = extractHtmlDocument(result.output);
      validateFreeGeneratedHtml(html);
      const sanitized = sanitizeFreeHtml(html);
      validateFreeGeneratedHtml(sanitized);
      for (const realImage of realImages) validateRealImageUsage(sanitized, realImage);
      return sanitized;
    } catch (error) {
      if (attempt === 1 || !isRecoverableFreeFrameUpstreamError(error, opts.abortSignal)) throw error;
      await waitForFreeFrameRetryDelay(opts.abortSignal);
    }
  }
  throw new Error('GPT 自由视觉生成失败');
}

function buildFreeFrameNeighboringContext(
  frameIndex: number,
  neighboringScenes: Array<{ title: string; visualIntent?: string; index?: number }>,
): string {
  const summarized = neighboringScenes
    .filter(scene => scene.title.trim())
    .map(scene => ({
      index: scene.index,
      title: scene.title.trim(),
      visualIntent: scene.visualIntent?.trim() || '未提供',
    }));
  const previous = summarized
    .filter(scene => typeof scene.index === 'number' && scene.index < frameIndex)
    .sort((left, right) => (right.index ?? -Infinity) - (left.index ?? -Infinity))[0];
  const next = summarized
    .filter(scene => typeof scene.index === 'number' && scene.index > frameIndex)
    .sort((left, right) => (left.index ?? Infinity) - (right.index ?? Infinity))[0];
  const fallback = summarized.filter(scene => typeof scene.index !== 'number');
  const before = previous || fallback.shift();
  const after = next || fallback.shift();
  if (!before && !after) return '';
  const format = (scene: { title: string; visualIntent: string }) => JSON.stringify({ title: scene.title, visualIntent: scene.visualIntent });
  return `【前后镜头摘要】\n${before ? `前镜：${format(before)}` : ''}${before && after ? '\n' : ''}${after ? `后镜：${format(after)}` : ''}\n只继承必要的叙事连续性，不复制相邻镜头的表面构图。`;
}

function isRecoverableFreeFrameUpstreamError(error: unknown, abortSignal?: AbortSignal): boolean {
  if (abortSignal?.aborted || isAbortError(error) || isVisionUnavailableError(error) || error instanceof HtmlValidationError) return false;
  const statuses: number[] = [];
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) messages.push(current.message);
    else messages.push(String(current));
    if (typeof current === 'object' && current) {
      const value = current as { status?: unknown; statusCode?: unknown; message?: unknown; error?: { message?: unknown; status?: unknown }; response?: { status?: unknown }; cause?: unknown };
      for (const status of [value.status, value.statusCode, value.error?.status, value.response?.status]) {
        const numericStatus = typeof status === 'number' ? status : Number(status);
        if (Number.isInteger(numericStatus)) statuses.push(numericStatus);
      }
      if (typeof value.message === 'string') messages.push(value.message);
      if (typeof value.error?.message === 'string') messages.push(value.error.message);
      current = value.cause;
    } else {
      current = undefined;
    }
  }
  if (statuses.some(status => status >= 400 && status < 500)) return false;
  if (statuses.some(status => [502, 503, 504].includes(status))) return true;
  return /bad gateway|gateway[\s-]*time(?:out|-out)|service unavailable|(?:temporary|transient).*(?:upstream|network)|(?:upstream|network).*(?:failure|error|unavailable|reset|timeout|timed out)|\b(?:econnreset|econnrefused|epipe|socket hang up|fetch failed)\b/i.test(messages.join('\n'));
}

function isAbortError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && current) {
      const value = current as { name?: unknown; code?: unknown; cause?: unknown };
      if (value.name === 'AbortError' || value.code === 'ABORT_ERR') return true;
      current = value.cause;
    } else {
      current = undefined;
    }
  }
  return false;
}

async function waitForFreeFrameRetryDelay(abortSignal?: AbortSignal): Promise<void> {
  throwIfFreeFrameAborted(abortSignal);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(cleanupAndResolve, FREE_FRAME_UPSTREAM_RETRY_DELAY_MS);
    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(abortSignal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    };
    function cleanup(): void {
      abortSignal?.removeEventListener('abort', onAbort);
    }
    function cleanupAndResolve(): void {
      cleanup();
      resolve();
    }
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

function throwIfFreeFrameAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) throw abortSignal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

export function buildHtmlAttemptPrompt(opts: {
  baseUserPrompt: string;
  attempt: number;
  lastError: unknown;
  lastRaw: string;
  lastFinishReason: string | null;
  compactMode: boolean;
}): string {
  if (opts.attempt === 1) return opts.baseUserPrompt;
  const titleRetryFeedback = `\n标题重排要求：\n- 重排中文标题，禁止连接词悬挂。\n- 保持核心短语完整。\n- 将标题层级调整为引子/核心/补充，而非整句同级放大。\n- 强调色回归当前主题的 accent。\n- 标题无法容纳时先重排，不要缩小到难以阅读。`;
  const validationErrors = `${formatHtmlValidationError(opts.lastError)}${titleRetryFeedback}`;
  if (opts.compactMode) {
    return `${opts.baseUserPrompt}\n\n【紧凑 HTML 模式】\n上一次生成触发了模型输出上限或正文为空。不要复用冗长实现，重新输出一个更短但完整的 HTML 文档。\n\n本地/模型错误：\n${validationErrors}\n\n紧凑要求：\n- 目标总长度 ${COMPACT_HTML_TARGET} 字符以内。\n- 直接输出最终 HTML，不要思考过程、解释、Markdown 或 JSON。\n- 保留 <section data-role="text-zone"> 和 <section data-role="visual-zone">。\n- 使用一个 <style> 块和少量 HTML 结构；优先 CSS 几何、渐变、计数器或简单 SVG。\n- JavaScript 可省略；如必须使用，只写极短的原生脚本。\n- 不写注释，不写长文本，不堆叠复杂 SVG path，不引入外部资源。\n- 画面仍需表达当前分镜核心意图和一个视觉主角。\n\n只输出完整 HTML 文档，从 <!DOCTYPE html> 开始，到 </html> 结束。`;
  }
  const truncated = validationErrors.includes('</html>') && !isNormalFinishReason(opts.lastFinishReason);
  const canRepair = opts.attempt >= 3 && hasExplicitDoctype(opts.lastRaw) && !truncated;
  if (canRepair) {
    return `${opts.baseUserPrompt}\n\n【修复模式】\n上一次 HTML 已经有明确的 <!DOCTYPE html> 开头，但没有通过本地校验。请在保留原有视觉设计意图的前提下补全和修复为一个完整 HTML 文档。\n\n本地校验错误：\n${validationErrors}\n\n上一次 HTML 片段：\n${opts.lastRaw}\n\n只输出修复后的完整 HTML 文档，从 <!DOCTYPE html> 开始，到 </html> 结束。不要 JSON，不要 Markdown，不要解释文字。`;
  }
  const retryReason = truncated
    ? '上一次输出疑似被截断，直接重新生成完整文档，不要尝试补丁式续写。'
    : '上一次输出没有通过本地校验，请重新生成完整文档。';
  return `${opts.baseUserPrompt}\n\n【重试要求】\n${retryReason}\n本地校验错误：\n${validationErrors}\n\n只输出完整 HTML 文档，从 <!DOCTYPE html> 开始，到 </html> 结束。不要 JSON，不要 Markdown，不要代码围栏，不要解释文字。`;
}

function prepareGeneratedHtml(raw: string, realImages: RealImageAsset[] = [], chartSpec?: ChartSpec | null, canvasPreset?: CanvasPresetId): string {
  const html = extractHtmlDocument(raw);
  validateGeneratedHtml(html);
  const charted = materializeDeterministicChart(html, chartSpec);
  const sanitized = sanitizeHtml(charted, canvasPreset);
  validateGeneratedHtml(sanitized);
  for (const realImage of realImages) validateRealImageUsage(sanitized, realImage);
  const slotted = bindRealImageSlots(sanitized, realImages);
  validateGeneratedHtml(slotted);
  return slotted;
}

export function validateRealImageUsage(html: string, realImage: Pick<RealImageAsset, 'localPath' | 'alt'>): void {
  if (!realImage.localPath.startsWith('/api/data/pexels/')) {
    throw new HtmlValidationError(['Real image path must be a local /api/data/pexels/ resource.']);
  }
  const escaped = realImage.localPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const visualZone = html.match(/<section\b[^>]*data-role=["']visual-zone["'][^>]*>[\s\S]*?<\/section>/i)?.[0] || '';
  const imageTag = visualZone.match(new RegExp(`<img\\b[^>]*src=["']${escaped}["'][^>]*>`, 'i'))?.[0];
  if (!imageTag) {
    throw new HtmlValidationError(['HTML must use the supplied local real image inside visual-zone.']);
  }
  const alt = imageTag.match(/\balt\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim();
  if (!alt) {
    throw new HtmlValidationError(['Real image must include a non-empty alt attribute.']);
  }
}

/** Returns supplied assets that the final HTML did not actually reference. */
export function findUnappliedRealImages(
  html: string | undefined,
  realImages: Array<Pick<RealImageAsset, 'localPath' | 'alt'>>,
): Array<Pick<RealImageAsset, 'localPath' | 'alt'>> {
  return realImages.filter(image => !html?.includes(image.localPath));
}

/** Adds application-owned stable slot ids without changing model-authored layout. */
export function bindRealImageSlots(html: string, realImages: Array<Pick<RealImageAsset, 'localPath'>>): string {
  if (!realImages.length) return html;
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const index = realImages.findIndex(image => tag.includes(image.localPath));
    if (index < 0) return tag;
    return setTagAttribute(tag, 'data-asset-slot', realImageSlotId(index));
  });
}

/**
 * Replaces only the image source and alt bound to one stable asset slot. The
 * surrounding HTML, CSS and animation stay byte-for-byte unchanged.
 */
export function replaceRealImageSlot(
  html: string,
  slotIndex: number,
  expectedLocalPath: string,
  replacement: Pick<RealImageAsset, 'localPath' | 'alt'>,
): string {
  const slotId = realImageSlotId(slotIndex);
  let replaced = false;
  const next = html.replace(/<img\b[^>]*>/gi, tag => {
    const slotMatch = readTagAttribute(tag, 'data-asset-slot') === slotId;
    const legacyPathMatch = tag.includes(expectedLocalPath);
    if (!slotMatch && !legacyPathMatch) return tag;
    if (slotMatch && readTagAttribute(tag, 'src') !== expectedLocalPath) {
      throw new HtmlValidationError([`HTML asset slot ${slotId} no longer points to the expected local image.`]);
    }
    replaced = true;
    return setTagAttribute(
      setTagAttribute(
        setTagAttribute(tag, 'src', replacement.localPath),
        'alt',
        replacement.alt || 'Pexels image',
      ),
      'data-asset-slot',
      slotId,
    );
  });
  if (!replaced) throw new HtmlValidationError([`HTML asset slot ${slotId} no longer exists.`]);
  return next;
}

/**
 * Activates localized candidates in a legacy/native frame that never created
 * model-authored image slots. The original semantic visual remains in the DOM
 * but is hidden inside the visual zone, so the operation is deterministic,
 * reversible through normal history, and safe for one-to-four equal subjects.
 */
export function applyRealImageGallery(html: string, realImages: RealImageAsset[]): string {
  if (!realImages.length) return html;
  const assets = realImages.slice(0, 4);
  let next = html
    .replace(/<style\b[^>]*\bdata-ai-real-image-gallery\b[^>]*>[\s\S]*?<\/style>\s*/gi, '')
    .replace(/<img\b[^>]*\bdata-asset-slot=["']real-image-\d+["'][^>]*>\s*/gi, '');
  const style = `<style data-ai-real-image-gallery>
[data-role="visual-content"][data-ai-real-image-gallery="true"]{display:grid!important;grid-template-columns:repeat(${assets.length},minmax(0,1fr))!important;grid-template-rows:minmax(0,1fr)!important;gap:${assets.length > 1 ? 16 : 0}px!important;overflow:hidden!important;align-items:stretch!important;transform:none!important}
[data-role="visual-content"][data-ai-real-image-gallery="true"]>:not(img[data-asset-slot]){display:none!important}
[data-role="visual-content"][data-ai-real-image-gallery="true"]>img[data-asset-slot]{display:block!important;position:relative!important;inset:auto!important;width:100%!important;height:100%!important;min-width:0!important;max-width:100%!important;max-height:100%!important;margin:0!important;border:0!important;border-radius:12px;object-position:center;opacity:1!important;visibility:visible!important;transform:none!important}
</style>`;
  next = /<\/head>/i.test(next) ? next.replace(/<\/head>/i, `${style}</head>`) : `${style}${next}`;
  const visualContent = /<([a-z][\w:-]*)\b[^>]*\bdata-role=["']visual-content["'][^>]*>/i;
  let found = false;
  next = next.replace(visualContent, tag => {
    found = true;
    const opening = setAnyTagAttribute(setAnyTagAttribute(tag, 'data-ai-real-image-gallery', 'true'), 'data-ai-gallery-count', String(assets.length));
    const images = assets.map((asset, index) => `<img data-asset-slot="${realImageSlotId(index)}" data-editor-id="real-image-${index + 1}" data-editor-label="${escapeHtmlAttribute(asset.alt || `真实图片 ${index + 1}`)}" src="${escapeHtmlAttribute(asset.localPath)}" alt="${escapeHtmlAttribute(asset.alt || 'Pexels image')}" style="object-fit:${asset.fitMode}" loading="eager" draggable="false">`).join('');
    return `${opening}${images}`;
  });
  if (!found) throw new HtmlValidationError(['HTML visual-content container no longer exists.']);
  return next;
}

/**
 * Removes every application-owned real-image slot without leaving a broken or
 * empty visual area. Gallery overlays reveal the native visual that was kept
 * underneath. Model-authored image slots are replaced with restrained
 * typographic subjects so cancelling a picture remains a valid video frame.
 */
export function removeRealImageAssets(
  html: string,
  realImages: Array<Pick<RealImageAsset, 'alt'>>,
): string {
  const galleryApplied = /data-ai-real-image-gallery=["']true["']/i.test(html);
  let removed = 0;
  let next = html
    .replace(/<style\b[^>]*\bdata-ai-real-image-gallery\b[^>]*>[\s\S]*?<\/style>\s*/gi, '')
    .replace(/<style\b[^>]*\bdata-ai-real-image-fallback\b[^>]*>[\s\S]*?<\/style>\s*/gi, '');

  next = next.replace(/<img\b[^>]*\bdata-asset-slot=["']real-image-(\d+)["'][^>]*>\s*/gi, (_tag, value: string) => {
    const slotIndex = Math.max(0, Number(value) - 1);
    removed++;
    if (galleryApplied) return '';
    const label = compactFallbackLabel(realImages[slotIndex]?.alt || `视觉主体 ${slotIndex + 1}`);
    return `<div data-ai-real-image-fallback="true" data-editor-id="real-image-fallback-${slotIndex + 1}" data-editor-label="${escapeHtmlAttribute(label)}"><span>${escapeHtmlText(label)}</span></div>`;
  });
  if (!removed) throw new HtmlValidationError(['HTML real-image slots no longer exist.']);

  next = next.replace(/<([a-z][\w:-]*)\b[^>]*\bdata-role=["']visual-content["'][^>]*>/i, tag => (
    removeAnyTagAttribute(removeAnyTagAttribute(tag, 'data-ai-real-image-gallery'), 'data-ai-gallery-count')
  ));

  if (!galleryApplied) {
    const style = `<style data-ai-real-image-fallback>
[data-ai-real-image-fallback="true"]{display:grid!important;place-items:center!important;position:relative!important;inset:auto!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;max-width:100%!important;max-height:100%!important;padding:clamp(18px,3vw,44px)!important;overflow:hidden!important;border:1px solid color-mix(in srgb,currentColor 22%,transparent)!important;border-radius:14px!important;background:linear-gradient(145deg,color-mix(in srgb,currentColor 8%,transparent),transparent 58%)!important;transform:none!important;opacity:1!important;visibility:visible!important}
[data-ai-real-image-fallback="true"]::before{content:"";position:absolute;inset:10%;border-block:1px solid color-mix(in srgb,currentColor 14%,transparent);pointer-events:none}
[data-ai-real-image-fallback="true"]>span{position:relative;max-width:14ch;text-align:center;font-size:clamp(18px,2.5vw,34px);font-weight:650;line-height:1.15;letter-spacing:-.02em;overflow-wrap:anywhere}
</style>`;
    next = /<\/head>/i.test(next) ? next.replace(/<\/head>/i, `${style}</head>`) : `${style}${next}`;
  }
  return next;
}

export function realImageSlotId(slotIndex: number): string {
  return `real-image-${slotIndex + 1}`;
}

function readTagAttribute(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
}

function setTagAttribute(tag: string, name: string, value: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\s${escapedName}\\s*=\\s*(["']).*?\\1`, 'i');
  const attribute = ` ${name}="${escapeHtmlAttribute(value)}"`;
  return pattern.test(tag) ? tag.replace(pattern, attribute) : tag.replace(/^<img\b/i, match => `${match}${attribute}`);
}

function setAnyTagAttribute(tag: string, name: string, value: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\s${escapedName}\\s*=\\s*(["']).*?\\1`, 'i');
  const attribute = ` ${name}="${escapeHtmlAttribute(value)}"`;
  return pattern.test(tag) ? tag.replace(pattern, attribute) : tag.replace(/>$/, `${attribute}>`);
}

function removeAnyTagAttribute(tag: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.replace(new RegExp(`\\s${escapedName}\\s*=\\s*(["']).*?\\1`, 'i'), '');
}

function compactFallbackLabel(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return (compact || '视觉主体').slice(0, 48);
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function loadLocalRealImageInputs(realImages: RealImageAsset[]): Promise<LocalRealImageInputResult> {
  const inputs = new Map<string, AIHtmlImageInput>();
  const omitted: LocalRealImageInputResult['omitted'] = [];
  let totalBytes = 0;

  for (const image of realImages) {
    if (inputs.has(image.localPath)) continue;
    if (!image.localPath.startsWith('/api/data/pexels/')) {
      omitted.push({ photoId: image.photoId, reason: 'not-local' });
      continue;
    }
    try {
      const input = await readLocalPexelsImageInput(image.localPath);
      const byteLength = input.byteLength || estimateImageInputBytes(input.dataUrl);
      if (inputs.size >= MAX_CODEX_TEST_IMAGES_PER_MESSAGE
        || totalBytes + byteLength > MAX_CODEX_TEST_REQUEST_IMAGE_BYTES) {
        omitted.push({ photoId: image.photoId, reason: 'budget' });
        continue;
      }
      inputs.set(image.localPath, { ...input, label: `photoId=${image.photoId}` });
      totalBytes += byteLength;
    } catch (error) {
      // Text metadata remains available to the existing HTML path. Do not log
      // the transient data URL or turn a missing local file into a hard block.
      console.warn('[HTML vision input] local image unavailable', {
        photoId: image.photoId,
        message: error instanceof Error ? error.message : String(error),
      });
      omitted.push({ photoId: image.photoId, reason: 'unavailable' });
    }
  }
  return { inputs, omitted };
}

function buildVisionInputFallbackNote(
  images: RealImageAsset[],
  result: LocalRealImageInputResult,
): string {
  const imageIds = new Set(images.map(image => image.photoId));
  const omitted = result.omitted.filter(item => imageIds.has(item.photoId));
  if (!omitted.length) return '';
  const budgetCount = omitted.filter(item => item.reason === 'budget').length;
  const unavailableCount = omitted.length - budgetCount;
  const reasons = [
    budgetCount ? `${budgetCount} 个素材超出图片输入预算` : '',
    unavailableCount ? `${unavailableCount} 个素材暂时无法读取` : '',
  ].filter(Boolean).join('，');
  const ids = omitted.map(item => `photoId=${item.photoId}`).join('、');
  return `\n\n【图片输入回退】${reasons}（${ids}）。这些素材仍以程序提供的本地路径和元数据为准；必须继续使用指定路径，不得改用外部 URL、其他图片或伪造主体。`;
}

function estimateImageInputBytes(dataUrl: string): number {
  const encoded = dataUrl.split(',', 2)[1] || '';
  return Math.floor(encoded.length * 0.75);
}

function buildVisionCompositionGuidance(review?: VisionImageReview): string {
  if (!review) return '';
  return `\n\n【视觉复选构图建议（软建议）】
主体匹配：${review.subjectMatch}；主体位置：${review.subjectPosition || 'mixed'}；安全文字留白：${review.safeTextSide || 'none'}；裁切风险：${review.cropRisk}。
可据此安排 text-zone 与 visual-zone 的关系，但不得放宽受保护安全区、真实性、来源和“必须使用指定本地路径”的硬约束。视觉复选只帮助相关性和构图适配，不证明人物身份、产品真伪或事实真实性。`;
}

export class HtmlValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('\n'));
    this.name = 'HtmlValidationError';
  }
}

export function extractHtmlDocument(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new HtmlValidationError(['HTML output is empty.']);
  if (/^\s*[\[{]/.test(trimmed) && /"html"\s*:/.test(trimmed)) {
    throw new HtmlValidationError(['HTML generation must return a raw HTML document, not a JSON object.']);
  }

  let text = trimmed;
  const fenced = text.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1].trim();

  const startMatch = /<!DOCTYPE\s+html\b|<html\b/i.exec(text);
  if (!startMatch) {
    throw new HtmlValidationError(['HTML document must start with <!DOCTYPE html> or <html>.']);
  }
  const start = startMatch.index;
  const lower = text.toLowerCase();
  const endTag = '</html>';
  const end = lower.lastIndexOf(endTag);
  if (end < start) {
    throw new HtmlValidationError(['HTML document is incomplete: missing </html>.']);
  }
  return text.slice(start, end + endTag.length).trim();
}

export function validateGeneratedHtml(html: string): void {
  const errors: string[] = [];
  if (html.trim().length < MIN_HTML_LENGTH) {
    errors.push(`HTML document is too short (${html.trim().length} chars).`);
  }
  if (!/<!DOCTYPE\s+html\b/i.test(html)) {
    errors.push('HTML document must contain <!DOCTYPE html>.');
  }
  if (!/<html\b/i.test(html)) {
    errors.push('HTML document must contain <html>.');
  }
  if (!/<\/html>/i.test(html)) {
    errors.push('HTML document must contain </html>.');
  }
  if (!/data-role=["']text-zone["']/i.test(html)) {
    errors.push('HTML document must contain data-role="text-zone".');
  }
  if (!/data-role=["']visual-zone["']/i.test(html)) {
    errors.push('HTML document must contain data-role="visual-zone".');
  }
  if (!/data-role=["']visual-content["']/i.test(html)) {
    errors.push('HTML document must contain data-role="visual-content" inside visual-zone so the composition stays within its local bounds.');
  }
  if (!/<main\b[^>]*\bdata-layout=["'](?:split|stack)["'][^>]*>/i.test(html)) {
    errors.push('Root <main> must declare data-layout="split" or data-layout="stack" for protected non-overlapping zones.');
  }
  if (/(?:src|href|xlink:href|action|poster|data)\s*=\s*["']\s*(?:https?:)?\/\//i.test(html)
    || /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html)
    || /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i.test(html)) {
    errors.push('HTML document must not reference external http(s) resources.');
  }
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i.test(html)
    || /\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b/i.test(html)) {
    errors.push('HTML document must not use fetch, XMLHttpRequest, WebSocket, or EventSource.');
  }
  if (/\b(?:alert|prompt|confirm)\s*\(/i.test(html)) {
    errors.push('HTML document must not use alert, prompt, or confirm.');
  }
  if (/[\p{Extended_Pictographic}]/u.test(html)) {
    errors.push('HTML document must not contain emoji.');
  }
  if (/\uFFFD|锟斤拷|â€|Â/.test(html)) {
    errors.push('HTML document contains common mojibake characters.');
  }
  if (hasForbiddenMapHtmlVisual(html)) {
    errors.push('HTML document must not contain maps or geographic silhouettes.');
  }
  if (hasSynchronousListenerRemoval(html, 'load')) {
    errors.push('Animation lifecycle removes the load listener before it can run.');
  }
  if (errors.length) throw new HtmlValidationError(errors);
}

/** Minimal runtime contract for GPT-free documents. No layout or style prescription. */
export function validateFreeGeneratedHtml(html: string): void {
  const errors: string[] = [];
  if (html.trim().length < MIN_HTML_LENGTH) errors.push(`HTML document is too short (${html.trim().length} chars).`);
  if (!/<!DOCTYPE\s+html\b/i.test(html) || !/<html\b/i.test(html) || !/<\/html>/i.test(html)) {
    errors.push('HTML document must be complete, including <!DOCTYPE html> and </html>.');
  }
  if (/(?:src|href|xlink:href|action|poster|data)\s*=\s*["']\s*(?:https?:)?\/\//i.test(html)
    || /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html)
    || /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i.test(html)) errors.push('HTML document must not reference external http(s) resources.');
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i.test(html)
    || /\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b/i.test(html)) errors.push('HTML document must not use network APIs.');
  if (/\b(?:alert|prompt|confirm|Math\.random)\s*\(/i.test(html)) errors.push('HTML document must be deterministic and non-interactive.');
  if (/\bsetInterval\s*\(/i.test(html) || /animation(?:-iteration-count)?\s*:[^;}]*\binfinite\b/i.test(html)) {
    errors.push('HTML document must not use looping timers or infinite animations.');
  }
  if (/\uFFFD|锟斤拷|â€|Â/.test(html)) errors.push('HTML document contains common mojibake characters.');
  if (errors.length) throw new HtmlValidationError(errors);
}

function selectRelevantSourceExcerpt(
  sourceMaterial: string,
  frame: FrameOutline,
  informationPool: string[],
  maxChars = 5000,
): string {
  const source = sourceMaterial.trim();
  if (!source) return '';
  const keywords = new Set(
    `${frame.title} ${frame.narration} ${informationPool.join(' ')}`
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]{2,}/gu) || [],
  );
  const paragraphs = source.split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
  const ranked = paragraphs
    .map((text, index) => ({
      text,
      index,
      score: [...keywords].reduce((sum, keyword) => sum + (text.toLocaleLowerCase().includes(keyword) ? 1 : 0), 0),
    }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected: string[] = [];
  let length = 0;
  for (const item of ranked) {
    if (selected.length && length + item.text.length > maxChars) continue;
    selected.push(item.text);
    length += item.text.length;
    if (length >= maxChars * 0.8) break;
  }
  return selected.join('\n\n').slice(0, maxChars);
}

function hasSynchronousListenerRemoval(html: string, eventName: string): boolean {
  const scripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
    .filter(match => !/\btype\s*=\s*["'](?!text\/javascript|application\/javascript|module)[^"']+["']/i.test(match[1] || ''))
    .map(match => match[2] || '');
  return scripts.some(script => {
    const masked = maskJavaScriptStringsAndComments(script);
    const functionBraces = new Set<number>();
    for (const match of masked.matchAll(/\bfunction\b(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{|=>\s*\{/g)) {
      functionBraces.add((match.index || 0) + match[0].lastIndexOf('{'));
    }
    const scopeAt = new Map<number, string>();
    const braces: Array<{ id: number; functionScope: boolean }> = [];
    const functionScopeIds: number[] = [];
    let nextScopeId = 1;
    for (let index = 0; index < masked.length; index += 1) {
      scopeAt.set(index, functionScopeIds.join('/'));
      if (masked[index] === '{') {
        const entry = { id: nextScopeId++, functionScope: functionBraces.has(index) };
        braces.push(entry);
        if (entry.functionScope) functionScopeIds.push(entry.id);
      } else if (masked[index] === '}') {
        const entry = braces.pop();
        if (entry?.functionScope) functionScopeIds.pop();
      }
    }
    const calls = Array.from(script.matchAll(
      /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*(addEventListener|removeEventListener)\s*\(\s*(['"])([^'"]+)\3\s*,\s*([A-Za-z_$][\w$]*)/g,
    )).map(match => ({
      index: match.index || 0,
      target: match[1].replace(/\s+/g, ''),
      operation: match[2],
      event: match[4],
      callback: match[5],
      scope: scopeAt.get(match.index || 0) || '',
    }));
    return calls.some((remove, removeIndex) => {
      if (remove.operation !== 'removeEventListener' || remove.event !== eventName) return false;
      const statementStart = Math.max(script.lastIndexOf(';', remove.index - 1), script.lastIndexOf('\n', remove.index - 1)) + 1;
      if (/=>|\bfunction\b/.test(script.slice(statementStart, remove.index))) return false;
      return calls.slice(0, removeIndex).some(add =>
        add.operation === 'addEventListener'
        && add.target === remove.target
        && add.event === remove.event
        && add.callback === remove.callback
        && add.scope === remove.scope,
      );
    });
  });
}

function maskJavaScriptStringsAndComments(source: string): string {
  let output = '';
  let mode: 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment' = 'code';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === 'code') {
      if (char === "'") mode = 'single';
      else if (char === '"') mode = 'double';
      else if (char === '`') mode = 'template';
      else if (char === '/' && next === '/') mode = 'line-comment';
      else if (char === '/' && next === '*') mode = 'block-comment';
      output += mode === 'code' ? char : ' ';
      continue;
    }
    output += char === '\n' ? '\n' : ' ';
    if ((mode === 'single' && char === "'") || (mode === 'double' && char === '"') || (mode === 'template' && char === '`')) {
      let escaped = false;
      for (let back = index - 1; back >= 0 && source[back] === '\\'; back -= 1) escaped = !escaped;
      if (!escaped) mode = 'code';
    } else if (mode === 'line-comment' && char === '\n') {
      mode = 'code';
    } else if (mode === 'block-comment' && char === '*' && next === '/') {
      output += ' ';
      index += 1;
      mode = 'code';
    }
  }
  return output;
}

function formatHtmlValidationError(error: unknown): string {
  if (error instanceof HtmlValidationError) return error.errors.map(item => `- ${item}`).join('\n');
  if (error instanceof Error) return `- ${error.message}`;
  return `- ${String(error)}`;
}

function hasExplicitDoctype(raw: string): boolean {
  return /<!DOCTYPE\s+html\b/i.test(raw);
}

function isNormalFinishReason(finishReason: string | null): boolean {
  return finishReason === 'stop';
}

function isLengthLimitedEmptyHtmlResult(result: {
  emptyOutput: boolean;
  lengthLimited: boolean;
  finishReason: string | null;
}): boolean {
  return result.emptyOutput && result.lengthLimited;
}

/**
 * 清理 AI 返回的 HTML：
 * - 去掉外部资源引用
 * - 强制 sandbox 友好（移除 <base>、target=_blank、form 等）
 */
export function sanitizeHtml(html: string, canvasPreset?: CanvasPresetId): string {
  return enforceLayoutSafety(sanitizeRuntimeHtml(html), canvasPreset);
}

/** Runtime sanitization for schema-free GPT scenes; no protected layout CSS is injected. */
export function sanitizeFreeHtml(html: string): string {
  return ensureFreeAuditHook(sanitizeRuntimeHtml(html));
}

function ensureFreeAuditHook(html: string): string {
  if (/\bdata-(?:editor|element)-id\s*=/i.test(html)) return html;
  return html.replace(/<(main|canvas|svg)\b([^>]*)>/i, (_full, tag: string, attributes: string) => (
    `<${tag}${attributes} data-editor-id="gpt-free-scene" data-editor-label="GPT 自由画面">`
  ));
}

function sanitizeRuntimeHtml(html: string): string {
  let cleaned = html;
  // 移除外部 <script src="..."> 和 <link rel="stylesheet" href="...">
  cleaned = cleaned.replace(/<script[^>]+src=["'][^"']*["'][^>]*>\s*<\/script>/gi, '');
  cleaned = cleaned.replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, '');
  cleaned = cleaned.replace(/<img[^>]+src=["']https?:\/\/[^"']*["'][^>]*>/gi, ''); // 不允许外部图片
  cleaned = cleaned.replace(/<base[^>]*>/gi, '');
  cleaned = cleaned.replace(/<form[\s\S]*?<\/form>/gi, '');
  cleaned = cleaned.replace(/\s(?:href|action)=["'](?:javascript:|https?:)[^"']*["']/gi, '');
  cleaned = cleaned.replace(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/g, 'void(');
  cleaned = cleaned.replace(/\b(?:alert|prompt|confirm)\s*\(/g, 'void(');
  return cleaned;
}

/**
 * Inject an application-owned geometry guard after model CSS.
 * The !important rules keep text, visuals, connectors and labels inside distinct
 * coordinate spaces, while reserving the lower 120px for player subtitles.
 */
export function enforceLayoutSafety(html: string, canvasPreset?: CanvasPresetId): string {
  return enforceProtectedLayout(html, canvasPreset);
}
