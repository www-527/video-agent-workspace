'use client';

import { useState, useEffect } from 'react';
import { Check, ZoomIn, Loader2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProjectDetail, StylePreset } from '@/types';
import { getCanvasPreset } from '@/lib/canvas-presets';

interface StylePickerDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: ProjectDetail;
  onProjectChange: (p: ProjectDetail) => void;
}

export function StylePickerDialog({ open, onOpenChange, project, onProjectChange }: StylePickerDialogProps) {
  const canvas = getCanvasPreset(project.canvasPreset);
  const [styles, setStyles] = useState<StylePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [previewStyle, setPreviewStyle] = useState<StylePreset | null>(null);
  const [recommendedStyleIds, setRecommendedStyleIds] = useState<string[]>([]);
  const resolvedStyleId = ({ 'cyber-clean': 'signal-grid', 'terminal-matrix': 'blueprint', 'warm-story': 'warm-archive' } as Record<string, string>)[project.styleId || ''] || project.styleId;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const context = `${project.title} ${project.outline?.script || project.outline?.frames.map(frame => frame.narration).join(' ') || ''}`.slice(0, 1200);
    fetch(`/api/styles?q=${encodeURIComponent(context)}`)
      .then(r => r.json())
      .then(d => {
        setStyles(d.styles || []);
        setRecommendedStyleIds(d.recommendedStyleIds || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [open]);

  /**
   * 选择风格（不关闭弹窗）
   */
  async function selectStyle(id: string) {
    if (savingId) return; // 防重
    setSavingId(id);
    try {
      onProjectChange({ ...project, styleId: id });
      await fetch(`/api/projects/${project.uuid}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ styleId: id }),
      });
      // ⭐ 不再 onOpenChange(false) — 弹窗保持打开，用户可继续浏览/预览
    } catch {
      // 静默失败
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      {/* 主弹窗：选择风格 */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[85vh] max-h-[85vh] min-h-0 max-w-4xl flex-col overflow-hidden">
          <DialogHeader className="flex-none pr-8">
            <DialogTitle>选择视觉风格</DialogTitle>
            <DialogDescription>
              14 套主题均由可复用 Token 驱动。选择与内容关系最贴合的方向，再查看动态样片。
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              加载中...
            </div>
          ) : (
            <ScrollArea type="always" className="min-h-0 flex-1 pr-3" data-testid="style-picker-scroll-area">
              <div className="grid grid-cols-1 gap-3 pb-1 md:grid-cols-3">
                {styles.map(s => {
                const selected = (resolvedStyleId || styles[0]?.id) === s.id;
                const isSaving = savingId === s.id;
                return (
                  <div
                    key={s.id}
                    className={cn(
                      'group relative overflow-hidden rounded-xl border-2 transition-all',
                      selected ? 'border-primary shadow-md' : 'border-slate-200 hover:border-slate-300',
                    )}
                  >
                    {/* 主选择按钮（覆盖缩略图+标题） */}
                    <button
                      type="button"
                      onClick={() => selectStyle(s.id)}
                      disabled={!!savingId}
                      aria-label={`选择视觉风格：${s.name}`}
                      className="block w-full text-left disabled:opacity-60"
                    >
                      <div className="relative mx-auto w-full overflow-hidden bg-slate-100" style={{ aspectRatio: `${canvas.design.width} / ${canvas.design.height}` }}>
                        <iframe
                          title={s.name}
                          srcDoc={stylePreviewHtml(s.demoHtml, canvas.design)}
                          sandbox="allow-scripts"
                          className="pointer-events-none h-full w-full"
                        />
                        {isSaving && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <Loader2 className="h-5 w-5 animate-spin text-white" />
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold">{s.name}</h4>
                          <div className="flex items-center gap-2">
                            {recommendedStyleIds.includes(s.id) && (
                              <span className="text-[10px] font-medium text-emerald-700">内容推荐</span>
                            )}
                            {selected && !isSaving && <Check className="h-4 w-4 text-primary" />}
                          </div>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {s.description}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(s.bestFor || []).slice(0, 2).map(item => (
                            <span key={item} className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>

                    {/* 放大镜按钮 - 浮在右上角 */}
                    <button
                      type="button"
                      onClick={() => setPreviewStyle(s)}
                      aria-label={`放大预览：${s.name}`}
                      className="absolute top-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                      title="放大预览"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                  </div>
                );
                })}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* 预览弹窗 - 嵌套 Dialog */}
      <StylePreviewDialog
        style={previewStyle}
        canvasPreset={project.canvasPreset}
        onClose={() => setPreviewStyle(null)}
      />
    </>
  );
}

/**
 * 风格预览大弹窗
 */
function StylePreviewDialog({
  style,
  canvasPreset,
  onClose,
}: {
  style: StylePreset | null;
  canvasPreset: ProjectDetail['canvasPreset'];
  onClose: () => void;
}) {
  const canvas = getCanvasPreset(canvasPreset);
  return (
    <Dialog open={!!style} onOpenChange={(o) => !o && onClose()}>
      <DialogContent hideClose className="max-w-6xl max-h-[92vh] p-0 overflow-hidden">
        {style && (
          <div className="flex flex-col">
            {/* 顶部信息条 */}
            <div className="flex items-start justify-between gap-4 border-b bg-white p-5">
              <div>
                <h2 className="text-xl font-semibold">{style.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{style.description}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="flex-shrink-0"
                title="关闭预览"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="relative mx-auto max-h-[68vh] bg-slate-100" style={{ aspectRatio: `${canvas.design.width} / ${canvas.design.height}`, width: canvas.id === 'douyin-portrait-9-16' ? 'min(100%, 430px)' : '100%' }}>
              <iframe
                title={`${style.name} 预览`}
                srcDoc={stylePreviewHtml(style.demoHtml, canvas.design)}
                sandbox="allow-scripts"
                className="h-full w-full"
              />
            </div>

            {/* 底部 Token 信息 */}
            <div className="border-t bg-slate-50 p-4">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                主题 Token（确认主题风格后供后续生成共同使用）
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-white p-3 text-xs leading-relaxed text-slate-700">
                {style.prompt}
              </pre>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function stylePreviewHtml(html: string, design: { width: number; height: number }): string {
  return html.replace('1280 × 720', `${design.width} × ${design.height}`);
}
