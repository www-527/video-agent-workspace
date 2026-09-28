'use client';

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImageOff, Code2, ShieldCheck, ShieldOff } from 'lucide-react';
import { SubtitleLayer } from '@/components/player/subtitle-layer';
import { splitSubtitles, type SubtitleCue } from '@/lib/subtitle';
import { wrapHtmlWithWatchdog, sanitizeAiHtml } from '@/lib/iframe-utils';
import type { ProjectDetail, FrameSource } from '@/types';
import { useStudioStore } from '@/stores/studio-store';
import { ensureEditableElementIds } from '@/lib/editor-command';
import { UISceneCanvas } from '@/components/render/ui-scene';
import type { UISceneDocument } from '@/lib/render/types';
import { resolveFrameImagePath, resolveSceneContract } from '@/lib/scene-contract';
import { getCanvasPreset, isPortraitPreset } from '@/lib/canvas-presets';
import type { CanvasPresetId } from '@/types';

interface PreviewCanvasProps {
  project: ProjectDetail;
  frameSource: FrameSource | null;
  showSubtitle: boolean;
  currentTime?: number;
  isPlaying?: boolean;
  playbackRevision?: number;
  audioRef?: React.RefObject<HTMLAudioElement>;
}

export const PreviewCanvas = forwardRef<HTMLDivElement, PreviewCanvasProps>(
  function PreviewCanvas(
    { project, frameSource, showSubtitle, currentTime = 0, isPlaying = false, playbackRevision = 0, audioRef },
    ref,
  ) {
    if (!project.outline || !frameSource) {
      return (
        <div
          ref={ref}
          className="flex h-full items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50"
        >
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <Code2 className="h-6 w-6 text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-700">还没有可预览的内容</p>
            <p className="mt-1 text-xs text-slate-500">
              在右侧输入提示词，让 AI 先生成视频大纲
            </p>
          </div>
        </div>
      );
    }

    return (
      <PreviewBody
        ref={ref}
        project={project}
        frameSource={frameSource}
        showSubtitle={showSubtitle}
        currentTime={currentTime}
        isPlaying={isPlaying}
        playbackRevision={playbackRevision}
        audioRef={audioRef}
      />
    );
  },
);

interface PreviewBodyProps {
  project: ProjectDetail;
  frameSource: FrameSource;
  showSubtitle: boolean;
  currentTime: number;
  isPlaying: boolean;
  playbackRevision: number;
  audioRef?: React.RefObject<HTMLAudioElement>;
}

const TRANSITION_MS = 500;

type PreviewLayer = {
  /** Preserve the actual iframe while a scene fades out. */
  key: number;
  frameSource: FrameSource;
  exiting: boolean;
  playbackRevision: number;
};

