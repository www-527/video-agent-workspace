/**
 * iframe 工具：把 AI 生成的 HTML 包一层"看门狗"，
 * 强制在指定秒数后停掉所有动画与定时器，防止 AI 写出无限循环把浏览器卡死。
 *
 * 工作原理：
 *   1. 在外层文档里嵌入 AI 的 HTML 内容（不嵌套 iframe，避免 srcdoc 套娃）
 *   2. 外层用 <script> 监听一个 watchdog
 *   3. 超时后：清掉所有元素的 CSS animation/transition、覆盖 setInterval、覆盖 requestAnimationFrame
 */

import { enforceProtectedLayout, stripLegacyAutoFitGuard } from '@/lib/layout-safety';
import { getCanvasPreset } from '@/lib/canvas-presets';
import { PORTRAIT_VISUAL_TOKENS } from '@/lib/portrait-visual-system';
import { buildVisualStabilityRuntime } from '@/lib/visual-stability';
import type { CanvasPresetId } from '@/types';

const WATCHDOG_DEFAULT_MS = 8_000;

export interface WatchdogOptions {
  /** Quality audits inspect a deterministic animation point without changing normal preview playback. */
  settleAnimationsBeforeAudit?: boolean;
  /** 0..1 progress point used only by hidden quality-audit iframes. */
  auditAnimationProgress?: number;
  /** Correlates an audit result with the exact hidden-render request that produced it. */
  auditToken?: string;
  /** Interactive previews receive explicit play/pause messages from PreviewCanvas. */
  playbackControlled?: boolean;
  canvasPreset?: CanvasPresetId;
}

export interface RenderVisibilityStatus {
  checked: boolean;
  candidateCount: number;
  visibleCount: number;
  issue?: 'invisible';
}

/**
 * Kept self-contained because Playwright serializes this function into the
 * render page and preview iframes embed the exact same implementation.
 */
export function auditCoreVisualVisibility(): RenderVisibilityStatus {
  const isGPTFree = Boolean(document.querySelector('[data-gpt-visual-bible]'));
  const selectors = isGPTFree
    ? ['[data-editor-id]', '[data-element-id]']
    : [
        '[data-role="visual-zone"] [data-editor-id]',
        '[data-role="visual-zone"] [data-element-id]',
        '[data-role="visual-content"] [data-role="composite"]',
      ];
  const elements = Array.from(document.querySelectorAll(selectors.join(',')));
  const candidates = elements.filter(element => {
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
    if (element.closest(
      '[data-role="decoration"],[data-role="subtitle"],[data-ai-editor-overlay],'
      + '[aria-hidden="true"],[hidden],.subtitle-layer,.ai-editor-overlay',
    )) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 4 && rect.height >= 4;
  });
  const stage = document.querySelector('.ai-stage');
  const stageRect = stage?.getBoundingClientRect();
  const canvas = stageRect && stageRect.width >= 4 && stageRect.height >= 4
    ? stageRect
    : { left: 0, top: 0, right: document.documentElement.clientWidth || 1280, bottom: document.documentElement.clientHeight || 720 };
  const visibleCount = candidates.filter(element => {
    const rect = element.getBoundingClientRect();
    if (rect.right <= canvas.left || rect.left >= canvas.right || rect.bottom <= canvas.top || rect.top >= canvas.bottom) {
      return false;
    }
    let opacity = 1;
    let current: Element | null = element;
    while (current) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      const ownOpacity = Number.parseFloat(style.opacity || '1');
      opacity *= Number.isFinite(ownOpacity) ? ownOpacity : 1;
      if (opacity <= 0.1) return false;
      current = current.parentElement;
    }
    return opacity > 0.1;
  }).length;
  return {
    checked: true,
    candidateCount: candidates.length,
    visibleCount,
    ...(candidates.length > 0 && visibleCount === 0 ? { issue: 'invisible' as const } : {}),
  };
}

/**
 * Normalize generated scenes into one absolute 1280×720 coordinate system.
 * Generated Grid/Flex roots may retain their static placement even after a
 * child is made absolute, which would otherwise add a second offset to every
 * protected zone.
 */
export function enforceLayoutSafety(html: string, canvasPreset?: CanvasPresetId): string {
  return enforceProtectedLayout(html, canvasPreset);
}
const GSAP_COMPAT_SCRIPT = `<script>
  (function() {
    if (window.gsap) return;
    function toArray(targets) {
      if (!targets) return [];
      if (typeof targets === 'string') return Array.prototype.slice.call(document.querySelectorAll(targets));
      if (targets instanceof Element || targets === window || targets === document) return [targets];
      if (Array.isArray(targets)) return targets;
      if (typeof targets.length === 'number') return Array.prototype.slice.call(targets);
      return [targets];
    }
    function normalizeValue(value) {
      return typeof value === 'number' ? String(value) : value;
    }
    function applyVars(targets, vars) {
      var reserved = { duration: true, delay: true, ease: true, stagger: true, onComplete: true, onStart: true, paused: true };
      toArray(targets).forEach(function(el) {
        if (!el || !el.style) return;
        Object.keys(vars || {}).forEach(function(key) {
          if (reserved[key]) return;
          var value = vars[key];
          if (key === 'x') el.style.transform = (el.style.transform || '') + ' translateX(' + normalizeValue(value) + 'px)';
          else if (key === 'y') el.style.transform = (el.style.transform || '') + ' translateY(' + normalizeValue(value) + 'px)';
          else if (key === 'scale') el.style.transform = (el.style.transform || '') + ' scale(' + normalizeValue(value) + ')';
          else if (key === 'rotation' || key === 'rotate') el.style.transform = (el.style.transform || '') + ' rotate(' + normalizeValue(value) + 'deg)';
          else if (key === 'autoAlpha') { el.style.opacity = normalizeValue(value); el.style.visibility = Number(value) <= 0 ? 'hidden' : 'visible'; }
          else if (key in el.style) el.style[key] = normalizeValue(value);
        });
      });
      if (typeof vars?.onStart === 'function') setTimeout(function(){ try { vars.onStart(); } catch(e) {} }, 0);
      if (typeof vars?.onComplete === 'function') setTimeout(function(){ try { vars.onComplete(); } catch(e) {} }, Math.max(0, Number(vars.duration || 0) * 1000));
      return tweenApi;
    }
    var tweenApi = { play: function(){ return this; }, pause: function(){ return this; }, restart: function(){ return this; }, kill: function(){ return this; } };
    function timeline() {
      return {
        to: function(targets, vars) { applyVars(targets, vars); return this; },
        from: function(targets, vars) { applyVars(targets, vars); return this; },
        fromTo: function(targets, fromVars, toVars) { applyVars(targets, fromVars); applyVars(targets, toVars); return this; },
        set: function(targets, vars) { applyVars(targets, vars); return this; },
        add: function(fn) { if (typeof fn === 'function') fn(); return this; },
        play: function(){ return this; },
        pause: function(){ return this; },
        restart: function(){ return this; },
        kill: function(){ return this; }
      };
    }
    window.gsap = {
      to: applyVars,
      from: applyVars,
      fromTo: function(targets, fromVars, toVars) { applyVars(targets, fromVars); return applyVars(targets, toVars); },
      set: applyVars,
      timeline: timeline,
      registerPlugin: function() {},
      defaults: function() {},
      utils: { toArray: toArray }
    };
  })();
</script>`;

/**
 * 把 AI 输出的 HTML 包成安全的"带看门狗"HTML 字符串。
 * 适用于 iframe srcdoc。
 *
 * @param innerHtml  AI 返回的 HTML（可包含 <!DOCTYPE> 或不含）
 * @param watchdogMs 看门狗超时（毫秒），默认 8 秒
 */
