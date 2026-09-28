import type { UISceneDocument } from '@/lib/render/types';
import type { CanvasPresetId, UIInteractionStep } from '@/types';
import type { CSSProperties } from 'react';
import { portraitSafeAreaStyle } from '@/lib/canvas-presets';

interface UISceneCanvasProps {
  scene: UISceneDocument;
  timeMs?: number;
  canvasPreset?: CanvasPresetId;
}

export function UISceneCanvas({ scene, timeMs = 0, canvasPreset = 'landscape-16-9' }: UISceneCanvasProps) {
  const portraitStyle = portraitSafeAreaStyle(canvasPreset) as CSSProperties;
  const active = scene.interactions.filter(step => step.atMs <= timeMs);
  const activeIds = new Set(active.map(step => step.target));
  const latestAction = new Map<string, UIInteractionStep['action']>();
  active.forEach(step => latestAction.set(step.target, step.action));
  const title = stringValue(scene.data.title, archetypeTitle(scene.archetype));
  const subtitle = stringValue(scene.data.subtitle, '业务数据工作台');
  const metrics = arrayValue(scene.data.metrics, [
    { id: 'metric-revenue', label: '本期收入', value: '¥ 2.84M', trend: '+12.6%' },
    { id: 'metric-risk', label: '待处理风险', value: '18', trend: '-3' },
    { id: 'metric-rate', label: '完成率', value: '86.4%', trend: '+4.2%' },
  ]);
  const rows = arrayValue(scene.data.rows, [
    { id: 'row-1', name: '华东区域', status: '正常', value: '96.2%', risk: '低' },
    { id: 'row-2', name: '华南区域', status: '需关注', value: '71.8%', risk: '高' },
    { id: 'row-3', name: '北方区域', status: '正常', value: '89.5%', risk: '中' },
  ]);
  const workflow = arrayValue(scene.data.workflow, [
    { id: 'step-input', label: '数据接入', status: 'completed' },
    { id: 'step-check', label: '规则校验', status: 'active' },
    { id: 'step-approval', label: '人工审批', status: 'pending' },
    { id: 'step-execute', label: '执行归档', status: 'pending' },
  ]);

  return (
    <main className="ui-scene" data-ui-archetype={scene.archetype} data-canvas-preset={canvasPreset} style={portraitStyle}>
      <style dangerouslySetInnerHTML={{ __html: UI_SCENE_CSS }} />
      <header className="ui-header">
        <div>
          <div className="ui-eyebrow">OPERATION CONSOLE</div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {scene.isDemoData ? <div className="demo-badge">演示数据</div> : null}
      </header>
      {scene.archetype === 'overview' ? (
        <Overview metrics={metrics} rows={rows} activeIds={activeIds} latestAction={latestAction} />
      ) : null}
      {scene.archetype === 'master-detail' ? (
        <MasterDetail rows={rows} activeIds={activeIds} latestAction={latestAction} />
      ) : null}
      {scene.archetype === 'workflow' ? (
        <Workflow items={workflow} activeIds={activeIds} latestAction={latestAction} />
      ) : null}
      {scene.archetype === 'ai-approval' ? (
        <AIApproval data={scene.data} activeIds={activeIds} latestAction={latestAction} />
      ) : null}
    </main>
  );
}

function Overview({ metrics, rows, activeIds, latestAction }: SharedDataProps) {
  return (
    <div className="ui-stack">
      <section className="metric-grid">
        {metrics.map((metric, index) => (
          <MetricCard key={String(metric.id || index)} item={metric} uiId={String(metric.id || `metric-${index}`)} activeIds={activeIds} latestAction={latestAction} />
        ))}
      </section>
      <section className="overview-grid">
        <TrendChart />
        <DataTable rows={rows} activeIds={activeIds} latestAction={latestAction} />
      </section>
    </div>
  );
}

