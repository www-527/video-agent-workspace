import { getCanvasPreset } from '@/lib/canvas-presets';
import { getProtectedLayout } from '@/lib/layout-geometry';
import { PORTRAIT_VISUAL_TOKENS } from '@/lib/portrait-visual-system';
import type { CanvasPresetId } from '@/types';

/**
 * Runtime layout normalization shared by interactive previews and offline renders.
 * Keep authored position in CSS `translate`, leaving `transform` available to animation.
 */
export function buildVisualStabilityRuntime(canvasPreset?: CanvasPresetId): string {
  const preset = getCanvasPreset(canvasPreset);
  const layout = getProtectedLayout(canvasPreset);
  const titleMin = preset.id === 'douyin-portrait-9-16'
    ? PORTRAIT_VISUAL_TOKENS.titleMin
    : 48;

  return `
  (function() {
    if (window.__aiVisualStabilityInstalled) return;
    window.__aiVisualStabilityInstalled = true;

    function hasOwnTransformAnimation(element) {
      try {
        return document.getAnimations().some(function(animation) {
          var target = animation.effect && animation.effect.target;
          if (target !== element || !animation.effect || !animation.effect.getKeyframes) return false;
          return animation.effect.getKeyframes().some(function(frame) {
            return typeof frame.transform === 'string' && frame.transform !== 'none';
          });
        });
      } catch (e) { return false; }
    }

    function preserveAnimatedPositioningTransforms() {
      Array.prototype.forEach.call(document.querySelectorAll('*'), function(element) {
        if (element.closest('[data-ai-visual-stability-probe]')) return;
        if (element.hasAttribute('data-ai-position-transform-inspected')) return;
        if (element.hasAttribute('data-ai-preserved-position-transform')) return;
        if (!hasOwnTransformAnimation(element)) return;
        var liveStyle = getComputedStyle(element);
        if (liveStyle.position !== 'absolute' && liveStyle.position !== 'fixed') return;
        if (liveStyle.translate && liveStyle.translate !== 'none') return;
        var parent = element.offsetParent;
        element.setAttribute('data-ai-position-transform-inspected', 'true');
        if (!parent) return;
        var centeredXCandidate = Math.abs(element.offsetLeft - parent.clientWidth / 2) <= 3;
        var centeredYCandidate = Math.abs(element.offsetTop - parent.clientHeight / 2) <= 3;
        if (!centeredXCandidate && !centeredYCandidate) return;

        // Reading an element's underlying transform by temporarily disabling its
        // animation cancels and recreates the visible CSSAnimation. Probe an
        // invisible clone instead so the live animation clock is never touched.
        var probe = element.cloneNode(true);
        probe.setAttribute('data-ai-visual-stability-probe', 'true');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.setProperty('animation', 'none', 'important');
        probe.style.setProperty('transition', 'none', 'important');
        probe.style.setProperty('visibility', 'hidden', 'important');
        probe.style.setProperty('pointer-events', 'none', 'important');
        element.parentNode.insertBefore(probe, element.nextSibling);
        var baseTransform = getComputedStyle(probe).transform || '';
        probe.remove();
        var matrix = null;
        try { matrix = baseTransform && baseTransform !== 'none' && typeof DOMMatrix !== 'undefined' ? new DOMMatrix(baseTransform) : null; } catch (e) {}
        if (!matrix) return;
        var pureTranslation = Math.abs(matrix.a - 1) < .001 && Math.abs(matrix.b) < .001
          && Math.abs(matrix.c) < .001 && Math.abs(matrix.d - 1) < .001;
        if (!pureTranslation || (Math.abs(matrix.e) < .5 && Math.abs(matrix.f) < .5)) return;
        var centeredX = centeredXCandidate
          && Math.abs(matrix.e + element.offsetWidth / 2) <= 3;
        var centeredY = centeredYCandidate
          && Math.abs(matrix.f + element.offsetHeight / 2) <= 3;
        if (!centeredX && !centeredY) return;
        element.setAttribute('data-ai-preserved-position-transform', 'true');
        element.style.setProperty('translate', matrix.e + 'px ' + matrix.f + 'px');
        element.style.setProperty('transform', 'none');
      });
    }

    function schedulePositionTransformProtection() {
      preserveAnimatedPositioningTransforms();
      try {
        var queued = false;
        var observer = new MutationObserver(function() {
          if (queued) return;
          queued = true;
          setTimeout(function() {
            queued = false;
            preserveAnimatedPositioningTransforms();
          }, 0);
        });
        observer.observe(document.documentElement, { subtree: true, childList: true });
      } catch (e) {}
    }

    function layoutBottomInMain(element, main) {
      var bottom = element.offsetHeight || 0;
      var current = element;
      while (current && current !== main) {
        bottom += current.offsetTop || 0;
        current = current.offsetParent;
      }
      if (current === main) return bottom;
      var elementRect = element.getBoundingClientRect();
      var mainRect = main.getBoundingClientRect();
      return elementRect.bottom - mainRect.top;
    }

    function titleLineCount(title) {
      try {
        var range = document.createRange();
        range.selectNodeContents(title);
        var rows = {};
        Array.prototype.forEach.call(range.getClientRects(), function(rect) {
          if (rect.width > 1 && rect.height > 1) rows[String(Math.round(rect.top / 2) * 2)] = true;
        });
        return Object.keys(rows).length;
      } catch (e) { return 0; }
    }

    function fitStackTitle(main, textZone) {
      var title = textZone.querySelector('[data-role="title"],h1,h2');
      if (!title || !(title.textContent || '').trim()) return;
      var authored = parseFloat(title.getAttribute('data-ai-authored-title-font') || '');
      if (!Number.isFinite(authored)) {
        authored = parseFloat(getComputedStyle(title).fontSize) || 0;
        title.setAttribute('data-ai-authored-title-font', String(authored));
      }
      if (authored < ${titleMin}) return;
      title.style.setProperty('font-size', authored + 'px', 'important');
      var size = authored;
      var maximumTextBottom = ${layout.stack.visualTopMax - layout.stack.gap};
      while (size > ${titleMin} && (layoutBottomInMain(title, main) > maximumTextBottom + 1 || titleLineCount(title) > 2)) {
        size = Math.max(${titleMin}, size - 8);
        title.style.setProperty('font-size', size + 'px', 'important');
      }
      if (size < authored) main.setAttribute('data-ai-stack-title-fitted', String(Math.round(size)));
      else main.removeAttribute('data-ai-stack-title-fitted');
    }

    function applyAdaptiveStackLayout() {
      try {
        var main = document.querySelector('main[data-layout="stack"]');
        if (!main) return;
        var textZone = main.querySelector('[data-role="text-zone"]');
        if (!textZone) return;
        fitStackTitle(main, textZone);
        var textBottom = ${layout.content.top};
        Array.prototype.forEach.call(textZone.querySelectorAll('*'), function(element) {
          if (element.closest('[data-role="decoration"]')) return;
          if (!(element.textContent || '').trim()) return;
          if (getComputedStyle(element).display === 'none') return;
          textBottom = Math.max(textBottom, layoutBottomInMain(element, main));
        });
        var requestedTop = textBottom + ${layout.stack.gap};
        var visualTop = Math.min(${layout.stack.visualTopMax}, Math.max(${layout.stack.visualTopMin}, requestedTop));
        main.style.setProperty('--ai-stack-visual-top', Math.round(visualTop) + 'px', 'important');
        main.setAttribute('data-ai-stack-visual-top', String(Math.round(visualTop)));
        main.setAttribute('data-ai-stack-text-bottom', String(Math.round(textBottom)));
      } catch (e) {}
    }

    function schedule() {
      schedulePositionTransformProtection();
      applyAdaptiveStackLayout();
      [50, 200, 500, 1000].forEach(function(delay) { setTimeout(applyAdaptiveStackLayout, delay); });
      try {
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyAdaptiveStackLayout);
      } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
    else schedule();
  })();`;
}

export function injectVisualStabilityRuntime(html: string, canvasPreset?: CanvasPresetId): string {
  if (html.includes('data-ai-visual-stability')) return html;
  const script = `<script data-ai-visual-stability>${buildVisualStabilityRuntime(canvasPreset)}</script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${script}</head>`);
  if (/<body\b/i.test(html)) return html.replace(/<body\b/i, `${script}<body`);
  return `${script}${html}`;
}
