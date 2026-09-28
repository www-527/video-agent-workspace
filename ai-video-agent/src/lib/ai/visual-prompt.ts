import type { FrameOutline } from '@/types';

/**
 * A manually edited HTML visual prompt replaces the previous visual design.
 * Keep the script metadata, but discard the old director SceneSpec so stale
 * subjects, actions, and asset hints cannot leak into the next render.
 */
export function applyHtmlPromptOverride(frame: FrameOutline, htmlPrompt: string): FrameOutline {
  return {
    ...frame,
    htmlPrompt,
    sceneSpec: undefined,
  };
}
