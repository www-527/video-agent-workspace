import { describe, expect, it } from 'vitest';
import {
  assertRepairPreservesImportantInformation,
  buildFrameQualityRepairPrompt,
  FREE_FRAME_QUALITY_REPAIR_SYSTEM,
} from '@/lib/ai/frame-quality-repair';

describe('AI frame quality repair', () => {
  const before = `<!DOCTYPE html><html><head><style>.chain{display:flex}</style></head><body>
    <main data-layout="split"><section data-role="text-zone"><h1 data-editor-id="title">研究：含糖饮料</h1></section>
    <section data-role="visual-zone"><div data-role="visual-content"><div class="chain" data-editor-id="chain">
      <div data-editor-id="node-1">含糖饮料</div><div data-editor-id="node-2">肠道菌群改变</div>
    </div></div></section></main></body></html>`;

  it('sends compact frame meaning, issue geometry, stable ids and the complete HTML to AI', () => {
    const prompt = buildFrameQualityRepairPrompt({
      frame: {
        id: 'frame-4', index: 4, title: '研究：含糖饮料改变肠道菌群', narration: '含糖饮料会改变肠道菌群',
        sceneSpec: { relationship: 'cause', focalElement: '因果链' } as any,
      },
      htmlCode: before,
      issues: [{
        code: 'clipped', severity: 'critical', label: '末端节点', detail: '右侧超出 12px', elementId: 'node-2',
        suggestedFix: { elementId: 'node-2', changes: { left: 1040, top: 258 } },
      }],
    });
    expect(prompt).toContain('研究：含糖饮料改变肠道菌群');
    expect(prompt).not.toContain('含糖饮料会改变肠道菌群');
    expect(prompt).toContain('关系=cause');
    expect(prompt).toContain('右侧超出 12px');
    expect(prompt).toContain('"left":1040');
    expect(prompt).toContain('data-editor-id="chain"');
    expect(prompt.length - before.length).toBeLessThan(1_200);
  });

  it('accepts layout restructuring while preserving text and stable ids', () => {
    const after = before.replace('.chain{display:flex}', '.chain{display:flex;transform:scale(.92);transform-origin:center}');
    expect(() => assertRepairPreservesImportantInformation(before, after)).not.toThrow();
  });

  it('rejects an AI repair that drops screen text or editable elements', () => {
    const after = before.replace('<div data-editor-id="node-2">肠道菌群改变</div>', '');
    expect(() => assertRepairPreservesImportantInformation(before, after)).toThrow(/删除或改写|丢失/);
  });

  it('keeps GPT-free repair focused on objective faults without standard layout instructions', () => {
    expect(FREE_FRAME_QUALITY_REPAIR_SYSTEM).toContain('只修复 DOM 自检明确报告的客观故障');
    expect(FREE_FRAME_QUALITY_REPAIR_SYSTEM).toContain('保留现有构图');
    expect(FREE_FRAME_QUALITY_REPAIR_SYSTEM).not.toContain('text-zone');
    expect(FREE_FRAME_QUALITY_REPAIR_SYSTEM).not.toContain('visual-zone');
    expect(FREE_FRAME_QUALITY_REPAIR_SYSTEM).not.toContain('split');
    expect(FREE_FRAME_QUALITY_REPAIR_SYSTEM).not.toContain('stack');
  });

  it('gives screenshot evidence priority and allows broad visual corrections', () => {
    const prompt = buildFrameQualityRepairPrompt({
      frame: { id: 'frame-1', index: 1, title: 'Test', narration: '', sceneSpec: {} as any },
      htmlCode: '<main data-editor-id="canvas"><div data-editor-id="label">Label</div></main>',
      issues: [{ code: 'subtitle_safe_area', label: 'Canvas', detail: 'enters the safe area', elementId: 'canvas' }],
      visualSamples: [
        { progress: 0.35, label: '35%', issues: [] },
        { progress: 0.7, label: '70%', issues: [] },
        { progress: 1, label: '100%', issues: [] },
      ],
    });
    expect(prompt).toContain('三张图片按 35%、70%、100% 排列');
    expect(prompt).toContain('100% 锁定终态');
    expect(prompt).toContain('DOM 问题只用于定位');
    expect(prompt).toContain('全画布根节点');
  });

  it('states that all three screenshots are required and treats 100% as the primary final-state evidence', () => {
    const prompt = buildFrameQualityRepairPrompt({
      frame: { id: 'frame-1', index: 1, title: '测试', narration: '', sceneSpec: {} as any },
      htmlCode: before,
      issues: [],
      visualSamples: [
        { progress: 0.35, label: '35%', issues: [] },
        { progress: 0.7, label: '70%', issues: [] },
        { progress: 1, label: '100%', issues: [] },
      ],
    });
    expect(prompt).toContain('三张图片按 35%、70%、100% 排列');
    expect(prompt).toContain('图3=100%/0项/终态主证据');
    expect(prompt).toContain('缺一不可');
    expect(FREE_FRAME_QUALITY_REPAIR_SYSTEM).toContain('100% 始终是权重最高的终态主证据');
  });

  it('accepts a single 100% final-state screenshot for a simple frame', () => {
    const prompt = buildFrameQualityRepairPrompt({
      frame: { id: 'frame-1', index: 1, title: '测试', narration: '', sceneSpec: {} as any },
      htmlCode: before,
      issues: [],
      visualSamples: [{ progress: 1, label: '100%', issues: [] }],
    });
    expect(prompt).toContain('当前只提供一张 100% 终态图');
    expect(prompt).toContain('图1=100%/0项/终态主证据');
    expect(prompt).not.toContain('缺一不可');
  });
});
