import { v4 as uuid } from 'uuid';
import type { CreativeBrief, FrameOutline, Outline, ScriptBeat, ScriptChapter } from '@/types';

/**
 * 大纲生成系统提示词：image 模式
 * 关键：让 AI 选定一组全局画风，保证所有分镜画面风格统一。
 */
export const OUTLINE_SYSTEM_IMAGE = `你是一位专业的视频脚本创作专家。你需要根据用户的提示词或脚本，生成一份完整的视频大纲。

## 任务步骤
1. **提炼主题**：分析用户意图，提炼视频核心主题
2. **撰写逐字稿**：写一份中文逐字旁白稿（口语化、有节奏感）。用户明确指定任何时长时，以该时长为硬约束，并同步匹配逐字稿篇幅和分镜数量；未指定时默认 60-300 秒、约 120 秒
3. **拆分分镜**：根据视频时长拆分成 6-40 个分镜，每个分镜对应一段画面+一段旁白；1-2 分钟建议 6-16 镜，3-5 分钟建议 18-40 镜
4. **撰写画面提示词**：为每个分镜写一段用于搜图检索和画面编排的描述（中文）
5. **确定全局画风**：选一组统一的视觉风格（如：水彩插画风 / 赛博朋克风 / 复古胶片风 / 极简矢量风 / 写实摄影风），并写成一段全局画风提示词，加在每个分镜的画面提示词前面，确保所有图片风格统一

## 输出格式（严格 JSON）

{
  "title": "视频标题（不超过 20 字）",
  "totalDuration": 总时长秒数（数字）,
  "creativeBrief": {"targetAudience":"具体人群及场景","viewerPainPoint":"其当前困扰","valuePromise":"看完能获得的明确收益","coreMessage":"全片唯一主张","hook":{"type":"pain_point|counterintuitive|result|suspense|question","text":"开场旁白原句"},"proofPlan":"将使用的案例、对比、步骤或事实","cta":"结尾行动或收束原句"},
  "globalStyle": "全局视觉风格提示词（英文，用于搜图筛选与画面编排，30-80 词）",
  "frames": [
    {
      "id": "uuid 字符串",
      "index": 1,
      "title": "面向观众的内容标题（通常不超过 15 字；第一镜与视频标题一致）",
      "narration": "分镜旁白（中文）",
      "imagePrompt": "画面提示词（英文，包含 [globalStyle] + 详细画面描述）"
    }
  ]
}

## 注意事项
- 全局画风要明确：色调、光影、笔触/材质、构图倾向
- 用户未指定时，视频总时长使用 60-300 秒；用户已指定时服从用户时长。totalDuration、逐字稿篇幅和分镜数量必须相互匹配，不能只改时长数字
- 单个分镜画面提示词 30-100 词
- 单个分镜旁白 15-60 字
- 第一镜是整条视频的主旨封面：frames[0].title 必须与顶层 title 完全一致，不得只概括第一句旁白或局部话题
- frames[].title 必须概括这一镜真正讲述的内容，像可直接展示给观众的小标题；不要写“开场、引入、铺垫、转折、过渡、总结、收束、行动号召、认知冲突”等编导标签。分镜在结构中的作用写在 beat purpose，而不是 title
- 整体节奏：开头 1-2 镜引入 → 中间 4-20 镜展开 → 结尾 1-2 镜收束
- 每个分镜必须带来新信息：事实、解释、条件、案例、对比、步骤或可执行结论至少一种；相邻分镜不得换句重复同一观点
- 不要任何 JSON 之外的内容
`;

