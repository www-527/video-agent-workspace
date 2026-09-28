import { describe, expect, it } from 'vitest';
import { assertProjectQualityForExport, exportQualityHtmlHash, ExportQualityGateError } from '@/lib/quality/export-gate';
import type { ProjectDetail } from '@/types';
import { QUALITY_AUDIT_VERSION } from '@/lib/quality/audit-version';

const html = `<!DOCTYPE html><html><head><style>
body{margin:0;width:1280px;height:720px;background:#0b1114;color:#ecf4f1;font-family:Arial}
main{position:relative;width:1280px;height:720px;overflow:hidden}
[data-role="text-zone"]{position:absolute;left:72px;top:72px;width:480px;height:480px}
[data-role="visual-zone"]{position:absolute;left:640px;top:72px;width:568px;height:528px}
</style></head><body><main data-layout="split"><section data-role="text-zone"><h1>权限需要先确认</h1><p>在安装前检查范围、批准和沙盒边界。</p></section><section data-role="visual-zone"><div data-role="visual-content"><div data-role="focal" data-editor-id="boundary">批准边界</div></div></section></main></body></html>`;

function projectWith(reportPatch: Record<string, unknown> = {}, options: { workflow?: ProjectDetail['workflow']; htmlCode?: string } = {}): ProjectDetail {
  const htmlCode = options.htmlCode || html;
  return {
    uuid: 'project-1', title: 'quality gate', type: 'html', canvasPreset: 'landscape-16-9',
    styleId: 'signal-grid', workflow: options.workflow, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), hasOutline: true,
    outline: {
      title: 'quality gate', totalDuration: 8,
      frames: [{
        id: 'frame-1', index: 1, title: '权限', narration: '在安装前检查范围。',
        sceneSpec: {
          relationship: 'hierarchy', focus: 'boundary', revealStrategy: 'progressive', focalElement: 'boundary',
          composition: 'expand', actionSemantics: 'show', assetStrategy: 'css-svg', informationPool: [],
          visualIntent: '批准边界', screenText: [], assetHints: [], durationHint: 8, prohibitedPatterns: [],
          compositionTag: 'split', visualType: 'diagram',
        },
      }],
    },
    videoSource: { frames: [{
      id: 'frame-1', htmlCode, audioDuration: 8,
      qualityReport: {
        frameId: 'frame-1', status: 'passed', scoreBefore: 100, scoreAfter: 100, iterations: 0, issues: [], appliedFixes: [],
        auditedAt: Date.now(), auditVersion: QUALITY_AUDIT_VERSION, htmlHash: exportQualityHtmlHash(htmlCode), ...reportPatch,
      } as any,
    }] },
  };
}

describe('export quality gate', () => {
  it('permits only a current passing report and valid controlled HTML', () => {
    expect(() => assertProjectQualityForExport(projectWith())).not.toThrow();
  });

  it('blocks stale or failing frame reports before rendering starts', () => {
    expect(() => assertProjectQualityForExport(projectWith({ htmlHash: 'stale' }))).toThrow(ExportQualityGateError);
    expect(() => assertProjectQualityForExport(projectWith({ status: 'needs_review' }))).toThrow(/尚未通过/);
  });

  it('accepts schema-free GPT HTML while keeping current-report and runtime gates', () => {
    const freeHtml = `<!DOCTYPE html><html><head><style>body{margin:0;width:1280px;height:720px;background:#050505;color:#fff}main{position:relative;width:1280px;height:720px;overflow:hidden}.word{position:absolute;inset:120px;font-size:92px}</style></head><body><main><div class="word">权限边界正在收紧，批准范围保持清晰。</div></main></body></html>`;
    expect(() => assertProjectQualityForExport(projectWith({}, { workflow: 'gpt-free', htmlCode: freeHtml }))).not.toThrow();
    expect(() => assertProjectQualityForExport(projectWith({ htmlHash: 'stale' }, { workflow: 'gpt-free', htmlCode: freeHtml }))).toThrow(/尚未通过/);
  });
});
