'use client';

import { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFrameGenerationController } from '@/components/studio/frame-generation-context';
import { findAppliedFrameStructureIds } from '@/lib/collaboration';
import type { FrameStructureDraft, FrameStructureItemDraft, ProjectDetail } from '@/types';

interface Props {
  draft: FrameStructureDraft;
  project: ProjectDetail;
  onProjectChange: (project: ProjectDetail) => void;
  onAppendAssistantText?: (text: string) => void | Promise<void>;
}

export function FrameStructureReviewCard({ draft, project, onProjectChange, onAppendAssistantText }: Props) {
  const [frames, setFrames] = useState(() => draft.frames.map(item => ({ ...item })));
  const [applying, setApplying] = useState(false);
  const [closed, setClosed] = useState(false);
  const [appliedFrameIds, setAppliedFrameIds] = useState<string[] | null>(() => {
    if (!project.outline || project.updatedAt === draft.baseUpdatedAt) return null;
    return findAppliedFrameStructureIds(project.outline, draft);
  });
  const { start: startFrameGeneration } = useFrameGenerationController();
  const targetIndexes = draft.targetFrameIds
    .map(id => (project.outline?.frames.findIndex(frame => frame.id === id) ?? -1) + 1)
    .filter(index => index > 0);

  function updateFrame(index: number, patch: Partial<FrameStructureItemDraft>) {
    setFrames(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  async function applyAndGenerate() {
    setApplying(true);
    const action = draft.operation === 'split' ? '拆分' : '合并';
    try {
      await onAppendAssistantText?.(`正在应用分镜${action}草稿，并准备重新生成受影响镜头。`);
      let frameIds = appliedFrameIds;
      if (!frameIds) {
        const normalizedFrames = frames.map(item => ({
          ...item,
          visualPrompt: visualPrompt(project.type, item),
          imagePrompt: project.type === 'image' ? visualPrompt(project.type, item) : item.imagePrompt,
          htmlPrompt: project.type === 'html' ? visualPrompt(project.type, item) : item.htmlPrompt,
        }));
        const response = await fetch(`/api/projects/${project.uuid}/frame-structure-drafts/apply`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            approveForGeneration: true,
            draft: { ...draft, frames: normalizedFrames },
          }),
        });
        const data = await response.json().catch(() => ({})) as { project?: ProjectDetail; frameIds?: string[]; error?: string };
        if (!response.ok || !data.project || !data.frameIds?.length) {
          throw new Error(data.error || '应用分镜结构草稿失败');
        }

        frameIds = data.frameIds;
        setAppliedFrameIds(frameIds);
        onProjectChange(data.project);
        toast.success(`已应用${action}，开始生成 ${frameIds.length} 个受影响镜头`);
        await onAppendAssistantText?.(`已完成分镜${action}并重排内容，正在重新生成受影响镜头的画面和配音。`);
      }

      const result = await startFrameGeneration(frameIds, { forceAudio: true });
      await onAppendAssistantText?.(
        result.status === 'completed'
          ? `分镜${action}及 ${frameIds.length} 个受影响镜头的画面和配音已全部完成。`
          : result.status === 'aborted'
            ? `受影响镜头的生成已取消，分镜${action}结果已经保留。`
            : `分镜${action}已经保存，但受影响镜头没有全部生成成功：${result.message || '请查看生成进度后重试。'}`,
      );
      // Keep the card available after a partial failure or cancellation. The
      // retry path keeps completed visuals and forces TTS again, so users can
      // recover a missing narration without reapplying the structure change.
      if (result.status === 'completed') setClosed(true);
    } catch (error) {
      toast.error((error as Error).message);
      await onAppendAssistantText?.(`分镜${action}处理失败：${(error as Error).message}`);
    } finally {
      setApplying(false);
    }
  }

  if (closed) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground">这份结构草稿已处理。</div>;
  }

  const targetLabel = targetIndexes.length > 1
    ? `第 ${targetIndexes[0]}–${targetIndexes[targetIndexes.length - 1]} 镜`
    : `第 ${targetIndexes[0] || '?'} 镜`;

  return (
    <div className="min-w-[300px] max-w-lg space-y-3 rounded-md border bg-slate-50 p-3">
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{draft.operation === 'split' ? '拆分分镜草稿' : '合并分镜草稿'}</p>
          <span className="rounded bg-white px-2 py-0.5 text-[11px] text-muted-foreground">{targetLabel}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {draft.operation === 'split'
            ? `确认后会在原位置形成 ${frames.length} 个连续镜头。`
            : `确认后会将 ${draft.targetFrameIds.length} 个连续镜头合成一个。`}
          {appliedFrameIds ? ' 结构已经应用；生成尚未完成，可以直接重试，不会重复修改分镜。' : ''}
        </p>
      </div>

      {frames.map((item, index) => (
        <div key={index} className="space-y-2 rounded border bg-white p-2">
          <p className="text-xs font-medium text-muted-foreground">结果镜头 {index + 1}</p>
          <Input
            value={item.title}
            onChange={event => updateFrame(index, { title: event.target.value })}
            className="h-8 text-sm"
            aria-label={`结果镜头 ${index + 1} 标题`}
          />
          <Textarea
            value={item.narration}
            onChange={event => updateFrame(index, { narration: event.target.value })}
            className="min-h-[68px] text-sm"
            aria-label={`结果镜头 ${index + 1} 旁白`}
          />
          <Textarea
            value={visualPrompt(project.type, item)}
            onChange={event => updateFrame(index, { visualPrompt: event.target.value })}
            className="min-h-[80px] text-xs leading-relaxed"
            aria-label={`结果镜头 ${index + 1} 画面意图`}
          />
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={applying || frames.some(item => !item.title.trim())} onClick={() => void applyAndGenerate()}>
          {applying ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
          {appliedFrameIds ? '重试生成画面和配音' : '应用并重生成画面和配音'}
        </Button>
        <Button size="sm" variant="ghost" disabled={applying} onClick={() => setClosed(true)}>
          <X className="mr-1 h-3.5 w-3.5" />
          取消
        </Button>
      </div>
    </div>
  );
}

function visualPrompt(type: ProjectDetail['type'], item: FrameStructureItemDraft) {
  if (item.visualPrompt !== undefined) return item.visualPrompt;
  if (type === 'html') return item.htmlPrompt || item.sceneSpec?.visualIntent || '';
  return item.imagePrompt || '';
}
