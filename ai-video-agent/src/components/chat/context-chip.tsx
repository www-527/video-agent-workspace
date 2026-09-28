'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStudioStore } from '@/stores/studio-store';
import type { ProjectDetail } from '@/types';

export function ContextChip({ project }: { project: ProjectDetail }) {
  const selectedFrameId = useStudioStore(state => state.selectedFrameId);
  const selectedElement = useStudioStore(state => state.selectedElement);
  const selectedElementIds = useStudioStore(state => state.selectedElementIds);
  const setSelectedFrameId = useStudioStore(state => state.setSelectedFrameId);
  const setSelectedElement = useStudioStore(state => state.setSelectedElement);
  const setSelectedElementIds = useStudioStore(state => state.setSelectedElementIds);
  if (!project.outline?.frames.length) return null;
  const frameIndex = selectedFrameId
    ? project.outline.frames.findIndex(frame => frame.id === selectedFrameId)
    : -1;
  const label = frameIndex >= 0
    ? selectedElementIds.length
      ? `第 ${frameIndex + 1} 镜 · ${selectedElement?.label || '已选元素'}`
      : `第 ${frameIndex + 1} 镜`
    : '完整视频';

  return (
    <div className="mb-1.5 flex items-center">
      <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/15 bg-primary/5 pl-2.5 text-[11px] text-primary">
        <span className="truncate">正在讨论：{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 rounded-full text-primary/70 hover:bg-primary/10 hover:text-primary"
          title="清除讨论范围"
          onClick={() => {
            setSelectedFrameId(null);
            setSelectedElement(null);
            setSelectedElementIds([]);
          }}
        >
          <X className="size-3" />
        </Button>
      </span>
    </div>
  );
}
