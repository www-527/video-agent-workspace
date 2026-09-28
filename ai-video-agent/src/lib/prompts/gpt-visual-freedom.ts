import { getCurrentGPTOptimizationSettings } from '@/lib/ai-key-context';
import type { GPTCreativeFreedom, GPTOptimizationSettings } from '@/lib/gpt-optimization-settings';

export type GPTVisualStage = 'director' | 'html' | 'rewrite';

const HARD_CONSTRAINTS = `
【GPT 专项优化：开放式视觉创作层】
本层不覆盖事实准确性、素材真实性、画布安全区、标题字幕可读性、合法 HTML/CSS/SVG、动画时长、性能上限、用户明确要求和素材授权。`;

const SHARED_BALANCED = `
- 不要把“外框 + 节点 + 连线”当作默认答案。连线只用于确实存在流程、因果、层级或数据关系时，每条线都应有可解释的起点、终点和语义；禁止用意义不明的线条填空。
- “一个视觉主角”表示层级清楚，不表示只能出现一个对象。对比、群像、产品组合和多步骤叙事可包含多个必要主体。
- DOM、SVG、标签数量和基础图形种类是软预算，不是创意禁令。为形成可辨认的语义插画、产品结构、拼贴、图表或界面可以适度超过，但仍要可编辑、可渲染。
- 可按内容选择产品特写、品牌档案、全屏摄影、拼贴、UI 场景、数据图表、时间线、地图、字体主导画面、抽象转场、语义插画、对比构图、局部放大或全屏留白节拍。
- 不连续复用同一种左右分栏、卡片、边框或中心节点构图。动画的建立、发展、转折和落点要分布在实际镜头时长中，避免前两秒结束全部变化后长时间静止。`;

const OPEN_EXTRA = `
- 当前为“开放”档：只要满足硬约束，可主动改变媒介、尺度、密度、视角、构图逻辑、纹理和层次；无需为了贴合既有模板而牺牲辨识度或品牌气质。
- 允许非对称构图、摄影与图形叠合、局部遮罩、复杂轮廓、层次化纹理、自由排版和更丰富的语义装饰。不要把有明确外观的主体降级成抽象线框。`;

const CONSERVATIVE_EXTRA = `
- 当前为“保守”档：优先稳定和可编辑性，但仍必须避免无意义连线、连续重复布局和把真实主体降级成空泛线框。只在语义非常明确时扩大复杂度。`;

const DIRECTOR = `
- 先输出整片视觉策略：主要视觉风格、可用布局家族、图片使用计划、UI 场景计划、重点镜头、安静镜头和转场节奏。
- 为需要真实人物、品牌、产品、地点、历史档案或现实场景的镜头输出 searchAction（tool 固定为 search_visual_assets）或 assetRequest / assetSubjects，交给程序内部搜图器执行。GPT 只提出搜索意图；程序负责搜索、缓存、授权检查和下载。
- 允许根据内容选择 real-image、ui-scene、chart、typography、icon 或 css-svg。相邻镜头应在尺度、视角、密度、布局或媒介上产生可感知变化。10–15 镜成片通常至少使用 3 种构图家族，但不要机械凑数。`;

const HTML = `
- 在安全布局合同内自由组织视觉区；不要把 split 当成默认模板。真实图片应通过裁切、层次、标注或运动参与叙事。
- 没有图片时按 SceneSpec 选择最贴合语义的原生视觉，不得自动回退成节点连线图。最终画面的准确性、辨识度和节奏优先于机械满足软数量预算。`;

const REWRITE = `
- 大改可以重新选择视觉媒介、尺度和构图逻辑，不要只重排旧卡片、边框和连接线。需要真实素材时输出完整 searchAction 或 assetRequest，让程序内部搜图继续处理。`;

export function buildGPTVisualFreedomGuidance(
  stage: GPTVisualStage,
  freedom: GPTCreativeFreedom = 'balanced',
): string {
  const level = freedom === 'open' ? OPEN_EXTRA : freedom === 'conservative' ? CONSERVATIVE_EXTRA : '';
  const stageGuidance = stage === 'director' ? DIRECTOR : stage === 'rewrite' ? REWRITE : HTML;
  return `${HARD_CONSTRAINTS}${SHARED_BALANCED}${level}${stageGuidance}`;
}

export function withGPTVisualFreedom(
  prompt: string,
  stage: GPTVisualStage,
  enabled = getCurrentGPTOptimizationSettings()?.enabled === true,
  settings: Pick<GPTOptimizationSettings, 'creativeFreedom'> | undefined = getCurrentGPTOptimizationSettings(),
): string {
  return enabled ? `${prompt}\n${buildGPTVisualFreedomGuidance(stage, settings?.creativeFreedom ?? 'balanced')}` : prompt;
}