const PreviewBody = forwardRef<HTMLDivElement, PreviewBodyProps>(function PreviewBody(
  { project, frameSource, showSubtitle, currentTime, isPlaying, playbackRevision, audioRef },
  ref,
) {
  const [pointerPosition, setPointerPosition] = useState<{ x: number; y: number } | null>(null);
  const [showPlatformSafeArea, setShowPlatformSafeArea] = useState(() => isPortraitPreset(project.canvasPreset));
  const preset = getCanvasPreset(project.canvasPreset);
  useEffect(() => {
    setShowPlatformSafeArea(isPortraitPreset(project.canvasPreset));
  }, [project.uuid, project.canvasPreset]);
  // ⭐ 叠化转场核心 state
  // - `displayed` 滞后于 `frameSource`，是当前真正显示的那一帧
  // - 当 frameSource 变化时：把 displayed 存为 outgoing，displayed 切到新帧
  // - 渲染时同时叠加 outgoing（淡出）和 displayed（淡入）
  const [layers, setLayers] = useState<PreviewLayer[]>(() => [{
    key: 0,
    frameSource,
    exiting: false,
    playbackRevision,
  }]);
  const nextLayerKeyRef = useRef(1);
  const initRef = useRef(false);
  const displayedRef = useRef(frameSource);
  const playbackRevisionRef = useRef(playbackRevision);
  playbackRevisionRef.current = playbackRevision;
  const displayed = layers.find(layer => !layer.exiting)?.frameSource ?? frameSource;

  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  // 跟踪 frameSource 变化
  useEffect(() => {
    if (initRef.current === false) {
      initRef.current = true;
      return;
    }
    const currentDisplayed = displayedRef.current;
    if (frameSource.id === currentDisplayed.id) {
      // Keep the document used by the current playback session immutable. An
      // automatic quality repair or editor save may publish newer HTML while
      // the scene is playing; applying it here would reload srcDoc mid-frame.
      if (isPlaying) return;
      setLayers(current => current.map(layer => (
        layer.exiting || layer.frameSource === frameSource ? layer : { ...layer, frameSource }
      )));
      return;
    }

    // 1) 把当前 displayed 存为 outgoing
    setLayers(current => [
      ...current.map(layer => layer.exiting ? layer : {
        ...layer,
        exiting: true,
      }),
      {
        key: nextLayerKeyRef.current++,
        frameSource,
        exiting: false,
        playbackRevision: playbackRevisionRef.current,
      },
    ]);
    // 2) 切换到新帧
    // 3) 改变 incoming 的 key 强制重挂载，触发淡入动画
    // 4) 500ms 后清掉 outgoing
  }, [frameSource, isPlaying]);

  useEffect(() => {
    if (!layers.some(layer => layer.exiting)) return;
    const timer = setTimeout(() => {
      setLayers(current => current.filter(layer => !layer.exiting));
    }, TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [layers]);

  // 字幕切片（基于当前 displayed 帧）
  const cues: SubtitleCue[] = useMemo(() => {
    const idx = project.outline?.frames.findIndex(f => f.id === displayed.id) ?? -1;
    if (idx < 0) return [];
    const frame = project.outline!.frames[idx];
    const dur = (displayed.audioPath ? displayed.audioDuration : undefined)
      ?? frame.sceneSpec?.durationHint
      ?? 3;
    return splitSubtitles(frame.narration, dur);
  }, [displayed, project.outline]);

  const updatePointerPosition = useCallback((x: number, y: number) => {
    setPointerPosition({
      x: Math.round(Math.min(preset.design.width, Math.max(0, x))),
      y: Math.round(Math.min(preset.design.height, Math.max(0, y))),
    });
  }, [preset.design.height, preset.design.width]);

  const handleStageMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    updatePointerPosition(
      ((event.clientX - bounds.left) / bounds.width) * preset.design.width,
      ((event.clientY - bounds.top) / bounds.height) * preset.design.height,
    );
  }, [preset.design.height, preset.design.width, updatePointerPosition]);

  return (
    <div
      ref={ref}
      className="preview-stage relative h-full overflow-hidden rounded-xl bg-slate-900 shadow-inner"
      style={{ background: '#0f172a' }}
      onMouseMove={handleStageMouseMove}
      onMouseLeave={() => setPointerPosition(null)}
    >
      {/* 旧帧 — 淡出中（pointer-events-none 防止拦截点击） */}
      {/* 新帧 — 淡入中（key 变化强制重挂载 → 重新触发动画） */}
      {layers.map(layer => {
        const isActive = !layer.exiting && layer.frameSource.id === frameSource.id;
        const effectivePlaybackRevision = isActive ? playbackRevision : layer.playbackRevision;
        return (
          <div
            key={layer.key}
            data-preview-layer={layer.exiting ? 'outgoing' : 'incoming'}
            data-playback-revision={effectivePlaybackRevision}
            className={`absolute inset-0 ${layer.exiting ? 'frame-fade-out pointer-events-none' : 'frame-fade-in'}`}
          >
            <FrameContent
              project={project}
              frameSource={layer.frameSource}
              canvasPreset={project.canvasPreset}
              isPlaying={isActive && isPlaying}
              playbackActive={isActive && isPlaying}
              playbackRevision={effectivePlaybackRevision}
              currentTimeMs={isActive ? currentTime * 1000 : 0}
              audioRef={audioRef}
              onPointerPosition={updatePointerPosition}
              onPointerLeave={() => setPointerPosition(null)}
            />
          </div>
        );
      })}

      {/* 字幕只挂在最上层（跟着新帧） */}
      {showSubtitle && cues.length > 0 && (
        <SubtitleLayer cues={cues} currentTime={currentTime} canvasPreset={project.canvasPreset} />
      )}
      {!isPlaying && isPortraitPreset(project.canvasPreset) && showPlatformSafeArea ? (
        <div className="pointer-events-none absolute inset-0 z-[15]" aria-label="抖音安全区辅助线">
          <div
            className="absolute border border-dashed border-cyan-300/80 bg-cyan-300/[0.035]"
            style={{
              left: `${preset.platformSafeArea.left / preset.design.width * 100}%`,
              top: `${preset.platformSafeArea.top / preset.design.height * 100}%`,
              width: `${(preset.platformSafeArea.right - preset.platformSafeArea.left) / preset.design.width * 100}%`,
              height: `${(preset.platformSafeArea.bottom - preset.platformSafeArea.top) / preset.design.height * 100}%`,
            }}
          />
          <div
            className="absolute border-t border-dashed border-amber-300/80 bg-amber-300/[0.045]"
            style={{
              left: `${preset.subtitleArea.left / preset.design.width * 100}%`,
              top: `${preset.subtitleArea.top / preset.design.height * 100}%`,
              width: `${(preset.subtitleArea.right - preset.subtitleArea.left) / preset.design.width * 100}%`,
              height: `${(preset.subtitleArea.bottom - preset.subtitleArea.top) / preset.design.height * 100}%`,
            }}
          />
        </div>
      ) : null}
      {!isPlaying && isPortraitPreset(project.canvasPreset) ? (
        <button
          type="button"
          className="absolute right-3 top-3 z-20 inline-flex items-center gap-1 rounded-md border border-white/20 bg-slate-950/75 px-2 py-1 text-[11px] text-white backdrop-blur-sm"
          onClick={() => setShowPlatformSafeArea(value => !value)}
          aria-pressed={showPlatformSafeArea}
        >
          {showPlatformSafeArea ? <ShieldOff className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
          {showPlatformSafeArea ? '隐藏安全区' : '显示安全区'}
        </button>
      ) : null}
      {!isPlaying && pointerPosition && (
        <output
          aria-live="off"
          className="canvas-coordinate-readout pointer-events-none absolute left-3 top-3 z-20 rounded-md border border-white/25 bg-slate-950/75 px-2 py-1 font-mono text-xs tabular-nums text-white shadow-sm backdrop-blur-sm"
        >
          X {pointerPosition.x} · Y {pointerPosition.y}
        </output>
      )}
    </div>
  );
});

// ===== FrameContent：根据项目类型渲染对应画面 =====
function FrameContent({
  project,
  frameSource,
  canvasPreset,
  isPlaying,
  playbackActive = isPlaying,
  playbackRevision = 0,
  currentTimeMs = 0,
  audioRef,
  onPointerPosition,
  onPointerLeave,
}: {
  project: ProjectDetail;
  frameSource: FrameSource;
  canvasPreset: CanvasPresetId;
  isPlaying: boolean;
  playbackActive?: boolean;
  playbackRevision?: number;
  currentTimeMs?: number;
  audioRef?: React.RefObject<HTMLAudioElement>;
  onPointerPosition?: (x: number, y: number) => void;
  onPointerLeave?: () => void;
}) {
  const outlineFrame = project.outline?.frames.find(frame => frame.id === frameSource.id);
  const frameDuration = (frameSource.audioPath ? frameSource.audioDuration : undefined)
    ?? outlineFrame?.sceneSpec?.durationHint
    ?? 3;
  const contract = resolveSceneContract(project.type, outlineFrame);
  if (contract.mode === 'image') {
    return (
      <ImageFrame
        frameSource={frameSource}
        canvasPreset={canvasPreset}
        isPlaying={isPlaying}
        audioRef={audioRef}
        frameDuration={frameDuration}
        onPointerPosition={onPointerPosition}
      />
    );
  }
  if (contract.mode === 'ui-scene' && outlineFrame?.sceneSpec?.uiArchetype) {
    const uiScene: UISceneDocument = {
      archetype: outlineFrame.sceneSpec.uiArchetype,
      data: outlineFrame.sceneSpec.uiData || {},
      interactions: outlineFrame.sceneSpec.interactionSequence || [],
      isDemoData: outlineFrame.sceneSpec.isDemoData === true,
    };
    return <UISceneCanvas scene={uiScene} timeMs={currentTimeMs} canvasPreset={canvasPreset} />;
  }
  return (
    <HtmlFrame
      htmlCode={frameSource.htmlCode}
      canvasPreset={canvasPreset}
      frameId={frameSource.id}
      frameDuration={frameDuration}
      playbackRevision={playbackRevision}
      isPlaying={playbackActive}
      onPointerPosition={onPointerPosition}
      onPointerLeave={onPointerLeave}
    />
  );
}

// ===== ImageFrame：rAF 60fps 缩放 =====
function ImageFrame({
  frameSource,
  canvasPreset,
  isPlaying,
  audioRef,
  frameDuration,
  onPointerPosition,
}: {
  frameSource: FrameSource;
  canvasPreset: CanvasPresetId;
  isPlaying: boolean;
  audioRef?: React.RefObject<HTMLAudioElement>;
  frameDuration: number;
  onPointerPosition?: (x: number, y: number) => void;
}) {
  const preset = getCanvasPreset(canvasPreset);
  const imgRef = useRef<HTMLImageElement>(null);
  const totalMs = Math.max(1, frameDuration * 1000);
  const imagePath = resolveFrameImagePath(frameSource);
  const asset = frameSource.realImage;
  const motion = asset?.imageMotion || 'slow-push-in';
  const scaleFrom = asset?.scaleFrom ?? 1;
  const scaleTo = asset?.scaleTo ?? (motion === 'static' ? scaleFrom : 1.08);

  useEffect(() => {
    if (!isPlaying) {
      if (imgRef.current) imgRef.current.style.transform = imageTransform(motion, scaleFrom, scaleTo, 0);
      return;
    }
    const audio = audioRef?.current;
    const img = imgRef.current;
    if (!audio || !img) return;

    let raf = 0;
    const tick = () => {
      const t = audio.currentTime || 0;
      const p = Math.min((t * 1000) / totalMs, 1);
      img.style.transform = imageTransform(motion, scaleFrom, scaleTo, p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (imgRef.current) imgRef.current.style.transform = imageTransform(motion, scaleFrom, scaleTo, 0);
    };
  }, [isPlaying, frameDuration, audioRef, totalMs, frameSource.id, motion, scaleFrom, scaleTo]);

  if (!imagePath) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <div className="text-center">
          <ImageOff className="mx-auto h-8 w-8" />
          <p className="mt-2 text-sm">该分镜尚未生成图片</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      onMouseMove={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        onPointerPosition?.(
          ((event.clientX - bounds.left) / bounds.width) * preset.design.width,
          ((event.clientY - bounds.top) / bounds.height) * preset.design.height,
        );
      }}
    >
      <img
        ref={imgRef}
        src={imagePath}
        alt={asset?.alt || '分镜画面'}
        className="h-full w-full"
        style={{
          objectFit: asset?.fitMode || 'cover',
          objectPosition: asset?.position || 'center',
          transform: imageTransform(motion, scaleFrom, scaleTo, 0),
          transformOrigin: 'center',
          willChange: 'transform',
        }}
      />
    </div>
  );
}

