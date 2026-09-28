'use client';

import { useState } from 'react';
import { Volume2, RefreshCw, Loader2, ChevronDown, ChevronRight, Code2, ImageIcon, ExternalLink, ShieldCheck, AlertTriangle, Save, Trash2, Plus, Play } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useStudioStore } from '@/stores/studio-store';
import { HtmlThumb } from '@/components/studio/html-thumb';
import { useFrameGenerationController } from '@/components/studio/frame-generation-context';
import type { ProjectDetail } from '@/types';
import { getCanvasPreset, isPortraitPreset } from '@/lib/canvas-presets';
import { Badge } from '@/components/ui/badge';
import { BUILTIN_CONTENT_STYLE_PRESETS } from '@/lib/content-style/presets';

interface OutlineDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: ProjectDetail;
  onProjectChange: (p: ProjectDetail) => void;
  onConfirmAndGenerate?: () => Promise<void>;
  confirming?: boolean;
}

export function OutlineDialog({ open, onOpenChange, project, onProjectChange, onConfirmAndGenerate, confirming = false }: OutlineDialogProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visualPromptDrafts, setVisualPromptDrafts] = useState<Record<string, string>>({});
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({});
  const [narrationDrafts, setNarrationDrafts] = useState<Record<string, string>>({});
  const [savingFrameId, setSavingFrameId] = useState<string | null>(null);
  const setSelectedFrameId = useStudioStore(s => s.setSelectedFrameId);
  const qc = useQueryClient();
  const { generating: visualGenerating, start: startVisualGeneration } = useFrameGenerationController();

  async function refreshProject() {
    const res = await fetch(`/api/projects/${project.uuid}`);
    if (!res.ok) throw new Error('刷新项目失败');
    const data = await res.json();
    onProjectChange(data);
  }

  async function regenerateVisual(frameId: string, promptOverride: string) {
    const firstFrameId = project.outline?.frames[0]?.id;
    await startVisualGeneration([frameId], {
      forceVisual: true,
      sampleOnly: project.type === 'html' && frameId === firstFrameId,
      promptOverride: promptOverride.trim(),
    });
  }

  async function applyFrameDraft(frameId: string, mode: 'modify' | 'delete' | 'add') {
    const frame = frames.find(item => item.id === frameId);
    if (!frame) return;
    if (mode === 'delete' && !window.confirm(`确认删除第 ${frame.index} 镜《${frame.title}》？`)) return;

    const visualPrompt = visualPromptDrafts[frame.id] ?? (
      (project.type === 'image' ? frame.imagePrompt : frame.htmlPrompt)
      || (project.workflow === 'gpt-free' && project.type === 'html' ? frame.sceneSpec?.visualIntent : undefined)
      || ''
    );
    const draft = mode === 'add'
      ? {
          operation: 'add',
          insertAfterIndex: frame.index,
          title: '新分镜',
          narration: '',
          visualPrompt: '',
          baseUpdatedAt: project.updatedAt,
        }
      : {
          operation: mode,
          targetFrameId: frame.id,
          title: titleDrafts[frame.id] ?? frame.title,
          narration: narrationDrafts[frame.id] ?? frame.narration,
          visualPrompt,
          imagePrompt: project.type === 'image' ? visualPrompt : frame.imagePrompt,
          htmlPrompt: project.type === 'html' ? visualPrompt : frame.htmlPrompt,
          sceneSpec: frame.sceneSpec,
          baseUpdatedAt: project.updatedAt,
        };

    setSavingFrameId(frameId);
    try {
      const res = await fetch(`/api/projects/${project.uuid}/frame-drafts/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft }),
      });
      const data = await res.json().catch(() => ({})) as { project?: ProjectDetail; frameId?: string; error?: string };
      if (!res.ok || !data.project) throw new Error(data.error || '保存分镜失败');
      onProjectChange(data.project);
      qc.invalidateQueries({ queryKey: ['project', project.uuid] });
      if (mode === 'delete') setExpandedId(null);
      if (mode === 'add' && data.frameId) setExpandedId(data.frameId);
      toast.success(mode === 'delete' ? '分镜已删除' : mode === 'add' ? '已新增分镜' : '分镜已保存');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingFrameId(null);
    }
  }

  const regenTTS = useMutation({
    mutationFn: async (frameId: string) => {
      const res = await fetch(`/api/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.uuid, frameId, regen: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '旁白重新生成失败');
      return data;
    },
    onSuccess: () => {
      toast.success('旁白已重新生成');
      qc.invalidateQueries({ queryKey: ['project', project.uuid] });
      refreshProject().catch(() => {});
    },
    onError: e => toast.error((e as Error).message),
  });

  if (!project.outline) return null;

  const frames = project.outline.frames;
  const isFreeWorkflow = project.workflow === 'gpt-free';
  const sources = project.videoSource?.frames ?? [];
  const hasApprovedAnchor = Boolean(project.outline.visualAnchor?.approvedFrameIds.length);
  const contentStyleTrace = project.outline.contentStyleTrace;
  const contentStyleName = BUILTIN_CONTENT_STYLE_PRESETS.find(preset => preset.id === contentStyleTrace?.presetId)?.name
    || contentStyleTrace?.presetId;

  function playAudio(path?: string) {
    if (!path) return;
    const audio = new Audio(path);
    audio.play().catch(() => {});
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] min-h-0 max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{project.outline.title}</span>
            <span className="text-xs font-normal text-muted-foreground">
              · {frames.length} 个分镜 · {Math.round(project.outline.totalDuration)}秒
            </span>
          </DialogTitle>
          <DialogDescription>{isFreeWorkflow ? 'GPT 自由创作会自动生成全部镜头与旁白；此处仅用于查看或手动编辑大纲。' : '先确认口播、分镜顺序和画面意图；确认后将立即生成完整视频。'}</DialogDescription>
        </DialogHeader>

        {contentStyleTrace ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
            <Badge variant="secondary">{contentStyleName}</Badge>
            <span className="text-muted-foreground">Planner {contentStyleTrace.plannerPromptVersionId}</span>
            <span className="text-muted-foreground">Quality {contentStyleTrace.qualityPromptVersionId}</span>
            {project.outline.creativeBrief ? (
              <span className="min-w-0 flex-1 truncate" title={project.outline.creativeBrief.coreMessage}>
                核心主张：{project.outline.creativeBrief.coreMessage}
              </span>
            ) : null}
          </div>
        ) : null}

        {project.outline.research ? (
          <div className={cn(
            'rounded-lg border px-3 py-2',
            project.outline.research.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50',
          )}>
            <div className="flex items-start gap-2">
              {project.outline.research.status === 'failed'
                ? <AlertTriangle className="mt-0.5 h-4 w-4 text-red-600" />
                : <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-700" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {project.outline.research.status === 'failed' ? '联网核实失败' : '联网事实核实'}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {project.outline.research.riskLevel || 'medium'} 风险 · {project.outline.research.sources.length} 个精选来源 · {project.outline.research.evidenceCards?.length || 0} 张证据卡
                  </span>
                </p>
                {project.outline.research.status === 'failed' ? (
                  <p className="mt-1 text-xs text-red-700">请在确认内容计划前人工核实数字、日期、价格、政策和人物现职。</p>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {project.outline.research.sources.map((source, index) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex max-w-[260px] items-center gap-1 truncate text-emerald-800 underline-offset-2 hover:underline"
                        title={source.title}
                      >
                        S{index + 1} {source.title}
                        <ExternalLink className="h-3 w-3 flex-none" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {!isFreeWorkflow && project.outline.contentAudit?.issues.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-sm font-medium text-amber-900">请人工留意这些文案提示</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-800">
              {project.outline.contentAudit.issues.map(issue => <li key={issue}>{issue}</li>)}
            </ul>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          <div className="space-y-3 pb-4">
            {frames.map((f, i) => {
              const fs = sources[i];
              const isExpanded = expandedId === f.id;
              const isFirstFrame = i === 0;
              const firstFrameRegenLocked = isFirstFrame && hasApprovedAnchor;
              const visualPrompt = visualPromptDrafts[f.id] ?? (
                (project.type === 'image' ? f.imagePrompt : f.htmlPrompt)
                || (isFreeWorkflow && project.type === 'html' ? f.sceneSpec?.visualIntent : undefined)
                || ''
              );
              const titleDraft = titleDrafts[f.id] ?? f.title;
              const narrationDraft = narrationDrafts[f.id] ?? f.narration;
              return (
                <div key={f.id} className="overflow-hidden rounded-lg border bg-white">
                  <div
                    className="flex cursor-pointer items-center gap-3 p-3 hover:bg-slate-50"
                    onClick={() => {
                      setExpandedId(isExpanded ? null : f.id);
                      setSelectedFrameId(f.id);
                    }}
                  >
                    {/* 缩略图 */}
                    <div
                      className="flex-shrink-0 overflow-hidden rounded-md bg-slate-100"
                      style={{
                        width: isPortraitPreset(project.canvasPreset) ? 36 : 96,
                        aspectRatio: `${getCanvasPreset(project.canvasPreset).design.width} / ${getCanvasPreset(project.canvasPreset).design.height}`,
                      }}
                    >
                      {project.type === 'image' && fs?.imagePath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fs.imagePath} alt={f.title} className="h-full w-full object-cover" />
                      ) : project.type === 'html' && fs?.htmlCode ? (
                        <HtmlThumb
                          htmlCode={fs.htmlCode}
                          scale={0.075}
                          canvasPreset={project.canvasPreset}
                          frameDuration={fs.audioPath ? fs.audioDuration : f.sceneSpec?.durationHint}
                          title="完整大纲分镜缩略预览"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-400">
                          {project.type === 'image' ? <ImageIcon className="h-5 w-5" /> : <Code2 className="h-5 w-5" />}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono">
                          #{f.index}
                        </span>
                        <h4 className="truncate text-sm font-medium">{f.title}</h4>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{f.narration}</p>
                    </div>

                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={!fs?.audioPath}
                        onClick={() => playAudio(fs?.audioPath)}
                        title={fs?.audioPath ? '播放旁白' : '暂无旁白'}
                      >
                        <Volume2 className={cn('h-4 w-4', fs?.audioPath ? 'text-orange-500' : 'text-slate-300')} />
                      </Button>
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t bg-slate-50 p-3">
                      <div className="space-y-3">
                        <div>
                          <div className="mb-1 text-xs font-medium text-muted-foreground">标题</div>
                          <Input
                            value={titleDraft}
                            onChange={event => setTitleDrafts(previous => ({ ...previous, [f.id]: event.target.value }))}
                            className="h-8 bg-white text-sm"
                          />
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-muted-foreground">旁白</div>
                          <Textarea
                            value={narrationDraft}
                            onChange={event => setNarrationDrafts(previous => ({ ...previous, [f.id]: event.target.value }))}
                            className="min-h-[72px] resize-y bg-white text-sm"
                          />
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-muted-foreground">
                            画面提示词（{project.type === 'image' ? '用于搜图与画面描述' : '用于 HTML 动画'}）
                          </div>
                          <Textarea
                            value={visualPrompt}
                            onChange={event => setVisualPromptDrafts(previous => ({
                              ...previous,
                              [f.id]: event.target.value,
                            }))}
                            className="min-h-[72px] resize-y bg-white text-xs leading-relaxed text-slate-700"
                            aria-label={`编辑第 ${f.index} 镜画面提示词`}
                            data-testid={`visual-prompt-${f.id}`}
                          />
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            HTML 模式请用自然语言写清画面布局、关键状态或变化及结果；修改并保存后将作为最高优先级覆盖，用于重新生成画面。
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingFrameId === f.id || !titleDraft.trim()}
                            onClick={() => void applyFrameDraft(f.id, 'modify')}
                          >
                            {savingFrameId === f.id ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Save className="mr-1 h-3.5 w-3.5" />
                            )}
                            保存到大纲
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={visualGenerating || !visualPrompt.trim() || firstFrameRegenLocked}
                            onClick={() => void regenerateVisual(f.id, visualPrompt)}
                            data-testid={isFirstFrame ? 'regenerate-first-frame' : undefined}
                            title={firstFrameRegenLocked ? '主题风格已确认，不能重新生成首镜' : isFirstFrame ? '重新生成首镜画面' : '重新生成当前画面'}
                          >
                            {visualGenerating ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-1 h-3.5 w-3.5" />
                            )}
                            {firstFrameRegenLocked ? '主题风格已确认' : isFirstFrame ? '重新生成首镜' : '重新生成画面'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={regenTTS.isPending}
                            onClick={() => regenTTS.mutate(f.id)}
                          >
                            {regenTTS.isPending ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-1 h-3.5 w-3.5" />
                            )}
                            重新生成旁白
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingFrameId === f.id}
                            onClick={() => void applyFrameDraft(f.id, 'add')}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            在此后新增
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingFrameId === f.id}
                            onClick={() => void applyFrameDraft(f.id, 'delete')}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            删除分镜
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {onConfirmAndGenerate ? (
          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>继续检查</Button>
            <Button onClick={() => void onConfirmAndGenerate()} disabled={confirming}>
              {confirming ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Play data-icon="inline-start" />}
              确认并生成视频
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