export function wrapHtmlWithWatchdog(
  innerHtml: string,
  watchdogMs = WATCHDOG_DEFAULT_MS,
  options: WatchdogOptions = {},
): string {
  const preset = getCanvasPreset(options.canvasPreset);
  // 1) 提取 AI 的 <head> 和 <body> 内容（如果没有就当作纯片段）
  const extracted = extractHeadAndBody(innerHtml);

  // 2) 拼装外层 HTML
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${preset.design.width}, initial-scale=1" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: ${preset.design.height}px; width: ${preset.design.width}px; overflow: hidden; background: transparent; }
  body { display: block; position: relative; }
  /* ⭐ 把 AI 内容包在唯一容器里，让容器铺满 body — 既保证铺满，又不破坏 AI 内部各元素的尺寸/定位 */
  .ai-stage { position: absolute; inset: 0; width: ${preset.design.width}px; height: ${preset.design.height}px; overflow: hidden; }
  [data-editor-id], [data-element-id] { cursor: pointer; }
  [data-editor-selected="true"] { outline: 3px solid #0f766e !important; outline-offset: 3px; }
  [data-editor-multi-selected="true"] { outline: 2px solid rgba(13, 148, 136, .82) !important; outline-offset: 3px; }
  [data-layout-issue="true"] { outline: 3px solid #dc2626 !important; outline-offset: 3px; }
  html[data-ai-playback="true"] [data-editor-selected="true"],
  html[data-ai-playback="true"] [data-editor-multi-selected="true"],
  html[data-ai-playback="true"] [data-layout-issue="true"] { outline: none !important; }
  html[data-ai-playback="true"] [data-editor-id],
  html[data-ai-playback="true"] [data-element-id] { cursor: default; }
  html[data-ai-playback="true"] .ai-editor-marquee { display: none !important; }
  html[data-ai-animation-paused="true"] .ai-stage *,
  html[data-ai-animation-paused="true"] .ai-stage *::before,
  html[data-ai-animation-paused="true"] .ai-stage *::after { animation-play-state: paused !important; }
  ${options.playbackControlled === true ? 'html:not([data-ai-playback-ready="true"]) .ai-stage { visibility: hidden !important; }' : ''}
  .ai-editor-marquee { position: fixed; z-index: 2147483647; pointer-events: none; border: 1.5px dashed #0f766e; background: rgba(20, 184, 166, .12); box-shadow: 0 0 0 1px rgba(255,255,255,.65) inset; }
  /* 看门狗触发后的样式 */
  body.frozen *, body.frozen *::before, body.frozen *::after {
    transition: none !important;
    animation-play-state: paused !important;
  }
</style>
${GSAP_COMPAT_SCRIPT}
${extracted.head}
<script>
  (function() {
    var WATCHDOG_MS = ${watchdogMs};
    var SETTLE_ANIMATIONS_BEFORE_AUDIT = ${options.settleAnimationsBeforeAudit === true};
    var AUDIT_ANIMATION_PROGRESS = ${Math.max(0, Math.min(1, options.auditAnimationProgress ?? 1))};
    var AUDIT_TOKEN = ${JSON.stringify(options.auditToken ?? '')};
    var PLAYBACK_CONTROLLED = ${options.playbackControlled === true};
    var frozen = false;
    var playbackActive = false;
    var playbackInitialized = false;
    var playbackHasStarted = false;
    var playbackRevision = null;
    // page.setContent() keeps Window globals from the previous document. Clear
    // the old audit synchronously so sequential samples cannot reuse its result.
    try {
      window.__ai_video_layout_audit = undefined;
      window.__ai_video_layout_audit_token = undefined;
    } catch (error) {}
    if (PLAYBACK_CONTROLLED) {
      document.documentElement.setAttribute('data-ai-animation-paused', 'true');
    }
    function syncDocumentAnimations(playing, restart) {
      if (!document.getAnimations) return;
      document.getAnimations().forEach(function(animation) {
        try {
          if (restart) {
            animation.pause();
            animation.currentTime = 0;
          }
          if (playing) animation.play();
          else animation.pause();
        } catch (error) {}
      });
    }
    function settleDocumentAnimationsAtEnd() {
      document.documentElement.setAttribute('data-ai-animation-paused', 'true');
      if (!document.getAnimations) return;
      document.getAnimations().forEach(function(animation) {
        try {
          animation.pause();
          var timing = animation.effect && animation.effect.getComputedTiming
            ? animation.effect.getComputedTiming()
            : null;
          if (timing && Number.isFinite(timing.endTime)) {
            animation.currentTime = Math.max(timing.endTime - 0.001, 0);
          }
        } catch (error) {}
      });
    }
    function updatePlaybackAnimations(playing, restart) {
      if (playing) {
        thawRuntime();
        scheduleWatchdog();
      }
      document.documentElement.setAttribute('data-ai-animation-paused', playing ? 'false' : 'true');
      syncDocumentAnimations(playing, restart);
    }
    function freeze() {
      if (frozen) return;
      frozen = true;
      watchdogTimer = null;
      try {
        // 1) 停所有 CSS 动画
        // Preserve the rendered frame. Removing CSS animation would restore the
        // authored pre-animation styles (commonly opacity: 0) and blank the scene.
        try {
          document.getAnimations().forEach(function(animation) {
            try { animation.pause(); } catch (e) {}
          });
        } catch (e) {}
        document.body.classList.add('frozen');
        // 2) 覆盖 setInterval / setTimeout，让新的定时器直接 no-op
        window.setInterval = function() { return -1; };
        window.setTimeout = function(fn, t) {
          if (typeof fn === 'function' && Number(t || 0) <= 0) {
            // setTimeout(fn, 0) 之类的关键任务仍然放行
            var id = setTimeoutOrig(function(){ try { fn(); } catch(e){} }, 0);
            return id;
          }
          return -1;
        };
        // 3) 停掉 requestAnimationFrame 链
        window.requestAnimationFrame = function() { return 0; };
        // 4) 只清理由本分镜实际创建的 timer，避免多个缩略分镜同时
        // 扫描大段 timer id，把主编辑线程一起卡住。
        trackedIntervals.forEach(function(id) { clearInterval(id); });
        trackedTimeouts.forEach(function(id) { clearTimeout(id); });
        trackedIntervals = [];
        trackedTimeouts = [];
      } catch (e) {}
    }
    var setTimeoutOrig = window.setTimeout;
    var setIntervalOrig = window.setInterval;
    var requestAnimationFrameOrig = window.requestAnimationFrame;
    var trackedTimeouts = [];
    var trackedIntervals = [];
    var watchdogTimer = null;
    function trackedSetTimeout() {
      var id = setTimeoutOrig.apply(window, arguments);
      trackedTimeouts.push(id);
      return id;
    }
    function trackedSetInterval() {
      var id = setIntervalOrig.apply(window, arguments);
      trackedIntervals.push(id);
      return id;
    }
    function restoreRuntimeTimingApis() {
      window.setTimeout = trackedSetTimeout;
      window.setInterval = trackedSetInterval;
      window.requestAnimationFrame = requestAnimationFrameOrig;
    }
    function thawRuntime() {
      frozen = false;
      if (document.body) document.body.classList.remove('frozen');
      restoreRuntimeTimingApis();
    }
    function scheduleWatchdog() {
      if (watchdogTimer !== null) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeoutOrig(freeze, WATCHDOG_MS);
    }
    restoreRuntimeTimingApis();
    scheduleWatchdog();

    function prepareStaticPreview() {
      if (!PLAYBACK_CONTROLLED || playbackInitialized) return;
      settleDocumentAnimationsAtEnd();
    }
    if (PLAYBACK_CONTROLLED) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', prepareStaticPreview, { once: true });
      } else {
        prepareStaticPreview();
      }
    }

    ${buildVisualStabilityRuntime(options.canvasPreset)}

    // Report the fixed design canvas size to the parent. AI-generated content can
    // briefly create huge scroll dimensions during animation; using those values
    // for scaling makes the visible 1280x720 stage shrink into a corner.
    function reportSize() {
      try {
        parent.postMessage({ type: '__ai_video_iframe_size', w: ${preset.design.width}, h: ${preset.design.height} }, '*');
      } catch (e) {}
    }
    // 多次上报，确保拿到准确尺寸（动画/字体加载后尺寸可能变化）
    setTimeoutOrig(reportSize, 50);
    setTimeoutOrig(reportSize, 200);
    setTimeoutOrig(reportSize, 500);
    setTimeoutOrig(reportSize, 1000);
    if (document.readyState === 'complete') {
      reportSize();
    } else {
      window.addEventListener('load', reportSize);
    }
    function auditLayout() {
      try {
        var stage = document.querySelector('.ai-stage');
        var main = document.querySelector('main[data-layout]') || stage;
        if (!stage || !main) return;
        var stageRect = stage.getBoundingClientRect();
        var issues = [];
        var seen = {};
        function editorId(element) { return element && (element.getAttribute('data-editor-id') || element.getAttribute('data-element-id') || ''); }
        function canvasPosition(rect) { return { left: Math.round(rect.left - stageRect.left), top: Math.round(rect.top - stageRect.top) }; }
        function add(code, severity, element, detail, suggestedFix, relatedElement) {
          var label = element.getAttribute('data-editor-label') || element.getAttribute('data-element-label') || (element.textContent || '').trim().slice(0, 28) || element.tagName.toLowerCase();
          var id = editorId(element);
          var relatedId = editorId(relatedElement);
          var key = code + ':' + id + ':' + relatedId;
          if (seen[key]) return;
          seen[key] = true;
          issues.push({ code: code, severity: severity, label: label, detail: detail, elementId: id || undefined,
            relatedElementId: relatedId || undefined, suggestedFix: suggestedFix || undefined });
        }
        document.querySelectorAll('[data-layout-issue]').forEach(function(element) { element.removeAttribute('data-layout-issue'); });
        function overflowDetail(rect, parentRect, parent, tolerance) {
          var parts = [];
          var role = parent.getAttribute('data-role');
          var boundary = role || 'overflow container';
          if (rect.top < parentRect.top - tolerance) parts.push('上侧 ' + Math.ceil(parentRect.top - rect.top) + 'px');
          if (rect.right > parentRect.right + tolerance) parts.push('右侧 ' + Math.ceil(rect.right - parentRect.right) + 'px');
          if (rect.bottom > parentRect.bottom + tolerance) parts.push('下侧 ' + Math.ceil(rect.bottom - parentRect.bottom) + 'px');
          if (rect.left < parentRect.left - tolerance) parts.push('左侧 ' + Math.ceil(parentRect.left - rect.left) + 'px');
          return '元素超出 ' + boundary + '：' + parts.join('、') + '，当前会被裁切。';
        }
        function parseRgb(value) {
          var match = String(value || '').match(/rgba?\\((\\d+)[, ]+(\\d+)[, ]+(\\d+)(?:[, /]+([\\d.]+))?\\)/i);
          return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
        }
        function luminance(rgb) {
          var values = rgb.slice(0, 3).map(function(value) { var c = value / 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); });
          return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
        }
        function effectiveOpacity(element) {
          var opacity = 1;
          var current = element;
          while (current && current !== document.documentElement) {
            var value = parseFloat(getComputedStyle(current).opacity);
            if (Number.isFinite(value)) opacity *= value;
            if (current === stage) break;
            current = current.parentElement;
          }
          return Math.max(0, Math.min(1, opacity));
        }
        function blendRgb(foreground, background, alpha) {
          var amount = Math.max(0, Math.min(1, alpha));
          return [
            foreground[0] * amount + background[0] * (1 - amount),
            foreground[1] * amount + background[1] * (1 - amount),
            foreground[2] * amount + background[2] * (1 - amount),
            1,
          ];
        }
        function contrastRatio(foreground, background) {
          var l1 = luminance(foreground), l2 = luminance(background);
          return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
        }
        function rgbCss(rgb) {
          return 'rgb(' + rgb.slice(0, 3).map(function(value) { return Math.max(0, Math.min(255, Math.round(value))); }).join(', ') + ')';
        }
        function closestAccessibleTextColor(foreground, background, required, opacity) {
          var best = null;
          [[0, 0, 0, 1], [255, 255, 255, 1]].forEach(function(target) {
            function candidateAt(amount) {
              var candidate = [
                foreground[0] + (target[0] - foreground[0]) * amount,
                foreground[1] + (target[1] - foreground[1]) * amount,
                foreground[2] + (target[2] - foreground[2]) * amount,
                1,
              ];
              return opacity < .999 ? blendRgb(candidate, background, opacity) : candidate;
            }
            if (contrastRatio(candidateAt(1), background) < required) return;
            var low = 0, high = 1;
            for (var step = 0; step < 16; step++) {
              var middle = (low + high) / 2;
              if (contrastRatio(candidateAt(middle), background) >= required) high = middle;
              else low = middle;
            }
            if (!best || high < best.amount) {
              best = {
                amount: high,
                color: [
                  foreground[0] + (target[0] - foreground[0]) * high,
                  foreground[1] + (target[1] - foreground[1]) * high,
                  foreground[2] + (target[2] - foreground[2]) * high,
                  1,
                ],
              };
            }
          });
          return best ? rgbCss(best.color) : null;
        }
        function backgroundOf(element) {
          var current = element;
          while (current && current !== document.documentElement) {
            var rgb = parseRgb(getComputedStyle(current).backgroundColor);
            if (rgb && rgb[3] > .85) return rgb;
            current = current.parentElement;
          }
          // Gradients and transparent image backgrounds cannot be measured
          // reliably from computed backgroundColor alone. Skip instead of
          // inventing a white background and creating a false warning.
          return null;
        }
        function compositeRoot(element) {
          return element && element.closest && element.closest('[data-role="composite"],[data-editor-group="composite"]');
        }
        function sameComposite(a, b) {
          var ca = compositeRoot(a);
          var cb = compositeRoot(b);
          return Boolean(ca && ca === cb);
        }
        function intentionalCompositeClip(element, parent, rect, tolerance, isText) {
          if (isText) return false;
          var composite = compositeRoot(element);
          if (!composite || !composite.contains(parent)) return false;
          var compositeRect = composite.getBoundingClientRect();
          // Cylinders, screens, masks and similar composite parts legitimately
          // clip their own moving non-text internals. This is safe only while
          // the complete part still remains inside the composite's outer box.
          return rect.left >= compositeRect.left - tolerance
            && rect.top >= compositeRect.top - tolerance
            && rect.right <= compositeRect.right + tolerance
            && rect.bottom <= compositeRect.bottom + tolerance;
        }
        function repairTarget(element) {
          var composite = element.closest && element.closest('[data-role="composite"][data-editor-id],[data-role="composite"][data-element-id]');
          if (composite) return composite;
          var current = element, topmost = element;
          while (current && current.parentElement && current.parentElement !== stage) {
            current = current.parentElement;
            var role = current.getAttribute && current.getAttribute('data-role');
            if (role === 'text-zone' || role === 'visual-zone') break;
            if (editorId(current)) topmost = current;
          }
          return topmost;
        }
        function correctedCanvasPosition(rect, boundaryRect, margin) {
          var position = canvasPosition(rect);
          var left = position.left;
          var top = position.top;
          if (rect.left < boundaryRect.left + margin) left += Math.ceil(boundaryRect.left + margin - rect.left);
          if (rect.right > boundaryRect.right - margin) left -= Math.ceil(rect.right - boundaryRect.right + margin);
          if (rect.top < boundaryRect.top + margin) top += Math.ceil(boundaryRect.top + margin - rect.top);
          if (rect.bottom > boundaryRect.bottom - margin) top -= Math.ceil(rect.bottom - boundaryRect.bottom + margin);
          return { left: Math.max(8, Math.round(left)), top: Math.max(8, Math.round(top)) };
        }
        var elements = Array.prototype.slice.call(document.querySelectorAll('[data-editor-id],[data-element-id]'));
        elements.forEach(function(element) {
          var rect = element.getBoundingClientRect();
          var style = getComputedStyle(element);
          var position = canvasPosition(rect);
          var tag = element.tagName.toLowerCase();
          var text = (element.innerText || '').trim();
          var directTextNodes = Array.prototype.filter.call(element.childNodes || [], function(node) {
            return node.nodeType === 3 && (node.textContent || '').trim();
          });
          var isText = text.length > 0 && (/^(h1|h2|h3|h4|p|span|strong|em|button|li|blockquote)$/.test(tag) || directTextNodes.length > 0 || element.children.length === 0);
          if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return;
          if (rect.left < stageRect.left - 1 || rect.top < stageRect.top - 1 || rect.right > stageRect.right + 1 || rect.bottom > stageRect.bottom + 1) {
            var canvasTarget = repairTarget(element);
            var canvasRect = canvasTarget.getBoundingClientRect();
            var canvasFixed = correctedCanvasPosition(canvasRect, stageRect, 8);
            add('out_of_bounds', 'critical', canvasTarget, '元素超出 ${preset.design.width}×${preset.design.height} 画布。', { elementId: editorId(canvasTarget), changes: canvasFixed });
          }
          var role = element.getAttribute && element.getAttribute('data-role');
          var isDecoration = role === 'decoration' || Boolean(element.closest && element.closest('[data-role="decoration"]'));
          if (${preset.id === 'douyin-portrait-9-16'} && !isDecoration && (
            rect.left < stageRect.left + ${preset.platformSafeArea.left} - 1
            || rect.top < stageRect.top + ${preset.platformSafeArea.top} - 1
            || rect.right > stageRect.left + ${preset.platformSafeArea.right} + 1
          )) {
            var platformTarget = repairTarget(element);
            var platformRect = platformTarget.getBoundingClientRect();
            var platformBoundary = {
              left: stageRect.left + ${preset.platformSafeArea.left},
              top: stageRect.top + ${preset.platformSafeArea.top},
              right: stageRect.left + ${preset.platformSafeArea.right},
              bottom: stageRect.top + ${preset.contentArea.bottom}
            };
            add('platform_safe_area', 'critical', platformTarget, '元素进入竖屏平台避让区。', { elementId: editorId(platformTarget), changes: correctedCanvasPosition(platformRect, platformBoundary, 0) });
          }
          if (rect.bottom - stageRect.top > ${preset.contentArea.bottom}) {
            var subtitleTarget = repairTarget(element);
            var subtitleRect = subtitleTarget.getBoundingClientRect();
            var subtitlePosition = canvasPosition(subtitleRect);
            add('subtitle_safe_area', 'critical', subtitleTarget, '元素进入字幕安全区（y=${preset.contentArea.bottom} 之后）。', { elementId: editorId(subtitleTarget), changes: { left: subtitlePosition.left, top: Math.max(8, Math.round(subtitlePosition.top - (subtitleRect.bottom - stageRect.top - ${preset.contentArea.bottom - 8}))) } });
          }
          var parentElement = element.parentElement;
          while (parentElement && parentElement !== stage) {
            var parentStyle = getComputedStyle(parentElement);
            // Fixed editor patches use canvas coordinates, but they still belong
            // to their authored text/visual zone. Skipping ancestor checks here
            // allowed an automatic repair to escape its zone and drift over the
            // title while incorrectly passing the next quality round.
            if (parentStyle.overflowX !== 'visible' || parentStyle.overflowY !== 'visible') {
              var parentRect = parentElement.getBoundingClientRect();
              // Glyph antialiasing, italic overhang and rounding commonly extend a
              // text box by 1-4px without clipping any visible character.
              var clipTolerance = isText ? 6 : 2;
              if (rect.left < parentRect.left - clipTolerance || rect.top < parentRect.top - clipTolerance || rect.right > parentRect.right + clipTolerance || rect.bottom > parentRect.bottom + clipTolerance) {
                if (intentionalCompositeClip(element, parentElement, rect, clipTolerance, isText)) {
                  parentElement = parentElement.parentElement;
                  continue;
                }
                var clipTarget = repairTarget(element);
                var clipRect = clipTarget.getBoundingClientRect();
                var corrected = correctedCanvasPosition(clipRect, parentRect, 8);
                add('clipped', 'critical', clipTarget, overflowDetail(rect, parentRect, parentElement, clipTolerance), { elementId: editorId(clipTarget), changes: corrected });
                break;
              }
            }
            parentElement = parentElement.parentElement;
          }
          if (!isText) return;
          var fontSize = parseFloat(style.fontSize) || 0;
          var minimum = /^h[1-4]$/.test(tag)
            ? ${preset.id === 'douyin-portrait-9-16' ? PORTRAIT_VISUAL_TOKENS.titleMin : 48}
            : tag === 'p' || tag === 'li' || tag === 'blockquote'
              ? ${preset.id === 'douyin-portrait-9-16' ? PORTRAIT_VISUAL_TOKENS.supportingMin : 24}
              : ${preset.id === 'douyin-portrait-9-16' ? PORTRAIT_VISUAL_TOKENS.labelMin : 18};
          if (fontSize + .5 < minimum) add('font_too_small', 'major', element, '字号 ' + Math.round(fontSize) + 'px，小于最低要求 ' + minimum + 'px。', { elementId: editorId(element), changes: { fontSize: minimum } });
          if (rect.left - stageRect.left < 32 || stageRect.right - rect.right < 32 || rect.top - stageRect.top < 24) {
            add('edge_spacing', 'major', element, '文字距离画布边缘过近。', { elementId: editorId(element), changes: { left: Math.max(${preset.contentArea.left}, Math.min(${preset.contentArea.right} - rect.width, position.left)), top: Math.max(${preset.contentArea.top}, position.top) } });
          }
          var fg = parseRgb(style.color);
          var bg = backgroundOf(element);
          if (fg && bg) {
            var authoredOpacity = parseFloat(style.opacity);
            var inheritedOpacity = effectiveOpacity(element) / Math.max(Number.isFinite(authoredOpacity) ? authoredOpacity : 1, .001);
            inheritedOpacity = Math.max(0, Math.min(1, inheritedOpacity));
            var opacity = effectiveOpacity(element) * (fg[3] === undefined ? 1 : fg[3]);
            var visibleFg = opacity < .999 ? blendRgb(fg, bg, opacity) : fg;
            var ratio = contrastRatio(visibleFg, bg);
            var required = fontSize >= 24 ? 3 : 4.5;
            if (ratio < required) {
              var accessibleColor = closestAccessibleTextColor(fg, bg, required, inheritedOpacity);
              var contrastChanges = accessibleColor
                ? { color: accessibleColor, opacity: 1 }
                : luminance(bg) < .5
                  ? { color: '#ffffff', opacity: 1, backgroundColor: 'rgba(0, 0, 0, 0.9)', padding: '0.08em 0.22em', borderRadius: '0.18em', boxDecorationBreak: 'clone' }
                  : { color: '#0b0f14', opacity: 1, backgroundColor: 'rgba(255, 255, 255, 0.94)', padding: '0.08em 0.22em', borderRadius: '0.18em', boxDecorationBreak: 'clone' };
              add('low_contrast', 'major', element, '文字对比度 ' + ratio.toFixed(1) + ':1，低于 ' + required + ':1。', { elementId: editorId(element), changes: contrastChanges });
            }
          }
          var lineRects = [];
          var range = document.createRange();
          if (directTextNodes.length) {
            directTextNodes.forEach(function(node) {
              range.selectNodeContents(node);
              lineRects = lineRects.concat(Array.prototype.slice.call(range.getClientRects()));
            });
          } else {
            range.selectNodeContents(element);
            lineRects = Array.prototype.slice.call(range.getClientRects());
          }
          var occludedBy = null;
          for (var r = 0; r < lineRects.length && !occludedBy; r++) {
            var line = lineRects[r];
            var points = [[.2,.5],[.5,.5],[.8,.5],[.5,.25],[.5,.75]];
            for (var p = 0; p < points.length; p++) {
              var x = line.left + line.width * points[p][0];
              var y = line.top + line.height * points[p][1];
              var stack = document.elementsFromPoint(x, y);
              var top = stack.filter(function(hit) { return !hit.closest || !hit.closest('[data-ai-editor-overlay]'); })[0];
              var positionedDescendant = top && element.contains(top)
                && /^(?:absolute|fixed)$/.test(getComputedStyle(top).position);
              if (top && top !== element && (!element.contains(top) || positionedDescendant) && !top.contains(element) && !sameComposite(element, top)) {
                var blocker = top.closest && top.closest('[data-editor-id],[data-element-id]');
                if (blocker && blocker !== element) { occludedBy = blocker; break; }
              }
            }
          }
          if (occludedBy) {
            var blockerRect = occludedBy.getBoundingClientRect();
            var blockerPos = canvasPosition(blockerRect);
            var moveUp = Math.round(rect.top - blockerRect.bottom - 24);
            var targetTop = moveUp >= 8 ? moveUp : Math.min(${preset.contentArea.bottom - 8} - blockerRect.height, Math.round(rect.bottom - stageRect.top + 24));
            add('text_occluded', 'critical', element, '文字被“' + (occludedBy.getAttribute('data-editor-label') || '其他元素') + '”遮挡。',
              { elementId: editorId(occludedBy), changes: { left: blockerPos.left, top: Math.max(8, targetTop) } }, occludedBy);
          }
        });
        function intersection(a, b) {
          var left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
          var right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
          return { width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
        }
        function isSemanticCandidate(element) {
          var role = element.getAttribute('data-role') || '';
          if (role === 'decoration' || role === 'connector' || role === 'text-zone' || role === 'visual-zone') return false;
          var tag = element.tagName.toLowerCase();
          if (/^(h1|h2|h3|h4|p|span|strong|em|button|li|blockquote)$/.test(tag)) return false;
          var rect = element.getBoundingClientRect();
          var style = getComputedStyle(element);
          // Connector overlays and other non-interactive drawing layers often
          // occupy the whole visual zone. They are not independent semantic
          // objects and must not create 100% overlap false positives.
          if (style.pointerEvents === 'none') return false;
          return rect.width >= 24 && rect.height >= 24 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > .1;
        }
        function separationFix(mover, obstacle) {
          var moverRect = mover.getBoundingClientRect(), obstacleRect = obstacle.getBoundingClientRect();
          var current = canvasPosition(moverRect), gap = 24;
          var options = [
            { left: Math.round(obstacleRect.left - stageRect.left - moverRect.width - gap), top: current.top },
            { left: Math.round(obstacleRect.right - stageRect.left + gap), top: current.top },
            { left: current.left, top: Math.round(obstacleRect.top - stageRect.top - moverRect.height - gap) },
            { left: current.left, top: Math.round(obstacleRect.bottom - stageRect.top + gap) }
          ].filter(function(option) { return option.left >= ${preset.contentArea.left} && option.top >= ${preset.contentArea.top} && option.left + moverRect.width <= ${preset.contentArea.right} && option.top + moverRect.height <= ${preset.contentArea.bottom - 8}; });
          options.sort(function(a, b) { return Math.abs(a.left - current.left) + Math.abs(a.top - current.top) - Math.abs(b.left - current.left) - Math.abs(b.top - current.top); });
          return options[0] || null;
        }
        var semantic = elements.filter(isSemanticCandidate);
        for (var a = 0; a < semantic.length; a++) {
          for (var b = a + 1; b < semantic.length; b++) {
            var first = semantic[a], second = semantic[b];
            if (first.contains(second) || second.contains(first) || sameComposite(first, second)) continue;
            var firstRect = first.getBoundingClientRect(), secondRect = second.getBoundingClientRect();
            var overlap = intersection(firstRect, secondRect);
            var overlapArea = overlap.width * overlap.height;
            var smallerArea = Math.min(firstRect.width * firstRect.height, secondRect.width * secondRect.height);
            var ratio = smallerArea > 0 ? overlapArea / smallerArea : 0;
            if (overlapArea < 1200 || ratio < .15) continue;
            var mover = firstRect.width * firstRect.height <= secondRect.width * secondRect.height ? first : second;
            var obstacle = mover === first ? second : first;
            var fix = separationFix(mover, obstacle);
            add('semantic_overlap', ratio >= .35 ? 'critical' : 'major', mover,
              '与“' + (obstacle.getAttribute('data-editor-label') || obstacle.tagName.toLowerCase()) + '”重叠 ' + Math.round(ratio * 100) + '%。',
              fix ? { elementId: editorId(mover), changes: fix } : null, obstacle);
          }
        }
        // A text occlusion and a semantic overlap can describe the same pair of
        // elements. Report that collision once so repair and UI stay aligned.
        var collisionKeys = {};
        issues.forEach(function(issue) {
          if (issue.code !== 'text_occluded' || !issue.elementId || !issue.relatedElementId) return;
          collisionKeys[[issue.elementId, issue.relatedElementId].sort().join('::')] = true;
        });
        issues = issues.filter(function(issue) {
          if (issue.code !== 'semantic_overlap' || !issue.elementId || !issue.relatedElementId) return true;
          return !collisionKeys[[issue.elementId, issue.relatedElementId].sort().join('::')];
        });
        var microLabels = Array.prototype.slice.call(main.querySelectorAll('[data-role="micro-label"]')).filter(function(element) {
          var style = getComputedStyle(element);
          var rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > .1;
        });
        microLabels.slice(2).forEach(function(element) {
          add('excessive_micro_labels', 'major', element, '本镜装饰性微标签超过 2 个；保留最有信息作用的两个，图例、坐标轴、数据单位和必要表头不属于微标签。');
        });
        if (${preset.id === 'douyin-portrait-9-16'}) {
          var focal = main.querySelector('[data-role="focal"]');
          var visualZone = main.querySelector('[data-role="visual-zone"]');
          if (focal && visualZone) {
            var focalStyle = getComputedStyle(focal);
            var focalRect = focal.getBoundingClientRect();
            var zoneRect = visualZone.getBoundingClientRect();
            var widthRatio = zoneRect.width > 0 ? focalRect.width / zoneRect.width : 0;
            var heightRatio = zoneRect.height > 0 ? focalRect.height / zoneRect.height : 0;
            var areaRatio = widthRatio * heightRatio;
            var focalVisible = focalRect.width > 0 && focalRect.height > 0
              && focalStyle.display !== 'none' && focalStyle.visibility !== 'hidden' && Number(focalStyle.opacity || 1) > .1;
            if (focalVisible && ((widthRatio < ${PORTRAIT_VISUAL_TOKENS.focalWidthMinRatio} && heightRatio < ${PORTRAIT_VISUAL_TOKENS.focalHeightMinRatio}) || areaRatio < ${PORTRAIT_VISUAL_TOKENS.focalAreaMinRatio})) {
              var focalTarget = repairTarget(focal);
              var scale = Math.min(1.6, Math.max(
                ${PORTRAIT_VISUAL_TOKENS.focalWidthMinRatio} / Math.max(widthRatio, .01),
                ${PORTRAIT_VISUAL_TOKENS.focalHeightMinRatio} / Math.max(heightRatio, .01)
              ));
              add('focal_too_small', 'major', focalTarget,
                '竖屏核心图形仅占视觉区 ' + Math.round(widthRatio * 100) + '% × ' + Math.round(heightRatio * 100) + '%，远观时会退化成小装饰。',
                { elementId: editorId(focalTarget), changes: { scale: Number(scale.toFixed(2)) } });
            }
          }
        }
        var visibility = (${auditCoreVisualVisibility.toString()})();
        if (AUDIT_ANIMATION_PROGRESS >= .999 && visibility.issue === 'invisible') {
          issues.push({
            code: 'invisible',
            severity: 'critical',
            label: '核心画面未显示',
            detail: '核心画面包含元素，但在动画最终检查点仍全部透明或不可见。',
            elementId: 'visual-content'
          });
        }
        try {
          window.__ai_video_layout_audit = issues;
          window.__ai_video_layout_audit_token = AUDIT_TOKEN;
        } catch (e) {}
        parent.postMessage({ type: '__ai_video_layout_audit', issues: issues, auditToken: AUDIT_TOKEN }, '*');
      } catch (e) {}
    }
    function settleAnimationsForAudit(callback) {
      if (!SETTLE_ANIMATIONS_BEFORE_AUDIT || !document.getAnimations) {
        callback();
        return;
      }
      document.getAnimations().forEach(function(animation) {
        try {
          var timing = animation.effect && animation.effect.getComputedTiming
            ? animation.effect.getComputedTiming()
            : null;
          animation.pause();
          if (timing && Number.isFinite(timing.endTime)) {
            animation.currentTime = Math.max(timing.endTime * AUDIT_ANIMATION_PROGRESS - 0.001, 0);
          }
        } catch (error) {}
      });
      setTimeoutOrig(function() { setTimeoutOrig(callback, 16); }, 16);
    }
    // Normal playback stays untouched. The hidden quality-audit iframe opts in
    // to a deterministic final-state seek before measuring layout.
    var auditDelay = SETTLE_ANIMATIONS_BEFORE_AUDIT ? 120 : Math.min(WATCHDOG_MS + 100, 2200);
    setTimeoutOrig(function() { settleAnimationsForAudit(auditLayout); }, auditDelay);
    // Forward the pointer in the fixed canvas coordinate system. The parent
    // cannot observe mousemove events inside this sandboxed iframe directly.
    document.addEventListener('mousemove', function(event) {
      var stage = document.querySelector('.ai-stage');
      if (!stage) return;
      var stageRect = stage.getBoundingClientRect();
      parent.postMessage({
        type: '__ai_video_canvas_pointer',
        x: event.clientX - stageRect.left,
        y: event.clientY - stageRect.top,
      }, '*');
    });
    document.addEventListener('mouseleave', function() {
      parent.postMessage({ type: '__ai_video_canvas_pointer_leave' }, '*');
    });
    function reportEditorElement(element, geometryElement) {
      if (!element) return;
      var geometry = geometryElement || editorGeometryElement(element);
      if (!geometry) return;
      var style = getComputedStyle(geometry);
      var contentStyle = getComputedStyle(element);
      var rect = geometry.getBoundingClientRect();
      var stageRect = document.querySelector('.ai-stage').getBoundingClientRect();
      // The inspector always speaks in the 1280×720 canvas coordinate system.
      // CSS left / top are relative to the nearest positioned parent, so using
      // them here made a child at left:0 inside the visual zone appear as X=0
      // even though it was rendered around X=700 on the canvas. Saving that
      // value then moved the child inside its clipped parent and could hide it.
      var x = rect.left - stageRect.left;
      var top = rect.top - stageRect.top;
      var right = rect.right - stageRect.left;
      var bottom = rect.bottom - stageRect.top;
      // For elements closer to the right edge, expose the right/bottom edge as
      // the primary audit point; left-side elements use their left/top edge.
      var boundaryAnchor = x <= stageRect.width - right ? 'left' : 'right';
      var outOfBounds = x < 0 || top < 0 || right > stageRect.width || bottom > stageRect.height;
      // Inspector dimensions describe the layout box. getBoundingClientRect()
      // includes animation and transform scale, causing the reported height to
      // change simply because an element was moved and the frame re-rendered.
      var layoutWidth = geometry.offsetWidth || parseFloat(style.width) || rect.width;
      var layoutHeight = geometry.offsetHeight || parseFloat(style.height) || rect.height;
      var transform = style.transform || '';
      var scale = 1, rotate = 0;
      if (transform && transform !== 'none' && typeof DOMMatrix !== 'undefined') {
        try { var matrix = new DOMMatrix(transform); scale = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b); rotate = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI; } catch (e) {}
      }
      var group = editorGroupRoot(element);
      parent.postMessage({ type: '__ai_video_editor_select', id: editorId(element), geometryId: editorId(geometry), groupRootId: editorId(group), label: element.getAttribute('data-editor-label') || element.getAttribute('data-element-label') || (element.textContent || '').trim().slice(0, 24), tag: element.tagName.toLowerCase(), isText: editorTextElement(element), values: { x: Math.round(x), y: Math.round(top), right: Math.round(right), bottom: Math.round(bottom), boundaryAnchor: boundaryAnchor, outOfBounds: outOfBounds, width: Math.round(layoutWidth), height: Math.round(layoutHeight), visualWidth: Math.round(rect.width), visualHeight: Math.round(rect.height), scale: Math.round(scale * 100) / 100, rotate: Math.round(rotate), opacity: Number(style.opacity), text: (element.textContent || '').trim(), color: contentStyle.color, fontSize: parseFloat(contentStyle.fontSize), fontFamily: contentStyle.fontFamily, fontWeight: contentStyle.fontWeight, textAlign: contentStyle.textAlign, hidden: contentStyle.visibility === 'hidden' || contentStyle.display === 'none', locked: contentStyle.pointerEvents === 'none' } }, '*');
    }
    function editorId(element) {
      return element && (element.getAttribute('data-editor-id') || element.getAttribute('data-element-id'));
    }
    function editorTextElement(element) {
      if (!element) return false;
      var tag = element.tagName.toLowerCase();
      if (/^(h1|h2|h3|h4|h5|h6|p|span|strong|em|button|li|blockquote|text|tspan)$/.test(tag)) return true;
      var role = element.getAttribute('data-role') || '';
      if (role === 'composite' || role === 'decoration' || element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
      var directText = Array.prototype.some.call(element.childNodes || [], function(node) {
        return node.nodeType === 3 && (node.textContent || '').trim();
      });
      if (!directText) return false;
      return !Array.prototype.some.call(element.children || [], function(child) {
        return child.hasAttribute('data-editor-id') || child.hasAttribute('data-element-id');
      });
    }
    function editorGroupRoot(element) {
      var root = null;
      var current = element;
      while (current && current !== document.documentElement) {
        if (current.getAttribute && (current.getAttribute('data-editor-group') || current.getAttribute('data-role') === 'composite')) root = current;
        current = current.parentElement;
      }
      return root;
    }
    function editorGeometryElement(element, requestedId) {
      if (requestedId) {
        var requested = Array.prototype.find.call(document.querySelectorAll('[data-editor-id],[data-element-id]'), function(item) { return editorId(item) === requestedId; });
        if (requested) return requested;
      }
      var explicitId = element && element.getAttribute && element.getAttribute('data-editor-geometry-id');
      if (explicitId) {
        var explicit = Array.prototype.find.call(document.querySelectorAll('[data-editor-id],[data-element-id]'), function(item) { return editorId(item) === explicitId; });
        if (explicit) return explicit;
      }
      return editorGroupRoot(element) || element;
    }
    function settleEditorAnimations(geometryElement, callback) {
      if (document.getAnimations) {
        document.getAnimations().forEach(function(animation) {
          try {
            var animationTarget = animation.effect && animation.effect.target;
            if (geometryElement && animationTarget && animationTarget !== geometryElement
              && !geometryElement.contains(animationTarget) && !animationTarget.contains(geometryElement)) return;
            var timing = animation.effect && animation.effect.getComputedTiming ? animation.effect.getComputedTiming() : null;
            animation.pause();
            if (timing && Number.isFinite(timing.endTime)) animation.currentTime = Math.max(timing.endTime - 0.001, 0);
            else animation.currentTime = 0;
          } catch (error) {}
        });
      }
      setTimeoutOrig(function() { setTimeoutOrig(callback, 16); }, 16);
    }
    function requestEditorReport(element, geometryElement) {
      var geometry = geometryElement || editorGeometryElement(element);
      settleEditorAnimations(geometry, function() {
        if (element && element.isConnected) reportEditorElement(element, geometry && geometry.isConnected ? geometry : null);
      });
    }
    function clearEditorSelection() {
      document.querySelectorAll('[data-editor-selected],[data-editor-multi-selected]').forEach(function(item) {
        item.removeAttribute('data-editor-selected');
        item.removeAttribute('data-editor-multi-selected');
      });
    }
    function paintEditorSelection(elements) {
      clearEditorSelection();
      elements.forEach(function(element, index) {
        if (index === 0) element.setAttribute('data-editor-selected', 'true');
        else element.setAttribute('data-editor-multi-selected', 'true');
      });
    }
    function directEditableElement(target) {
      var direct = target && target.closest ? target.closest('[data-editor-id],[data-element-id]') : null;
      var group = direct ? editorGroupRoot(direct) : null;
      return direct && editorTextElement(direct) ? direct : (group || direct);
    }
    function hasOverlap(rect, left, top, right, bottom) {
      return rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
    }
    function boxSelectableElements(left, top, right, bottom) {
      var seen = {};
      var result = [];
      document.querySelectorAll('[data-editor-id],[data-element-id]').forEach(function(candidate) {
        var element = editorGroupRoot(candidate) || candidate;
        var id = editorId(element);
        if (!id || seen[id]) return;
        seen[id] = true;
        var rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && hasOverlap(rect, left, top, right, bottom)) result.push(element);
      });
      return result;
    }
    var marqueeState = null;
    var suppressNextClick = false;
    document.addEventListener('mousedown', function(event) {
      if (event.button !== 0 || directEditableElement(event.target)) return;
      marqueeState = { x: event.clientX, y: event.clientY, append: Boolean(event.shiftKey), moved: false, box: null };
    }, true);
    document.addEventListener('mousemove', function(event) {
      if (!marqueeState) return;
      var dx = event.clientX - marqueeState.x;
      var dy = event.clientY - marqueeState.y;
      if (!marqueeState.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      marqueeState.moved = true;
      if (!marqueeState.box) {
        marqueeState.box = document.createElement('div');
        marqueeState.box.className = 'ai-editor-marquee';
        document.body.appendChild(marqueeState.box);
      }
      marqueeState.box.style.left = Math.min(marqueeState.x, event.clientX) + 'px';
      marqueeState.box.style.top = Math.min(marqueeState.y, event.clientY) + 'px';
      marqueeState.box.style.width = Math.abs(dx) + 'px';
      marqueeState.box.style.height = Math.abs(dy) + 'px';
    }, true);
    document.addEventListener('mouseup', function(event) {
      if (!marqueeState) return;
      var state = marqueeState;
      marqueeState = null;
      if (state.box) state.box.remove();
      if (!state.moved) {
        clearEditorSelection();
        parent.postMessage({ type: '__ai_video_editor_multi_select', ids: [] }, '*');
        suppressNextClick = true;
        return;
      }
      var left = Math.min(state.x, event.clientX), top = Math.min(state.y, event.clientY);
      var right = Math.max(state.x, event.clientX), bottom = Math.max(state.y, event.clientY);
      var selected = boxSelectableElements(left, top, right, bottom);
      if (state.append) {
        document.querySelectorAll('[data-editor-selected],[data-editor-multi-selected]').forEach(function(element) {
          if (selected.indexOf(element) < 0) selected.unshift(element);
        });
      }
      paintEditorSelection(selected);
      var ids = selected.map(editorId).filter(Boolean).slice(0, 80);
      if (selected[0]) requestEditorReport(selected[0]);
      parent.postMessage({ type: '__ai_video_editor_multi_select', ids: ids }, '*');
      suppressNextClick = true;
      event.preventDefault();
    }, true);
    function findEditableElement(event) {
      var direct = event.target && event.target.closest ? event.target.closest('[data-editor-id],[data-element-id]') : null;
      var group = direct ? editorGroupRoot(direct) : null;
      if (direct && editorTextElement(direct)) return direct;
      if (group) return group;
      if (direct) return direct;
      // Decorative and transparent layers sometimes sit above a real editor
      // element. Walk the paint stack at the click point to reach the first
      // selectable element underneath instead of dropping the click.
      if (!document.elementsFromPoint) return null;
      var stack = document.elementsFromPoint(event.clientX, event.clientY);
      for (var i = 0; i < stack.length; i += 1) {
        var candidate = stack[i];
        var editableCandidate = candidate && candidate.closest ? candidate.closest('[data-editor-id],[data-element-id]') : null;
        if (editableCandidate && editorTextElement(editableCandidate)) return editableCandidate;
        var composite = editableCandidate ? editorGroupRoot(editableCandidate) : null;
        if (composite) return composite;
        var editable = candidate && candidate.closest ? candidate.closest('[data-editor-id],[data-element-id]') : null;
        if (editable) return editable;
      }
      // Fine rules and divider marks can be only 1-2px tall, making their
      // literal hit target impractical. Select the nearest editor element in a
      // small radius without changing its rendered size.
      var nearest = null;
      var nearestDistance = 12;
      document.querySelectorAll('[data-editor-id],[data-element-id]').forEach(function(candidate) {
        var rect = candidate.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        var dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
        var dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
        var distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= nearestDistance) {
          nearest = candidate;
          nearestDistance = distance;
        }
      });
      return nearest ? (editorGroupRoot(nearest) || nearest) : null;
    }
    document.addEventListener('click', function(event) {
      if (suppressNextClick) {
        suppressNextClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      var element = findEditableElement(event);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      paintEditorSelection([element]);
      requestEditorReport(element);
    }, true);
    window.addEventListener('message', function(event) {
      if (!event.data) return;
      if (event.data.type === '__ai_video_layout_issue_visibility') {
        var visibleIssueIds = Array.isArray(event.data.visibleElementIds) ? event.data.visibleElementIds : [];
        document.querySelectorAll('[data-layout-issue]').forEach(function(element) {
          if (visibleIssueIds.indexOf(editorId(element)) < 0) element.removeAttribute('data-layout-issue');
        });
        return;
      }
      if (event.data.type === '__ai_video_playback_state') {
        var playing = event.data.isPlaying === true;
        var nextPlaybackRevision = Number.isFinite(Number(event.data.playbackRevision))
          ? Number(event.data.playbackRevision)
          : playbackRevision;
        document.documentElement.setAttribute('data-ai-playback', playing ? 'true' : 'false');
        if (!playbackInitialized) {
          playbackInitialized = true;
          if (playing) {
            playbackHasStarted = true;
            updatePlaybackAnimations(true, true);
          } else settleDocumentAnimationsAtEnd();
        } else {
          var shouldRestart = playing && nextPlaybackRevision !== playbackRevision;
          if (playing) playbackHasStarted = true;
          if (!playing && !playbackHasStarted) settleDocumentAnimationsAtEnd();
          else if (shouldRestart || playing !== playbackActive) updatePlaybackAnimations(playing, shouldRestart);
        }
        playbackRevision = nextPlaybackRevision;
        playbackActive = playing;
        document.documentElement.setAttribute('data-ai-playback-ready', 'true');
        if (playing) {
          clearEditorSelection();
          if (marqueeState && marqueeState.box) marqueeState.box.remove();
          marqueeState = null;
        }
        return;
      }
      if (event.data.type === '__ai_video_editor_measure') {
        if (playbackActive) return;
        var measuredId = typeof event.data.id === 'string' ? event.data.id : '';
        if (!measuredId) return;
        var measured = Array.prototype.find.call(document.querySelectorAll('[data-editor-id],[data-element-id]'), function(item) { return editorId(item) === measuredId; });
        var geometryId = typeof event.data.geometryId === 'string' ? event.data.geometryId : '';
        if (measured) requestEditorReport(measured, editorGeometryElement(measured, geometryId));
        return;
      }
      if (event.data.type !== '__ai_video_editor_highlight') return;
      clearEditorSelection();
      var id = typeof event.data.id === 'string' ? event.data.id : '';
      var geometryId = typeof event.data.geometryId === 'string' ? event.data.geometryId : '';
      var requestedIds = Array.isArray(event.data.ids) ? event.data.ids.filter(function(value) { return typeof value === 'string'; }) : [];
      if (!requestedIds.length && id) requestedIds = [id];
      var targets = [];
      requestedIds.forEach(function(requestedId) {
        var target = Array.prototype.find.call(document.querySelectorAll('[data-editor-id],[data-element-id]'), function(item) { return editorId(item) === requestedId; });
        if (target && targets.indexOf(target) < 0) targets.push(target);
      });
      if (geometryId && targets.length === 1) {
        var geometryTarget = Array.prototype.find.call(document.querySelectorAll('[data-editor-id],[data-element-id]'), function(item) { return editorId(item) === geometryId; });
        if (geometryTarget) targets = [geometryTarget];
      }
      paintEditorSelection(targets);
    });
  })();
</script>
</head>
<body>
<div class="ai-stage">${extracted.body}</div>
</body>
</html>`;
}

/**
 * 从 AI HTML 中提取 head 和 body 内容
 */
function extractHeadAndBody(html: string): { head: string; body: string } {
  if (!html) return { head: '', body: '' };

  // 尝试匹配 <head>...</head>
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  if (headMatch && bodyMatch) {
    return { head: headMatch[1], body: bodyMatch[1] };
  }
  // 退化：把整段 HTML 放到 body
  return { head: '', body: html };
}

/**
 * 简单 HTML 清理：
 * - 去掉外部 <script src>、外部 <link>、外部 <img>
 * - 去掉 <base>
 */
export function sanitizeAiHtml(html: string, canvasPreset?: CanvasPresetId): string {
  if (!html) return '';
  let cleaned = stripLegacyAutoFitGuard(html);
  cleaned = cleaned.replace(/<script[^>]+src=["'][^"']*["'][^>]*>\s*<\/script>/gi, '');
  // AI occasionally emits syntactically broken inline JavaScript (for example a
  // literal newline inside a quoted string, or a `//` comment in minified code
  // that comments out the closing braces). A syntax error inside srcDoc is still
  // reported in the parent DevTools console and makes the preview look broken.
  // Compile only (never execute) classic scripts and drop invalid ones while
  // preserving the frame's HTML/CSS fallback.
  cleaned = cleaned.replace(
    /<script([^>]*)>([\s\S]*?)<\/script>/gi,
    (full, attributes: string, source: string) => {
      const type = attributes.match(/\btype\s*=\s*["']?([^\s"'>]+)/i)?.[1]?.toLowerCase();
      const isClassicJavaScript = !type || /^(?:text|application)\/(?:java|ecma)script$/.test(type);
      if (!isClassicJavaScript) return full;
      try {
        // eslint-disable-next-line no-new-func
        new Function(source);
        return full;
      } catch {
        const repaired = repairCollapsedLineComments(source);
        if (repaired !== source) {
          try {
            // eslint-disable-next-line no-new-func
            new Function(repaired);
            return `<script${attributes}>${repaired}</script>`;
          } catch {
            // Fall through to removal below.
          }
        }
        return '<!-- invalid inline script removed -->';
      }
    },
  );
  cleaned = cleaned.replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, '');
  cleaned = cleaned.replace(/<img[^>]+src=["']https?:\/\/[^"']*["'][^>]*>/gi, '');
  cleaned = cleaned.replace(/<base[^>]*>/gi, '');
  return enforceLayoutSafety(cleaned, canvasPreset);
}

function repairCollapsedLineComments(source: string): string {
  let output = '';
  let index = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      output += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      const tail = source.slice(index + 2);
      const newlineMatch = tail.match(/\r?\n/);
      if (newlineMatch?.index !== undefined) {
        output += '\n';
        index += 2 + newlineMatch.index + newlineMatch[0].length;
        continue;
      }

      const resumeAt = findCollapsedCommentCodeStart(tail);
      if (resumeAt >= 0) {
        output += '\n';
        index += 2 + resumeAt;
        continue;
      }

      break;
    }

    output += char;
    index += 1;
  }

  return output;
}

