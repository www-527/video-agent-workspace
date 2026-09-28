'use client';

import type { SubtitleCue } from '@/lib/subtitle';
import { useStudioStore } from '@/stores/studio-store';
import { getCanvasPreset } from '@/lib/canvas-presets';
import { getSubtitleVisualStyle, subtitleFontSizeForCanvas } from '@/lib/subtitle-style';
import type { CanvasPresetId } from '@/types';

interface SubtitleLayerProps {
  cues: SubtitleCue[];
  currentTime: number;
  canvasPreset?: CanvasPresetId;
}

export { subtitleFontSizeForCanvas } from '@/lib/subtitle-style';

export function SubtitleLayer({ cues, currentTime, canvasPreset }: SubtitleLayerProps) {
  const preset = getCanvasPreset(canvasPreset);
  const visualStyle = getSubtitleVisualStyle(canvasPreset);
  const activeText = cues.find(cue => currentTime >= cue.startTime && currentTime < cue.endTime)?.text ?? '';
  const horizontal = useStudioStore(s => s.subtitleHorizontal);
  const vertical = useStudioStore(s => s.subtitleVertical);
  const safeHorizontal = Math.max(preset.subtitle.horizontalRange[0], Math.min(preset.subtitle.horizontalRange[1], horizontal));
  const safeVertical = Math.max(preset.subtitle.verticalRange[0], Math.min(preset.subtitle.verticalRange[1], vertical));

  if (!activeText) return null;

  return (
    <div className="pointer-events-none absolute inset-0" style={{ containerType: 'inline-size' }}>
      <div
        className="absolute -translate-x-1/2 text-center transition-[left,bottom] duration-150 ease-out"
        style={{
          left: `${safeHorizontal}%`,
          bottom: `${safeVertical}%`,
          width: `${visualStyle.maxWidth / preset.design.width * 100}%`,
        }}
        data-testid="subtitle-positioner"
      >
        <p
          className="text-center font-semibold text-white"
          style={{
            letterSpacing: visualStyle.letterSpacing,
            fontSize: subtitleFontSizeForCanvas(canvasPreset),
            lineHeight: visualStyle.lineHeight,
            textShadow: visualStyle.textShadow,
          }}
        >
          {activeText}
        </p>
      </div>
    </div>
  );
}
