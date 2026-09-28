import { DEFAULT_CANVAS_PRESET } from '@/lib/canvas-presets';
import type { CanvasPresetId } from '@/types';

export async function createGPTFreeProject(canvasPreset: CanvasPresetId = DEFAULT_CANVAS_PRESET): Promise<string> {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'html',
      workflow: 'gpt-free',
      canvasPreset,
      contentStyle: { mode: 'inherit' },
      gptOptimization: { mode: 'inherit' },
    }),
  });
  const data = await response.json().catch(() => ({})) as { uuid?: string; error?: string };
  if (!response.ok || !data.uuid) throw new Error(data.error || '创建 GPT 自由创作项目失败');
  return data.uuid;
}