function imageTransform(motion: string, from: number, to: number, progress: number): string {
  const clamped = Math.max(0, Math.min(1, progress));
  const scale = from + (to - from) * clamped;
  const translateX = motion === 'slow-pan' ? -2 + clamped * 4 : 0;
  return `translate3d(${translateX}%,0,0) scale(${scale})`;
}

// ===== HtmlFrame：iframe srcdoc 沙箱 + 看门狗 + 动态尺寸缩放（cover 模式）=====
function HtmlFrame({
  htmlCode,
  canvasPreset,
  frameId,
  frameDuration,
  playbackRevision,
  isPlaying,
  onPointerPosition,
  onPointerLeave,
}: {
  htmlCode?: string;
  canvasPreset: CanvasPresetId;
  frameId?: string;
  frameDuration: number;
  playbackRevision: number;
  isPlaying: boolean;
  onPointerPosition?: (x: number, y: number) => void;
  onPointerLeave?: () => void;
}) {
  const preset = getCanvasPreset(canvasPreset);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** iframe 内部 HTML 的"设计尺寸"，由 iframe 通过 postMessage 上报 */
  const [designSize, setDesignSize] = useState<{ w: number; h: number }>({ w: preset.design.width, h: preset.design.height });
  const setSelectedElement = useStudioStore(s => s.setSelectedElement);
  const setSelectedElementIds = useStudioStore(s => s.setSelectedElementIds);
  const requestElementPanelFocus = useStudioStore(s => s.requestElementPanelFocus);
  const selectedElementId = useStudioStore(s => s.selectedElement?.id || null);
  const selectedGeometryId = useStudioStore(s => s.selectedElement?.geometryId || s.selectedElement?.id || null);
  const selectedElementIsText = useStudioStore(s => s.selectedElement?.type === 'text');
  const selectedElementIds = useStudioStore(s => s.selectedElementIds);
  const setLayoutAudit = useStudioStore(s => s.setLayoutAudit);
  const selectedElementIdsKey = selectedElementIds.join('|');
  const watchdogMs = Math.max(8_000, Math.ceil(frameDuration * 1000) + 1_500);
  const safeHtml = useMemo(
    () => wrapHtmlWithWatchdog(
      sanitizeAiHtml(ensureEditableElementIds(htmlCode || ''), canvasPreset),
      watchdogMs,
      { canvasPreset, playbackControlled: true },
    ),
    [canvasPreset, htmlCode, watchdogMs],
  );

  // ⭐ 监听 iframe 的 postMessage 上报（sandbox 阻止我们直接读 contentDocument）
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data && e.data.type === '__ai_video_iframe_size') {
        const w = Number(e.data.w);
        const h = Number(e.data.h);
        if (w > 0 && h > 0 && w < 10000 && h < 10000) {
          setDesignSize({ w, h });
        }
      } else if (e.data && e.data.type === '__ai_video_editor_select' && typeof e.data.id === 'string') {
        const tag = String(e.data.tag || 'div');
        const type = e.data.isText === true ? 'text' : 'visual';
        setSelectedElement({ id: e.data.id, geometryId: typeof e.data.geometryId === 'string' ? e.data.geometryId : e.data.id,
          groupRootId: typeof e.data.groupRootId === 'string' ? e.data.groupRootId : undefined,
          label: String(e.data.label || e.data.id), tag, type, values: e.data.values,
          editable: type === 'text' ? ['position', 'size', 'color', 'opacity', 'animation'] : ['position', 'size', 'opacity', 'animation'] });
        setSelectedElementIds([e.data.id]);
        if (frameId) requestElementPanelFocus(frameId, e.data.id);
      } else if (e.data && e.data.type === '__ai_video_editor_multi_select' && Array.isArray(e.data.ids)) {
        const ids = e.data.ids.filter((id: unknown): id is string => typeof id === 'string').slice(0, 80);
        setSelectedElementIds(ids);
        if (!ids.length) setSelectedElement(null);
      } else if (e.data && e.data.type === '__ai_video_canvas_pointer') {
        const x = Number(e.data.x);
        const y = Number(e.data.y);
        if (Number.isFinite(x) && Number.isFinite(y)) onPointerPosition?.(x, y);
      } else if (e.data && e.data.type === '__ai_video_canvas_pointer_leave') {
        onPointerLeave?.();
      } else if (e.data && e.data.type === '__ai_video_layout_audit' && Array.isArray(e.data.issues) && frameId) {
        setLayoutAudit(frameId, e.data.issues);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [frameId, onPointerLeave, onPointerPosition, requestElementPanelFocus, setLayoutAudit, setSelectedElement, setSelectedElementIds]);

  useEffect(() => {
    setDesignSize({ w: preset.design.width, h: preset.design.height });
    if (frameId) setLayoutAudit(frameId, []);
  }, [frameId, htmlCode, preset.design.height, preset.design.width, setLayoutAudit]);

  const sendEditorHighlight = useCallback(() => {
    const frameWindow = iframeRef.current?.contentWindow;
    frameWindow?.postMessage({
      type: '__ai_video_editor_highlight',
      id: selectedElementId,
      geometryId: selectedElementIsText ? undefined : selectedGeometryId,
      ids: selectedElementIdsKey ? selectedElementIdsKey.split('|') : [],
    }, '*');
  }, [selectedElementId, selectedElementIdsKey, selectedElementIsText, selectedGeometryId]);

  const sendPlaybackState = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({
      type: '__ai_video_playback_state',
      isPlaying,
      playbackRevision,
    }, '*');
  }, [isPlaying, playbackRevision]);

  useEffect(() => {
    sendEditorHighlight();
  }, [sendEditorHighlight, safeHtml]);

  useEffect(() => {
    sendPlaybackState();
  }, [sendPlaybackState, safeHtml]);


  // The element list in the inspector changes selection without a click inside
  // the iframe. Ask the rendered document for the same canvas-relative values
  // that a canvas click would report, so X/Y are immediately editable.
  const measureSelectedElement = useCallback(() => {
    if (isPlaying || !selectedElementId) return;
    iframeRef.current?.contentWindow?.postMessage({
      type: '__ai_video_editor_measure',
      id: selectedElementId,
      geometryId: selectedGeometryId,
    }, '*');
  }, [isPlaying, selectedElementId, selectedGeometryId]);

  useEffect(() => {
    measureSelectedElement();
  }, [measureSelectedElement]);

  const handleIframeLoad = useCallback(() => {
    sendPlaybackState();
    sendEditorHighlight();
    measureSelectedElement();
  }, [measureSelectedElement, sendEditorHighlight, sendPlaybackState]);

  useEffect(() => {
    setSelectedElement(null);
    setSelectedElementIds([]);
  }, [frameId, setSelectedElement, setSelectedElementIds]);

  // ResizeObserver：容器尺寸变化时重新计算 scale + 显式 left/top 居中
  useEffect(() => {
    const container = containerRef.current;
    const iframe = iframeRef.current;
    if (!container || !iframe) return;

    const update = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw === 0 || ch === 0) return;

      const baseW = designSize.w;
      const baseH = designSize.h;
      // ⭐ contain 模式：完整展示整个 HTML 画面，避免边缘被裁切
      const scale = Math.min(cw / baseW, ch / baseH);
      const scaledW = baseW * scale;
      const scaledH = baseH * scale;
      // ⭐ 关键：transform-origin: 0 0 + left/top 显式居中
      // （不用 transform-origin: center，因为 flex 居中和它会冲突）
      iframe.style.transformOrigin = '0 0';
      iframe.style.transform = `scale(${scale})`;
      iframe.style.left = `${(cw - scaledW) / 2}px`;
      iframe.style.top = `${(ch - scaledH) / 2}px`;
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [designSize]);

  if (!htmlCode) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <div className="text-center">
          <Code2 className="mx-auto h-8 w-8" />
          <p className="mt-2 text-sm">该分镜尚未生成 HTML 动画</p>
        </div>
      </div>
    );
  }
  return (
    <div ref={containerRef} className="html-frame-container">
      <iframe
        ref={iframeRef}
        title="HTML 分镜动画"
        srcDoc={safeHtml}
        sandbox="allow-scripts"
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={handleIframeLoad}
        className="block bg-transparent"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${designSize.w}px`,
          height: `${designSize.h}px`,
          border: 0,
        }}
      />
    </div>
  );
}
