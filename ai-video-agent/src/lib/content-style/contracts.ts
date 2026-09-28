import type { CanvasPresetId, ProjectType } from '@/types';
import { canvasPromptSummary } from '@/lib/canvas-presets';
import { HTML_INTENT_OUTPUT_GUIDANCE } from '@/lib/prompts/html-native-visual';
import { OUTLINE_SYSTEM_HTML, OUTLINE_SYSTEM_IMAGE } from '@/lib/prompts/outline';

export function buildPlannerFixedContract(type: ProjectType, canvasPreset?: CanvasPresetId): string {
  const base = type === 'image'
    ? OUTLINE_SYSTEM_IMAGE
    : `${OUTLINE_SYSTEM_HTML}\n${HTML_INTENT_OUTPUT_GUIDANCE}`;
  return `${base}\n\n【项目画幅】${canvasPromptSummary(canvasPreset)}。所有画面意图和构图必须适配该固定画幅。`;
}

export const QUALITY_FIXED_CONTRACT = '必须依据原始用户要求、允许使用的证据和待审校大纲工作；不得编造事实或改变固定 Outline 数据契约。';