function MasterDetail({ rows, activeIds, latestAction }: Pick<SharedDataProps, 'rows' | 'activeIds' | 'latestAction'>) {
  const selected = rows.find(row => activeIds.has(String(row.id))) || rows[0] || {};
  return (
    <section className="master-detail">
      <DataTable rows={rows} activeIds={activeIds} latestAction={latestAction} compact />
      <aside className="detail-panel" data-ui-id={String(selected.id || 'detail')}>
        <div className="panel-kicker">DETAIL</div>
        <h2>{stringValue(selected.name, '对象详情')}</h2>
        <StatusTag value={stringValue(selected.status, '正常')} />
        <div className="detail-value">{stringValue(selected.value, '—')}</div>
        <ProgressBar value={numberValue(selected.progress, 72)} />
        <RiskNotice text={stringValue(selected.reason, '当前指标存在短期波动，建议复核最近一次数据变更。')} />
        <Timeline />
      </aside>
    </section>
  );
}

function Workflow({ items, activeIds, latestAction }: {
  items: Record<string, unknown>[];
  activeIds: Set<string>;
  latestAction: Map<string, UIInteractionStep['action']>;
}) {
  return (
    <section className="workflow-board">
      {items.map((item, index) => {
        const id = String(item.id || `step-${index}`);
        return (
          <article key={id} className={stateClass(activeIds.has(id), latestAction.get(id))} data-ui-id={id}>
            <div className="workflow-index">{String(index + 1).padStart(2, '0')}</div>
            <h2>{stringValue(item.label, `步骤 ${index + 1}`)}</h2>
            <StatusTag value={stringValue(item.status, 'pending')} />
            <ProgressBar value={numberValue(item.progress, index === 0 ? 100 : index === 1 ? 62 : 0)} />
          </article>
        );
      })}
    </section>
  );
}

function AIApproval({ data, activeIds, latestAction }: {
  data: Record<string, unknown>;
  activeIds: Set<string>;
  latestAction: Map<string, UIInteractionStep['action']>;
}) {
  const suggestionId = 'ai-suggestion';
  const confirmId = 'confirm-execution';
  return (
    <section className="approval-grid">
      <article className="risk-column">
        <div className="panel-kicker">SIGNAL</div>
        <h2>{stringValue(data.riskTitle, '检测到异常波动')}</h2>
        <div className="large-stat">{stringValue(data.riskValue, '+28.4%')}</div>
        <RiskNotice text={stringValue(data.riskReason, '过去 24 小时内，异常订单集中来自同一渠道。')} />
        <TrendChart />
      </article>
      <article
        className={`suggestion-card ${stateClass(activeIds.has(suggestionId), latestAction.get(suggestionId))}`}
        data-ui-id={suggestionId}
      >
        <div className="ai-orb">AI</div>
        <div className="panel-kicker">RECOMMENDATION</div>
        <h2>{stringValue(data.suggestionTitle, '建议暂缓自动执行')}</h2>
        <p>{stringValue(data.suggestion, '先隔离高风险订单，并将渠道阈值从 80 调整至 65，等待人工复核。')}</p>
        <div className="reason-box" data-ui-id="suggestion-reason">
          <strong>判断依据</strong>
          <span>{stringValue(data.reason, '风险集中度高于历史均值 2.7 个标准差。')}</span>
        </div>
        <div className={`confirm-area ${stateClass(activeIds.has(confirmId), latestAction.get(confirmId))}`} data-ui-id={confirmId}>
          <button type="button">确认执行</button>
          <span>{activeIds.has(confirmId) ? '已确认 · 等待系统回执' : '需要负责人确认'}</span>
        </div>
      </article>
    </section>
  );
}

interface SharedDataProps {
  metrics: Record<string, unknown>[];
  rows: Record<string, unknown>[];
  activeIds: Set<string>;
  latestAction: Map<string, UIInteractionStep['action']>;
}

