'use client';

import { useMemo, useState } from 'react';
import { Check, Loader2, Play, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFrameGenerationController } from '@/components/studio/frame-generation-context';
import type { FrameReviewDraft, ProjectDetail } from '@/types';

interface FrameReviewCardProps {
  draft: FrameReviewDraft;
  project: ProjectDetail;
  onProjectChange: (project: ProjectDetail) => void;
  onSendText?: (text: string) => void;
  onRewriteDraft?: (text: string, draft: FrameReviewDraft) => void;
  onAppendAssistantText?: (text: string) => void | Promise<void>;
}

export function FrameReviewCard({ draft, project, onProjectChange, onSendText, onRewriteDraft, onAppendAssistantText }: FrameReviewCardProps) {
  const [workingDraft, setWorkingDraft] = useState(draft);
  const [title, setTitle] = useState(draft.title);
  const [narration, setNarration] = useState(draft.narration);
  const [visualPrompt, setVisualPrompt] = useState(initialVisualPrompt(project.type, draft));
  const [insertAfterIndex, setInsertAfterIndex] = useState(draft.insertAfterIndex ?? project.outline?.frames.length ?? 0);
  const [applying, setApplying] = useState<'outline' | 'generate' | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const { start: startFrameGeneration } = useFrameGenerationController();

  const totalFrames = project.outline?.frames.length ?? 0;
  const operationLabel = useMemo(() => {
    if (workingDraft.operation === 'add') return '新增分镜草稿';
    if (workingDraft.operation === 'delete') return '删除分镜确认';
    return '修改分镜草稿';
  }, [workingDraft.operation]);
  const targetLabel = workingDraft.operation === 'add'
    ? `插入位置：${insertAfterIndex <= 0 ? '片头' : insertAfterIndex >= totalFrames ? '片尾' : `第 ${insertAfterIndex} 镜之后`}`
    : findFrameLabel(project, workingDraft.targetFrameId);
  const incompleteHtmlVisual = project.type === 'html'
    && workingDraft.operation !== 'delete'
    && !isCompleteHtmlPrompt(visualPrompt);

  async function applyDraft(mode: 'outline' | 'generate') {
    setApplying(mode);
    const deletingFrameIndex = findFrameIndex(project, workingDraft.targetFrameId);
    const deletingTitle = title;
    const frameLabel = workingDraft.operation === 'add'
      ? '新增分镜'
      : deletingFrameIndex ? `第 ${deletingFrameIndex} 镜` : '当前分镜';
    try {
      await onAppendAssistantText?.(
        mode === 'generate'
          ? `正在应用${frameLabel}草稿，随后会重新生成画面和配音。`
          : `正在把${frameLabel}草稿应用到内容计划。`,
      );
      const response = await fetch(`/api/projects/${project.uuid}/frame-drafts/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          approveForGeneration: mode === 'generate',
          draft: {
            ...workingDraft,
            title,
            narration,
            visualPrompt,
            imagePrompt: project.type === 'image' ? visualPrompt : workingDraft.imagePrompt,
            htmlPrompt: project.type === 'html' ? visualPrompt : workingDraft.htmlPrompt,
            sceneSpec: project.type === 'html' && !hasMeaningfulSceneSpec(workingDraft.sceneSpec)
              ? undefined
              : workingDraft.sceneSpec,
            insertAfterIndex,
          },
        }),
      });
      const data = await response.json().catch(() => ({})) as { project?: ProjectDetail; frameId?: string; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || '应用分镜草稿失败');

      onProjectChange(data.project);
      setWorkingDraft(current => ({
        ...current,
        operation: data.frameId && current.operation !== 'delete' ? 'modify' : current.operation,
        targetFrameId: data.frameId || current.targetFrameId,
        insertAfterIndex: data.frameId ? ((findFrameIndex(data.project!, data.frameId) ?? 1) - 1) : current.insertAfterIndex,
        baseUpdatedAt: data.project!.updatedAt,
      }));
      toast.success(mode === 'generate' ? '已应用，开始重生成画面和配音' : '已应用');
      if (workingDraft.operation === 'delete') {
        const deletedLabel = deletingFrameIndex ? `第 ${deletingFrameIndex} 镜` : '这个分镜';
        await onAppendAssistantText?.(`已删除${deletedLabel}《${deletingTitle}》，我已经重排大纲并移除对应媒体。`);
        setCancelled(true);
      } else if (mode === 'generate' && data.frameId) {
        await onAppendAssistantText?.(`${frameLabel}草稿已应用，正在生成新画面和配音。`);
        // The draft application deliberately clears the previous frame artifact.  Force both
        // stages as well so a reworked shot cannot reuse a stale visual task-cache entry.
        const result = await startFrameGeneration([data.frameId], {
          forceVisual: true,
          forceAudio: true,
          ...(workingDraft.freshStart ? { freshStart: true } : {}),
        });
        await onAppendAssistantText?.(
          result.status === 'completed'
            ? `${frameLabel}的画面和配音已生成完成，可以在预览区查看。`
            : result.status === 'aborted'
              ? `${frameLabel}的生成已取消，草稿修改已经保留。`
              : `${frameLabel}没有全部生成成功：${result.message || '请查看生成进度后重试。'}`,
        );
      } else {
        await onAppendAssistantText?.(`${frameLabel}草稿已应用到内容计划。`);
      }
    } catch (error) {
      toast.error((error as Error).message);
      await onAppendAssistantText?.(`${frameLabel}处理失败：${(error as Error).message}`);
    } finally {
      setApplying(null);
    }
  }

  function askRevision() {
    if (!onSendText && !onRewriteDraft) return;
    const modeInstruction = project.type === 'html'
      ? '当前项目是 html 模式：请生成 htmlPrompt 和 sceneSpec，不要输出 imagePrompt。'
      : '当前项目是 image 模式：请生成 imagePrompt，不要输出 htmlPrompt。';

    const currentDraft: FrameReviewDraft = {
      ...workingDraft,
      title,
      narration,
      visualPrompt,
      imagePrompt: project.type === 'image' ? visualPrompt : workingDraft.imagePrompt,
      htmlPrompt: project.type === 'html' ? visualPrompt : workingDraft.htmlPrompt,
    };
    const sendRevision = (text: string, nextDraft = currentDraft) => {
      if (workingDraft.operation === 'modify' && onRewriteDraft) onRewriteDraft(text, nextDraft);
      else onSendText?.(text);
    };

    if (workingDraft.operation === 'add') {
      sendRevision([
        `请在第 ${insertAfterIndex} 镜之后新增一条分镜草稿，并基于下面这版大改，不要只做轻微润色。`,
        modeInstruction,
        '要求：重新设计叙事角度、旁白表达和画面提示词；保留事实准确性和分镜主题，但句式、信息组织、视觉呈现都要明显不同。HTML 模式请用自然语言写清画面布局、关键状态或变化及结果。',
        `当前标题：「${title}」`,
        `当前旁白：「${narration}」`,
        `当前画面提示词：「${visualPrompt}」`,
      ].join('\n'));
      return;
    }

    const targetText = `第 ${findFrameIndex(project, workingDraft.targetFrameId) || ''} 镜`;
    sendRevision([
      `请将${targetText}作为一片空白的新镜头重新生成。`,
      modeInstruction,
      '不要参考、改写或保留当前草稿的标题、旁白、画面提示词、SceneSpec、构图、视觉锚点或历史对话约束。请复用“新增分镜”的首次生成链路，只根据项目内容位置创作一个全新的镜头；HTML 模式请用自然语言写清画面布局、关键状态或变化及结果。',
    ].join('\n'), { ...currentDraft, freshStart: true });
  }

  if (cancelled) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
        已取消这个草稿。
      </div>
    );
  }

  return (
    <div className="min-w-[280px] max-w-md space-y-3 rounded-md border bg-slate-50 p-3">
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{operationLabel}</p>
          <span className="rounded bg-white px-2 py-0.5 text-[11px] text-muted-foreground">{targetLabel}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {workingDraft.operation === 'delete' ? '确认后才会删除并重排大纲。' : '可以先编辑，再应用并重生成画面和配音。'}
        </p>
      </div>

      {workingDraft.operation === 'add' ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">插入到第几镜之后</label>
          <Input
            type="number"
            min={0}
            max={totalFrames}
            value={insertAfterIndex}
            onChange={event => setInsertAfterIndex(clamp(Number(event.target.value), 0, totalFrames))}
            className="h-8 bg-white text-sm"
          />
        </div>
      ) : null}

      {workingDraft.operation !== 'delete' ? (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">标题</label>
            <Input value={title} onChange={event => setTitle(event.target.value)} className="h-8 bg-white text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">旁白</label>
            <Textarea value={narration} onChange={event => setNarration(event.target.value)} className="min-h-[72px] bg-white text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {project.type === 'html' ? '画面提示词（用于 HTML 动画）' : '画面意图'}
            </label>
            <Textarea value={visualPrompt} onChange={event => setVisualPrompt(event.target.value)} className="min-h-[88px] bg-white text-xs leading-relaxed" />
            {incompleteHtmlVisual ? (
              <p className="mt-1 rounded bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-700">
                画面提示词生成不完整。请点击“让 AI 大改一版”，或补全画面布局、关键状态或变化结果后再生成。
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <div className="space-y-2 rounded border bg-white p-2 text-sm">
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground">{narration}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {workingDraft.operation === 'delete' ? (
          <Button size="sm" variant="destructive" disabled={Boolean(applying)} onClick={() => void applyDraft('outline')}>
            {applying === 'outline' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
            确认删除
          </Button>
        ) : (
          <Button size="sm" disabled={Boolean(applying) || !title.trim() || incompleteHtmlVisual} onClick={() => void applyDraft('generate')}>
            {applying === 'generate' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
            应用并重生成画面和配音
          </Button>
        )}
        {workingDraft.operation !== 'delete' ? (
          <Button size="sm" variant="outline" disabled={Boolean(applying)} onClick={askRevision}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
          从空白镜头重做
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={Boolean(applying)} onClick={() => setCancelled(true)}>
          <X className="mr-1 h-3.5 w-3.5" />
          取消
        </Button>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(value, max));
}

function findFrameIndex(project: ProjectDetail, frameId?: string) {
  const index = project.outline?.frames.findIndex(frame => frame.id === frameId) ?? -1;
  return index >= 0 ? index + 1 : undefined;
}

function findFrameLabel(project: ProjectDetail, frameId?: string) {
  const index = findFrameIndex(project, frameId);
  return index ? `第 ${index} 镜` : '当前分镜';
}

function initialVisualPrompt(type: ProjectDetail['type'], draft: FrameReviewDraft) {
  if (type === 'html') {
    if (isCompleteHtmlPrompt(draft.htmlPrompt)) return draft.htmlPrompt!;
    if (isCompleteHtmlPrompt(draft.visualPrompt) && draft.visualPrompt !== draft.imagePrompt) return draft.visualPrompt!;
    if (hasMeaningfulSceneSpec(draft.sceneSpec)) return visualPromptFromSceneSpec(draft.sceneSpec!);
    return draft.htmlPrompt || draft.visualPrompt || '';
  }
  return draft.visualPrompt || draft.imagePrompt || '';
}

function isCompleteHtmlPrompt(value?: string) {
  const text = value?.trim() || '';
  const isLegacyFieldFormat = text.includes('主角：')
    && text.includes('关系：')
    && (text.includes('屏幕文字：') || text.includes('屏幕短词：'));
  return isLegacyFieldFormat || (text.length >= 30 && /[。；]/.test(text));
}

function hasMeaningfulSceneSpec(sceneSpec: FrameReviewDraft['sceneSpec']) {
  return Boolean(sceneSpec?.focus && sceneSpec.focalElement && sceneSpec.actionSemantics && sceneSpec.visualIntent);
}

function visualPromptFromSceneSpec(sceneSpec: NonNullable<FrameReviewDraft['sceneSpec']>) {
  const screenText = sceneSpec.screenText?.length ? `屏幕文字显示“${sceneSpec.screenText.join(' / ')}”。` : '';
  return `画面以${sceneSpec.focalElement}为核心，${sceneSpec.actionSemantics}，让观众理解${sceneSpec.visualIntent}。${screenText}`;
}
