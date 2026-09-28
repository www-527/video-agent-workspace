import { describe, it, expect } from 'vitest';
import { STYLE_PRESETS, getStyleById, getDefaultStyle } from '@/lib/styles/presets';

describe('STYLE_PRESETS', () => {
  it('包含 14 套差异化 Token 主题', () => {
    expect(STYLE_PRESETS).toHaveLength(14);
  });

  it('包含高级审美方向模板', () => {
    expect(STYLE_PRESETS.map(style => style.id)).toEqual(expect.arrayContaining([
      'editorial-minimal',
      'cinematic-documentary',
      'luxury-tech',
      'gallery-contemporary',
      'product-craft',
      'humanist-literary',
    ]));
  });

  it('每套风格都有 id、name、prompt、demoHtml', () => {
    STYLE_PRESETS.forEach(s => {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.prompt).toBeTruthy();
      expect(s.demoHtml).toContain('<!DOCTYPE html>');
      expect(s.tokens).toBeTruthy();
      expect(s.bestFor?.length).toBeGreaterThan(0);
      expect(s.prohibitedPatterns).toContain('emoji');
    });
  });

  it('id 唯一', () => {
    const ids = STYLE_PRESETS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getStyleById', () => {
  it('能查到已有风格', () => {
    expect(getStyleById('cyber-clean')?.id).toBe('signal-grid');
    expect(getStyleById('terminal-matrix')?.id).toBe('blueprint');
    expect(getStyleById('warm-story')?.id).toBe('warm-archive');
  });

  it('未传或未知 id 返回 undefined', () => {
    expect(getStyleById()).toBeUndefined();
    expect(getStyleById(null)).toBeUndefined();
    expect(getStyleById('not-exist')).toBeUndefined();
  });
});

describe('getDefaultStyle', () => {
  it('返回第一套', () => {
    expect(getDefaultStyle().id).toBe(STYLE_PRESETS[0].id);
  });
});