function MetricCard({ item, uiId, activeIds, latestAction }: {
  item: Record<string, unknown>;
  uiId: string;
  activeIds: Set<string>;
  latestAction: Map<string, UIInteractionStep['action']>;
}) {
  return (
    <article className={`metric-card ${stateClass(activeIds.has(uiId), latestAction.get(uiId))}`} data-ui-id={uiId}>
      <span>{stringValue(item.label, '指标')}</span>
      <strong>{stringValue(item.value, '—')}</strong>
      <em>{stringValue(item.trend, '0%')}</em>
    </article>
  );
}

function TrendChart() {
  return (
    <article className="chart-card">
      <div className="card-title"><span>趋势变化</span><StatusTag value="近 7 日" /></div>
      <svg viewBox="0 0 640 220" role="img" aria-label="趋势图">
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#38bdf8" stopOpacity=".38" />
            <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="grid-line" d="M20 45H620M20 110H620M20 175H620" />
        <path className="chart-area" d="M20 178 C90 160 112 110 176 126 S270 168 326 98 S430 38 478 82 S560 118 620 40 L620 210 L20 210Z" />
        <path className="chart-line" d="M20 178 C90 160 112 110 176 126 S270 168 326 98 S430 38 478 82 S560 118 620 40" />
      </svg>
    </article>
  );
}

function DataTable({ rows, activeIds, latestAction, compact = false }: {
  rows: Record<string, unknown>[];
  activeIds: Set<string>;
  latestAction: Map<string, UIInteractionStep['action']>;
  compact?: boolean;
}) {
  return (
    <article className={`table-card ${compact ? 'compact' : ''}`}>
      <div className="card-title"><span>业务明细</span><span className="filter-chip" data-ui-id="table-filter">全部</span></div>
      <div className="table-head"><span>对象</span><span>状态</span><span>指标</span></div>
      {rows.map((row, index) => {
        const id = String(row.id || `row-${index}`);
        return (
          <div key={id} className={`table-row ${stateClass(activeIds.has(id), latestAction.get(id))}`} data-ui-id={id}>
            <strong>{stringValue(row.name, `对象 ${index + 1}`)}</strong>
            <StatusTag value={stringValue(row.status, '正常')} />
            <span>{stringValue(row.value, '—')}</span>
          </div>
        );
      })}
    </article>
  );
}

function StatusTag({ value }: { value: string }) {
  const danger = /高|异常|关注|failed/i.test(value);
  return <span className={`status-tag ${danger ? 'danger' : ''}`}>{value}</span>;
}

