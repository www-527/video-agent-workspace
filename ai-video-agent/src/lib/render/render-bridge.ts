import type { RenderCompatibility, RenderStatus } from './types';
import type { CanvasPresetId } from '@/types';
import { getCanvasPreset } from '@/lib/canvas-presets';
import { injectVisualStabilityRuntime } from '@/lib/visual-stability';

const UNSUPPORTED_PATTERNS: Array<{ pattern: RegExp; warning: string }> = [
  { pattern: /\bWebGL(?:2)?RenderingContext\b|\bgetContext\s*\(\s*['"]webgl/i, warning: '检测到 WebGL 动画，无法保证离线寻址。' },
  { pattern: /\bAudioContext\b|\bwebkitAudioContext\b/, warning: '检测到 Web Audio 实时时钟。' },
  { pattern: /\bWebSocket\b|\bEventSource\b/, warning: '检测到实时网络事件。' },
  { pattern: /\bvideo\b[^>]*\bsrc=|createElement\s*\(\s*['"]video/i, warning: '检测到视频轨。' },
  { pattern: /\bWorker\s*\(|\bSharedWorker\s*\(/, warning: '检测到独立 Worker 时钟。' },
];

const REPAIRABLE_PATTERNS: Array<{ pattern: RegExp; warning: string }> = [
  { pattern: /\bsetTimeout\s*\(|\bsetInterval\s*\(/, warning: '已接管页面计时器。' },
  { pattern: /\brequestAnimationFrame\s*\(/, warning: '已接管 requestAnimationFrame。' },
  { pattern: /\bMath\.random\s*\(/, warning: '已替换为固定种子随机数。' },
  { pattern: /\bDate\.now\s*\(|\bperformance\.now\s*\(/, warning: '已固定页面时钟。' },
];

export function classifyHtmlCompatibility(html: string): Pick<RenderStatus, 'compatibility' | 'controllable' | 'warnings'> {
  const failed = UNSUPPORTED_PATTERNS.filter(item => item.pattern.test(html)).map(item => item.warning);
  if (failed.length) {
    return { compatibility: 'realtime-fallback', controllable: false, warnings: failed };
  }
  const repaired = REPAIRABLE_PATTERNS.filter(item => item.pattern.test(html)).map(item => item.warning);
  return {
    compatibility: repaired.length ? 'offline-repaired' : 'offline-compatible',
    controllable: true,
    warnings: repaired,
  };
}

export function injectRenderBridge(html: string, options?: {
  compatibility?: RenderCompatibility;
  warnings?: string[];
  baseUrl?: string;
  canvasPreset?: CanvasPresetId;
}): string {
  const canvas = getCanvasPreset(options?.canvasPreset);
  const stableHtml = injectVisualStabilityRuntime(html, options?.canvasPreset);
  const compatibility = options?.compatibility ?? classifyHtmlCompatibility(html).compatibility;
  const warnings = options?.warnings ?? classifyHtmlCompatibility(html).warnings;
  const baseTag = options?.baseUrl ? `<base href="${escapeHtmlAttribute(options.baseUrl)}">` : '';
  const bridge = `<script data-render-bridge="v1">${buildRenderBridgeRuntime(compatibility, warnings)}</script>`;
  const cleanUi = `<style data-render-clean-ui>
    [data-editor-selected],[data-editor-multi-selected],[data-layout-issue],
    .ai-editor-marquee,.canvas-coordinate-readout,[data-render-hide],
    [role="tooltip"],[data-radix-popper-content-wrapper] {
      outline: none !important; box-shadow: none !important; display: none !important;
    }
    html,body { margin:0 !important; width:${canvas.design.width}px !important; height:${canvas.design.height}px !important; overflow:hidden !important; }
  </style>`;
  if (/<head\b[^>]*>/i.test(stableHtml)) {
    return stableHtml.replace(/<head\b([^>]*)>/i, `<head$1>${baseTag}${bridge}${cleanUi}`);
  }
  return `<!doctype html><html><head>${baseTag}${bridge}${cleanUi}</head><body>${stableHtml}</body></html>`;
}

export function buildRenderBridgeRuntime(
  compatibility: RenderCompatibility = 'offline-compatible',
  warnings: string[] = [],
): string {
  return `
(function () {
  'use strict';
  var native = {
    Date: window.Date,
    dateNow: Date.now.bind(Date),
    performanceNow: performance.now.bind(performance),
    random: Math.random.bind(Math),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window)
  };
  var currentMs = 0;
  var epochMs = 1704067200000;
  var nextId = 1;
  var tasks = new Map();
  var randomState = 0x6d2b79f5;
  var status = {
    ready: false,
    assets: 'loading',
    controllable: ${compatibility === 'offline-compatible' || compatibility === 'offline-repaired'},
    compatibility: ${JSON.stringify(compatibility)},
    warnings: ${JSON.stringify(warnings)}
  };

  function seededRandom() {
    randomState |= 0;
    randomState = randomState + 0x6D2B79F5 | 0;
    var value = Math.imul(randomState ^ randomState >>> 15, 1 | randomState);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }
  Math.random = seededRandom;

  function RenderDate() {
    var args = Array.prototype.slice.call(arguments);
    if (!(this instanceof RenderDate)) return new native.Date(epochMs + currentMs).toString();
    if (!args.length) return new native.Date(epochMs + currentMs);
    return new (Function.prototype.bind.apply(native.Date, [null].concat(args)))();
  }
  RenderDate.prototype = native.Date.prototype;
  Object.setPrototypeOf(RenderDate, native.Date);
  RenderDate.now = function () { return epochMs + currentMs; };
  RenderDate.parse = native.Date.parse;
  RenderDate.UTC = native.Date.UTC;
  window.Date = RenderDate;
  try { Object.defineProperty(performance, 'now', { configurable: true, value: function () { return currentMs; } }); } catch (_) {}

  function addTask(kind, callback, delay, args) {
    var id = nextId++;
    var safeDelay = Math.max(0, Number(delay) || 0);
    tasks.set(id, { id: id, kind: kind, callback: callback, args: args || [], at: currentMs + safeDelay, delay: safeDelay });
    return id;
  }
  window.setTimeout = function (callback, delay) {
    return addTask('timeout', callback, delay, Array.prototype.slice.call(arguments, 2));
  };
  window.clearTimeout = function (id) { tasks.delete(Number(id)); };
  window.setInterval = function (callback, delay) {
    return addTask('interval', callback, Math.max(1, Number(delay) || 0), Array.prototype.slice.call(arguments, 2));
  };
  window.clearInterval = window.clearTimeout;
  window.requestAnimationFrame = function (callback) {
    return addTask('raf', callback, 1000 / 60, []);
  };
  window.cancelAnimationFrame = window.clearTimeout;

  function runTask(task) {
    if (!tasks.has(task.id)) return;
    if (task.kind === 'interval') task.at += task.delay;
    else tasks.delete(task.id);
    try {
      if (typeof task.callback === 'function') {
        if (task.kind === 'raf') task.callback(currentMs);
        else task.callback.apply(window, task.args);
      } else {
        Function(String(task.callback))();
      }
    } catch (error) {
      status.warnings.push('计时器执行失败: ' + (error && error.message ? error.message : String(error)));
      status.compatibility = 'offline-repaired';
    }
  }
  function flushTasks(targetMs) {
    var guard = 0;
    while (guard++ < 10000) {
      var due = Array.from(tasks.values())
        .filter(function (task) { return task.at <= targetMs; })
        .sort(function (left, right) { return left.at - right.at || left.id - right.id; });
      if (!due.length) break;
      currentMs = Math.max(currentMs, due[0].at);
      runTask(due[0]);
    }
    if (guard >= 10000) {
      status.controllable = false;
      status.compatibility = 'realtime-fallback';
      status.warnings.push('计时器在单帧内执行超过上限。');
    }
  }
  async function waitForAssets() {
    status.assets = 'loading';
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      var images = Array.prototype.slice.call(document.images || []);
      await Promise.all(images.map(function (image) {
        function sourceLabel() {
          return image.currentSrc || image.getAttribute('src') || '(unknown image source)';
        }
        function failed() {
          return new Error('图片加载失败: ' + sourceLabel());
        }
        function verifyDecoded() {
          // A broken image is complete too. Previously decode() failures were
          // swallowed, so Chromium encoded the alt text into an otherwise
          // successful export.
          if (!image.naturalWidth || !image.naturalHeight) return Promise.reject(failed());
          if (!image.decode) return Promise.resolve();
          return image.decode().catch(function () { return Promise.reject(failed()); });
        }
        if (image.complete) return verifyDecoded();
        return new Promise(function (resolve, reject) {
          image.addEventListener('load', function () {
            verifyDecoded().then(resolve, reject);
          }, { once: true });
          image.addEventListener('error', function () { reject(failed()); }, { once: true });
        });
      }));
      status.assets = 'ready';
    } catch (error) {
      status.assets = 'failed';
      status.compatibility = 'failed';
      status.controllable = false;
      status.warnings.push('素材加载失败: ' + (error && error.message ? error.message : String(error)));
    }
  }
  function setAnimations(ms) {
    if (!document.getAnimations) return;
    document.getAnimations({ subtree: true }).forEach(function (animation) {
      try {
        animation.pause();
        var timing = animation.effect && animation.effect.getComputedTiming ? animation.effect.getComputedTiming() : null;
        var endTime = timing && Number.isFinite(Number(timing.endTime)) ? Number(timing.endTime) : ms;
        animation.currentTime = Math.max(0, Math.min(ms, endTime || ms));
      } catch (_) {}
    });
  }
  async function stabilize() {
    await waitForAssets();
    await Promise.resolve();
    document.body && document.body.getBoundingClientRect();
    await Promise.resolve();
  }
  async function setTime(ms) {
    var targetMs = Math.max(0, Number(ms) || 0);
    if (targetMs < currentMs) {
      status.warnings.push('setTime 不支持倒序调用；渲染器应按帧顺序推进。');
      status.compatibility = status.compatibility === 'offline-compatible' ? 'offline-repaired' : status.compatibility;
    }
    flushTasks(targetMs);
    currentMs = targetMs;
    setAnimations(targetMs);
    document.documentElement.setAttribute('data-render-time', String(targetMs));
    document.documentElement.setAttribute('data-ai-playback', 'true');
    window.dispatchEvent(new CustomEvent('renderbridge:time', { detail: { ms: targetMs } }));
    await stabilize();
  }
  async function initialize() {
    await stabilize();
    setAnimations(0);
    status.ready = status.assets === 'ready';
    window.dispatchEvent(new CustomEvent('renderbridge:ready'));
  }
  window.__renderBridge = {
    version: 1,
    setTime: setTime,
    getStatus: function () {
      return {
        ready: status.ready,
        assets: status.assets,
        controllable: status.controllable,
        compatibility: status.compatibility,
        warnings: status.warnings.slice()
      };
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else native.setTimeout(initialize, 0);
})();`;
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
