'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, Check, ChevronDown, Maximize2, Move,
  Trash2, Type, Undo2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useStudioStore } from '@/stores/studio-store';
import { applyEditCommand, extractCompositeTextElements, extractEditableElements, extractFrameTextElements } from '@/lib/editor-command';
import { getFrameSourceForOutlineFrame } from '@/lib/video-source';
import type { EditCommand, EditOperation, ProjectDetail } from '@/types';
import { SubtitleSettingsControl } from './subtitle-settings-control';
import { CandidateImagesPanel } from './candidate-images-panel';
import { getCanvasPreset, isPortraitPreset } from '@/lib/canvas-presets';

export interface EditorPanelHandle {
  saveDraft: () => Promise<boolean>;
  discardDraft: () => void;
}

export const EditorPanel = forwardRef<EditorPanelHandle, { project: ProjectDetail; onProjectChange: (p: ProjectDetail) => void }>(function EditorPanel({ project, onProjectChange }, ref) {
  const frameId = useStudioStore(s => s.selectedFrameId);
  const selected = useStudioStore(s => s.selectedElement);
  const selectedElementIds = useStudioStore(s => s.selectedElementIds);
  const elementPanelFocus = useStudioStore(s => s.elementPanelFocus);
  const setSelected = useStudioStore(s => s.setSelectedElement);
  const setSelectedElementIds = useStudioStore(s => s.setSelectedElementIds);
  const setTunePreview = useStudioStore(s => s.setTunePreview);
  const requestEditorMeasurement = useStudioStore(s => s.requestEditorMeasurement);
  const frameHistory = useStudioStore(s => frameId ? s.editHistoryByFrame[frameId] : undefined);
  const pushHistory = useStudioStore(s => s.pushEditHistory);
  const setHistoryIndex = useStudioStore(s => s.setEditHistoryIndex);
  const setEditorDirty = useStudioStore(s => s.setEditorDirty);
  const clearElementPanelFocus = useStudioStore(s => s.clearElementPanelFocus);
  const [pending, setPending] = useState<EditCommand[]>([]);
  const [draftHtml, setDraftHtml] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [elementSectionOpen, setElementSectionOpen] = useState(true);
  const [locatedElementId, setLocatedElementId] = useState<string | null>(null);
  const [frameTextSearch, setFrameTextSearch] = useState('');
  const elementRefs = useRef(new Map<string, HTMLButtonElement>());
  const frameIndex = project.outline?.frames.findIndex(f => f.id === frameId) ?? -1;
  const source = getFrameSourceForOutlineFrame(project.videoSource, frameId, Math.max(0, frameIndex));
  const html = source?.htmlCode || '';
  const elements = useMemo(() => extractEditableElements(html), [html]);
  const frameTextElements = useMemo(() => extractFrameTextElements(draftHtml ?? html), [draftHtml, html]);
  const filteredFrameTextElements = useMemo(() => {
    const query = frameTextSearch.trim().toLocaleLowerCase();
    return query ? frameTextElements.filter(item => item.label.toLocaleLowerCase().includes(query)) : frameTextElements;
  }, [frameTextElements, frameTextSearch]);
  const compositeTextElements = useMemo(() => selected?.type !== 'text' && selected
    ? extractCompositeTextElements(draftHtml ?? html, selected.id)
    : [], [draftHtml, html, selected]);
  const history = frameHistory?.entries ?? [];
  const historyIndex = frameHistory?.index ?? -1;

  // Canvas selection is the only source that requests panel navigation. List
  // selection should remain quiet so it never fights a user's manual scroll.
  useEffect(() => {
    if (!elementPanelFocus || elementPanelFocus.frameId !== frameId) return;
    setElementSectionOpen(true);
    const target = elementRefs.current.get(elementPanelFocus.elementId);
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setLocatedElementId(elementPanelFocus.elementId);
      const timer = window.setTimeout(() => setLocatedElementId(null), 900);
      clearElementPanelFocus();
      return () => window.clearTimeout(timer);
    }
  }, [clearElementPanelFocus, elementPanelFocus, frameId, elements]);

  // A draft belongs to its source frame. Discard it when the storyboard
  // selection changes so it can never be saved into another frame.
  useEffect(() => {
    setPending([]); setDraftHtml(null); setTunePreview(null); setSelected(null);
  }, [frameId, setSelected, setTunePreview]);
  useEffect(() => {
    setEditorDirty(pending.length > 0);
    return () => setEditorDirty(false);
  }, [pending.length, setEditorDirty]);
  const frameLabel = frameIndex >= 0 ? `第 ${frameIndex + 1} 镜` : '未选择分镜';

  function stage(operation: EditOperation, changes: EditCommand['changes'] = {}, summary?: string, targetElementId?: string) {
    if (!frameId || !selected) return toast.error('请先选择画面中的元素');
    const command: EditCommand = {
      id: crypto.randomUUID(), operation, changes, frameId, elementId: targetElementId || selected.id,
      scope: 'element', preserve: ['narration', 'duration', 'otherElements'], source: 'direct',
      summary: summary || `${selected.label}：${Object.keys(changes).join('、')}`,
    };
    const nextHtml = applyEditCommand(draftHtml ?? html, command);
    setPending(items => [...items, command]);
    setDraftHtml(nextHtml);
    setTunePreview({ frameId, htmlCode: nextHtml });
    // Keep the inputs bound to the exact values the user entered. The iframe
    // will report its layout again after rendering, but it must not round or
    // replace a pending X/Y edit in the meantime.
    if (typeof changes.left === 'number' || typeof changes.top === 'number') {
      setSelected({ ...selected, values: {
        ...selected.values,
        x: typeof changes.left === 'number' ? changes.left : selected.values?.x,
        y: typeof changes.top === 'number' ? changes.top : selected.values?.y,
      } });
    }
  }

  function stagePosition(nextX: number, nextY: number, summary: string) {
    if (!selected || value?.x === undefined || value.y === undefined) {
      toast.message('正在读取元素位置，请稍后再试');
      return;
    }
    const canvas = getCanvasPreset(project.canvasPreset);
    const width = Math.max(0, value.width ?? 0);
    const height = Math.max(0, value.height ?? 0);
    const safeX = isPortraitPreset(project.canvasPreset)
      ? Math.max(canvas.contentArea.left, Math.min(canvas.contentArea.right - width, nextX))
      : Math.max(0, Math.min(canvas.design.width - width, nextX));
    const safeY = isPortraitPreset(project.canvasPreset)
      ? Math.max(canvas.contentArea.top, Math.min(canvas.contentArea.bottom - height, nextY))
      : Math.max(0, Math.min(canvas.design.height - height, nextY));
    const deltaX = safeX - value.x;
    const deltaY = safeY - value.y;
    if (!deltaX && !deltaY) return;
    stage('update_element', {
      ...(deltaX ? { canvasDeltaX: deltaX } : {}),
      ...(deltaY ? { canvasDeltaY: deltaY } : {}),
    }, summary, selected.geometryId || selected.id);
    setSelected({ ...selected, values: { ...selected.values, x: safeX, y: safeY } });
  }

  async function persistHtml(targetFrameId: string, htmlCode: string) {
    const response = await fetch(`/api/projects/${project.uuid}/frame-tunes/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ restore: { targetFrameId, htmlCode } }),
    });
    const data = await response.json().catch(() => ({})) as { project?: ProjectDetail; error?: string };
    if (!response.ok || !data.project) throw new Error(data.error || '保存修改失败');
    onProjectChange(data.project);
  }

  async function apply(): Promise<boolean> {
    if (!pending.length) return true;
    if (!draftHtml || !frameId || !project.videoSource || saving) return false;
    const afterHtml = draftHtml;
    const lastCommand = pending[pending.length - 1];
    const historyCommand = pending.length === 1 ? lastCommand : {
      ...lastCommand,
      id: crypto.randomUUID(),
      summary: `连续编辑 ${pending.length} 项：${pending.map(command => command.summary).slice(-3).join('；')}`,
    };
    setSaving(true);
    try {
      await persistHtml(frameId, afterHtml);
      pushHistory({ id: historyCommand.id, command: historyCommand, beforeHtml: html, afterHtml, createdAt: new Date().toISOString() });
      setTunePreview(null); setPending([]); setDraftHtml(null);
      toast.success('修改已保存');
      return true;
    } catch (error) {
      toast.error((error as Error).message);
      return false;
    } finally { setSaving(false); }
  }

  async function restore(targetHtml: string, nextIndex: number) {
    if (!frameId || !project.videoSource || saving) return;
    setSaving(true);
    try {
      await persistHtml(frameId, targetHtml);
      setHistoryIndex(frameId, nextIndex); setTunePreview(null);
    } catch (error) { toast.error((error as Error).message); }
    finally { setSaving(false); }
  }

  const cancelPending = () => {
    setPending([]); setDraftHtml(null); setTunePreview(null);
    requestEditorMeasurement();
  };
  useImperativeHandle(ref, () => ({ saveDraft: apply, discardDraft: cancelPending }));
  const value = selected?.values;
  const historyActionDisabled = saving || pending.length > 0;

  return <div className="h-full overflow-y-auto overscroll-contain bg-white">
    <div className="sticky top-0 z-20 flex min-h-12 items-center justify-between gap-2 border-b bg-white px-3 py-1.5">
      <div><div className="text-sm font-semibold">编辑面板</div><div className="text-[10px] text-muted-foreground">选择元素后直接调整</div></div>
      <div className="flex items-center gap-1">
        <SubtitleSettingsControl canvasPreset={project.canvasPreset} />
      </div>
    </div>
    <div className="overflow-visible p-3 pb-20">
        <Context frame={frameLabel} element={selectedElementIds.length > 1 ? `已框选 ${selectedElementIds.length} 个元素；属性编辑作用于当前元素` : selected?.label || '点击画面选择元素'} undo={<Button type="button" size="sm" variant="outline" className="h-8 shrink-0 gap-1 px-2 text-xs" title={pending.length ? '请先保存或取消当前修改' : '撤销上一次已保存的修改'} aria-label="撤销" disabled={historyActionDisabled || historyIndex < 0} onClick={() => void restore(history[historyIndex].beforeHtml, historyIndex - 1)}><Undo2 className="h-3.5 w-3.5"/><span>撤销</span></Button>} />
        <CandidateImagesPanel project={project} frameId={frameId} source={source} onProjectChange={onProjectChange} />

        <Section title={`元素 · ${elements.length}`} icon={<Move className="h-3.5 w-3.5"/>} open={elementSectionOpen} onOpenChange={setElementSectionOpen}>
          {elements.length ? <div className="grid max-h-44 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-1 overflow-y-auto pr-0.5">{elements.map((el, index) =>
            <button key={el.id} ref={node => { if (node) elementRefs.current.set(el.id, node); else elementRefs.current.delete(el.id); }} title={el.label} aria-label={`选择元素 ${index + 1}：${el.label}`} onClick={() => { setSelected({ ...el, values: selected?.id === el.id ? selected.values : undefined }); setSelectedElementIds([el.id]); }} className={`group/element scroll-my-3 flex min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-xs leading-4 transition ${selected?.id === el.id ? 'border-teal-500 bg-teal-50 text-teal-950 shadow-sm ring-1 ring-teal-100' : 'border-slate-200 bg-slate-50/60 text-slate-700 hover:border-teal-300 hover:bg-teal-50/50'} ${locatedElementId === el.id ? 'animate-pulse ring-2 ring-amber-300 ring-offset-1 motion-reduce:animate-none' : ''}`}>
              <span className={`flex h-5 min-w-5 shrink-0 items-center justify-center rounded text-[9px] font-semibold tabular-nums ${selected?.id === el.id ? 'bg-teal-600 text-white' : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200 group-hover/element:text-teal-700'}`}>{String(index + 1).padStart(2, '0')}</span>
              <span className="min-w-0 truncate font-medium">{el.label}</span>
            </button>)}</div> : <Empty text="当前画面没有可编辑元素"/>}
        </Section>

        <Section title={`当前分镜文字 · ${frameTextElements.length}`} icon={<Type className="h-3.5 w-3.5"/>} defaultOpen>
          <Input value={frameTextSearch} onChange={event => setFrameTextSearch(event.target.value)} className="mb-2 h-8 text-xs" placeholder="搜索文字，例如：财务" aria-label="搜索当前分镜文字" />
          {filteredFrameTextElements.length ? <div className="max-h-52 space-y-1 overflow-y-auto pr-0.5">{filteredFrameTextElements.map(item => <button key={item.id} type="button" onClick={() => {
            setSelected({ ...item, values: selected?.id === item.id ? selected.values : undefined });
            setSelectedElementIds([item.id]);
          }} className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition ${selected?.id === item.id ? 'border-teal-500 bg-teal-50 text-teal-950' : 'border-slate-200 bg-slate-50 hover:border-teal-300 hover:bg-teal-50'}`}>
            <Type className="h-3.5 w-3.5 shrink-0 text-teal-700"/>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.groupRootId && <span className="shrink-0 text-[10px] text-muted-foreground">卡片内</span>}
          </button>)}</div> : <p className="py-1 text-xs text-muted-foreground">没有匹配的可编辑文字</p>}
        </Section>

        <Section title="位置与尺寸" icon={<Maximize2 className="h-3.5 w-3.5"/>} defaultOpen>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="X" value={value?.x} onCommit={v => {
              if (value?.y === undefined) return toast.message('正在读取元素位置，请稍后再试');
              stagePosition(v, value.y, `移动 ${selected?.label} 到 X ${v}`);
            }} />
            <NumberField label="Y" value={value?.y} onCommit={v => {
              if (value?.x === undefined) return toast.message('正在读取元素位置，请稍后再试');
              stagePosition(value.x, v, `移动 ${selected?.label} 到 Y ${v}`);
            }} />
            <NumberField label="宽" value={value?.width} min={1} onCommit={v => stage('update_element', { width: v }, `设置 ${selected?.label} 宽度为 ${v}`, selected?.geometryId)} />
            <NumberField label="高" value={value?.height} min={1} onCommit={v => stage('update_element', { height: v }, `设置 ${selected?.label} 高度为 ${v}`, selected?.geometryId)} />
            <NumberField label="缩放" value={value?.scale ?? 1} step={0.05} min={0.05} onCommit={v => stage('update_element', { scale: v }, `缩放 ${selected?.label} 至 ${v}×`, selected?.geometryId)} />
            <NumberField label="旋转" value={value?.rotate ?? 0} suffix="°" onCommit={v => stage('update_element', { rotate: v }, `旋转 ${selected?.label} ${v}°`, selected?.geometryId)} />
          </div>
          <div className="mt-2"><RangeField label="透明度" value={Math.round((value?.opacity ?? 1) * 100)} onCommit={v => stage('update_element', { opacity: v / 100 }, `设置 ${selected?.label} 透明度为 ${v}%`)} /></div>
        </Section>

        {selected?.type === 'text' && <Section title="文本" icon={<Type className="h-3.5 w-3.5"/>}>
          <label className="block text-[11px] text-muted-foreground">文字</label>
          <Textarea key={`${selected.id}-text`} defaultValue={value?.text || selected.label} className="mt-1 min-h-16 resize-none text-xs" onBlur={e => { if (e.target.value !== value?.text) stage('update_element', { text: e.target.value }, `修改 ${selected.label} 的文字`); }} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[11px] text-muted-foreground">字体<Input key={`${selected.id}-font`} defaultValue={value?.fontFamily || ''} className="mt-1 h-8 text-xs" placeholder="继承当前字体" onBlur={e => e.target.value && stage('update_element', { fontFamily: e.target.value }, `修改 ${selected.label} 字体`)} /></label>
            <NumberField label="字号" value={value?.fontSize} min={1} onCommit={v => stage('update_element', { fontSize: v }, `设置 ${selected.label} 字号为 ${v}`)} />
            <label className="text-[11px] text-muted-foreground">颜色<div className="mt-1 flex h-8 items-center gap-1 rounded-md border px-1"><input type="color" defaultValue={toHex(value?.color)} className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0" onChange={e => stage('update_element', { color: e.target.value }, `修改 ${selected.label} 颜色`)} /><span className="truncate font-mono text-[10px]">{toHex(value?.color)}</span></div></label>
            <label className="text-[11px] text-muted-foreground">字重<select defaultValue={value?.fontWeight || '400'} className="mt-1 h-8 w-full rounded-md border bg-white px-2 text-xs" onChange={e => stage('update_element', { fontWeight: e.target.value }, `修改 ${selected.label} 字重`)}><option value="300">细</option><option value="400">常规</option><option value="500">中等</option><option value="600">半粗</option><option value="700">粗体</option></select></label>
          </div>
          <div className="mt-2 grid grid-cols-3 rounded-md border p-0.5">
            {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([align, Icon]) => <button key={align} title={align} onClick={() => stage('update_element', { textAlign: align }, `${selected.label} ${align === 'left' ? '左' : align === 'center' ? '居中' : '右'}对齐`)} className={`flex h-7 items-center justify-center rounded ${value?.textAlign === align ? 'bg-slate-100 text-teal-700' : 'hover:bg-slate-50'}`}><Icon className="h-3.5 w-3.5"/></button>)}
          </div>
        </Section>}

        {selected?.type !== 'text' && compositeTextElements.length > 0 && <Section title="卡片内容" icon={<Type className="h-3.5 w-3.5"/>} defaultOpen>
          <p className="mb-2 text-[11px] leading-4 text-muted-foreground">选择一段文字后，可在下方“文本”区域直接修改；卡片的位置与尺寸保持不变。</p>
          <div className="space-y-1">
            {compositeTextElements.map(item => <button key={item.id} type="button" onClick={() => {
              setSelected({ ...item, values: undefined });
              setSelectedElementIds([item.id]);
            }} className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-xs transition hover:border-teal-300 hover:bg-teal-50">
              <Type className="h-3.5 w-3.5 shrink-0 text-teal-700"/>
              <span className="min-w-0 truncate">{item.label}</span>
            </button>)}
          </div>
        </Section>}

        {selected && <div className="mt-4 border-t pt-3">
          <Button type="button" variant="outline" className="w-full border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50 hover:text-red-800" disabled={saving} onClick={() => stage('delete_element', {}, `删除 ${selected.label}`)}><Trash2 className="mr-1.5 h-3.5 w-3.5"/>删除元素</Button>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">保存前可取消，保存后可通过撤销恢复</p>
        </div>}

        {pending.length > 0 && <ConfirmBar summary={pending[pending.length - 1].summary} count={pending.length} saving={saving} onCancel={cancelPending} onApply={() => void apply()} />}
    </div>
  </div>;
});

function Section({ title, icon, defaultOpen = false, open, onOpenChange, children }: { title: string; icon: React.ReactNode; defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; children: React.ReactNode }) {
  return <details open={open ?? defaultOpen} onToggle={event => onOpenChange?.(event.currentTarget.open)} className="group mt-1 border-b pb-1"><summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-1.5 text-xs font-medium hover:bg-slate-50">{icon}<span className="flex-1">{title}</span><ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180"/></summary><div className="px-1 pb-0.5 pt-0.5">{children}</div></details>;
}

function NumberField({ label, value, min, step = 1, suffix, onCommit }: { label: string; value?: number; min?: number; step?: number; suffix?: string; onCommit: (value: number) => void }) {
  return <label className="text-[11px] text-muted-foreground">{label}<div className="relative mt-1"><Input key={`${label}-${value}`} type="number" defaultValue={value ?? ''} min={min} step={step} placeholder="—" className="h-8 pr-7 text-xs tabular-nums" onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={e => { const next = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(next) && next !== value) onCommit(next); }} />{suffix && <span className="pointer-events-none absolute right-2 top-1.5 text-[11px]">{suffix}</span>}</div></label>;
}

function RangeField({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  return <label className="text-[11px] text-muted-foreground"><span className="flex justify-between"><span>{label}</span><span>{value}%</span></span><input key={value} type="range" min="0" max="100" defaultValue={value} className="mt-1 h-1.5 w-full accent-teal-600" onMouseUp={e => onCommit(Number(e.currentTarget.value))} onTouchEnd={e => onCommit(Number(e.currentTarget.value))}/></label>;
}

function ConfirmBar({ summary, count, saving, onCancel, onApply }: { summary: string; count: number; saving: boolean; onCancel: () => void; onApply: () => void }) {
  return <div className="sticky bottom-0 z-20 -mx-3 mt-3 border-t bg-white/95 px-3 pb-2 pt-3 shadow-[0_-8px_20px_rgba(15,23,42,0.06)] backdrop-blur"><div className="mb-2 truncate rounded-md bg-teal-50 px-2.5 py-2 text-xs text-teal-900" title={summary}>{count > 1 ? `已暂存 ${count} 项修改 · ` : ''}{summary}</div><div className="flex gap-2"><Button type="button" size="sm" variant="outline" className="flex-1" disabled={saving} onClick={onCancel}><X className="mr-1 h-3.5 w-3.5"/>取消全部</Button><Button type="button" size="sm" className="flex-1" disabled={saving} onClick={onApply}><Check className="mr-1 h-3.5 w-3.5"/>保存全部</Button></div></div>;
}

function Context({ frame, element, undo }: { frame: string; element: string; undo: React.ReactNode }) { return <div className="mb-1 flex min-w-0 items-center justify-between gap-1.5 text-[11px]"><div className="flex min-w-0 gap-1.5"><span className="shrink-0 rounded bg-slate-100 px-2 py-1">{frame}</span><span className="min-w-0 truncate rounded bg-teal-50 px-2 py-1 text-teal-800">{element}</span></div>{undo}</div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-md border border-dashed py-4 text-center text-[11px] text-muted-foreground">{text}</div>; }
function toHex(color?: string) { const match = color?.match(/\d+/g); return match && match.length >= 3 ? `#${match.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('')}` : color?.startsWith('#') ? color : '#111827'; }