function ProgressBar({ value }: { value: number }) {
  return <div className="progress-track"><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

function RiskNotice({ text }: { text: string }) {
  return <div className="risk-notice"><strong>风险提示</strong><span>{text}</span></div>;
}

function Timeline() {
  return (
    <div className="timeline">
      <div><i /><span>09:30 数据更新</span></div>
      <div><i /><span>10:12 规则命中</span></div>
      <div><i /><span>10:18 等待复核</span></div>
    </div>
  );
}

function stateClass(active: boolean, action?: UIInteractionStep['action']) {
  return active ? `ui-active ui-action-${action || 'active'}` : '';
}

function arrayValue(value: unknown, fallback: Record<string, unknown>[]): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Record<string, unknown>[] : fallback;
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function archetypeTitle(archetype: UISceneDocument['archetype']) {
  return {
    overview: '经营数据总览',
    'master-detail': '业务对象详情',
    workflow: '流程执行看板',
    'ai-approval': 'AI 建议与审批',
  }[archetype];
}

export const UI_SCENE_CSS = `
  :root{color-scheme:dark;font-family:Inter,"Microsoft YaHei",sans-serif}
  *{box-sizing:border-box}.ui-scene{width:100%;height:100%;overflow:hidden;color:#eaf6ff;background:
  radial-gradient(circle at 82% 12%,rgba(14,165,233,.16),transparent 34%),#07111e;padding:46px 54px 42px}
  .ui-header{height:94px;display:flex;align-items:flex-start;justify-content:space-between}.ui-eyebrow,.panel-kicker{font-size:11px;letter-spacing:.2em;color:#38bdf8;font-weight:800}
  h1{font-size:34px;line-height:1.05;margin:8px 0 5px}h2{font-size:22px;margin:8px 0 14px}.ui-header p{margin:0;color:#7f9bb0;font-size:14px}
  .demo-badge{padding:8px 13px;border-radius:999px;border:1px solid rgba(56,189,248,.45);background:rgba(14,165,233,.1);color:#7dd3fc;font-size:13px;font-weight:700}
  .ui-stack{display:flex;flex-direction:column;gap:18px}.metric-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.metric-card,.chart-card,.table-card,.detail-panel,.workflow-board article,.risk-column,.suggestion-card{
  border:1px solid rgba(148,183,207,.16);background:linear-gradient(145deg,rgba(20,38,57,.95),rgba(10,25,40,.94));box-shadow:0 20px 50px rgba(0,0,0,.16);border-radius:16px}
  .metric-card{height:116px;padding:20px 22px;position:relative}.metric-card span{display:block;color:#8da6b8;font-size:13px}.metric-card strong{display:block;margin-top:9px;font-size:28px}.metric-card em{position:absolute;right:20px;bottom:22px;color:#34d399;font-size:13px;font-style:normal}
  .overview-grid{display:grid;grid-template-columns:1.25fr .9fr;gap:18px;height:376px}.chart-card,.table-card{padding:20px}.card-title{display:flex;align-items:center;justify-content:space-between;font-weight:700;margin-bottom:13px}.chart-card svg{width:100%;height:280px}
  .grid-line{stroke:rgba(148,183,207,.12);stroke-width:1}.chart-area{fill:url(#area)}.chart-line{fill:none;stroke:#38bdf8;stroke-width:4;stroke-linecap:round}
  .filter-chip,.status-tag{display:inline-flex;padding:5px 8px;border-radius:999px;background:rgba(52,211,153,.1);color:#6ee7b7;font-size:11px;font-weight:700}.status-tag.danger{background:rgba(251,113,133,.12);color:#fda4af}
  .table-head,.table-row{display:grid;grid-template-columns:1.25fr .8fr .65fr;align-items:center;gap:8px}.table-head{height:38px;color:#668299;font-size:11px;text-transform:uppercase}.table-row{min-height:67px;border-top:1px solid rgba(148,183,207,.1);font-size:13px}.table-row>span:last-child{text-align:right;font-variant-numeric:tabular-nums}
  .master-detail{height:510px;display:grid;grid-template-columns:1.1fr .9fr;gap:18px}.master-detail>.table-card,.detail-panel{height:510px}.detail-panel{padding:26px}.detail-value{font-size:42px;font-weight:800;margin:28px 0 13px}.progress-track{height:8px;border-radius:999px;background:#152a3c;overflow:hidden}.progress-track span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#0ea5e9,#34d399)}
  .risk-notice{margin-top:23px;padding:14px;border-left:3px solid #fb7185;background:rgba(251,113,133,.08);display:flex;flex-direction:column;gap:5px;font-size:12px;color:#9db3c3}.risk-notice strong{color:#fda4af}
  .timeline{margin-top:22px;display:flex;flex-direction:column;gap:12px;color:#7893a8;font-size:12px}.timeline div{display:flex;align-items:center;gap:9px}.timeline i{width:7px;height:7px;border-radius:50%;background:#38bdf8;box-shadow:0 0 0 4px rgba(56,189,248,.1)}
  .workflow-board{height:500px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;align-items:center;background:transparent;border:0;box-shadow:none}.workflow-board article{height:328px;padding:26px;position:relative}.workflow-board article:not(:last-child):after{content:"";position:absolute;left:100%;top:50%;width:17px;height:1px;background:#2d516b}.workflow-index{font-size:50px;font-weight:900;color:rgba(56,189,248,.14);margin-bottom:64px}
  .workflow-board .progress-track{margin-top:70px}.approval-grid{height:510px;display:grid;grid-template-columns:.9fr 1.1fr;gap:18px}.risk-column,.suggestion-card{padding:27px}.large-stat{font-size:54px;font-weight:900;color:#fda4af}.risk-column .chart-card{border:0;background:transparent;box-shadow:none;padding:10px 0}.risk-column .chart-card .card-title{display:none}.risk-column .chart-card svg{height:150px}
  .suggestion-card{position:relative}.ai-orb{position:absolute;right:28px;top:25px;width:52px;height:52px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(135deg,#38bdf8,#8b5cf6);font-weight:900}.suggestion-card>p{color:#9db3c3;line-height:1.8;font-size:15px;max-width:570px}
  .reason-box{margin-top:28px;padding:18px;border-radius:12px;background:rgba(56,189,248,.07);display:flex;flex-direction:column;gap:8px;color:#93aec2;font-size:13px}.reason-box strong{color:#7dd3fc}
  .confirm-area{margin-top:25px;display:flex;align-items:center;gap:16px}.confirm-area button{border:0;border-radius:10px;padding:12px 22px;background:#1e3a4e;color:#7091a8;font-weight:800}.confirm-area span{font-size:12px;color:#607f95}
  .ui-active{border-color:rgba(56,189,248,.8)!important;box-shadow:0 0 0 2px rgba(56,189,248,.18),0 22px 55px rgba(2,132,199,.15)!important}
  .ui-action-highlight-anomaly{border-color:#fb7185!important;box-shadow:0 0 0 2px rgba(251,113,133,.18)!important}.ui-action-confirm-execution button{background:#10b981;color:#04120e}.ui-action-confirm-execution span{color:#6ee7b7}
  .ui-action-open-detail,.ui-action-expand-reason,.ui-action-generate-suggestion{transform:translateY(-2px)}body{margin:0;background:#07111e}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .ui-header{height:150px;display:block}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .ui-header h1{font-size:42px;max-width:520px}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .demo-badge{position:absolute;right:var(--ui-safe-right);top:var(--ui-safe-top)}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .metric-grid{grid-template-columns:repeat(2,1fr)}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .metric-card{height:126px}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .overview-grid{grid-template-columns:1fr;height:560px}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .overview-grid .chart-card{height:290px}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .chart-card svg{height:210px}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .master-detail{height:690px;grid-template-columns:1fr;grid-template-rows:330px 340px}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .master-detail>.table-card,.ui-scene[data-canvas-preset="douyin-portrait-9-16"] .detail-panel{height:auto}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .detail-panel{padding:20px}.ui-scene[data-canvas-preset="douyin-portrait-9-16"] .detail-value{font-size:34px;margin:14px 0 10px}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .timeline{display:none}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .workflow-board{height:690px;grid-template-columns:1fr 1fr;gap:16px}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .workflow-board article{height:250px;padding:22px}.ui-scene[data-canvas-preset="douyin-portrait-9-16"] .workflow-board article:after{display:none}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .workflow-index{margin-bottom:24px;font-size:42px}.ui-scene[data-canvas-preset="douyin-portrait-9-16"] .workflow-board .progress-track{margin-top:30px}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .approval-grid{height:690px;grid-template-columns:1fr;grid-template-rows:300px 370px}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .risk-column,.ui-scene[data-canvas-preset="douyin-portrait-9-16"] .suggestion-card{padding:22px}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .risk-column .chart-card{display:none}.ui-scene[data-canvas-preset="douyin-portrait-9-16"] .large-stat{font-size:46px}
  .ui-scene[data-canvas-preset="douyin-portrait-9-16"] .suggestion-card>p{font-size:14px;line-height:1.6}.ui-scene[data-canvas-preset="douyin-portrait-9-16"] .reason-box{margin-top:18px;padding:14px}
`;