export const OUTLINE_SYSTEM_HTML = `你是一位专业的视频脚本编辑。你需要把用户的主题、文章或现成脚本整理成“完整口播稿 → 章节 → 口播节拍 → 分镜”的内容结构。系统会在下一阶段完成视觉编导，不要提前设计动画。

## 任务步骤
1. **提炼主题**：分析用户意图
2. **保留信息**：从原始素材提取数据、案例、引用、实体和关键事实，写入 informationPool，不得杜撰
3. **撰写并自检口播稿**：自然口语化，去除“在这个时代、赋能、让我们一起、值得注意的是”等 AI 高频套话；检查钩子、句长和信息保留率
4. **组织章节与节拍**：每个 beat 只承载一个主要想法，beat 与最终 frame 一一对应
5. **撰写画面提示词**：htmlPrompt 用自然语言描述一段可用于 HTML 动画的画面：先写整体布局，再写关键元素的状态、对比或变化，最后写结果。每镜只保留一个视觉主角和一个内容关系；屏幕文字默认仅使用分镜标题
6. **选择可稳定实现的表达**：HTML 模式优先使用排版、图表、流程、时间线、简单图标、模拟浏览器/App/聊天/社交媒体 UI。禁止规划地图、地理轮廓、人物剪影或表演、写实自然环境、航拍/地图飞行、复杂写实 3D 和物理特效；将它们改写为数字、节点、标签、引语、进度线或抽象二维关系。

## 输出格式（严格 JSON）

{
  "title": "视频标题",
  "totalDuration": 总时长秒数,
  "script": "完整口播逐字稿",
  "chapters": [{"id":"chapter-1","title":"章节名","purpose":"本章作用","beatIds":["beat-1"]}],
  "beats": [{"id":"beat-1","chapterId":"chapter-1","order":1,"narration":"节拍旁白","purpose":"这一拍推进什么","frameId":"与 frames.id 相同"}],
  "informationPool": [{"type":"data|case|quote|entity|fact","content":"原始素材中的信息","source":"可选来源"}],
  "creativeBrief": {"targetAudience":"具体人群及场景","viewerPainPoint":"其当前困扰","valuePromise":"看完能获得的明确收益","coreMessage":"全片唯一主张","hook":{"type":"pain_point|counterintuitive|result|suspense|question","text":"开场旁白原句"},"proofPlan":"将使用的案例、对比、步骤或事实","cta":"结尾行动或收束原句"},
  "contentAudit": {"retentionRate":0到1,"hasHook":true,"averageSentenceLength":数字,"aiPhrases":[],"issues":[],"repaired":true},
  "frames": [
    {
      "id": "uuid 字符串",
      "index": 1,
      "title": "面向观众的内容标题",
      "narration": "分镜旁白",
      "htmlPrompt": "先描述整体画面与布局，再描述关键状态、对比或变化，最后说明结果；需要时自然写出屏幕文字（共45-160个汉字）"
    }
  ]
}

## 注意事项
- 用户未指定时，视频总时长使用 60-300 秒；用户已指定时服从用户时长。totalDuration、逐字稿篇幅和分镜数量必须相互匹配，不能只改时长数字
- htmlPrompt 必须短、单焦点、可排版；用 1-3 句自然语言连续描述“画面布局 → 关键状态/变化 → 结果”，不使用“主角 / 关系 / 屏幕文字”字段式写法，不写 CSS/JS
- 浏览器、App、聊天与社交媒体 UI 可以作为 htmlPrompt 的主角；描述时只保留最关键的 1-3 个交互状态，不追求完整复刻。
- 禁止在 htmlPrompt 中规划人物剪影/表演、照片人物动态化、真实风景、航拍、地图或地球飞行、火烟水雨雪、复杂写实 3D、布料/毛发/破碎等物理效果。若旁白提到这些对象，必须转译为可清晰排版的二维信息表达。
- 屏幕文字默认写“仅标题”，不要为了填满画面添加多个两三个字的短词、标签、徽章或胶囊。能通过构图、图标、位置、大小、颜色和连线表达的信息，不重复写成文字
- 确实需要补充文字时，优先使用一句自然完整的短语；独立标签最多 1-2 个，且必须用于消除歧义
- 第一镜是整条视频的主旨封面：frames[0].title 必须与顶层 title 完全一致，不得只概括第一句旁白或局部话题
- 一段旁白只承载一个主要想法，避免把多个逻辑关系塞进同一分镜
- frames[].title 必须概括这一镜真正讲述的内容，像可直接展示给观众的小标题；不要写“开场、引入、铺垫、转折、过渡、总结、收束、行动号召、认知冲突”等编导标签。分镜在结构中的作用写在 beat purpose，而不是 title
- script 必须等于按 order 拼接 beats.narration 后得到的完整口播稿；frameId 必须对应 frame.id
- informationPool 只保留原始素材中真实存在的信息；不确定时宁可省略
- contentAudit 发现问题时先修复 script 和 beats，再输出 repaired=true；retentionRate 使用 0 到 1
- 整体节奏：开头 1-2 镜引入 → 中间展开 → 结尾收束
- creativeBrief 的每个字段都必须具体，不能写“所有人”“获得价值”等空话；具体开场与结尾形式服从当前内容风格
- 每个 beat 必须提供新信息（事实、解释、条件、案例、对比、步骤或可执行结论至少一种），相邻 beat 不得只是同义改写
- 不要任何 JSON 之外的内容
`;

