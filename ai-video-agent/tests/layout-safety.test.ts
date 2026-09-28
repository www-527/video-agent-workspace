import { describe, expect, it } from 'vitest';
import {
  normalizeEditorPositionTransforms,
  resolveCanvasPositionTargetId,
  stripLegacyAutoFitGuard,
  stripUnsafeInlinePositionPatches,
} from '@/lib/layout-safety';

describe('legacy visual auto-fit cleanup', () => {
  it('moves legacy editor positioning out of the animation transform', () => {
    const html = '<style data-editor-patch="old">[data-editor-id="title"]{transform:translate(-50%, -50%) translateY(-20px) scale(1.1)!important}</style>';
    const normalized = normalizeEditorPositionTransforms(html);
    expect(normalized).toContain('translate: -50% calc(-50% - 20px) !important');
    expect(normalized).toContain('transform: scale(1.1) !important');
    expect(normalized).not.toContain('translateY(');
  });

  it('removes the runtime script and turns its scale transform into a stable transform', () => {
    const legacy = `<style data-ai-layout-guard>main[data-layout] [data-role="visual-content"]{transform-origin:0 0!important;transform:translate(var(--ai-fit-x,0px),var(--ai-fit-y,0px)) scale(var(--ai-fit-scale,1))!important}</style><script data-ai-fit-guard>window.fit = true;</script>`;
    const cleaned = stripLegacyAutoFitGuard(legacy);

    expect(cleaned).not.toContain('data-ai-fit-guard');
    expect(cleaned).not.toContain('--ai-fit-scale');
    expect(cleaned).toContain('transform:none!important');
  });

  it('promotes an inline word move to the nearest editable title block', () => {
    const html = '<div data-editor-id="title"><span data-editor-id="accent">关键词</span>后半句</div>';
    expect(resolveCanvasPositionTargetId(html, 'accent')).toBe('title');
    expect(resolveCanvasPositionTargetId(html, 'title')).toBe('title');
  });

  it('rejects a canvas move when an inline word has no editable block parent', () => {
    const html = '<div><span data-editor-id="accent">关键词</span>后半句</div>';
    expect(resolveCanvasPositionTargetId(html, 'accent')).toBeNull();
  });

  it('removes a persisted fixed-position patch targeting an inline word', () => {
    const html = [
      '<style data-editor-patch="bad">[data-editor-id="accent"]{left:160px!important;top:157px!important;position:fixed!important}</style>',
      '<div data-editor-id="title"><span data-editor-id="accent">关键词</span>后半句</div>',
    ].join('');
    const cleaned = stripUnsafeInlinePositionPatches(html);
    expect(cleaned).not.toContain('data-editor-patch="bad"');
    expect(cleaned).toContain('<span data-editor-id="accent">关键词</span>后半句');
  });

  it('preserves typography-only patches on inline text', () => {
    const html = [
      '<style data-editor-patch="safe">[data-editor-id="accent"]{color:#176b55!important}</style>',
      '<span data-editor-id="accent">关键词</span>',
    ].join('');
    expect(stripUnsafeInlinePositionPatches(html)).toContain('data-editor-patch="safe"');
  });
});
