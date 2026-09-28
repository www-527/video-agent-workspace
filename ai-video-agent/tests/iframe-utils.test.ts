import { describe, it, expect } from 'vitest';
import { enforceLayoutSafety, wrapHtmlWithWatchdog, wrapHtmlForThumbnail, sanitizeAiHtml } from '@/lib/iframe-utils';

describe('wrapHtmlForThumbnail', () => {
  it('seeks CSS animations to their static final state instead of restoring the empty start frame', () => {
    const out = wrapHtmlForThumbnail('<style>.item { opacity: 0; animation: enter .6s forwards; }</style><div class="item">frame</div>');

    expect(out).toContain('animation-delay: -9999s !important');
    expect(out).toContain('animation-play-state: paused !important');
    expect(out).not.toContain('animation: none !important');
  });
});

describe('wrapHtmlWithWatchdog', () => {
  it('空输入返回带 watchdog 的空文档', () => {
    const out = wrapHtmlWithWatchdog('');
    expect(out).toContain('<!DOCTYPE html>');
    expect(out).toContain('setInterval');
    expect(out).toContain('requestAnimationFrame');
  });

  it('包裹 AI HTML 并插入看门狗脚本', () => {
    const ai = '<!DOCTYPE html><html><body><h1>Hello</h1></body></html>';
    const out = wrapHtmlWithWatchdog(ai);
    expect(out).toContain('<h1>Hello</h1>');
    expect(out).toContain('WATCHDOG_MS = ');
    // body 必须有内容
    expect(out).toMatch(/<body>[\s\S]*Hello[\s\S]*<\/body>/);
  });

  it('从 AI HTML 中提取 head 内容', () => {
    const ai = '<!DOCTYPE html><html><head><style>p{color:red}</style></head><body><p>Hi</p></body></html>';
    const out = wrapHtmlWithWatchdog(ai);
    expect(out).toContain('p{color:red}');
    expect(out).toContain('<p>Hi</p>');
  });

  it('支持自定义看门狗时长', () => {
    const out = wrapHtmlWithWatchdog('<body>x</body>', 3000);
    expect(out).toContain('WATCHDOG_MS = 3000');
  });

  it('reports the fixed 16:9 design size instead of scroll dimensions', () => {
    const out = wrapHtmlWithWatchdog('<div style="height:50000px">oversized animation</div>');
    expect(out).toContain("parent.postMessage({ type: '__ai_video_iframe_size', w: 1280, h: 720 }, '*')");
    expect(out).not.toContain('scrollHeight');
    expect(out).not.toContain('scrollWidth');
  });

  it('includes a marquee selection interaction for multiple editable elements', () => {
    const out = wrapHtmlWithWatchdog('<div data-editor-id="one"></div><div data-editor-id="two"></div>');
    expect(out).toContain('ai-editor-marquee');
    expect(out).toContain('__ai_video_editor_multi_select');
    expect(out).toContain('data-editor-multi-selected');
    expect(out).toContain('Boolean(event.shiftKey)');
  });

  it('prioritizes a clicked text child over its composite card', () => {
    const out = wrapHtmlWithWatchdog('<div data-editor-id="card" data-role="composite"><p data-editor-id="caption">说明</p></div>');
    expect(out).toContain('direct && editorTextElement(direct) ? direct : (group || direct)');
    expect(out).toContain('if (direct && editorTextElement(direct)) return direct;');
    expect(out).toContain('if (editableCandidate && editorTextElement(editableCandidate)) return editableCandidate;');
  });

  it('hides editor and layout diagnostics while the frame is playing', () => {
    const out = wrapHtmlWithWatchdog(
      '<div data-editor-id="one"></div>',
      8000,
      { playbackControlled: true },
    );
    expect(out).toContain('html[data-ai-playback="true"] [data-layout-issue="true"]');
    expect(out).toContain("event.data.type === '__ai_video_playback_state'");
    expect(out).toContain("setAttribute('data-ai-playback', playing ? 'true' : 'false')");
    expect(out).toContain('var shouldRestart = playing && nextPlaybackRevision !== playbackRevision');
    expect(out).toContain('PLAYBACK_CONTROLLED = true');
    expect(out).toContain('html:not([data-ai-playback-ready="true"]) .ai-stage');
    expect(out).toContain('function settleDocumentAnimationsAtEnd()');
    expect(out).toContain('updatePlaybackAnimations(true, true);');
    expect(out).toContain('if (!playing && !playbackHasStarted) settleDocumentAnimationsAtEnd()');
    expect(out).toContain("document.body.classList.remove('frozen')");
    expect(out).toContain('function scheduleWatchdog()');
    expect(out).toContain('watchdogTimer = setTimeoutOrig(freeze, WATCHDOG_MS)');
    expect(out).toContain('syncDocumentAnimations(playing, restart)');
    expect(out).toContain('html[data-ai-animation-paused="true"] .ai-stage *');
    expect(out).toContain('animation.currentTime = 0');
    expect(out).toContain("setAttribute('data-ai-playback-ready', 'true')");
    expect(out).not.toContain('ai-animation-restarting');
    expect(out).not.toContain('restartTargets');
    expect(out).not.toContain('void document.body.offsetWidth');
    expect(out).toContain('if (playbackActive) return;');
    expect(out).toContain('clearEditorSelection()');
  });

  it('supports re-measuring a selected element after restoring a preview', () => {
    const out = wrapHtmlWithWatchdog('<div data-editor-id="phone"></div>');
    expect(out).toContain('__ai_video_editor_measure');
    expect(out).toContain('editorGeometryElement(measured, geometryId)');
    expect(out).toContain('if (measured) requestEditorReport(');
  });

  it('settles animations before reporting editable geometry', () => {
    const out = wrapHtmlWithWatchdog('<div data-editor-id="phone"></div>');
    expect(out).toContain('document.getAnimations');
    expect(out).toContain('animationTarget !== geometryElement');
    expect(out).toContain('animation.pause()');
    expect(out).toContain('animation.currentTime = Math.max(timing.endTime - 0.001, 0)');
    expect(out).toContain('setTimeoutOrig(callback, 16)');
  });

  it('preserves centering transforms when an entrance animation also changes transform', () => {
    const out = wrapHtmlWithWatchdog('<div class="centered">Centered quote</div>');
    expect(out).toContain('function preserveAnimatedPositioningTransforms()');
    expect(out).toContain("element.style.setProperty('translate', matrix.e + 'px ' + matrix.f + 'px')");
    expect(out).toContain("element.style.setProperty('transform', 'none')");
    expect(out).toContain("data-ai-preserved-position-transform");
    expect(out).toContain("data-ai-position-transform-inspected");
    expect(out).toContain("var probe = element.cloneNode(true)");
    expect(out).toContain("probe.style.setProperty('animation', 'none', 'important')");
    expect(out).not.toContain("element.style.setProperty('animation', 'none', 'important')");
    expect(out).toContain("observer.observe(document.documentElement, { subtree: true, childList: true })");
    expect(out).not.toContain("attributeFilter: ['class']");
    expect(out).not.toContain('setTimeout(preserveAnimatedPositioningTransforms, delay)');
    expect(out).toContain('hasOwnTransformAnimation(element)');
  });

  it('audits the final frame without mutating normal preview playback', () => {
    const out = wrapHtmlWithWatchdog('<div data-editor-id="bottle">Bottle</div>');
    expect(out).toContain('SETTLE_ANIMATIONS_BEFORE_AUDIT = false');
    expect(out).toContain('settleAnimationsForAudit(auditLayout)');
    expect(out).toContain("type: '__ai_video_layout_audit'");
    expect(out).toContain("add('out_of_bounds'");
    expect(out).toContain("add('subtitle_safe_area'");
    expect(out).toContain("add('clipped'");
    expect(out).toContain("code: 'invisible'");
    expect(out).toContain("label: '核心画面未显示'");
    expect(out).toContain('auditCoreVisualVisibility');
    expect(out).not.toContain('autoRepairLayout');
    expect(out).not.toContain('style.scale =');
    expect(out).not.toContain('style.translate =');
    expect(out).not.toContain('data-layout-autofixed');
  });

  it('audits the portrait platform safe area on the top and both sides', () => {
    const out = wrapHtmlWithWatchdog(
      '<div data-editor-id="subject">Subject</div>',
      1000,
      { canvasPreset: 'douyin-portrait-9-16' },
    );
    expect(out).toContain("add('platform_safe_area', 'critical'");
    expect(out).toContain('stageRect.left + 48');
    expect(out).toContain('stageRect.top + 80');
    expect(out).toContain('stageRect.left + 608');
  });

  it('audits undersized portrait focal visuals with portrait-only thresholds', () => {
    const out = wrapHtmlWithWatchdog(
      '<main data-layout="stack"><section data-role="text-zone"><h1>标题</h1></section><section data-role="visual-zone"><div data-role="visual-content"><div data-role="focal" data-editor-id="hero"></div></div></section></main>',
      1000,
      { canvasPreset: 'douyin-portrait-9-16' },
    );
    expect(out).toContain("main.querySelector('[data-role=\"focal\"]')");
    expect(out).toContain("add('focal_too_small', 'major'");
    expect(out).toContain('widthRatio < 0.58');
    expect(out).toContain('heightRatio < 0.36');
    expect(out).toContain('? 56');
  });

  it('can deterministically seek CSS animations to their final state for hidden quality audits', () => {
    const out = wrapHtmlWithWatchdog(
      '<div data-editor-id="flow">Flow</div>',
      12_000,
      { settleAnimationsBeforeAudit: true, auditAnimationProgress: 0.7 },
    );
    expect(out).toContain('SETTLE_ANIMATIONS_BEFORE_AUDIT = true');
    expect(out).toContain('AUDIT_ANIMATION_PROGRESS = 0.7');
    expect(out).toContain('animation.currentTime = Math.max(timing.endTime * AUDIT_ANIMATION_PROGRESS - 0.001, 0)');
    expect(out).toContain('setTimeoutOrig(function() { setTimeoutOrig(callback, 16); }, 16)');
    expect(out).toContain('var auditDelay = SETTLE_ANIMATIONS_BEFORE_AUDIT ? 120');
  });

  it('correlates sequential hidden audits instead of accepting a stale prior result', () => {
    const out = wrapHtmlWithWatchdog(
      '<div data-editor-id="flow">Flow</div>',
      12_000,
      { settleAnimationsBeforeAudit: true, auditAnimationProgress: 0.7, auditToken: 'sample:700' },
    );

    expect(out).toContain('var AUDIT_TOKEN = "sample:700"');
    expect(out).toContain('window.__ai_video_layout_audit = undefined');
    expect(out).toContain('window.__ai_video_layout_audit_token = undefined');
    expect(out).toContain('window.__ai_video_layout_audit_token = AUDIT_TOKEN');
    expect(out).toContain("auditToken: AUDIT_TOKEN");
  });

  it('adapts stack geometry from measured text boxes before auditing', () => {
    const out = wrapHtmlWithWatchdog('<main data-layout="stack"><section data-role="text-zone"><h1>Short title</h1></section><section data-role="visual-zone"><div data-role="visual-content"></div></section></main>');
    expect(out).toContain('function applyAdaptiveStackLayout()');
    expect(out).toContain("main.style.setProperty('--ai-stack-visual-top'");
    expect(out).toContain("document.fonts.ready.then(applyAdaptiveStackLayout)");
    expect(out).toContain('Math.min(304, Math.max(240, requestedTop))');
    expect(out).toContain("main.setAttribute('data-ai-stack-text-bottom'");
    expect(out).toContain('function fitStackTitle(main, textZone)');
    expect(out).toContain("title.style.setProperty('font-size'");
    expect(out).toContain("main.setAttribute('data-ai-stack-title-fitted'");
  });

  it('audits non-text visuals and reports their clipped edge distance', () => {
    const out = wrapHtmlWithWatchdog('<div data-editor-id="shape"></div>');
    expect(out).not.toContain("rect.height <= 0 || !text");
    expect(out).toContain("parts.push('上侧 '");
    expect(out).toContain("'px'");
    expect(out).toContain('overflowDetail(rect, parentRect, parentElement, clipTolerance)');
  });

  it('keeps fixed auto-repair patches accountable to their authored zone', () => {
    const out = wrapHtmlWithWatchdog('<section data-role="visual-zone"><div data-editor-id="shape"></div></section>');
    expect(out).not.toContain("if (style.position === 'fixed') break");
    expect(out).toContain('they still belong');
  });

  it('excludes connector drawing layers from semantic overlap diagnostics', () => {
    const out = wrapHtmlWithWatchdog('<svg data-role="connector" style="pointer-events:none"></svg><div data-editor-id="card"></div>');
    expect(out).toContain("role === 'connector'");
    expect(out).toContain("style.pointerEvents === 'none'");
  });

  it('allows non-text internals to be intentionally clipped inside a bounded composite', () => {
    const out = wrapHtmlWithWatchdog('<div data-role="composite"><div style="overflow:hidden"><div data-editor-id="piston"></div></div></div>');
    expect(out).toContain('function intentionalCompositeClip(');
    expect(out).toContain('[data-role="composite"],[data-editor-group="composite"]');
    expect(out).toContain('composite.contains(parent)');
    expect(out).toContain('if (isText) return false');
  });

  it('checks direct parent text against positioned inline descendants', () => {
    const out = wrapHtmlWithWatchdog('<div data-editor-id="title">前半句<span data-editor-id="accent">关键词</span>后半句</div>');
    expect(out).toContain('var directTextNodes');
    expect(out).toContain('var positionedDescendant');
    expect(out).toContain('(!element.contains(top) || positionedDescendant)');
  });

  it('provides a lightweight gsap compatibility shim before AI scripts', () => {
    const out = wrapHtmlWithWatchdog('<head><script>gsap.to(".box",{opacity:1})</script></head><body><div class="box"></div></body>');
    expect(out).toContain('window.gsap');
    expect(out.indexOf('window.gsap')).toBeLessThan(out.indexOf('gsap.to(".box"'));
  });

  it('看门狗中包含 freeze 函数', () => {
    const out = wrapHtmlWithWatchdog('<p>x</p>');
    expect(out).toContain('function freeze()');
    expect(out).toContain('document.getAnimations()');
    expect(out).not.toMatch(/body\.frozen[^}]*animation:\s*none/i);
    // 必须覆盖 setInterval / setTimeout / requestAnimationFrame
    expect(out).toMatch(/window\.setInterval\s*=/);
    expect(out).toMatch(/window\.setTimeout\s*=/);
    expect(out).toMatch(/window\.requestAnimationFrame\s*=/);
    expect(out).toContain('var trackedTimeouts = []');
    expect(out).toContain('var trackedIntervals = []');
    expect(out).toContain('var requestAnimationFrameOrig = window.requestAnimationFrame');
    expect(out).toContain('window.requestAnimationFrame = requestAnimationFrameOrig');
    expect(out).toContain('function scheduleWatchdog()');
    expect(out).toContain('trackedIntervals.forEach');
    expect(out).not.toContain('i < 99999');
  });
});