/**
 * 把 AI 返回的 outline 数据补齐 id 等字段
 */
export function normalizeOutline(raw: Partial<Outline>): Outline {
  const outlineTitle = normalizeVideoTitle(raw.title);
  const recovered = recoverFramesFromBeats(raw);
  const sourceFrames = raw.frames?.length ? raw.frames : recovered.frames;
  const frames = sourceFrames.map((f, i) => ({
    id: f.id || uuid(),
    index: f.index || i + 1,
    title: i === 0 ? outlineTitle : normalizeFrameTitle(f.title, f.narration, i),
    narration: f.narration || '',
    imagePrompt: f.imagePrompt,
    htmlPrompt: f.htmlPrompt,
    sceneSpec: f.sceneSpec,
  }));
  const beats = raw.beats?.length
    ? raw.beats.map((beat, index) => ({
      ...beat,
      id: beat.id || `beat-${index + 1}`,
      chapterId: beat.chapterId || recovered.chapterIds[index] || 'chapter-1',
      order: beat.order || index + 1,
      narration: beat.narration || frames[index]?.narration || '',
      purpose: beat.purpose || frames[index]?.title || '',
      frameId: beat.frameId || frames[index]?.id,
    }))
    : recovered.beats.length
      ? recovered.beats.map((beat, index) => ({ ...beat, frameId: frames[index]?.id || beat.frameId }))
    : frames.map((frame, index) => ({
        id: `beat-${index + 1}`,
        chapterId: 'chapter-1',
        order: index + 1,
        narration: frame.narration,
        purpose: frame.title,
        frameId: frame.id,
      }));
  return {
    title: outlineTitle,
    totalDuration: raw.totalDuration || 60,
    globalStyle: raw.globalStyle,
    sourceMaterial: raw.sourceMaterial,
    script: raw.script || beats.map(beat => beat.narration).join('\n'),
    chapters: recovered.chapters.length ? recovered.chapters : raw.chapters?.length ? raw.chapters : [{
      id: 'chapter-1', title: raw.title || '正文', purpose: '完整讲述主题', beatIds: beats.map(beat => beat.id),
    }],
    beats,
    informationPool: raw.informationPool || [],
    creativeBrief: normalizeCreativeBrief(raw.creativeBrief),
    contentAudit: raw.contentAudit,
    visualAnchor: raw.visualAnchor,
    directorPlan: raw.directorPlan,
    research: raw.research,
    frames,
  };
}

