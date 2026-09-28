import type { SceneSpec } from '@/types';
import type { ChartDatum, ChartIssue, ChartSpec, ChartType, ChartValidationResult } from './types';

const PALETTE = ['#b43924', '#d7cdbd', '#706c63', '#d98a75', '#9b8f7d', '#e6b8a9'];
export function validateChartSpec(input: ChartSpec): ChartValidationResult {
  const issues: ChartIssue[] = [];
  const data = input.data
    .map(item => ({ ...item, label: String(item.label || '').trim(), value: Number(item.value) }))
    .filter(item => item.label || Number.isFinite(item.value));

  if (!data.length) {
    issues.push({ code: 'chart_invalid_data', severity: 'critical', detail: '图表没有可绘制的数据。' });
  }
  if (data.some(item => !item.label || !Number.isFinite(item.value))) {
    issues.push({ code: 'chart_invalid_data', severity: 'critical', detail: '图表包含空标签或非有限数值。' });
  }
  if (['pie', 'donut', 'progress'].includes(input.type) && data.some(item => item.value < 0)) {
    issues.push({ code: 'chart_invalid_data', severity: 'critical', detail: '占比类图表不能包含负数。' });
  }
  if (['pie', 'donut'].includes(input.type)) {
    const total = data.reduce((sum, item) => sum + item.value, 0);
    if (total <= 0) {
      issues.push({ code: 'chart_invalid_total', severity: 'critical', detail: '饼图数据总和必须大于零。' });
    }
    if (data.length > 6) {
      issues.push({ code: 'chart_unsuitable_type', severity: 'major', detail: '饼图分类超过 6 个，应改用条形图。' });
    }
  }
  if (input.type === 'progress') {
    const max = input.max ?? 100;
    if (max <= 0 || data.some(item => item.value > max)) {
      issues.push({ code: 'chart_invalid_scale', severity: 'critical', detail: '进度值必须位于 0 与最大值之间。' });
    }
  }
  if (input.type === 'stacked-bar' && data.some(item => item.value < 0)) {
    issues.push({ code: 'chart_invalid_data', severity: 'critical', detail: '当前堆叠柱图不接受负数；应改用分组柱状图或正负分离图。' });
  }
  if (input.type === 'scatter' && data.some(item => !Number.isFinite(item.x) || !Number.isFinite(item.y))) {
    issues.push({ code: 'chart_invalid_data', severity: 'critical', detail: '散点图的每个数据点都必须包含有限的 x、y 数值。' });
  }

  const critical = issues.some(issue => issue.severity === 'critical');
  return {
    valid: !critical,
    issues,
    ...(!critical ? { normalized: { ...input, data } } : {}),
  };
}

export function selectChartType(sceneSpec: Pick<SceneSpec, 'relationship' | 'focalElement' | 'visualIntent' | 'assetHints'>, text = ''): ChartType {
  const haystack = [sceneSpec.focalElement, sceneSpec.visualIntent, ...(sceneSpec.assetHints || []), text].filter(Boolean).join(' ');
  if (/圆环|环形|donut/i.test(haystack)) return 'donut';
  if (/饼图|饼状|扇形|pie/i.test(haystack)) return 'pie';
  if (/堆叠|stacked/i.test(haystack)) return 'stacked-bar';
  if (/分组|grouped/i.test(haystack)) return 'grouped-bar';
  if (/散点|相关性|scatter/i.test(haystack)) return 'scatter';
  if (/面积图|area/i.test(haystack)) return 'area';
  if (/折线|趋势|走势|随时间|line/i.test(haystack)) return 'line';
  if (/进度|完成率|达成率|progress/i.test(haystack)) return 'progress';
  return sceneSpec.relationship === 'metric' && /占比|比例|构成/.test(haystack) ? 'pie' : 'bar';
}

/**
 * Builds a conservative chart contract from director-authored facts. It only
 * returns a spec when at least one explicit numeric fact can be recovered.
 */
