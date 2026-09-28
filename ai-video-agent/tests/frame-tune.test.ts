import { describe, expect, it } from 'vitest';
import { applyFrameTuneSource, applyFrameTuneToHtml, buildTuneHtmlSummary, normalizeTuneDraft } from '@/lib/ai/frame-tune';
import type { FrameOutline, FrameTuneDraft, VideoSource } from '@/types';

describe('normalizeTuneDraft', () => {
  it('keeps supported parameters and limits the plan to four elements', () => {
    const element = {
      label: 'divider',
      kind: 'visual' as const,
      selector: '.divider',
      current: { x: '50%', y: '48%', unknown: 'discard me' },
      proposed: { x: '50%', y: '43%', unknown: 'discard me' },
      reason: 'move it up',
    };
    const draft: FrameTuneDraft = {
      targetFrameId: 'frame-2',
      summary: 'move divider up',
      baseUpdatedAt: 'v1',
      elements: Array.from({ length: 6 }, (_, index) => ({ ...element, label: `divider-${index}` })),
    };

    const result = normalizeTuneDraft(draft);

    expect(result.elements).toHaveLength(4);
    expect(result.elements[0]).toMatchObject({
      label: 'divider-0',
      current: { x: '50%', y: '48%' },
      proposed: { x: '50%', y: '43%' },
    });
    expect(result.elements[0].current).not.toHaveProperty('unknown');
  });

  it('provides a fallback element when AI returns an empty list', () => {
    const result = normalizeTuneDraft({
      targetFrameId: 'frame-1',
      summary: '',
      baseUpdatedAt: 'v1',
      elements: [],
    });

    expect(result.summary).toBe('微调当前画面布局');
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0].label).toBe('主要视觉元素');
  });

  it('keeps the supported removal visibility operation', () => {
    const result = normalizeTuneDraft({
      targetFrameId: 'frame-1', summary: '删除标签', baseUpdatedAt: 'v1',
      elements: [{
        label: '标签', kind: 'visual', selector: '.badge',
        current: { visibility: 'visible' }, proposed: { visibility: 'removed', unknown: 'discard' }, reason: '',
      }],
    });

    expect(result.elements[0].proposed).toEqual({ visibility: 'removed' });
  });
});

describe('buildTuneHtmlSummary', () => {
  it('keeps stable selectors and CSS while removing scripts and unrelated markup', () => {
    const summary = buildTuneHtmlSummary(`
      <html><head><style>.divider { top: 50%; }</style></head><body>
        <div class="divider" data-role="divider"></div>
        <h1 id="title">Headline</h1>
        <script>const secretImplementation = true;</script>
      </body></html>
    `);

    expect(summary).toContain('class="divider"');
    expect(summary).toContain('data-role="divider"');
    expect(summary).toContain('.divider { top: 50%; }');
    expect(summary).not.toContain('secretImplementation');
  });

  it('exposes stable data-element selectors to the tune analyzer', () => {
    const summary = buildTuneHtmlSummary(
      '<div class="shelf-group" data-element-id="shelf-stack" data-element-label="Shelf"></div>',
    );

    expect(summary).toContain('data-element-id="shelf-stack"');
    expect(summary).toContain('data-element-label="Shelf"');
  });
});

describe('applyFrameTuneToHtml', () => {
  it('persists the preview CSS without asking AI to regenerate the document', async () => {
    const html = '<html><head></head><body><div class="divider"></div></body></html>';
    const result = await applyFrameTuneToHtml({
      frame: { id: 'frame-1', title: 'Frame' } as FrameOutline,
      htmlCode: html,
      draft: {
        targetFrameId: 'frame-1',
        baseUpdatedAt: 'v1',
        summary: 'move divider up',
        elements: [{
          label: 'divider',
          kind: 'decoration',
          selector: '.divider',
          current: { y: '50%' },
          proposed: { y: '45%' },
          reason: 'requested',
        }],
      },
    });

    expect(result).toContain('__ai_video_tune_persisted__');
    expect(result).toContain('.divider');
    expect(result).toContain('translate: 0px -36px 0');
    expect(result).not.toContain('__ai_video_tune_preview_script__');
  });
});

describe('applyFrameTuneSource', () => {
  it('only replaces the target frame html and preserves audio', () => {
    const videoSource: VideoSource = {
      frames: [
        { id: 'frame-1', htmlCode: '<div>first</div>', audioPath: '/a.mp3', audioDuration: 1 },
        { id: 'frame-2', htmlCode: '<div>old</div>', audioPath: '/b.mp3', audioDuration: 2 },
      ],
    };

    const result = applyFrameTuneSource({
      videoSource,
      frameIndex: 1,
      frameId: 'frame-2',
      htmlCode: '<div>new</div>',
    });

    expect(result.frames[0]).toEqual(videoSource.frames[0]);
    expect(result.frames[1]).toEqual({
      id: 'frame-2',
      htmlCode: '<div>new</div>',
      audioPath: '/b.mp3',
      audioDuration: 2,
    });
  });
});