describe('sanitizeAiHtml', () => {
  it('replaces stale layout guards and makes the canvas the only coordinate system', () => {
    const html = '<html><head><style data-ai-layout-guard>main{padding:72px}</style></head><body><main data-layout="split"><section data-role="text-zone"></section><section data-role="visual-zone"></section></main></body></html>';
    const out = enforceLayoutSafety(html);
    expect(out.match(/data-ai-layout-guard/g)).toHaveLength(1);
    expect(out).toContain('display:block!important');
    expect(out).toContain('padding:0!important');
    expect(out).toContain('grid-column:auto!important');
    expect(out).toContain('left:568px!important');
    expect(out).toContain('--ai-stack-visual-top:304px');
    expect(out).toContain('top:var(--ai-stack-visual-top)!important');
    // Fixed-position inspector edits use canvas coordinates. A containing
    // paint/layout boundary would make them relative to, and clipped by, a zone.
    expect(out).not.toContain('contain:layout paint!important');
  });

  it('移除外部 script src', () => {
    const html = '<script src="https://evil.com/x.js"></script><p>safe</p>';
    const out = sanitizeAiHtml(html);
    expect(out).not.toContain('evil.com');
    expect(out).toContain('<p>safe</p>');
  });

  it('移除外部 stylesheet link', () => {
    const html = '<link rel="stylesheet" href="https://evil.com/x.css"><p>safe</p>';
    const out = sanitizeAiHtml(html);
    expect(out).not.toContain('evil.com');
    expect(out).toContain('<p>safe</p>');
  });

  it('移除外部 img', () => {
    const html = '<img src="https://x.com/1.png"><img src="/local.png">';
    const out = sanitizeAiHtml(html);
    expect(out).not.toContain('https://x.com');
    expect(out).toContain('/local.png');
  });

  it('移除 <base>', () => {
    const html = '<base href="https://evil.com/"><p>safe</p>';
    const out = sanitizeAiHtml(html);
    expect(out).not.toContain('<base');
    expect(out).toContain('<p>safe</p>');
  });

  it('内联 script 保留', () => {
    const html = '<script>console.log(1)</script>';
    const out = sanitizeAiHtml(html);
    expect(out).toContain('console.log(1)');
  });

  it('removes an inline script with invalid JavaScript syntax', () => {
    const html = "<main>fallback</main><script>const value = 'broken\nstring';</script>";
    const out = sanitizeAiHtml(html);
    expect(out).toContain('<main>fallback</main>');
    expect(out).not.toContain('broken');
    expect(out).toContain('invalid inline script removed');
  });

  it('repairs collapsed line comments that would hide animation code', () => {
    const html = [
      '<script>',
      "document.addEventListener('DOMContentLoaded',function(){",
      "var el=document.getElementById('x');// 显示元素setTimeout(function(){el.classList.add('show');},200);",
      '});',
      '</script>',
    ].join('');
    const out = sanitizeAiHtml(html);
    expect(out).not.toContain('invalid inline script removed');
    expect(out).toContain("setTimeout(function(){el.classList.add('show');},200);");
  });

  it('preserves non-JavaScript data scripts', () => {
    const html = '<script type="application/json">{"label":"safe"}</script>';
    expect(sanitizeAiHtml(html)).toContain('{"label":"safe"}');
  });
});

describe('wrapHtmlForThumbnail', () => {
  it('removes scripts from static thumbnail documents', () => {
    const out = wrapHtmlForThumbnail('<head><script>console.log(1)</script></head><body><p>preview</p><script>animate()</script></body>');
    expect(out).toContain('<p>preview</p>');
    expect(out).not.toContain('<script');
  });

  it('forces static thumbnails to reveal initially hidden animation elements', () => {
    const out = wrapHtmlForThumbnail('<body><div style="opacity:0">preview</div></body>');
    expect(out).toContain('opacity: 1 !important');
    expect(out).toContain('visibility: visible !important');
  });
});