export function deriveChartSpec(sceneSpec: SceneSpec, title?: string, prompt = ''): ChartSpec | null {
  if (sceneSpec.assetStrategy !== 'chart') return null;
  const text = [...(sceneSpec.informationPool || []), ...(sceneSpec.assetHints || []), sceneSpec.visualIntent || '', prompt]
    .filter(Boolean)
    .join('；');
  const type = selectChartType(sceneSpec, text);
  const extracted = extractNumericData(text);
  if (!extracted.length) return null;

  let data = dedupeData(extracted);
  const percentUnit = /[%％]/.test(text);
  if (['pie', 'donut'].includes(type)) {
    const firstPercent = data.find(item => item.value >= 0 && item.value <= 100);
    const mentionsRemainder = /剩余|其余|余下|固体部分/.test(text);
    if (percentUnit && firstPercent && mentionsRemainder && firstPercent.value < 100) {
      const remainderLabel = /固体/.test(text) ? '固体' : '其余';
      data = [firstPercent, { label: remainderLabel, value: round(100 - firstPercent.value, 4) }];
    } else if (percentUnit && data.length === 1 && data[0].value <= 100) {
      data = [data[0], { label: '其余', value: round(100 - data[0].value, 4) }];
    }
  }

  const spec: ChartSpec = {
    type,
    title,
    data,
    ...(percentUnit ? { unit: '%' } : {}),
    showLegend: ['pie', 'donut', 'grouped-bar', 'stacked-bar'].includes(type),
    showValues: true,
  };
  const validation = validateChartSpec(spec);
  return validation.valid ? validation.normalized! : null;
}