/** Recovers the common `chapters[].beats[]` dialect into the persisted Outline contract. */
function recoverFramesFromBeats(raw: Partial<Outline>): {
  frames: Partial<FrameOutline>[];
  beats: ScriptBeat[];
  chapters: ScriptChapter[];
  chapterIds: string[];
} {
  const rawChapters = Array.isArray(raw.chapters) ? raw.chapters as unknown[] : [];
  const frames: Partial<FrameOutline>[] = [];
  const beats: ScriptBeat[] = [];
  const chapters: ScriptChapter[] = [];
  const chapterIds: string[] = [];

  for (const [chapterIndex, value] of rawChapters.entries()) {
    if (!value || typeof value !== 'object') continue;
    const chapter = value as Record<string, unknown>;
    const nestedBeats = Array.isArray(chapter.beats) ? chapter.beats : [];
    if (!nestedBeats.length) continue;

    const chapterId = textOr(chapter.id, `chapter-${chapterIndex + 1}`);
    const chapterTitle = textOr(chapter.title, `第 ${chapterIndex + 1} 章`);
    const purpose = textOr(chapter.narrativeFunction, textOr(chapter.purpose, chapterTitle));
    const beatIds: string[] = [];

    for (const nested of nestedBeats) {
      if (!nested || typeof nested !== 'object') continue;
      const beat = nested as Record<string, unknown>;
      const frameIndex = frames.length + 1;
      const frameId = textOr(beat.frameId, textOr(beat.id, uuid()));
      const narration = textOr(beat.narration, textOr(beat.voiceover, ''));
      const visual = textOr(beat.htmlPrompt, textOr(beat.visual, ''));
      const title = textOr(beat.title, textOr(beat.onScreenText, chapterTitle));
      const beatId = textOr(beat.id, `beat-${frameIndex}`);

      frames.push({ id: frameId, index: frameIndex, title, narration, htmlPrompt: visual });
      beats.push({ id: beatId, chapterId, order: frameIndex, narration, purpose: textOr(beat.purpose, title), frameId });
      chapterIds.push(chapterId);
      beatIds.push(beatId);
    }

    if (beatIds.length) chapters.push({ id: chapterId, title: chapterTitle, purpose, beatIds });
  }

  return { frames, beats, chapters, chapterIds };
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeCreativeBrief(value: unknown): CreativeBrief | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const hook = raw.hook && typeof raw.hook === 'object' && !Array.isArray(raw.hook)
    ? raw.hook as Record<string, unknown>
    : {};
  const hookType = typeof hook.type === 'string'
    && ['pain_point', 'counterintuitive', 'result', 'suspense', 'question'].includes(hook.type)
    ? hook.type as CreativeBrief['hook']['type']
    : 'question';
  return {
    targetAudience: textValue(raw.targetAudience),
    viewerPainPoint: textValue(raw.viewerPainPoint),
    valuePromise: textValue(raw.valuePromise),
    coreMessage: textValue(raw.coreMessage),
    hook: { type: hookType, text: textValue(hook.text) },
    proofPlan: textValue(raw.proofPlan),
    cta: textValue(raw.cta),
  };
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const object = value as Record<string, unknown>;
  for (const key of ['text', 'content', 'action', 'value', 'label']) {
    if (typeof object[key] === 'string' && object[key].trim()) return object[key].trim();
  }
  return '';
}

function normalizeVideoTitle(title: unknown): string {
  return typeof title === 'string' && title.trim() ? title.trim() : '未命名视频';
}

const META_FRAME_TITLE_ENDINGS = [
  '开场', '引入', '导入', '铺垫', '抛题', '问题抛出', '冲突建立',
  '转折', '承接', '过渡', '展开', '递进', '高潮', '总结', '收束',
  '结尾', '行动号召',
];

/**
 * 防止模型把编导用途（例如“认知冲突开场”）写进观众可见的标题字段。
 * 只拦截短小且以结构标签结尾的标题，避免误伤正常的内容标题。
 */
function normalizeFrameTitle(title: unknown, narration: unknown, index: number): string {
  const candidate = typeof title === 'string' ? title.trim() : '';
  if (candidate && !isMetaFrameTitle(candidate)) return candidate;

  const narrationText = typeof narration === 'string'
    ? narration.replace(/\s+/g, ' ').trim()
    : '';
  const firstClause = narrationText.split(/[，。！？；,.!?;]/, 1)[0]?.trim() || '';
  if (firstClause) return Array.from(firstClause).slice(0, 18).join('');

  return candidate || `分镜 ${index + 1}`;
}

function isMetaFrameTitle(title: string): boolean {
  const compact = title.replace(/\s+/g, '');
  if (/^(hook|intro|opening|transition|summary|conclusion|cta)(?:[-_:：].*)?$/i.test(compact)) {
    return true;
  }
  return Array.from(compact).length <= 12
    && META_FRAME_TITLE_ENDINGS.some(ending => compact.endsWith(ending));
}
