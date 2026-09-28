import { UI_SCENE_CSS } from '@/components/render/ui-scene';
import type { UISceneDocument } from './types';
import type { CanvasPresetId } from '@/types';
import { getCanvasPreset, portraitSafeAreaStyle } from '@/lib/canvas-presets';

export function renderUISceneHtml(scene: UISceneDocument, canvasPreset: CanvasPresetId = 'landscape-16-9'): string {
  const preset = getCanvasPreset(canvasPreset);
  const rootStyle = Object.entries(portraitSafeAreaStyle(canvasPreset))
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
  const title = text(scene.data.title, titleFor(scene.archetype));
  const subtitle = text(scene.data.subtitle, '业务数据工作台');
  const body = scene.archetype === 'overview'
    ? renderOverview(scene.data)
    : scene.archetype === 'master-detail'
    ? renderMasterDetail(scene.data)
    : scene.archetype === 'workflow'
    ? renderWorkflow(scene.data)
    : renderApproval(scene.data);
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=${preset.design.width},initial-scale=1"><style>${UI_SCENE_CSS}</style></head>
<body>
<main class="ui-scene" data-ui-archetype="${scene.archetype}" data-canvas-preset="${canvasPreset}"${rootStyle ? ` style="${rootStyle}"` : ''}>
  <header class="ui-header"><div><div class="ui-eyebrow">OPERATION CONSOLE</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>${scene.isDemoData ? '<div class="demo-badge">演示数据</div>' : ''}</header>
  ${body}
</main>
<script>
(function(){
  var steps=${safeJson(scene.interactions)};
  function apply(ms){
    document.querySelectorAll('[data-ui-id]').forEach(function(node){
      Array.from(node.classList).filter(function(name){return name==='ui-active'||name.indexOf('ui-action-')===0}).forEach(function(name){node.classList.remove(name)});
    });
    steps.filter(function(step){return step.atMs<=ms}).forEach(function(step){
      var target=document.querySelector('[data-ui-id="'+CSS.escape(step.target)+'"]');
      if(!target)return;
      target.classList.add('ui-active','ui-action-'+step.action);
      if(step.action==='filter'&&step.payload&&typeof step.payload.label==='string')target.textContent=step.payload.label;
    });
  }
  window.addEventListener('renderbridge:time',function(event){apply(event.detail.ms)});
})();
</script>
</body>
</html>`;
}

function renderOverview(data: Record<string, unknown>) {
  const metrics = records(data.metrics, [
    { id: 'metric-revenue', label: '本期收入', value: '¥ 2.84M', trend: '+12.6%' },
    { id: 'metric-risk', label: '待处理风险', value: '18', trend: '-3' },
    { id: 'metric-rate', label: '完成率', value: '86.4%', trend: '+4.2%' },
  ]);
  return `<div class="ui-stack"><section class="metric-grid">${metrics.map((metric, index) =>
    `<article class="metric-card" data-ui-id="${attr(text(metric.id, `metric-${index}`))}"><span>${html(metric.label, '指标')}</span><strong>${html(metric.value, '—')}</strong><em>${html(metric.trend, '0%')}</em></article>`).join('')}</section>
    <section class="overview-grid">${trendChart()}${dataTable(data)}</section></div>`;
}

function renderMasterDetail(data: Record<string, unknown>) {
  const rows = records(data.rows, defaultRows());
  const selected = rows[0] || {};
  return `<section class="master-detail">${dataTable({ ...data, rows }, true)}
    <aside class="detail-panel" data-ui-id="${attr(text(selected.id, 'detail'))}"><div class="panel-kicker">DETAIL</div><h2>${html(selected.name, '对象详情')}</h2>${statusTag(selected.status)}
    <div class="detail-value">${html(selected.value, '—')}</div>${progress(selected.progress, 72)}
    <div class="risk-notice"><strong>风险提示</strong><span>${html(selected.reason, '当前指标存在短期波动，建议复核最近一次数据变更。')}</span></div>
    <div class="timeline"><div><i></i><span>09:30 数据更新</span></div><div><i></i><span>10:12 规则命中</span></div><div><i></i><span>10:18 等待复核</span></div></div></aside></section>`;
}

function renderWorkflow(data: Record<string, unknown>) {
  const items = records(data.workflow, [
    { id: 'step-input', label: '数据接入', status: 'completed', progress: 100 },
    { id: 'step-check', label: '规则校验', status: 'active', progress: 62 },
    { id: 'step-approval', label: '人工审批', status: 'pending', progress: 0 },
    { id: 'step-execute', label: '执行归档', status: 'pending', progress: 0 },
  ]);
  return `<section class="workflow-board">${items.map((item, index) =>
    `<article data-ui-id="${attr(text(item.id, `step-${index}`))}"><div class="workflow-index">${String(index + 1).padStart(2, '0')}</div><h2>${html(item.label, `步骤 ${index + 1}`)}</h2>${statusTag(item.status)}${progress(item.progress, 0)}</article>`).join('')}</section>`;
}

function renderApproval(data: Record<string, unknown>) {
  return `<section class="approval-grid"><article class="risk-column"><div class="panel-kicker">SIGNAL</div><h2>${html(data.riskTitle, '检测到异常波动')}</h2><div class="large-stat">${html(data.riskValue, '+28.4%')}</div>
  <div class="risk-notice"><strong>风险提示</strong><span>${html(data.riskReason, '过去 24 小时内，异常订单集中来自同一渠道。')}</span></div>${trendChart()}</article>
  <article class="suggestion-card" data-ui-id="ai-suggestion"><div class="ai-orb">AI</div><div class="panel-kicker">RECOMMENDATION</div><h2>${html(data.suggestionTitle, '建议暂缓自动执行')}</h2>
  <p>${html(data.suggestion, '先隔离高风险订单，并将渠道阈值从 80 调整至 65，等待人工复核。')}</p>
  <div class="reason-box" data-ui-id="suggestion-reason"><strong>判断依据</strong><span>${html(data.reason, '风险集中度高于历史均值 2.7 个标准差。')}</span></div>
  <div class="confirm-area" data-ui-id="confirm-execution"><button type="button">确认执行</button><span>需要负责人确认</span></div></article></section>`;
}

function dataTable(data: Record<string, unknown>, compact = false) {
  const rows = records(data.rows, defaultRows());
  return `<article class="table-card${compact ? ' compact' : ''}"><div class="card-title"><span>业务明细</span><span class="filter-chip" data-ui-id="table-filter">全部</span></div>
  <div class="table-head"><span>对象</span><span>状态</span><span>指标</span></div>${rows.map((row, index) =>
    `<div class="table-row" data-ui-id="${attr(text(row.id, `row-${index}`))}"><strong>${html(row.name, `对象 ${index + 1}`)}</strong>${statusTag(row.status)}<span>${html(row.value, '—')}</span></div>`).join('')}</article>`;
}

function trendChart() {
  return `<article class="chart-card"><div class="card-title"><span>趋势变化</span>${statusTag('近 7 日')}</div><svg viewBox="0 0 640 220" role="img" aria-label="趋势图"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38bdf8" stop-opacity=".38"></stop><stop offset="1" stop-color="#38bdf8" stop-opacity="0"></stop></linearGradient></defs><path class="grid-line" d="M20 45H620M20 110H620M20 175H620"></path><path class="chart-area" d="M20 178 C90 160 112 110 176 126 S270 168 326 98 S430 38 478 82 S560 118 620 40 L620 210 L20 210Z"></path><path class="chart-line" d="M20 178 C90 160 112 110 176 126 S270 168 326 98 S430 38 478 82 S560 118 620 40"></path></svg></article>`;
}

function statusTag(value: unknown) {
  const label = text(value, '正常');
  return `<span class="status-tag${/高|异常|关注|failed/i.test(label) ? ' danger' : ''}">${escapeHtml(label)}</span>`;
}

function progress(value: unknown, fallback: number) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return `<div class="progress-track"><span style="width:${Math.max(0, Math.min(100, number))}%"></span></div>`;
}

function defaultRows(): Record<string, unknown>[] {
  return [
    { id: 'row-1', name: '华东区域', status: '正常', value: '96.2%' },
    { id: 'row-2', name: '华南区域', status: '需关注', value: '71.8%' },
    { id: 'row-3', name: '北方区域', status: '正常', value: '89.5%' },
  ];
}

function records(value: unknown, fallback: Record<string, unknown>[]) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Record<string, unknown>[] : fallback;
}

function titleFor(archetype: UISceneDocument['archetype']) {
  return ({ overview: '经营数据总览', 'master-detail': '业务对象详情', workflow: '流程执行看板', 'ai-approval': 'AI 建议与审批' })[archetype];
}

function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function html(value: unknown, fallback: string) {
  return escapeHtml(text(value, fallback));
}

function attr(value: string) {
  return escapeHtml(value);
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '--\\>');
}