function findCollapsedCommentCodeStart(text: string): number {
  const candidates = [
    /\b(?:setTimeout|setInterval|requestAnimationFrame|document|window)\s*[\.(]/,
    /\b(?:var|let|const|if|for|while|return)\b/,
    /\b[A-Za-z_$][\w$]*\s*(?:[.=]|\+\+|--)/,
  ];
  const starts = candidates
    .map(pattern => pattern.exec(text)?.index ?? -1)
    .filter(index => index > 0);

  return starts.length ? Math.min(...starts) : -1;
}

/**
 * 为缩略图生成一个无脚本的安全预览壳：
 * - 固定按 1280x720 设计稿尺寸渲染
 * - 父容器通过 transform 整体缩放，确保看到完整分镜
 */
export function wrapHtmlForThumbnail(innerHtml: string, canvasPreset?: CanvasPresetId): string {
  const preset = getCanvasPreset(canvasPreset);
  const extracted = extractHeadAndBody(innerHtml);
  // Thumbnails are intentionally static (`sandbox=""`). Remove scripts instead
  // of asking the browser to block them and report a warning for every card.
  const staticHead = extracted.head.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const staticBody = extracted.body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${preset.design.width}, initial-scale=1" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: ${preset.design.width}px;
    height: ${preset.design.height}px;
    overflow: hidden;
    background: transparent;
  }
  *, *::before, *::after { box-sizing: border-box; }
  .ai-thumb-stage {
    position: relative;
    width: ${preset.design.width}px;
    height: ${preset.design.height}px;
    overflow: hidden;
    transform-origin: 0 0;
  }
  .ai-thumb-stage * {
    opacity: 1 !important;
    visibility: visible !important;
    /* A negative delay seeks CSS animations past their final keyframe while
       retaining the authored forwards state. Disabling animation entirely would
       restore the usual pre-animation styles (often opacity: 0). */
    animation-delay: -9999s !important;
    animation-play-state: paused !important;
    transition: none !important;
  }
</style>
${staticHead}
</head>
<body>
  <div class="ai-thumb-stage">${staticBody}</div>
</body>
</html>`;
}
