import type { CanvasPresetId, FrameTuneElement, FrameTunePreviewAnchor } from '@/types';
import { stripLegacyAutoFitGuard } from '@/lib/layout-safety';
import { getCanvasPreset } from '@/lib/canvas-presets';

const STYLE_ID = '__ai_video_tune_preview__';
const SCRIPT_ID = '__ai_video_tune_preview_script__';
const OVERLAY_ID = '__ai_video_tune_overlay__';
const PERSISTED_STYLE_ID = '__ai_video_tune_persisted__';

export interface FrameTunePreviewOptions {
  selectedIndex?: number | null;
  showControls?: boolean;
  canvasPreset?: CanvasPresetId;
}

export function buildFrameTunePreviewHtml(
  htmlCode: string,
  elements: FrameTuneElement[],
  options: FrameTunePreviewOptions = {},
): string {
  htmlCode = stripLegacyAutoFitGuard(htmlCode);
  if (!htmlCode.trim()) return htmlCode;
  const canvas = getCanvasPreset(options.canvasPreset);
  const safeElements = elements
    .map((element, index) => toPreviewElement(element, index, htmlCode))
    .filter((element): element is PreviewElement => Boolean(element));
  const cssRules = safeElements.map(element => buildElementRule(element, 'preview', canvas.design)).filter(Boolean).join('\n');
  const style = buildPreviewStyle(cssRules, options.showControls ?? false, options.selectedIndex ?? null);
  const script = buildPreviewScript(safeElements, options);
  return injectPreviewAssets(stripPreviewAssets(htmlCode), style, script);
}

export function stripFrameTunePreviewHtml(htmlCode: string): string {
  return stripPreviewAssets(stripLegacyAutoFitGuard(htmlCode));
}

export function persistFrameTuneHtml(htmlCode: string, elements: FrameTuneElement[], canvasPreset?: CanvasPresetId): string {
  const canvas = getCanvasPreset(canvasPreset);
  const cleanHtml = stripPreviewAssets(stripLegacyAutoFitGuard(htmlCode));
  const safeElements = elements
    .map((element, index) => toPreviewElement(element, index, cleanHtml))
    .filter((element): element is PreviewElement => Boolean(element));
  const newRules = safeElements.map(element => buildElementRule(element, 'persisted', canvas.design)).filter(Boolean).join('\n');
  if (!newRules) return cleanHtml;

  const persistedPattern = new RegExp(`<style id=["']${PERSISTED_STYLE_ID}["']>([\\s\\S]*?)<\\/style>`, 'i');
  const existingRules = cleanHtml.match(persistedPattern)?.[1]?.trim() || '';
  const mergedRules = [existingRules, newRules].filter(Boolean).join('\n');
  const style = `<style id="${PERSISTED_STYLE_ID}">\n${mergedRules}\n</style>`;

  if (persistedPattern.test(cleanHtml)) return cleanHtml.replace(persistedPattern, style);
  if (/<\/head>/i.test(cleanHtml)) return cleanHtml.replace(/<\/head>/i, `${style}\n</head>`);
  if (/<\/body>/i.test(cleanHtml)) return cleanHtml.replace(/<\/body>/i, `${style}\n</body>`);
  return `${style}\n${cleanHtml}`;
}

interface PreviewElement {
  index: number;
  label: string;
  selector: string;
  anchor: FrameTunePreviewAnchor;
  current: Record<string, string>;
  proposed: Record<string, string>;
}

function toPreviewElement(element: FrameTuneElement, index: number, htmlCode: string): PreviewElement | null {
  const selector = resolveSelector(htmlCode, sanitizeSelector(element.selector));
  if (!selector) return null;
  return {
    index,
    label: element.label || `元素 ${index + 1}`,
    selector,
    anchor: normalizeAnchor(element.previewAnchor),
    current: element.current || {},
    proposed: element.proposed || {},
  };
}

