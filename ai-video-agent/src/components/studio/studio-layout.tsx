'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FolderKanban, MessageSquare, ShieldCheck, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ProjectDrawer } from './project-drawer';
import { PreviewPanel } from './preview-panel';
import { EditorPanel, type EditorPanelHandle } from './editor-panel';
import { ChatPanel } from './chat-panel';
import { QualityPanel } from './quality-panel';
import { SettingsMenu } from './settings-menu';
import { useStudioStore } from '@/stores/studio-store';
import type { ChatMessage, ProjectDetail } from '@/types';
import { FrameGenerationProvider } from './frame-generation-context';
import { cn } from '@/lib/utils';
import {
  DEFAULT_FRAME_GENERATION_CONCURRENCY,
  MAX_GPT_FREE_FRAME_CONCURRENCY,
  MIN_GPT_FREE_FRAME_CONCURRENCY,
} from '@/lib/generation/frame-concurrency';

interface StudioLayoutProps {
  initialProject: ProjectDetail;
  initialMessages: ChatMessage[];
}

type RightPaneContext = 'chat' | 'editor' | 'quality';
type PendingNavigation =
  | { type: 'context'; context: RightPaneContext }
  | { type: 'frame'; frameId: string | null; context?: RightPaneContext }
  | { type: 'route'; href: string };

const RIGHT_PANEL_STORAGE_KEY = 'ai-video:right-panel-width:v1';
const EXPORT_CONCURRENCY_STORAGE_KEY = 'ai-video:export-concurrency:v1';
const GPT_FREE_FRAME_CONCURRENCY_STORAGE_KEY = 'ai-video:gpt-free-frame-concurrency:v1';
const AUTO_OPTIMIZE_STORAGE_KEY = 'ai-video:auto-optimize:v1';
const GPU_ENCODING_STORAGE_KEY = 'ai-video:gpu-encoding:v1';

