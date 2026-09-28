import { describe, expect, it } from 'vitest';
import { buildFrameTunePreviewHtml, persistFrameTuneHtml, stripFrameTunePreviewHtml } from '@/lib/frame-tune-preview';

describe('buildFrameTunePreviewHtml', () => {
  it('injects frozen preview assets and control overlay without changing body content', () => {
    const html = '<!DOCTYPE html><html><head></head><body><div class="clock">clock</div></body></html>';
    const result = buildFrameTunePreviewHtml(html, [
      {
        label: '钟表主体',
        kind: 'visual',
        selector: '.clock',
        previewAnchor: 'center',
        current: { x: '50%', y: '48%', scale: '1.00' },
        proposed: { x: '50%', y: '43%', scale: '1.10' },
        reason: '上移一点',
      },
    ], { showControls: true, selectedIndex: 0 });

    expect(result).toContain('__ai_video_tune_preview__');
    expect(result).toContain('__ai_video_tune_preview_script__');
    expect(result).toContain('__ai_video_tune_overlay__');
    expect(result).toContain('animation-play-state: paused');
    expect(result).toContain('freezeAnimationsAtReadableTime');
    expect(result).not.toContain('fittedTransform');
    expect(result).toContain('animation.currentTime = readableTime');
    expect(result).toContain('.clock');
    expect(result).toContain('translate: 0px -36px 0');
    expect(result).toContain('scale: 1.1');
    expect(result).toContain('<div class="clock">clock</div>');
  });

  it('skips unsafe broad selectors instead of generating destructive css', () => {
    const html = '<html><body><div>clock</div></body></html>';
    const result = buildFrameTunePreviewHtml(html, [
      {
        label: '整页',
        kind: 'visual',
        selector: 'body',
        current: { x: '50%' },
        proposed: { x: '45%' },
        reason: '',
      },
    ]);

    expect(result).toContain('__ai_video_tune_preview__');
    expect(result).toContain('"elements":[]');
    expect(result).not.toContain('body {\n  transform');
    expect(result).toContain('<div>clock</div>');
  });

  it('clamps extreme movement and scale values to keep the frame visible', () => {
    const html = '<html><body><div class="clock">clock</div></body></html>';
    const result = buildFrameTunePreviewHtml(html, [
      {
        label: '钟表主体',
        kind: 'visual',
        selector: '.clock',
        current: { x: '0%', y: '0%', scale: '1' },
        proposed: { x: '500%', y: '-500%', scale: '0' },
        reason: '',
      },
    ]);

    expect(result).toContain('translate: 448px -252px 0');
    expect(result).toContain('scale: 0.2');
  });

  it('uses exact pixel coordinates from the 1280x720 frame editor', () => {
    const html = '<html><body><div class="book">book</div></body></html>';
    const result = buildFrameTunePreviewHtml(html, [{
      label: 'Book', kind: 'visual', selector: '.book',
      current: { x: '640px', y: '346px' },
      proposed: { x: '640px', y: '120px' },
      reason: '',
    }]);

    expect(result).toContain('translate: 0px -226px 0');
  });

  it('repairs an AI id selector when the frame uses data-element-id', () => {
    const html = '<html><body><div class="shelf-group" data-element-id="shelf-stack">shelf</div></body></html>';
    const result = buildFrameTunePreviewHtml(html, [{
      label: 'Shelf', kind: 'visual', selector: '#shelf-stack',
      current: { x: '20px', y: '30px' },
      proposed: { x: '20px', y: '-120px' },
      reason: '',
    }]);

    expect(result).toContain('[data-element-id="shelf-stack"] {');
    expect(result).toContain('translate: 0px -150px 0');
    expect(result).toContain('"selector":"[data-element-id=\\"shelf-stack\\"]"');
    expect(result).not.toContain('#shelf-stack {');
  });

  it('shows a removable element as a red ghost before confirmation', () => {
    const html = '<html><body><div class="badge">badge</div></body></html>';
    const result = buildFrameTunePreviewHtml(html, [{
      label: '橙色标签', kind: 'visual', selector: '.badge',
      current: { visibility: 'visible' }, proposed: { visibility: 'removed' }, reason: '用户要求删除',
    }], { showControls: true });

    expect(result).toContain('opacity: 0.16 !important');
    expect(result).toContain('outline: 3px solid rgba(220,38,38,.92)');
    expect(result).toContain('is-removal');
    expect(result).not.toContain('.badge {\n  display: none');
  });

  it('persists removal as a reversible display rule', () => {
    const html = '<html><head></head><body><div class="badge">badge</div></body></html>';
    const result = persistFrameTuneHtml(html, [{
      label: '橙色标签', kind: 'visual', selector: '.badge',
      current: { visibility: 'visible' }, proposed: { visibility: 'removed' }, reason: '用户要求删除',
    }]);

    expect(result).toContain('.badge {\n  display: none !important;');
  });

  it('blocks deletion selectors that target protected layout zones', () => {
    const html = '<html><body><section data-role="visual-zone"><div>visual</div></section></body></html>';
    const result = persistFrameTuneHtml(html, [{
      label: '主视觉区', kind: 'visual', selector: '[data-role="visual-zone"]',
      current: {}, proposed: { visibility: 'removed' }, reason: '',
    }]);

    expect(result).toBe(html);
  });

  it('does not globally reveal hidden content or replace existing transforms', () => {
    const html = [
      '<html><body>',
      '<div class="card" style="transform: translate(-50%, -50%) rotate(8deg)">card</div>',
      '<div class="future" style="display: none; opacity: 0">later</div>',
      '</body></html>',
    ].join('');
    const result = buildFrameTunePreviewHtml(html, [
      {
        label: '卡片',
        kind: 'visual',
        selector: '.card',
        current: { y: '20%' },
        proposed: { y: '30%' },
        reason: '',
      },
    ]);

    expect(result).toContain('translate: 0px 72px 0');
    expect(result).not.toContain('transform: translate3d');
    expect(result).not.toContain('*, *::before, *::after {\n  animation-play-state');
    expect(result).not.toContain('body * {\n  visibility: visible !important;');
    expect(result).not.toContain('[style*="display: none"]');
    expect(result).toContain('style="display: none; opacity: 0"');
    expect(result).toContain('style="transform: translate(-50%, -50%) rotate(8deg)"');
  });

  it('can strip preview-only assets before persistence if needed', () => {
    const html = '<html><body><div class="clock">clock</div></body></html>';
    const preview = buildFrameTunePreviewHtml(html, [
      {
        label: '钟表主体',
        kind: 'visual',
        selector: '.clock',
        current: { x: '50%' },
        proposed: { x: '45%' },
        reason: '',
      },
    ]);

    const stripped = stripFrameTunePreviewHtml(preview);
    expect(stripped).not.toContain('__ai_video_tune_preview__');
    expect(stripped).not.toContain('__ai_video_tune_overlay__');
    expect(stripped).toContain('<div class="clock">clock</div>');
  });
});

describe('persistFrameTuneHtml', () => {
  it('merges repeated tune rules into one persistent style block', () => {
    const html = '<html><head></head><body><div class="clock">clock</div></body></html>';
    const first = persistFrameTuneHtml(html, [{
      label: 'clock', kind: 'visual', selector: '.clock',
      current: { y: '50%' }, proposed: { y: '45%' }, reason: '',
    }]);
    const second = persistFrameTuneHtml(first, [{
      label: 'clock', kind: 'visual', selector: '.clock',
      current: { scale: '1' }, proposed: { scale: '1.1' }, reason: '',
    }]);

    expect(second.match(/__ai_video_tune_persisted__/g)).toHaveLength(1);
    expect(second).not.toContain('__ai_video_tune_persisted_script__');
    expect(second).not.toContain('html.__ai_video_tune_layout_locked__ .clock');
    expect(second).toContain('.clock {');
    expect(second).toContain('translate: 0px -36px 0');
    expect(second).toContain('scale: 1.1');
  });
});
