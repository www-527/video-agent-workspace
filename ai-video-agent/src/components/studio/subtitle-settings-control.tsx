'use client';

import { useEffect, useRef, useState } from 'react';
import { Settings2, Subtitles } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useStudioStore } from '@/stores/studio-store';
import type { CanvasPresetId } from '@/types';
import { getCanvasPreset } from '@/lib/canvas-presets';

/** Global subtitle controls, colocated with the editor without becoming frame-specific. */
export function SubtitleSettingsControl({ canvasPreset }: { canvasPreset?: CanvasPresetId }) {
  const canvas = getCanvasPreset(canvasPreset);
  const showSubtitle = useStudioStore(s => s.showSubtitle);
  const setShowSubtitle = useStudioStore(s => s.setShowSubtitle);
  const horizontal = useStudioStore(s => s.subtitleHorizontal);
  const vertical = useStudioStore(s => s.subtitleVertical);
  const setHorizontal = useStudioStore(s => s.setSubtitleHorizontal);
  const setVertical = useStudioStore(s => s.setSubtitleVertical);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50/80 p-1" title="全局字幕设置">
      <button
        type="button"
        className="flex h-7 items-center gap-1.5 rounded px-1.5 text-xs text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="打开全局字幕设置"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(value => !value)}
      >
        <Subtitles className="h-4 w-4" />
        <span>字幕</span>
        <Settings2 className="h-3.5 w-3.5" />
      </button>
      <Switch aria-label="切换全局字幕显示" checked={showSubtitle} onCheckedChange={setShowSubtitle} />

      {open && (
        <div
          role="dialog"
          aria-label="全局字幕设置"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 rounded-lg border border-slate-200 bg-white p-3.5 shadow-lg shadow-slate-900/10"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-800">字幕位置</p>
              <p className="mt-0.5 text-[11px] text-slate-500">应用于所有分镜，并在预览中实时生效</p>
            </div>
            <button
              type="button"
              className="rounded px-1.5 py-1 text-[11px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setHorizontal(canvas.subtitle.horizontal);
                setVertical(canvas.subtitle.vertical);
              }}
            >
              重置
            </button>
          </div>
          <SubtitlePositionSlider label="水平位置" value={horizontal} min={canvas.subtitle.horizontalRange[0]} max={canvas.subtitle.horizontalRange[1]} onChange={setHorizontal} />
          <div className="my-3 h-px bg-slate-100" />
          <SubtitlePositionSlider label="垂直位置" value={vertical} min={canvas.subtitle.verticalRange[0]} max={canvas.subtitle.verticalRange[1]} onChange={setVertical} />
        </div>
      )}
    </div>
  );
}

function SubtitlePositionSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="min-w-9 rounded bg-slate-100 px-1.5 py-0.5 text-center tabular-nums text-slate-600">{value}%</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        onChange={event => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
    </label>
  );
}
