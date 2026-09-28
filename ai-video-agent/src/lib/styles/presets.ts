import type { StylePreset, ThemeTokens } from '@/types';

interface ThemeDefinition extends Omit<StylePreset, 'prompt' | 'demoHtml'> {
  tokens: ThemeTokens;
  bestFor: string[];
  mood: string[];
  prohibitedPatterns: string[];
}

const DEFAULT_PROHIBITED = ['卡片墙', '大段字幕', 'emoji', '紫粉渐变', '随机装饰', '无意义漂浮'];

const THEMES: ThemeDefinition[] = [
  theme('editorial-ink', '编辑墨迹', '高对比编辑设计，用字号、细线和留白建立秩序。',
    ['历史故事', '观点解释', '人物叙事'], ['克制', '权威', '编辑感'],
    colors('#f4f0e8', '#fffdf8', '#171714', '#706c63', '#b43924', '#d7cdbd'),
    type("'Songti SC', 'Noto Serif CJK SC', serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '104px', '28px'),
    '不对称标题、细分隔线与大面积纸张留白'),
  theme('signal-grid', '信号网格', '冷静的技术信息系统，以网格和亮青色信号组织复杂概念。',
    ['科技讲解', '系统架构', '产品能力'], ['精确', '理性', '快速'],
    colors('#0b1114', '#111a1e', '#ecf4f1', '#83938f', '#35d0ba', '#55736d'),
    type("'Microsoft YaHei', sans-serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '92px', '26px'),
    '稀疏坐标网格、单一信号色与工程标注'),
  theme('warm-archive', '暖色档案', '像翻阅保存完好的档案，以编号、日期和材料质感推进叙事。',
    ['历史故事', '品牌故事', '文化内容'], ['温暖', '人文', '沉静'],
    colors('#efe3cf', '#f8eedc', '#2d251c', '#766653', '#ad542f', '#8c806e'),
    type("'Songti SC', serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '88px', '27px'),
    '档案编号、日期刻度与克制的纸张层次'),
  theme('kinetic-type', '动势排印', '用文字尺度与方向变化表达冲突、转折和结论。',
    ['观点短片', '品牌宣言', '概念解释'], ['有力', '直接', '现代'],
    colors('#f2f0e9', '#ffffff', '#10100f', '#676761', '#e24a2a', '#22221f'),
    type("'Arial Black', 'Microsoft YaHei', sans-serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '118px', '30px'),
    '超大关键词、方向性切分与硬朗节奏'),
  theme('data-paper', '数据纸面', '让数字成为画面主角，强调基线、刻度与可比关系。',
    ['数据对比', '研究摘要', '商业分析'], ['可信', '清晰', '客观'],
    colors('#f7f8f4', '#ffffff', '#17201d', '#68746f', '#176b55', '#a7bdb5'),
    type("'Microsoft YaHei', sans-serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '96px', '26px'),
    '大数字、细刻度和极低装饰的数据墨水比'),
  theme('field-notes', '现场笔记', '带有人手整理痕迹的教学视觉，强调步骤、圈点和路径。',
    ['流程教程', '学习内容', '方法拆解'], ['亲近', '清楚', '活跃'],
    colors('#f2ead8', '#fbf5e7', '#26241f', '#716d62', '#24706a', '#c7793f'),
    type("'KaiTi', 'STKaiti', serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '90px', '28px'),
    '手记式标题、路径线和有限的圈点标记'),
  theme('cinematic-noir', '电影黑场', '以黑场、窄束光和高反差排版制造叙事张力。',
    ['人物故事', '悬念开场', '高端产品'], ['沉浸', '戏剧', '高级'],
    colors('#080909', '#121414', '#f3f0e8', '#8d8d86', '#d3a640', '#4e504d'),
    type("'Songti SC', serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '100px', '26px'),
    '单束暖光、电影字幕比例与深黑负空间'),
  theme('blueprint', '结构蓝图', '用连线、层级与工程蓝图语法解释系统关系。',
    ['流程教程', '空间结构', '因果链路'], ['系统', '冷静', '探索'],
    colors('#102a35', '#153744', '#edf7f5', '#91aaa9', '#62c3af', '#d1aa62'),
    type("'Microsoft YaHei', sans-serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '88px', '26px'),
    '结构连线、层级编号和蓝图式展开'),
  theme('editorial-minimal', '编辑部极简', '像一本高级杂志：以留白、精致排版与低饱和色彩，让观点从容落在画面上。',
    ['观点表达', '品牌叙事', '深度解读'], ['安静', '精致', '笃定'],
    colors('#f6f4ef', '#fffefa', '#20201d', '#77746d', '#8c3f2c', '#c8c1b4'),
    type("'Songti SC', 'Noto Serif CJK SC', serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '110px', '27px'),
    '杂志级留白、非对称标题与一条克制的砖红色编辑标记'),
  theme('cinematic-documentary', '电影感纪实', '用有层次的暗部、自然颗粒与缓慢推进的镜头语言，留下真实的呼吸感。',
    ['人物故事', '品牌纪录', '现场观察'], ['沉浸', '真实', '克制'],
    colors('#131514', '#1d201e', '#ece7dc', '#9a978d', '#bb8b54', '#5e655d'),
    type("'Songti SC', 'Noto Serif CJK SC', serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '102px', '27px'),
    '电影宽画幅、暖色侧光、细微颗粒与慢节奏淡入'),
  theme('luxury-tech', '科技奢华', '深色基底上只保留一束精确的光：玻璃、金属与数据被处理成克制而昂贵的细节。',
    ['AI 产品', '高端发布', '技术战略'], ['冷冽', '精密', '昂贵'],
    colors('#090b10', '#111621', '#f1f4f4', '#8b98a5', '#8cc9c4', '#536779'),
    type("'Microsoft YaHei', sans-serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '94px', '25px'),
    '黑钛质感、低亮玻璃面、单一冰青高光与精确数据标注'),
  theme('gallery-contemporary', '当代艺术展览', '把每一屏视作展览中的一件作品：大尺度文字、抽象材料和不对称的视觉秩序。',
    ['概念表达', '创意提案', '文化艺术'], ['前卫', '留白', '张力'],
    colors('#e8e5de', '#f5f2eb', '#171716', '#77736c', '#3359a8', '#d2905f'),
    type("'STHeiti', 'Microsoft YaHei', sans-serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '122px', '28px'),
    '展签编号、超大排版、色块切片与有意保留的不对称'),
  theme('product-craft', '高端产品广告', '让产品的材质和工艺成为主角，用微距式细节、干净背景和缓慢节奏建立信任。',
    ['产品发布', '功能讲解', '品牌广告'], ['纯净', '细腻', '高级'],
    colors('#eff0ed', '#ffffff', '#141614', '#737871', '#456e5d', '#c2b9a8'),
    type("'Microsoft YaHei', sans-serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '98px', '26px'),
    '无影棚留白、材质特写取景、微弱反射与缓慢的产品式揭示'),
  theme('humanist-literary', '人文书卷气', '温暖纸张、墨色文字和档案细节共同推进叙事，像一篇被细心编排的长文。',
    ['历史文化', '人物传记', '知识讲解'], ['温润', '知性', '安定'],
    colors('#eee5d5', '#f8f2e7', '#30291f', '#776c5b', '#6d4a32', '#a79a83'),
    type("'KaiTi', 'STKaiti', serif", "'Microsoft YaHei', sans-serif", "'SFMono-Regular', Consolas, monospace", '96px', '28px'),
    '纸张肌理、毛笔般的标题节奏、脚注式信息与低速转场'),
];

function colors(background: string, surface: string, foreground: string, muted: string, accent: string, accentSecondary: string) {
  return { background, surface, foreground, muted, accent, accentSecondary };
}

function type(display: string, body: string, mono: string, titleSize: string, bodySize: string) {
  return { display, body, mono, titleSize, bodySize };
}

function theme(
  id: string,
  name: string,
  description: string,
  bestFor: string[],
  mood: string[],
  themeColors: ThemeTokens['colors'],
  typography: ThemeTokens['typography'],
  signature: string,
): ThemeDefinition {
  return {
    id, name, description, bestFor, mood,
    prohibitedPatterns: DEFAULT_PROHIBITED,
    tokens: {
      colors: themeColors,
      typography,
      spacing: { safeArea: '72px', gap: '24px' },
      shape: { radius: id === 'field-notes' ? '10px' : '2px', borderWidth: '1px' },
      motion: {
        duration: id === 'cinematic-noir' || id === 'warm-archive' ? '900ms' : '560ms',
        easing: 'cubic-bezier(.22,.8,.22,1)',
        stagger: '140ms',
      },
      signature,
    },
  };
}

function buildPrompt(theme: ThemeDefinition): string {
  const t = theme.tokens;
  return `【主题 Token：${theme.name} / ${theme.id}】\n适用：${theme.bestFor.join('、')}\n气质：${theme.mood.join('、')}\n色彩：背景 ${t.colors.background}；表面 ${t.colors.surface}；主文字 ${t.colors.foreground}；弱文字 ${t.colors.muted}；唯一强调色 ${t.colors.accent}；辅助色 ${t.colors.accentSecondary}。\n字体：标题 ${t.typography.display} ${t.typography.titleSize}；正文 ${t.typography.body} ${t.typography.bodySize}；数字与标签 ${t.typography.mono}。\n空间：安全区 ${t.spacing.safeArea}；基础间距 ${t.spacing.gap}；圆角 ${t.shape.radius}；边框 ${t.shape.borderWidth}。\n动作：${t.motion.duration}，${t.motion.easing}，逐项错峰 ${t.motion.stagger}；动作必须表达内容关系。\n标志语法：${t.signature}。\n禁止：${theme.prohibitedPatterns.join('、')}。不得把旁白整段铺在屏幕上。`;
}

function buildPreview(theme: ThemeDefinition): string {
  const t = theme.tokens;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{background:${t.colors.background};color:${t.colors.foreground};font-family:${t.typography.body};padding:${t.spacing.safeArea};display:grid;grid-template-rows:auto 1fr auto}.top,.foot{display:flex;justify-content:space-between;align-items:center;font:12px ${t.typography.mono};letter-spacing:.16em;color:${t.colors.muted}.mark{width:48px;height:4px;background:${t.colors.accent};transform-origin:left;animation:draw ${t.motion.duration} ${t.motion.easing} forwards}.hero{align-self:center;max-width:85%}.kicker{font:13px ${t.typography.mono};letter-spacing:.22em;color:${t.colors.accent};opacity:0;animation:up ${t.motion.duration} 100ms ${t.motion.easing} forwards}.title{font-family:${t.typography.display};font-size:clamp(52px,8vw,112px);line-height:.96;letter-spacing:-.04em;margin:20px 0 0;text-wrap:pretty;opacity:0;animation:up ${t.motion.duration} 240ms ${t.motion.easing} forwards}.rule{margin-top:28px;width:38%;height:${t.shape.borderWidth};background:${t.colors.accentSecondary};transform-origin:left;animation:draw ${t.motion.duration} 420ms ${t.motion.easing} both}.foot{border-top:${t.shape.borderWidth} solid ${t.colors.accentSecondary};padding-top:18px;opacity:0;animation:up ${t.motion.duration} 540ms ${t.motion.easing} forwards}@keyframes up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}@keyframes draw{from{transform:scaleX(0)}to{transform:scaleX(1)}}@media(prefers-reduced-motion:reduce){*{animation:none!important;opacity:1!important}}
</style></head><body><div class="top"><div class="mark"></div><span>THEME / 01</span></div><main class="hero"><div class="kicker">${theme.mood[0]} · ${theme.bestFor[0]}</div><div class="title">${theme.name}</div><div class="rule"></div></main><div class="foot"><span>${t.signature}</span><span>1280 × 720</span></div></body></html>`;
}

export const STYLE_PRESETS: StylePreset[] = THEMES.map(themeDefinition => ({
  ...themeDefinition,
  prompt: buildPrompt(themeDefinition),
  demoHtml: buildPreview(themeDefinition),
}));

const LEGACY_ALIASES: Record<string, string> = {
  'cyber-clean': 'signal-grid',
  'terminal-matrix': 'blueprint',
  'warm-story': 'warm-archive',
};

export function getStyleById(id?: string | null): StylePreset | undefined {
  if (!id) return undefined;
  const resolved = LEGACY_ALIASES[id] || id;
  return STYLE_PRESETS.find(item => item.id === resolved);
}

export function getDefaultStyle(): StylePreset {
  return STYLE_PRESETS[0];
}

export function recommendStyles(input: string, limit = 3): StylePreset[] {
  const text = input.toLowerCase();
  const scored = STYLE_PRESETS.map(style => ({
    style,
    score: style.bestFor?.reduce((sum, keyword) => sum + (text.includes(keyword.toLowerCase()) ? 3 : 0), 0) || 0,
  }));
  if (/数据|增长|比例|对比|指标/.test(text)) scored.find(x => x.style.id === 'data-paper')!.score += 5;
  if (/教程|步骤|流程|方法/.test(text)) scored.find(x => x.style.id === 'field-notes')!.score += 5;
  if (/历史|故事|人物|年代/.test(text)) scored.find(x => x.style.id === 'warm-archive')!.score += 5;
  if (/科技|ai|系统|架构|技术/.test(text)) scored.find(x => x.style.id === 'signal-grid')!.score += 5;
  return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit)).map(item => item.style);
}

/** GPT-only automatic style selection. Existing/default callers stay unchanged. */
export function recommendGPTStyle(input: string): StylePreset {
  const text = input.toLocaleLowerCase();
  const scored = STYLE_PRESETS.map((style, index) => ({
    style,
    index,
    score: style.bestFor?.reduce((sum, keyword) => sum + (text.includes(keyword.toLocaleLowerCase()) ? 3 : 0), 0) || 0,
  }));
  const boost = (id: string, score: number) => {
    const match = scored.find(item => item.style.id === id);
    if (match) match.score += score;
  };
  if (/麦当劳|mcdonald|品牌|餐饮|食品|汉堡|薯条|产品|包装|广告/.test(text)) boost('product-craft', 8);
  if (/历史|档案|创始|年代|早期门店|品牌故事/.test(text)) boost('warm-archive', 7);
  if (/纪实|门店|人物|现场|全球/.test(text)) boost('cinematic-documentary', 5);
  if (/数据|增长|比例|地图|全球分布|指标/.test(text)) boost('data-paper', 5);
  return scored.sort((a, b) => b.score - a.score || a.index - b.index)[0]?.style ?? getDefaultStyle();
}
