import { describe, expect, it } from 'vitest';
import { createGPTVisualBible, createVisualContract, hasVisualContractMarker, stampGPTVisualBible, stampVisualContract } from '@/lib/ai/visual-contract';
import { getStyleById } from '@/lib/styles/presets';

describe('visual contract', () => {
  it('freezes a selected style and stamps the generated scene root', () => {
    const style = getStyleById('signal-grid');
    expect(style).toBeTruthy();
    const contract = createVisualContract(style!);
    const html = stampVisualContract('<main data-layout="split"></main>', contract);

    expect(contract.themeId).toBe('signal-grid');
    expect(contract.allowedLayouts).toEqual(['split', 'stack']);
    expect(contract.maxSemanticObjects).toBe(4);
    expect(html).toContain('data-visual-contract="signal-grid"');
    expect(hasVisualContractMarker(html, contract)).toBe(true);
  });

  it('keeps GPT artistic direction separate from standard layout constraints', () => {
    const style = getStyleById('signal-grid')!;
    const bible = createGPTVisualBible(style, {
      title: 'GPT free', totalDuration: 8, frames: [],
      freeCreativeBrief: { visualMotif: '精密刻度', mediaStrategy: '原生网页视觉', chapterStrategy: '逐镜变化', rhythm: '先紧后松' },
    });
    const html = stampGPTVisualBible('<main></main>', bible);
    expect(bible.themeId).toBe('signal-grid');
    expect(bible.motifs).toContain('精密刻度');
    expect(bible).not.toHaveProperty('allowedLayouts');
    expect(bible).not.toHaveProperty('maxSemanticObjects');
    expect(html).toContain('data-gpt-visual-bible="signal-grid"');
    expect(html).not.toContain('data-visual-contract');
    expect(stampGPTVisualBible('<body><canvas></canvas></body>', bible)).toContain('data-gpt-visual-bible="signal-grid"');
  });
});
