'use client';

import { Check, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChangeSetSummary, MessageAction } from '@/types';

export function ChangeSetCard({
  changeSet,
  actions,
  onAction,
}: {
  changeSet: ChangeSetSummary;
  actions: MessageAction[];
  onAction: (action: MessageAction) => void;
}) {
  const impact = changeSet.impact;
  return (
    <div className="min-w-64 space-y-3">
      <div className="flex items-start gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="size-4" />
        </span>
        <div>
          <p className="font-medium text-slate-950">{changeSet.summary.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{changeSet.summary.description}</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-1.5 text-xs">
        <Impact label="影响镜头" value={impact.affectedFrameIds.length} />
        <Impact label="保留镜头" value={impact.preservedFrameCount} />
        <Impact label="重做画面" value={impact.visualRegenerationCount} />
        <Impact label="重做旁白" value={impact.audioRegenerationCount} />
      </dl>
      {impact.warnings.length ? (
        <div className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
          {impact.warnings.map(warning => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">确认时会先保存检查点；项目已变化时系统会拒绝应用。</p>
      {actions.map(action => (
        <Button
          key={action.id}
          type="button"
          size="sm"
          className="w-full"
          disabled={action.disabled || changeSet.status !== 'proposed'}
          onClick={() => onAction(action)}
        >
          <Check className="mr-1.5 size-3.5" />
          {changeSet.status === 'proposed' ? action.label : statusLabel(changeSet.status)}
        </Button>
      ))}
    </div>
  );
}

export function CheckpointCard({
  checkpointId,
  canRevert,
  actions,
  onAction,
}: {
  checkpointId: string;
  canRevert: boolean;
  actions: MessageAction[];
  onAction: (action: MessageAction) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-emerald-800">
        <ShieldCheck className="size-4" />
        <span>应用前状态已安全保存</span>
      </div>
      <p className="text-[10px] text-muted-foreground">检查点 {checkpointId.slice(0, 8)}</p>
      {actions.map(action => (
        <Button key={action.id} type="button" size="sm" variant="outline" disabled={!canRevert || action.disabled} onClick={() => onAction(action)}>
          <RotateCcw className="mr-1.5 size-3.5" />{canRevert ? action.label : '已撤销'}
        </Button>
      ))}
    </div>
  );
}

function Impact({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-slate-50 px-2 py-1.5"><dt className="text-[10px] text-muted-foreground">{label}</dt><dd className="font-semibold text-slate-900">{value}</dd></div>;
}

function statusLabel(status: ChangeSetSummary['status']) {
  if (status === 'applied') return '已应用';
  if (status === 'reverted') return '已撤销';
  if (status === 'stale') return '方案已过期';
  if (status === 'failed') return '应用失败';
  return '正在应用';
}
