'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeAiHtml, wrapHtmlForThumbnail } from '@/lib/iframe-utils';
import { getCanvasPreset } from '@/lib/canvas-presets';
import type { CanvasPresetId } from '@/types';

interface HtmlThumbProps {
  htmlCode: string;
  scale?: number;
  canvasPreset?: CanvasPresetId;
  frameDuration?: number;
  title?: string;
  className?: string;
}

export function HtmlThumb({
  htmlCode,
  scale: fallbackScale = 0.1,
  canvasPreset,
  title = 'HTML 分镜缩略预览',
  className = '',
}: HtmlThumbProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const [scale, setScale] = useState(fallbackScale);
  const preset = getCanvasPreset(canvasPreset);
  // Mount only thumbnails near the viewport so a long storyboard does not start
  // every animation at once. The thumbnail document is static so a visual that
  // begins at opacity 0 still shows its readable end state in the strip.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        setShouldRender(true);
        observer.disconnect();
      },
      { rootMargin: '240px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const next = Math.min(host.clientWidth / preset.design.width, host.clientHeight / preset.design.height);
      if (Number.isFinite(next) && next > 0) setScale(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, [preset.design.height, preset.design.width]);

  const srcDoc = useMemo(
    () => wrapHtmlForThumbnail(sanitizeAiHtml(htmlCode, canvasPreset), canvasPreset),
    [canvasPreset, htmlCode],
  );

  return (
    <div
      ref={hostRef}
      className={`relative h-full w-full overflow-hidden bg-slate-100 ${className}`}
    >
      {shouldRender && (
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: `${preset.design.width}px`,
            height: `${preset.design.height}px`,
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: 'center',
          }}
        >
          <iframe
            title={title}
            srcDoc={srcDoc}
            sandbox=""
            loading="lazy"
            scrolling="no"
            className="pointer-events-none block h-full w-full border-0 bg-transparent"
          />
        </div>
      )}
    </div>
  );
}
