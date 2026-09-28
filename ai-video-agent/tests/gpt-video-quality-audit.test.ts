import { describe, expect, it } from 'vitest';
import { auditGPTVideoQuality } from '@/lib/render/visual-audit';
import { QUALITY_AUDIT_VERSION } from '@/lib/quality/audit-version';
import { exportQualityHtmlHash } from '@/lib/quality/export-gate';
import type { Outline, VideoSource } from '@/types';

describe('GPT whole-film quality audit', () => {
  it('keeps technical and creative scores separate and catches repetitive, asset-poor output', () => {
    const frames = Array.from({ length: 12 }, (_, index) => ({
      id: `frame-${index + 1}`,
      index: index + 1,
      title: `Scene ${index + 1}`,
      narration: index < 2 ? '这是同一个重复事实和同一个重复事实' : `麦当劳品牌故事第 ${index + 1} 段`,
      sceneSpec: {
        relationship: 'spatial', focus: 'restaurant', revealStrategy: 'progressive', focalElement: 'restaurant',
        composition: 'expand', actionSemantics: 'show', assetStrategy: 'real-image', informationPool: [],
        visualIntent: 'show restaurant', screenText: [], assetHints: [], durationHint: 12,
        prohibitedPatterns: [], compositionTag: 'split', visualType: 'photo',
        assetRequirement: index === 0 ? { attempt: 'required', failurePolicy: 'needs-review' } : { attempt: 'optional', failurePolicy: 'allow-native' },
      },
    }));
    const outline = {
      title: 'McDonald’s', totalDuration: 144, frames,
      research: {
        provider: 'tavily', queriedAt: new Date().toISOString(), queries: ['mcdonalds'], summary: '',
        sources: [{ title: 'one', url: 'https://example.com', content: 'low confidence' }],
        evidenceCards: [{ id: 'e1', question: 'q', finding: 'f', sourceIds: ['one'], confidence: 'low' }],
      },
    } as unknown as Outline;
    const repeatedHtml = '<style>:root{--bg:#ffffff;--accent:#ff0000}body{font-family:Arial;background:#ffffff}.x{animation:in 1s 0.2s}</style><div class="card connector" data-role="connector">same</div>';
    const videoSource = { frames: frames.map(frame => ({ id: frame.id, htmlCode: repeatedHtml, audioDuration: 12 })) } as VideoSource;

    const report = auditGPTVideoQuality(outline, videoSource);
    expect(report.modelScope).toBe('gpt-only');
    expect(report.scores.technical).toBeNull();
    expect(report.scores.creative).toBeLessThan(100);
    expect(report.scores.overall).toBeNull();
    expect(report.stats.auditStatus).toBe('pending');
    expect(report.stats.auditedFrameCount).toBe(0);
    expect(report.stats.layoutFamilyCount).toBe(1);
    expect(report.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'three_consecutive_same_layout',
      'insufficient_layout_families',
      'required_asset_missing',
      'meaningless_connector_risk',
      'animation_ends_too_early',
      'single_low_confidence_source',
    ]));
  });

  it('marks native-only GPT-free work as asset-not-applicable and completes scores only after every current frame audit', () => {
    const html = '<!doctype html><html><body><main>native visual</main></body></html>';
    const outline = {
      title: 'Native only', totalDuration: 8,
      frames: [{
        id: 'frame-1', index: 1, title: 'One', narration: '一个原生画面。',
        sceneSpec: {
          relationship: 'emphasis', focus: 'one', revealStrategy: 'single', focalElement: 'one',
          composition: 'establish', actionSemantics: 'show', assetStrategy: 'css-svg', informationPool: [],
          visualIntent: 'show one idea', screenText: [], assetHints: [], durationHint: 8, prohibitedPatterns: [],
          assetRequirement: { attempt: 'never', failurePolicy: 'allow-native' },
        },
      }],
    } as unknown as Outline;
    const videoSource = {
      frames: [{
        id: 'frame-1', htmlCode: html,
        qualityReport: {
          frameId: 'frame-1', status: 'passed', scoreBefore: 85, scoreAfter: 92, iterations: 1,
          issues: [], appliedFixes: [], auditedAt: Date.now(), auditVersion: QUALITY_AUDIT_VERSION,
          htmlHash: exportQualityHtmlHash(html),
        },
      }],
    } as VideoSource;

    const report = auditGPTVideoQuality(outline, videoSource);
    expect(report.stats).toMatchObject({ auditStatus: 'complete', auditedFrameCount: 1, frameCount: 1 });
    expect(report.scores.technical).toBe(92);
    expect(report.scores.assets).toBeNull();
    expect(report.scores.creative).toBe(100);
    expect(report.scores.overall).toBe(96);
  });
});
