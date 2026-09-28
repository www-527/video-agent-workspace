'use client';

import { Check, Pencil, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MessageAction, ProjectBrief } from '@/types';

export function BriefReviewCard({
  brief,
  actions,
  onAction,
}: {
  brief: ProjectBrief;
  actions: MessageAction[];
  onAction: (action: MessageAction) => void;
}) {
  return (
    <div className="min-w-64 space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">创作简报</p>
        <p className="mt-1 font-medium text-slate-950">{brief.goal}</p>
      </div>
      <dl className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">受众</dt><dd>{brief.targetAudience}</dd>
        <dt className="text-muted-foreground">平台</dt><dd>{platformLabel(brief.platform)}</dd>
        <dt className="text-muted-foreground">时长</dt><dd>约 {brief.durationSeconds} 秒</dd>
        <dt className="text-muted-foreground">语气</dt><dd>{brief.tone}</dd>
        <dt className="text-muted-foreground">核心信息</dt><dd>{brief.coreMessage}</dd>
        <dt className="text-muted-foreground">希望观众</dt><dd>{brief.desiredOutcome}</dd>
      </dl>
      {brief.assumptions.length ? (
        <details className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer font-medium text-slate-600">AI 暂定了 {brief.assumptions.length} 项</summary>
          <ul className="mt-1.5 space-y-1">
            {brief.assumptions.map(item => <li key={`${item.field}-${item.value}`}>{item.reason}</li>)}
          </ul>
        </details>
      ) : null}
      <div className="grid gap-1.5">
        {actions.slice(0, 3).map(action => (
          <Button
            key={action.id}
            type="button"
            size="sm"
            variant={action.id === 'brief_confirm' ? 'default' : action.id === 'brief_ai_decide' ? 'secondary' : 'outline'}
            className="justify-start"
            onClick={() => onAction(action)}
          >
            {action.id === 'brief_confirm' ? <Check className="mr-1.5 size-3.5" /> : null}
            {action.id === 'brief_edit' ? <Pencil className="mr-1.5 size-3.5" /> : null}
            {action.id === 'brief_ai_decide' ? <Sparkles className="mr-1.5 size-3.5" /> : null}
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function platformLabel(platform: ProjectBrief['platform']) {
  return ({
    douyin: '抖音',
    'video-account': '视频号',
    bilibili: 'B站',
    youtube: 'YouTube',
    general: '通用平台',
  })[platform];
}
