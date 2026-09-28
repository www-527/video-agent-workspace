// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { auditCoreVisualVisibility } from '@/lib/iframe-utils';

const VISIBLE_RECT = {
  x: 100, y: 100, left: 100, top: 100, right: 300, bottom: 300,
  width: 200, height: 200, toJSON: () => ({}),
};

function setRect(element: Element, rect = VISIBLE_RECT) {
  element.getBoundingClientRect = () => rect as DOMRect;
}

describe('核心视觉可见性审计', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reports invisible when every core visual remains transparent', () => {
    document.body.innerHTML = `
      <main data-layout="split">
        <section data-role="visual-zone">
          <div data-role="visual-content">
            <div data-editor-id="circle" style="opacity:0"></div>
          </div>
        </section>
      </main>`;
    const circle = document.querySelector('[data-editor-id="circle"]')!;
    setRect(circle);

    expect(auditCoreVisualVisibility()).toEqual({
      checked: true,
      candidateCount: 1,
      visibleCount: 0,
      issue: 'invisible',
    });
  });

  it('passes when an entrance animation has made one core visual visible', () => {
    document.body.innerHTML = `
      <section data-role="visual-zone">
        <div data-role="visual-content">
          <div data-editor-id="circle" style="opacity:1"></div>
        </div>
      </section>`;
    setRect(document.querySelector('[data-editor-id="circle"]')!);

    expect(auditCoreVisualVisibility()).toMatchObject({
      checked: true,
      candidateCount: 1,
      visibleCount: 1,
    });
    expect(auditCoreVisualVisibility().issue).toBeUndefined();
  });

  it('audits GPT-free elements without requiring standard visual-zone roles', () => {
    document.body.innerHTML = `
      <main data-gpt-visual-bible="signal-grid">
        <canvas data-editor-id="gpt-free-scene" style="opacity:0"></canvas>
      </main>`;
    setRect(document.querySelector('[data-editor-id="gpt-free-scene"]')!);

    expect(auditCoreVisualVisibility()).toEqual({
      checked: true,
      candidateCount: 1,
      visibleCount: 0,
      issue: 'invisible',
    });
  });

  it('uses ancestor opacity and excludes decorations from core candidates', () => {
    document.body.innerHTML = `
      <section data-role="visual-zone">
        <div data-role="visual-content" style="opacity:0">
          <div data-editor-id="core"></div>
          <div data-role="decoration"><div data-editor-id="spark"></div></div>
        </div>
      </section>`;
    setRect(document.querySelector('[data-editor-id="core"]')!);
    setRect(document.querySelector('[data-editor-id="spark"]')!);

    expect(auditCoreVisualVisibility()).toEqual({
      checked: true,
      candidateCount: 1,
      visibleCount: 0,
      issue: 'invisible',
    });
  });
});