function resolveSelector(htmlCode: string, selector: string): string {
  if (!selector) return '';
  const idMatch = selector.match(/^#([A-Za-z_][\w-]*)$/);
  if (!idMatch) return selector;

  const identifier = idMatch[1];
  if (hasHtmlAttribute(htmlCode, 'id', identifier)) return selector;
  if (hasHtmlAttribute(htmlCode, 'data-element-id', identifier)) {
    return `[data-element-id="${identifier}"]`;
  }
  return selector;
}

function hasHtmlAttribute(htmlCode: string, attribute: string, value: string): boolean {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\s<])${attribute}\\s*=\\s*(["'])${escapedValue}\\1`, 'i').test(htmlCode);
}

function buildElementRule(element: PreviewElement, mode: 'preview' | 'persisted', design: { width: number; height: number }): string {
  const { current, proposed } = element;
  const activeSelector = mode === 'preview'
    ? `html.__ai_video_tune_layout_locked__ ${element.selector}`
    : element.selector;
  const removed = proposed.visibility === 'removed';
  if (removed) {
    return mode === 'persisted'
      ? `${activeSelector} {\n  display: none !important;\n}`
      : `${activeSelector} {\n  opacity: 0.16 !important;\n  filter: grayscale(1) !important;\n  outline: 3px solid rgba(220,38,38,.92) !important;\n  outline-offset: 4px !important;\n}`;
  }
  const currentX = parsePositionInPixels(current.x ?? current.left, design.width);
  const proposedX = parsePositionInPixels(proposed.x ?? proposed.left, design.width);
  const currentY = parsePositionInPixels(current.y ?? current.top, design.height);
  const proposedY = parsePositionInPixels(proposed.y ?? proposed.top, design.height);
  const dxPixels = proposedX !== null && currentX !== null
    ? clamp(proposedX - currentX, -design.width * 0.35, design.width * 0.35)
    : 0;
  const dyPixels = proposedY !== null && currentY !== null
    ? clamp(proposedY - currentY, -design.height * 0.35, design.height * 0.35)
    : 0;
  const scale = parseNumber(proposed.scale ?? proposed.size ?? proposed['缩放'] ?? proposed['缂╂斁']);
  const opacity = parseNumber(proposed.opacity ?? proposed['透明度'] ?? proposed['閫忔槑搴?']);
  const zIndex = parseInteger(proposed.zIndex ?? proposed.layer ?? proposed['层级'] ?? proposed['灞傜骇']);
  const duration = parseDuration(proposed.duration ?? proposed.speed ?? proposed['速度'] ?? proposed['閫熷害']);

  if (!dxPixels && !dyPixels && scale === null && opacity === null && zIndex === null && duration === null) return '';

  const declarations = [
    // Position editing uses real coordinates on the fixed 1280x720 frame.
    // Persist an exact pixel delta so preview scaling cannot change the result.
    (dxPixels || dyPixels) ? `translate: ${formatPixels(dxPixels)} ${formatPixels(dyPixels)} 0 !important;` : '',
    scale !== null ? `scale: ${clamp(scale, 0.2, 4)} !important;` : '',
    (dxPixels || dyPixels || scale !== null) ? 'transform-origin: center center !important;' : '',
    opacity !== null ? `opacity: ${clamp(opacity, 0.05, 1)} !important;` : '',
    zIndex !== null ? `z-index: ${clamp(zIndex, -10, 9999)} !important; position: relative !important;` : '',
    duration !== null ? `animation-duration: ${duration}s !important; transition-duration: ${duration}s !important;` : '',
  ].filter(Boolean);

  return `${activeSelector} {\n  ${declarations.join('\n  ')}\n}`;
}

function buildPreviewStyle(elementRules: string, showControls: boolean, selectedIndex: number | null): string {
  const selectedRule = selectedIndex !== null
    ? `#${OVERLAY_ID} [data-tune-index="${selectedIndex}"] { opacity: 1 !important; transform: translate(-50%, -50%) scale(1.08); }`
    : '';
  const controlsOpacity = showControls ? '0.62' : '0.08';
  return `<style id="${STYLE_ID}">
html, body { overflow: hidden !important; }
html.__ai_video_tune_frozen__ *, html.__ai_video_tune_frozen__ *::before, html.__ai_video_tune_frozen__ *::after {
  animation-play-state: paused !important;
  transition-duration: 0s !important;
}
${elementRules}
#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: none;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#${OVERLAY_ID} .tune-control {
  position: fixed;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.9);
  background: rgba(20,184,166,.92);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  box-shadow: 0 6px 18px rgba(0,0,0,.35);
  opacity: ${controlsOpacity};
  pointer-events: auto;
  transform: translate(-50%, -50%);
  transition: opacity .12s ease, transform .12s ease;
}
#${OVERLAY_ID} .tune-control:hover,
#${OVERLAY_ID} .tune-control:focus {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1.08);
  outline: none;
}
#${OVERLAY_ID} .tune-control.is-removal {
  background: rgba(220,38,38,.96);
  opacity: 1;
}
#${OVERLAY_ID} .tune-control::after {
  content: attr(data-label);
  position: absolute;
  left: 50%;
  top: calc(100% + 5px);
  transform: translateX(-50%);
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: 4px;
  background: rgba(15,23,42,.88);
  padding: 2px 6px;
  color: #fff;
  font-size: 10px;
  font-weight: 500;
  opacity: 0;
  pointer-events: none;
}
#${OVERLAY_ID} .tune-control:hover::after,
#${OVERLAY_ID} .tune-control:focus::after {
  opacity: 1;
}
${selectedRule}
</style>`;
}

function buildPreviewScript(elements: PreviewElement[], options: FrameTunePreviewOptions): string {
  const payload = JSON.stringify({
    elements: elements.map(element => ({
      index: element.index,
      label: element.label,
      selector: element.selector,
      anchor: element.anchor,
      removal: element.proposed.visibility === 'removed',
    })),
    showControls: options.showControls ?? false,
    selectedIndex: options.selectedIndex ?? null,
    overlayId: OVERLAY_ID,
  }).replace(/</g, '\\u003c');

  return `<script id="${SCRIPT_ID}">
(function(){
  var payload = ${payload};
  var old = document.getElementById(payload.overlayId);
  if (old) old.remove();
  var overlay = document.createElement('div');
  overlay.id = payload.overlayId;
  document.documentElement.appendChild(overlay);

  function pointFor(rect, anchor) {
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    if (anchor === 'top') y = rect.top;
    if (anchor === 'bottom') y = rect.bottom;
    if (anchor === 'left') x = rect.left;
    if (anchor === 'right') x = rect.right;
    return { x: x, y: y };
  }

  function render() {
    overlay.innerHTML = '';
    payload.elements.forEach(function(item) {
      var target;
      try { target = document.querySelector(item.selector); } catch (error) { target = null; }
      if (!target) return;
      var rect = target.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      var point = pointFor(rect, item.anchor || 'center');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'tune-control';
      button.dataset.tuneIndex = String(item.index);
      button.dataset.label = item.label || ('元素 ' + (item.index + 1));
      if (item.removal) button.classList.add('is-removal');
      button.textContent = item.removal ? '×' : String(item.index + 1);
      button.style.left = point.x + 'px';
      button.style.top = point.y + 'px';
      button.setAttribute('aria-label', button.dataset.label);
      overlay.appendChild(button);
    });
  }

  function freezeAnimationsAtReadableTime() {
    try {
      document.documentElement.classList.add('__ai_video_tune_layout_locked__');
      if (document.getAnimations) {
        document.getAnimations({ subtree: true }).forEach(function(animation) {
          try {
            var timing = animation.effect && animation.effect.getTiming ? animation.effect.getTiming() : null;
            var duration = timing && typeof timing.duration === 'number' && isFinite(timing.duration) ? timing.duration : 1200;
            var delay = timing && typeof timing.delay === 'number' && isFinite(timing.delay) ? Math.max(0, timing.delay) : 0;
            var readableTime = delay + Math.max(450, duration * 0.65);
            animation.currentTime = readableTime;
            animation.pause();
          } catch (error) {}
        });
      }
      document.documentElement.classList.add('__ai_video_tune_frozen__');
    } catch (error) {}
    render();
  }

  render();
  window.addEventListener('resize', render);
  setTimeout(render, 50);
  setTimeout(render, 250);
  setTimeout(freezeAnimationsAtReadableTime, 120);
  window.addEventListener('load', function() {
    setTimeout(freezeAnimationsAtReadableTime, 80);
  });
})();</script>`;
}

function injectPreviewAssets(htmlCode: string, style: string, script: string): string {
  const assets = `${style}\n${script}`;
  if (/<\/body>/i.test(htmlCode)) return htmlCode.replace(/<\/body>/i, `${assets}\n</body>`);
  if (/<\/head>/i.test(htmlCode)) return htmlCode.replace(/<\/head>/i, `${assets}\n</head>`);
  return `${assets}\n${htmlCode}`;
}

function stripPreviewAssets(htmlCode: string): string {
  return htmlCode
    .replace(new RegExp(`<style id="${STYLE_ID}">[\\s\\S]*?<\\/style>`, 'gi'), '')
    .replace(new RegExp(`<script id="${SCRIPT_ID}">[\\s\\S]*?<\\/script>`, 'gi'), '')
    .replace(new RegExp(`<div id="${OVERLAY_ID}"[\\s\\S]*?<\\/div>`, 'gi'), '')
    .replace(/<script\b[^>]*\bid=["']__ai_video_tune_persisted_script__["'][^>]*>[\s\S]*?<\/script>/gi, '');
}

function sanitizeSelector(selector: string | undefined): string {
  if (!selector) return '';
  const trimmed = selector.trim();
  if (!trimmed || trimmed.length > 160) return '';
  if (/[{}<>]/.test(trimmed)) return '';
  if (/^(html|body|:root|\*|main|section|article|\.?container|\.?scene|\.?stage|\.?screen)$/i.test(trimmed)) return '';
  if (/data-role\s*=\s*["']?(?:text-zone|visual-zone|visual-content|decoration)["']?/i.test(trimmed)) return '';
  if (/[,>+~]/.test(trimmed) && trimmed.split(/\s+/).length > 4) return '';
  return trimmed;
}

function normalizeAnchor(anchor: unknown): FrameTunePreviewAnchor {
  if (anchor === 'top' || anchor === 'bottom' || anchor === 'left' || anchor === 'right') return anchor;
  return 'center';
}

function parsePositionInPixels(value: unknown, axisSize: number): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numericValue = Number(match[0]);
  return text.includes('%') ? (numericValue / 100) * axisSize : numericValue;
}

function formatPixels(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${Object.is(rounded, -0) ? 0 : rounded}px`;
}

function parseNumber(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseInteger(value: unknown): number | null {
  const parsed = parseNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function parseDuration(value: unknown): number | null {
  const parsed = parseNumber(value);
  return parsed === null || parsed <= 0 ? null : clamp(parsed, 0.1, 30);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
