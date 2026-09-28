import type { CanvasPresetId } from '@/types';
import { isPortraitPreset } from '@/lib/canvas-presets';

/**
 * Portrait-only visual rules. Keeping these outside the shared HTML guidance is
 * intentional: landscape generation must not inherit vertical composition or
 * type-scale decisions.
 */
export const PORTRAIT_VISUAL_TOKENS = {
  titleMin: 56,
  titleMax: 76,
  supportingMin: 26,
  labelMin: 20,
  heroNumberMin: 132,
  focalWidthMinRatio: 0.58,
  focalHeightMinRatio: 0.36,
  focalAreaMinRatio: 0.2,
  focalWidthPreferredRatio: [0.68, 0.86] as const,
  focalHeightPreferredRatio: [0.48, 0.72] as const,
} as const;

/**
 * Creative-mode portrait guidance deliberately stays qualitative. It nudges
 * the model away from top-heavy compositions without turning every vertical
 * frame into the same protected layout or imposing a universal fill ratio.
 */
export function buildAdaptivePortraitDensityGuidance(canvasPreset?: CanvasPresetId | string | null): string {
  if (!isPortraitPreset(canvasPreset)) return '';
  return `
## 9:16 竖屏自适应密度建议（审美倾向，不是固定模板）
- 先判断本镜职责再决定密度：hook、metric、quote、transition 可以克制而有冲击；explain、process、compare、summary 可以承载更多关系，但仍只保留一个当前视觉主角。
- 再判断标题是不是主角：hook、quote 或以文字本身构成结论的镜头可以让标题承担最大视觉权重；解释、流程、对比等镜头通常让图解或状态变化成为主角，标题只负责快速建立语境。若标题本身就是本镜要演示的命题，可以例外。
- 把标题、主视觉与必要结论视作一个可沿纵向舒展的整体，优先利用字幕安全区上方的可用高度。避免所有高权重元素都挤在上半屏、下半屏却失去叙事作用。
- 留白可以很大，但必须强化主角、制造尺度感或为转折蓄力；如果留白没有叙事作用，优先放大或下移主视觉、拉开内部层级，不要添加装饰物填空。
- 多个同级信息优先采用纵向节奏、逐项揭示或前后状态，让高权重元素分时成为主角；当内容天然适合并列且短小清楚时，可以保留横向关系，不强行改成固定竖排模板。
- “信息最完整”不等于所有项目始终等权铺满。旁白已经讲过的项目可以退成轨迹、索引或较低权重状态，把空间留给当前项目；只有当观众需要在同一眼中比较全貌时，才保留同时展开的总览。
- 标题与主视觉互相抢空间时，优先精简辅助信息、降低次级文字权重或错开出现时机；不要机械缩小整组内容，也不要套用统一字号、固定对象数量或占屏比例。
- 以信息最完整的时刻检查整体重心：内容应显得舒展、连贯、远观可读。只有在叙事上有明确理由时，才让视觉重心明显偏上或偏下。
`;
}

export function buildPortraitVisualGuidance(canvasPreset?: CanvasPresetId | string | null): string {
  if (!isPortraitPreset(canvasPreset)) return '';
  const token = PORTRAIT_VISUAL_TOKENS;
  return `
## 9:16 竖屏独立构图协议（仅适用于当前竖屏画幅，强制）
- 这是竖屏专用布局，不是横屏布局的压缩版。只共享主题颜色和字体家族，不沿用横屏的左右分栏尺寸、横向流程、字号或绝对坐标。
- 每屏使用一个聚合内容组：标题与核心图形必须围绕同一条竖向中轴或同一左边线组织，不能出现“左上标题 + 中央小图 + 大片空白”。
- 在核心图形的最外层标记 data-role="focal"，并保留稳定的 data-editor-id。核心图形优先占 visual-zone 宽度 ${Math.round(token.focalWidthPreferredRatio[0] * 100)}%-${Math.round(token.focalWidthPreferredRatio[1] * 100)}%、高度 ${Math.round(token.focalHeightPreferredRatio[0] * 100)}%-${Math.round(token.focalHeightPreferredRatio[1] * 100)}%；不得把主角缩成图标或中央小装饰。
- 默认使用 data-layout="stack"。只有单张真实素材或极短标题需要更大的视觉高度时才使用 split；竖屏中的 split 仍是上标题、下视觉，不得写成横向左右栏。
- 标题最多两行，按完整语义短语换行；主标题使用 ${token.titleMin}-${token.titleMax}px。标题超过 18 个汉字时，把解释信息降为一行 ${token.supportingMin}-34px 的辅助文字，不得整体缩成小字。禁止虚词悬挂，禁止为了装饰添加无关章节眉题。
- 屏幕只保留一个主标题、一个核心视觉和可选的一句结论。图内必要标签使用 ${token.labelMin}-28px，最多 2 个；大数字使用至少 ${token.heroNumberMin}px。删除读不清的小注释、来源角标和重复解释。
- metric / hook：数字、关键词或单一符号必须成为画面最大元素并居中；辅助图形退后。
- process / cause / timeline：默认改为自上而下的单路径，节点等宽、等距；禁止把横向 4-5 步流程压进竖屏。
- compare：默认上下对照并共享同一宽度和中轴；只有两个极短指标才可左右并列。
- hierarchy：根节点在上、2-3 个子节点在下；超过 3 个子节点应简化或拆镜，不做横向卡片墙。
- spatial：中心对象至少占 visual-zone 短边的一半，周边关系靠近主角；禁止用细小图标在大空白中自由散点。
- 图形线宽以 3-5px 为主，低对比细线只作装饰，不能承担主要关系。动画终态必须让核心图形完整、清晰、静止可读。
- 留白必须包围并强化核心内容组；若内容显得空，先放大核心图形、数字或关系，不得添加无语义圆点、光斑、装饰英文或漂浮标签填空。
`;
}

export function buildPortraitGuardTokens(canvasPreset?: CanvasPresetId | string | null): string {
  if (!isPortraitPreset(canvasPreset)) return '';
  const token = PORTRAIT_VISUAL_TOKENS;
  return `--ai-p-title-min:${token.titleMin}px;--ai-p-title-max:${token.titleMax}px;--ai-p-supporting-min:${token.supportingMin}px;--ai-p-label-min:${token.labelMin}px;--ai-p-hero-number-min:${token.heroNumberMin}px;`;
}