export function StudioLayout({ initialProject, initialMessages }: StudioLayoutProps) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetail>(initialProject);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [rightPaneContext, setRightPaneContext] = useState<RightPaneContext>('chat');
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const [exportConcurrency, setExportConcurrencyState] = useState(0);
  const [gptFreeFrameConcurrency, setGPTFreeFrameConcurrencyState] = useState(DEFAULT_FRAME_GENERATION_CONCURRENCY);
  const [autoOptimizeEnabled, setAutoOptimizeEnabledState] = useState<boolean | null>(null);
  const [useGpuEncoding, setUseGpuEncodingState] = useState(false);
  const editorRef = useRef<EditorPanelHandle>(null);
  const editorDirty = useStudioStore(state => state.editorDirty);
  const selectedElementId = useStudioStore(state => state.selectedElement?.id ?? null);
  const selectedFrameId = useStudioStore(state => state.selectedFrameId);
  const setSelectedFrameId = useStudioStore(state => state.setSelectedFrameId);

  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem(RIGHT_PANEL_STORAGE_KEY));
    if (Number.isFinite(savedWidth)) setRightPanelWidth(clampPanelWidth(savedWidth));
    const savedConcurrency = Number(window.localStorage.getItem(EXPORT_CONCURRENCY_STORAGE_KEY));
    if (Number.isInteger(savedConcurrency) && savedConcurrency >= 0 && savedConcurrency <= 4) setExportConcurrencyState(savedConcurrency);
    const savedFrameConcurrency = Number(window.localStorage.getItem(GPT_FREE_FRAME_CONCURRENCY_STORAGE_KEY));
    if (Number.isInteger(savedFrameConcurrency)
      && savedFrameConcurrency >= MIN_GPT_FREE_FRAME_CONCURRENCY
      && savedFrameConcurrency <= MAX_GPT_FREE_FRAME_CONCURRENCY) {
      setGPTFreeFrameConcurrencyState(savedFrameConcurrency);
    }
    setAutoOptimizeEnabledState(window.localStorage.getItem(AUTO_OPTIMIZE_STORAGE_KEY) !== 'false');
    setUseGpuEncodingState(window.localStorage.getItem(GPU_ENCODING_STORAGE_KEY) === 'true');
  }, []);

  useEffect(() => {
    if (selectedElementId) setRightPaneContext('editor');
  }, [selectedElementId]);

  const performNavigation = useCallback((navigation: PendingNavigation) => {
    if (navigation.type === 'context') setRightPaneContext(navigation.context);
    if (navigation.type === 'frame') {
      setSelectedFrameId(navigation.frameId);
      if (navigation.context) setRightPaneContext(navigation.context);
    }
    if (navigation.type === 'route') router.push(navigation.href);
    setPendingNavigation(null);
  }, [router, setSelectedFrameId]);

  const requestNavigation = useCallback((navigation: PendingNavigation) => {
    const leavesCurrentDraft = editorDirty && (
      navigation.type === 'route'
      || (navigation.type === 'context' && navigation.context !== 'editor')
      || (navigation.type === 'frame' && navigation.frameId !== selectedFrameId)
    );
    if (leavesCurrentDraft) setPendingNavigation(navigation);
    else performNavigation(navigation);
  }, [editorDirty, performNavigation, selectedFrameId]);

  const openQuality = useCallback((frameId?: string) => {
    if (frameId && frameId !== selectedFrameId) requestNavigation({ type: 'frame', frameId, context: 'quality' });
    else requestNavigation({ type: 'context', context: 'quality' });
  }, [requestNavigation, selectedFrameId]);

  function setExportConcurrency(value: number) {
    const safeValue = Math.max(0, Math.min(4, Math.round(value)));
    setExportConcurrencyState(safeValue);
    window.localStorage.setItem(EXPORT_CONCURRENCY_STORAGE_KEY, String(safeValue));
  }

  function setAutoOptimizeEnabled(enabled: boolean) {
    setAutoOptimizeEnabledState(enabled);
    window.localStorage.setItem(AUTO_OPTIMIZE_STORAGE_KEY, String(enabled));
  }

  function setGPTFreeFrameConcurrency(value: number) {
    const safeValue = Math.max(
      MIN_GPT_FREE_FRAME_CONCURRENCY,
      Math.min(MAX_GPT_FREE_FRAME_CONCURRENCY, Math.round(value)),
    );
    setGPTFreeFrameConcurrencyState(safeValue);
    window.localStorage.setItem(GPT_FREE_FRAME_CONCURRENCY_STORAGE_KEY, String(safeValue));
  }

  function setUseGpuEncoding(enabled: boolean) {
    setUseGpuEncodingState(enabled);
    window.localStorage.setItem(GPU_ENCODING_STORAGE_KEY, String(enabled));
  }

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightPanelWidth;
    const onMove = (moveEvent: PointerEvent) => setRightPanelWidth(clampPanelWidth(startWidth + startX - moveEvent.clientX));
    const onUp = (upEvent: PointerEvent) => {
      const width = clampPanelWidth(startWidth + startX - upEvent.clientX);
      setRightPanelWidth(width);
      window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, String(width));
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  async function saveAndContinue() {
    const saved = await editorRef.current?.saveDraft();
    if (saved && pendingNavigation) performNavigation(pendingNavigation);
  }

  function discardAndContinue() {
    editorRef.current?.discardDraft();
    if (pendingNavigation) performNavigation(pendingNavigation);
  }

  return (
    <div className="studio-shell h-screen min-w-[1280px] overflow-hidden bg-muted/40 text-foreground">
      <div className="fixed inset-x-0 top-0 z-[80] hidden h-8 items-center justify-center bg-amber-50 text-xs text-amber-900 shadow-sm max-[1279px]:flex">当前工作台最低支持 1280px 宽度，请放大窗口或降低系统缩放。</div>
      <header className="studio-header grid h-12 grid-cols-[1fr_auto_1fr] items-center border-b bg-background px-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => requestNavigation({ type: 'route', href: '/' })}><ArrowLeft data-icon="inline-start" />返回</Button>
          <Button variant="ghost" size="sm" onClick={() => setProjectDrawerOpen(true)}><FolderKanban data-icon="inline-start" />项目</Button>
        </div>
        <div className="flex min-w-0 items-center justify-center gap-2"><h1 className="max-w-[32vw] truncate text-sm font-medium" title={project.title}>{project.title}</h1>{project.workflow === 'gpt-free' ? <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"><Sparkles className="size-3" />GPT 自由创作</span> : null}</div>
        <div className="flex justify-end">
          <SettingsMenu
            projectId={project.uuid}
            exportConcurrency={exportConcurrency}
            onExportConcurrencyChange={setExportConcurrency}
            isGPTFree={project.workflow === 'gpt-free'}
            gptFreeFrameConcurrency={gptFreeFrameConcurrency}
            onGPTFreeFrameConcurrencyChange={setGPTFreeFrameConcurrency}
            autoOptimizeEnabled={autoOptimizeEnabled === true}
            onAutoOptimizeEnabledChange={setAutoOptimizeEnabled}
            useGpuEncoding={useGpuEncoding}
            onUseGpuEncodingChange={setUseGpuEncoding}
            messages={messages}
          />
        </div>
      </header>

      <div className="flex h-[calc(100vh-3rem)] min-h-0">
        <FrameGenerationProvider
          project={project}
          onProjectChange={setProject}
          frameConcurrency={gptFreeFrameConcurrency}
        >
          <main className="studio-main min-w-0 flex-1">
            <PreviewPanel
              project={project}
              onProjectChange={setProject}
              onFrameSelect={frameId => requestNavigation({ type: 'frame', frameId })}
              onOpenQuality={openQuality}
              editorDirty={editorDirty}
              frameConcurrency={gptFreeFrameConcurrency}
              exportConcurrency={exportConcurrency}
              autoOptimizeEnabled={autoOptimizeEnabled === true}
              useGpuEncoding={useGpuEncoding}
            />
          </main>
          <div role="separator" aria-orientation="vertical" aria-label="调整上下文面板宽度" onPointerDown={beginResize} className="group flex w-1.5 shrink-0 cursor-col-resize items-center justify-center border-x bg-muted/30 outline-none hover:bg-primary/10">
            <span className="h-10 w-0.5 rounded-full bg-border group-hover:bg-primary/50" />
          </div>
          <aside style={{ width: rightPanelWidth }} className="studio-inspector flex min-h-0 shrink-0 flex-col bg-background">
            <div role="tablist" aria-label="右侧工作区" className="grid h-12 shrink-0 grid-cols-3 border-b px-2">
              <RightPaneTab active={rightPaneContext === 'chat'} onClick={() => requestNavigation({ type: 'context', context: 'chat' })} icon={<MessageSquare />} label="对话" />
              <RightPaneTab active={rightPaneContext === 'editor'} onClick={() => requestNavigation({ type: 'context', context: 'editor' })} icon={<SlidersHorizontal />} label="编辑" />
              <RightPaneTab active={rightPaneContext === 'quality'} onClick={() => requestNavigation({ type: 'context', context: 'quality' })} icon={<ShieldCheck />} label="质量" />
            </div>
            <div className={cn('min-h-0 flex-1 overflow-hidden', rightPaneContext === 'editor' ? 'block studio-pane-enter' : 'hidden')} aria-hidden={rightPaneContext !== 'editor'}><EditorPanel ref={editorRef} project={project} onProjectChange={setProject} /></div>
            <div className={cn('min-h-0 flex-1 overflow-hidden', rightPaneContext === 'chat' ? 'block studio-pane-enter' : 'hidden')} aria-hidden={rightPaneContext !== 'chat'}><ChatPanel project={project} messages={messages} onMessagesChange={setMessages} onProjectChange={setProject} /></div>
            <div className={cn('min-h-0 flex-1 overflow-hidden', rightPaneContext === 'quality' ? 'block studio-pane-enter' : 'hidden')} aria-hidden={rightPaneContext !== 'quality'}><QualityPanel project={project} onProjectChange={setProject} frameConcurrency={gptFreeFrameConcurrency} /></div>
          </aside>
        </FrameGenerationProvider>
      </div>

      <ProjectDrawer open={projectDrawerOpen} onOpenChange={setProjectDrawerOpen} onNavigate={href => requestNavigation({ type: 'route', href })} />
      <Dialog open={Boolean(pendingNavigation)} onOpenChange={open => { if (!open) setPendingNavigation(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>保存当前修改？</DialogTitle><DialogDescription>当前分镜还有未保存的画面调整。请选择如何处理后再继续。</DialogDescription></DialogHeader>
          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={() => setPendingNavigation(null)}>留在此处</Button>
            <div className="flex gap-2"><Button variant="outline" onClick={discardAndContinue}>放弃修改</Button><Button onClick={() => void saveAndContinue()}>保存并继续</Button></div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RightPaneTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactElement; label: string }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={cn('studio-tab-motion relative flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', active && 'text-foreground after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary')}><span className="[&>svg]:size-3.5">{icon}</span>{label}</button>;
}

function clampPanelWidth(value: number) {
  return Math.min(520, Math.max(340, Math.round(value)));
}
