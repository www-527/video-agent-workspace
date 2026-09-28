import { describe, expect, it } from 'vitest';
import {
  deriveChartSpec,
  materializeDeterministicChart,
  parseEmbeddedChartSpec,
  renderChartFigure,
  selectChartType,
  validateChartSpec,
  type ChartSpec,
} from '@/lib/charts/chart-engine';
import type { SceneSpec } from '@/types';

const scene = (overrides: Partial<SceneSpec> = {}): SceneSpec => ({
  relationship: 'metric',
  focus: '数据关系',
  revealStrategy: 'single',
  focalElement: '图表',
  composition: 'establish',
  actionSemantics: '显示比例关系',
  assetStrategy: 'chart',
  informationPool: [],
  visualIntent: '展示数据',
  screenText: [],
  assetHints: [],
  durationHint: 8,
  prohibitedPatterns: [],
  ...overrides,
});

const frameHtml = (visual = '<div class="model-chart">model geometry</div>') => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Chart</title></head><body>
<main data-layout="split"><section data-role="text-zone"><h1>Chart</h1></section>
<section data-role="visual-zone"><div data-role="visual-content">${visual}</div></section></main>
</body></html>`;

describe('deterministic chart engine', () => {
  it('selects common chart types from semantic intent', () => {
    expect(selectChartType(scene({ focalElement: '年度趋势折线图' }))).toBe('line');
    expect(selectChartType(scene({ focalElement: '构成饼图' }))).toBe('pie');
    expect(selectChartType(scene({ focalElement: '相关性散点图' }))).toBe('scatter');
    expect(selectChartType(scene({ focalElement: '完成率进度条' }))).toBe('progress');
    expect(selectChartType(scene({ focalElement: '类别比较' }))).toBe('bar');
  });

  it('derives a mathematically complete 87/13 pie from director facts', () => {
    const spec = deriveChartSpec(scene({
      focalElement: '圆形饼图',
      visualIntent: '水占大部分，剩余为固体部分',
      informationPool: ['水占87%', '蛋白质3.3%'],
      assetHints: ['饼图，水标注87%，剩余部分标注固体'],
    }), '牛奶主要成分');

    expect(spec?.type).toBe('pie');
    expect(spec?.data).toEqual([
      { label: '水', value: 87 },
      { label: '固体', value: 13 },
    ]);
    const rendered = renderChartFigure(spec!);
    expect(rendered).toContain('data-chart-type="pie"');
    expect(rendered).toContain('A145 145 0 1 1');
    expect(rendered).toContain('水 87%');
    expect(rendered).toContain('固体 13%');
  });

  it('rejects invalid chart mathematics before rendering', () => {
    expect(validateChartSpec({ type: 'pie', data: [{ label: '错误', value: -1 }] }).valid).toBe(false);
    expect(validateChartSpec({ type: 'progress', max: 100, data: [{ label: '完成率', value: 120 }] }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'chart_invalid_scale' })]));
    expect(validateChartSpec({ type: 'scatter', data: [{ label: '点', value: 1 }] }).valid).toBe(false);
  });

  it('materializes an embedded ChartSpec and suppresses model-authored geometry', () => {
    const spec: ChartSpec = {
      type: 'bar',
      unit: '%',
      data: [{ label: 'A', value: 70 }, { label: 'B', value: 30 }],
    };
    const embedded = `<script type="application/json" data-chart-spec>${JSON.stringify(spec)}</script>`;
    const materialized = materializeDeterministicChart(frameHtml(embedded));

    expect(parseEmbeddedChartSpec(frameHtml(embedded))).toEqual(expect.objectContaining({ type: 'bar' }));
    expect(materialized).toContain('data-ai-chart-rendered="true"');
    expect(materialized).toContain('data-ai-chart-renderer="true"');
    expect(materialized).toContain('data-ai-chart-runtime');
    expect(materialized).not.toContain('data-chart-spec');
  });

  it('uses the fallback ChartSpec when legacy HTML contains a hand-written chart', () => {
    const fallback: ChartSpec = {
      type: 'line',
      data: [{ label: '一月', value: 10 }, { label: '二月', value: 20 }, { label: '三月', value: 15 }],
    };
    const materialized = materializeDeterministicChart(frameHtml(), fallback);

    expect(materialized).toContain('data-chart-type="line"');
    expect(materialized).toContain('class="chart-line"');
    expect(materialized).toContain('一月');
    expect(materialized).toContain('三月');
    expect(materialized).toContain(':not([data-ai-chart-renderer="true"]){display:none!important}');
  });

  it('renders area, progress and scatter charts from the same contract', () => {
    expect(renderChartFigure({ type: 'area', data: [{ label: 'A', value: 1 }, { label: 'B', value: 3 }] }))
      .toContain('opacity=".14"');
    expect(renderChartFigure({ type: 'progress', max: 100, unit: '%', data: [{ label: '完成率', value: 64 }] }))
      .toContain('width="327.68"');
    expect(renderChartFigure({ type: 'scatter', data: [
      { label: 'A', value: 1, x: 1, y: 2 },
      { label: 'B', value: 1, x: 2, y: 3 },
    ] })).toContain('<circle');
  });

  it('keeps grouped, stacked and multi-series relationships distinct', () => {
    const data = [
      { label: '一月', series: '线上', value: 40 },
      { label: '一月', series: '线下', value: 60 },
      { label: '二月', series: '线上', value: 55 },
      { label: '二月', series: '线下', value: 45 },
    ];
    const grouped = renderChartFigure({ type: 'grouped-bar', data });
    const stacked = renderChartFigure({ type: 'stacked-bar', data });
    const lines = renderChartFigure({ type: 'line', data });

    expect(grouped.match(/class="chart-bar"/g)).toHaveLength(4);
    expect(stacked).toContain('>100<');
    expect(lines.match(/class="chart-line"/g)).toHaveLength(2);
    expect(lines).toContain('线上');
    expect(lines).toContain('线下');
  });

  it('rejects an invalid embedded contract when no validated fallback exists', () => {
    const invalid = frameHtml('<script type="application/json" data-chart-spec>{"type":"pie","data":[]}</script>');
    expect(() => materializeDeterministicChart(invalid)).toThrow(/Embedded ChartSpec is invalid/);
  });
});