export function parseEmbeddedChartSpec(html: string): ChartSpec | null {
  const match = html.match(/<script\b[^>]*\bdata-chart-spec(?:=["'][^"']*["'])?[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(decodeHtmlEntities(match[1].trim())) as ChartSpec;
    const result = validateChartSpec(parsed);
    return result.valid ? result.normalized! : null;
  } catch {
    return null;
  }
}

export function materializeDeterministicChart(html: string, fallbackSpec?: ChartSpec | null): string {
  const hasEmbeddedSpec = /<script\b[^>]*\bdata-chart-spec/i.test(html);
  const embedded = parseEmbeddedChartSpec(html);
  const spec = embedded || fallbackSpec;
  if (hasEmbeddedSpec && !embedded && !fallbackSpec) {
    throw new Error('Embedded ChartSpec is invalid and no validated fallback data is available.');
  }
  if (!spec) return html;
  const validation = validateChartSpec(spec);
  if (!validation.valid || !validation.normalized) return html;
  const figure = renderChartFigure(validation.normalized);
  const style = `<style data-ai-chart-runtime>\n${chartRuntimeCss()}\n</style>`;
  let next = html
    .replace(/<style\b[^>]*\bdata-ai-chart-runtime\b[^>]*>[\s\S]*?<\/style>\s*/gi, '')
    .replace(/<figure\b[^>]*\bdata-ai-chart-renderer\b[^>]*>[\s\S]*?<\/figure>\s*/gi, '')
    .replace(/<script\b[^>]*\bdata-chart-spec(?:=["'][^"']*["'])?[^>]*>[\s\S]*?<\/script>\s*/gi, '');
  next = /<\/head>/i.test(next) ? next.replace(/<\/head>/i, `${style}</head>`) : `${style}${next}`;
  let inserted = false;
  next = next.replace(/<([a-z][\w:-]*)\b[^>]*\bdata-role=["']visual-content["'][^>]*>/i, tag => {
    inserted = true;
    return `${setTagAttribute(tag, 'data-ai-chart-rendered', 'true')}${figure}`;
  });
  return inserted ? next : html;
}

export function renderChartFigure(spec: ChartSpec): string {
  const renderer = ['pie', 'donut'].includes(spec.type)
    ? renderPie
    : spec.type === 'grouped-bar'
      ? renderGroupedBars
      : spec.type === 'stacked-bar'
        ? renderStackedBars
    : spec.type === 'line' || spec.type === 'area'
      ? renderLine
      : spec.type === 'scatter'
        ? renderScatter
        : spec.type === 'progress'
          ? renderProgress
          : renderBars;
  return `<figure data-ai-chart-renderer="true" data-chart-type="${spec.type}" role="img" aria-label="${escapeAttribute(spec.title || `${spec.type} chart`)}">${renderer(spec)}</figure>`;
}

function renderGroupedBars(spec: ChartSpec): string {
  const categories = unique(spec.data.map(item => item.label));
  const series = unique(spec.data.map(item => item.series || '数据'));
  const maxValue = Math.max(...spec.data.map(item => item.value), spec.max ?? 0, 1);
  const plot = { x: 72, y: 42, width: 520, height: 330 };
  const categorySlot = plot.width / Math.max(categories.length, 1);
  const groupWidth = categorySlot * .76;
  const barWidth = Math.min(42, groupWidth / Math.max(series.length, 1));
  const bars = categories.map((category, categoryIndex) => {
    const groupX = plot.x + categoryIndex * categorySlot + (categorySlot - barWidth * series.length) / 2;
    const segments = series.map((seriesName, seriesIndex) => {
      const item = spec.data.find(datum => datum.label === category && (datum.series || '数据') === seriesName);
      const value = item?.value ?? 0;
      const height = value / maxValue * plot.height;
      const x = groupX + seriesIndex * barWidth;
      const y = plot.y + plot.height - height;
      return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(Math.max(2, barWidth - 3))}" height="${fmt(Math.max(1, height))}" rx="3" fill="${PALETTE[seriesIndex % PALETTE.length]}" class="chart-bar" style="transform-origin:${fmt(x + barWidth / 2)}px ${plot.y + plot.height}px"/>`;
    }).join('');
    return `<g>${segments}<text x="${fmt(plot.x + categoryIndex * categorySlot + categorySlot / 2)}" y="${plot.y + plot.height + 32}" text-anchor="middle" class="chart-label">${escapeText(truncate(category, 8))}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 640 480" aria-hidden="true"><line x1="${plot.x}" y1="${plot.y + plot.height}" x2="${plot.x + plot.width}" y2="${plot.y + plot.height}" class="chart-axis"/>${bars}${renderSeriesLegend(series)}</svg>`;
}

function renderStackedBars(spec: ChartSpec): string {
  const categories = unique(spec.data.map(item => item.label));
  const series = unique(spec.data.map(item => item.series || '数据'));
  const totals = categories.map(category => spec.data.filter(item => item.label === category).reduce((sum, item) => sum + item.value, 0));
  const maxTotal = Math.max(...totals, spec.max ?? 0, 1);
  const plot = { x: 72, y: 42, width: 520, height: 330 };
  const slot = plot.width / Math.max(categories.length, 1);
  const barWidth = Math.min(72, slot * .58);
  const bars = categories.map((category, categoryIndex) => {
    let accumulated = 0;
    const x = plot.x + categoryIndex * slot + (slot - barWidth) / 2;
    const segments = series.map((seriesName, seriesIndex) => {
      const value = spec.data.find(item => item.label === category && (item.series || '数据') === seriesName)?.value ?? 0;
      const height = value / maxTotal * plot.height;
      accumulated += height;
      const y = plot.y + plot.height - accumulated;
      return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(barWidth)}" height="${fmt(Math.max(0, height))}" fill="${PALETTE[seriesIndex % PALETTE.length]}"/>`;
    }).join('');
    return `<g>${segments}<text x="${fmt(x + barWidth / 2)}" y="${fmt(plot.y + plot.height - totals[categoryIndex] / maxTotal * plot.height - 10)}" text-anchor="middle" class="chart-value">${formatValue(totals[categoryIndex], spec.unit)}</text><text x="${fmt(x + barWidth / 2)}" y="${plot.y + plot.height + 32}" text-anchor="middle" class="chart-label">${escapeText(truncate(category, 8))}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 640 480" aria-hidden="true"><line x1="${plot.x}" y1="${plot.y + plot.height}" x2="${plot.x + plot.width}" y2="${plot.y + plot.height}" class="chart-axis"/>${bars}${renderSeriesLegend(series)}</svg>`;
}

function renderPie(spec: ChartSpec): string {
  const data = spec.data.filter(item => item.value > 0);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let cursor = -90;
  const paths = data.map((item, index) => {
    const angle = item.value / total * 360;
    const start = polar(220, 220, 145, cursor);
    const end = polar(220, 220, 145, cursor + angle);
    const largeArc = angle > 180 ? 1 : 0;
    cursor += angle;
    if (angle >= 359.999) return `<circle cx="220" cy="220" r="145" fill="${PALETTE[index % PALETTE.length]}"/>`;
    const inner = spec.type === 'donut' ? 76 : 0;
    if (!inner) {
      return `<path d="M220 220 L${fmt(start.x)} ${fmt(start.y)} A145 145 0 ${largeArc} 1 ${fmt(end.x)} ${fmt(end.y)} Z" fill="${PALETTE[index % PALETTE.length]}" stroke="#f4f0e8" stroke-width="3"/>`;
    }
    const innerEnd = polar(220, 220, inner, cursor - angle);
    const innerStart = polar(220, 220, inner, cursor);
    return `<path d="M${fmt(start.x)} ${fmt(start.y)} A145 145 0 ${largeArc} 1 ${fmt(end.x)} ${fmt(end.y)} L${fmt(innerStart.x)} ${fmt(innerStart.y)} A${inner} ${inner} 0 ${largeArc} 0 ${fmt(innerEnd.x)} ${fmt(innerEnd.y)} Z" fill="${PALETTE[index % PALETTE.length]}" stroke="#f4f0e8" stroke-width="3"/>`;
  }).join('');
  const legend = data.map((item, index) => `<g transform="translate(410 ${140 + index * 48})"><circle r="7" fill="${PALETTE[index % PALETTE.length]}"/><text x="18" y="7" class="chart-label">${escapeText(item.label)} ${formatValue(item.value, spec.unit)}</text></g>`).join('');
  return `<svg viewBox="0 0 640 480" aria-hidden="true"><g class="chart-reveal chart-pie">${paths}</g>${legend}</svg>`;
}

function renderBars(spec: ChartSpec): string {
  const data = spec.data;
  const minValue = Math.min(0, ...data.map(item => item.value), spec.min ?? 0);
  const maxValue = Math.max(...data.map(item => item.value), spec.max ?? 0, 1);
  const plot = { x: 72, y: 42, width: 520, height: 340 };
  const zeroY = scaleY(0, minValue, maxValue, plot);
  const slot = plot.width / Math.max(data.length, 1);
  const barWidth = Math.min(64, slot * 0.62);
  const grid = [0, .25, .5, .75, 1].map(ratio => {
    const value = minValue + (maxValue - minValue) * ratio;
    const y = scaleY(value, minValue, maxValue, plot);
    return `<line x1="${plot.x}" y1="${fmt(y)}" x2="${plot.x + plot.width}" y2="${fmt(y)}" class="chart-grid"/><text x="${plot.x - 12}" y="${fmt(y + 6)}" text-anchor="end" class="chart-tick">${formatCompact(value)}</text>`;
  }).join('');
  const bars = data.map((item, index) => {
    const x = plot.x + slot * index + (slot - barWidth) / 2;
    const valueY = scaleY(item.value, minValue, maxValue, plot);
    const y = Math.min(valueY, zeroY);
    const height = Math.max(1, Math.abs(valueY - zeroY));
    return `<g><rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(barWidth)}" height="${fmt(height)}" rx="4" fill="${PALETTE[index % PALETTE.length]}" class="chart-bar" style="--bar-height:${fmt(height)}px;transform-origin:${fmt(x + barWidth / 2)}px ${fmt(zeroY)}px"/><text x="${fmt(x + barWidth / 2)}" y="${fmt(y - 10)}" text-anchor="middle" class="chart-value">${formatValue(item.value, spec.unit)}</text><text x="${fmt(x + barWidth / 2)}" y="${plot.y + plot.height + 34}" text-anchor="middle" class="chart-label">${escapeText(truncate(item.label, 8))}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 640 480" aria-hidden="true">${grid}<line x1="${plot.x}" y1="${fmt(zeroY)}" x2="${plot.x + plot.width}" y2="${fmt(zeroY)}" class="chart-axis"/>${bars}</svg>`;
}

function renderLine(spec: ChartSpec): string {
  const data = spec.data;
  const values = data.map(item => item.value);
  const minValue = Math.min(...values, spec.min ?? Infinity);
  const maxValue = Math.max(...values, spec.max ?? -Infinity);
  const padding = Math.max((maxValue - minValue) * .12, 1);
  const domainMin = Number.isFinite(spec.min) ? spec.min! : minValue - padding;
  const domainMax = Number.isFinite(spec.max) ? spec.max! : maxValue + padding;
  const plot = { x: 72, y: 42, width: 520, height: 340 };
  const labels = unique(data.map(item => item.label));
  const series = unique(data.map(item => item.series || '数据'));
  const step = labels.length > 1 ? plot.width / (labels.length - 1) : 0;
  const seriesPaths = series.map((seriesName, seriesIndex) => {
    const points = labels.map((label, index) => {
      const item = data.find(datum => datum.label === label && (datum.series || '数据') === seriesName);
      return item ? { x: plot.x + step * index, y: scaleY(item.value, domainMin, domainMax, plot), item } : null;
    }).filter((point): point is NonNullable<typeof point> => Boolean(point));
    const line = points.map((point, index) => `${index ? 'L' : 'M'}${fmt(point.x)} ${fmt(point.y)}`).join(' ');
    const area = `${line} L${fmt(points.at(-1)?.x || plot.x)} ${plot.y + plot.height} L${plot.x} ${plot.y + plot.height} Z`;
    const marks = points.map(point => `<g><circle cx="${fmt(point.x)}" cy="${fmt(point.y)}" r="6" fill="${PALETTE[seriesIndex % PALETTE.length]}"/>${data.length <= 10 ? `<text x="${fmt(point.x)}" y="${fmt(point.y - 14)}" text-anchor="middle" class="chart-value">${formatValue(point.item.value, spec.unit)}</text>` : ''}</g>`).join('');
    return `${spec.type === 'area' && seriesIndex === 0 ? `<path d="${area}" fill="${PALETTE[0]}" opacity=".14"/>` : ''}<path d="${line}" class="chart-line" pathLength="1" style="stroke:${PALETTE[seriesIndex % PALETTE.length]}"/>${marks}`;
  }).join('');
  const xLabels = labels.map((label, index) => `<text x="${fmt(plot.x + step * index)}" y="${plot.y + plot.height + 34}" text-anchor="middle" class="chart-label">${escapeText(truncate(label, 8))}</text>`).join('');
  const grid = [0, .25, .5, .75, 1].map(ratio => {
    const y = plot.y + plot.height * ratio;
    return `<line x1="${plot.x}" y1="${fmt(y)}" x2="${plot.x + plot.width}" y2="${fmt(y)}" class="chart-grid"/>`;
  }).join('');
  return `<svg viewBox="0 0 640 480" aria-hidden="true">${grid}${seriesPaths}${xLabels}${series.length > 1 ? renderSeriesLegend(series) : ''}</svg>`;
}

function renderScatter(spec: ChartSpec): string {
  const data = spec.data;
  const xs = data.map(item => item.x!);
  const ys = data.map(item => item.y!);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const plot = { x: 72, y: 42, width: 520, height: 340 };
  const marks = data.map((item, index) => {
    const x = plot.x + normalize(item.x!, minX, maxX) * plot.width;
    const y = plot.y + (1 - normalize(item.y!, minY, maxY)) * plot.height;
    const radius = item.size ? 5 + Math.sqrt(Math.max(0, item.size)) * 1.6 : 8;
    return `<g><circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(Math.min(radius, 24))}" fill="${PALETTE[index % PALETTE.length]}" opacity=".78"/><text x="${fmt(x)}" y="${fmt(y - radius - 8)}" text-anchor="middle" class="chart-label">${escapeText(truncate(item.label, 8))}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 640 480" aria-hidden="true"><line x1="${plot.x}" y1="${plot.y + plot.height}" x2="${plot.x + plot.width}" y2="${plot.y + plot.height}" class="chart-axis"/><line x1="${plot.x}" y1="${plot.y}" x2="${plot.x}" y2="${plot.y + plot.height}" class="chart-axis"/>${marks}</svg>`;
}

function renderProgress(spec: ChartSpec): string {
  const item = spec.data[0];
  const max = spec.max ?? 100;
  const ratio = Math.max(0, Math.min(1, item.value / max));
  return `<svg viewBox="0 0 640 480" aria-hidden="true"><text x="64" y="155" class="chart-progress-label">${escapeText(item.label)}</text><text x="576" y="155" text-anchor="end" class="chart-progress-value">${formatValue(item.value, spec.unit || '%')}</text><rect x="64" y="205" width="512" height="44" rx="22" fill="#d7cdbd"/><rect x="64" y="205" width="${fmt(512 * ratio)}" height="44" rx="22" fill="#b43924" class="chart-progress"/><text x="64" y="292" class="chart-label">目标 ${formatValue(max, spec.unit || '%')}</text></svg>`;
}

function extractNumericData(text: string): ChartDatum[] {
  const normalized = text.replace(/，/g, ',').replace(/：/g, ':').replace(/％/g, '%');
  const matches: ChartDatum[] = [];
  const pattern = /([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9\s·_-]{0,18}?)(?:占|为|达到|约|同比|环比|[:：])?\s*(-?\d+(?:\.\d+)?)\s*(%|万|亿|元|人|天|次|kg|g|ml|毫升)?/gu;
  for (const match of normalized.matchAll(pattern)) {
    let label = match[1].trim().replace(/[;,。；]+$/g, '').replace(/(?:占|为|达到|约|同比|环比)$/g, '').trim();
    label = label.split(/[;,。；]/).at(-1)?.trim() || label;
    const value = Number(match[2]);
    if (!label || !Number.isFinite(value)) continue;
    matches.push({ label: truncate(label, 20), value });
  }
  return matches;
}

function dedupeData(data: ChartDatum[]): ChartDatum[] {
  const seen = new Set<string>();
  return data.filter(item => {
    const key = `${item.label}:${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderSeriesLegend(series: string[]) {
  return series.map((name, index) => `<g transform="translate(${92 + index * 128} 452)"><circle r="6" fill="${PALETTE[index % PALETTE.length]}"/><text x="14" y="6" class="chart-tick">${escapeText(truncate(name, 10))}</text></g>`).join('');
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function chartRuntimeCss(): string {
  return `[data-role="visual-content"][data-ai-chart-rendered="true"]{display:grid!important;place-items:center!important;overflow:hidden!important}
[data-role="visual-content"][data-ai-chart-rendered="true"]>:not([data-ai-chart-renderer="true"]){display:none!important}
[data-ai-chart-renderer="true"]{display:block!important;position:relative!important;inset:auto!important;width:100%!important;height:100%!important;max-width:640px!important;max-height:544px!important;margin:0!important;padding:0!important;overflow:hidden!important;opacity:1!important;transform:none!important}
[data-ai-chart-renderer="true"] svg{display:block;width:100%;height:100%;overflow:visible;font-family:'Microsoft YaHei',sans-serif}
.chart-grid{stroke:#d7cdbd;stroke-width:1}.chart-axis{stroke:#706c63;stroke-width:1.5}.chart-label{fill:#171714;font-size:18px}.chart-value{fill:#171714;font-size:17px;font-weight:700}.chart-tick{fill:#706c63;font-size:14px}.chart-line{fill:none;stroke:#b43924;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;animation:ai-chart-line .7s ease-out forwards}.chart-bar{animation:ai-chart-bar .65s ease-out both}.chart-pie{transform-origin:220px 220px;animation:ai-chart-pie .65s ease-out both}.chart-progress{transform-origin:64px center;animation:ai-chart-progress .65s ease-out both}.chart-progress-label{fill:#171714;font-size:30px}.chart-progress-value{fill:#b43924;font-size:54px;font-weight:700}
@keyframes ai-chart-line{to{stroke-dashoffset:0}}@keyframes ai-chart-bar{from{transform:scaleY(0)}}@keyframes ai-chart-pie{from{opacity:0;transform:scale(.86)}}@keyframes ai-chart-progress{from{transform:scaleX(0)}}
@media(prefers-reduced-motion:reduce){.chart-line{stroke-dashoffset:0;animation:none}.chart-bar,.chart-pie,.chart-progress{animation:none}}`;
}

function polar(cx: number, cy: number, radius: number, degrees: number) {
  const radians = degrees * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function scaleY(value: number, min: number, max: number, plot: { y: number; height: number }) {
  return plot.y + (1 - normalize(value, min, max)) * plot.height;
}

function normalize(value: number, min: number, max: number) {
  return max === min ? .5 : (value - min) / (max - min);
}

function setTagAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(["']).*?\\1`, 'i');
  const attribute = ` ${name}="${escapeAttribute(value)}"`;
  return pattern.test(tag) ? tag.replace(pattern, attribute) : tag.replace(/>$/, `${attribute}>`);
}

function formatValue(value: number, unit = '') {
  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}${unit || ''}`;
}

function formatCompact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 100000000) return `${Number((value / 100000000).toFixed(1))}亿`;
  if (abs >= 10000) return `${Number((value / 10000).toFixed(1))}万`;
  return String(Number(value.toFixed(1)));
}

function fmt(value: number) {
  return String(Number(value.toFixed(2)));
}

function round(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function escapeText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string) {
  return escapeText(value).replace(/"/g, '&quot;');
}

export type { ChartDatum, ChartIssue, ChartSpec, ChartType, ChartValidationResult } from './types';
