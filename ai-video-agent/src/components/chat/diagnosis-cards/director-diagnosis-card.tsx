'use client';

import { AlertTriangle, CheckCircle2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DirectorDiagnosis, MessageAction } from '@/types';

export function DirectorDiagnosisCard({
  diagnosis,
  actions,
  onAction,
}: {
  diagnosis: DirectorDiagnosis;
  actions: MessageAction[];
  onAction: (action: MessageAction) => void;
}) {
  const recommended = diagnosis.options.find(option => option.id === diagnosis.recommendedOptionId);
  return (
    <div className="min-w-64 space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">导演检查</p>
        <p className="mt-1 text-sm font-medium text-slate-950">{diagnosis.summary}</p>
      </div>

      {diagnosis.issues.length ? (
        <div className="space-y-1.5">
          {diagnosis.issues.slice(0, 3).map(issue => (
            <div key={issue.id} className="flex gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs">
              {issue.severity === 'blocking' ? (
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              ) : (
                <span className={cn('mt-1 size-2 shrink-0 rounded-full', issue.severity === 'important' ? 'bg-amber-400' : 'bg-slate-300')} />
              )}
              <span>{issue.userFacingExplanation}</span>
            </div>
          ))}
          {diagnosis.issues.length > 3 ? (
            <details className="text-xs text-muted-foreground">
              <summary className="flex cursor-pointer items-center gap-1">另外 {diagnosis.issues.length - 3} 个问题 <ChevronDown className="size-3" /></summary>
              <div className="mt-1.5 space-y-1.5">
                {diagnosis.issues.slice(3).map(issue => <p key={issue.id}>{issue.userFacingExplanation}</p>)}
              </div>
            </details>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="size-3.5" />没有发现明确故障
        </div>
      )}

      {recommended ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-primary">推荐：{recommended.label}</p>
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">推荐</span>
          </div>
          <p className="mt-1 text-xs text-slate-700">{recommended.description}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{recommended.expectedImpact}</p>
        </div>
      ) : null}

      {diagnosis.issues.some(issue => issue.technicalEvidence) ? (
        <details className="rounded-lg border px-2.5 py-2 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">查看检查依据</summary>
          <ul className="mt-1.5 space-y-1">
            {diagnosis.issues.filter(issue => issue.technicalEvidence).map(issue => (
              <li key={issue.id}>{issue.userFacingExplanation}（{issue.evidenceFrameIds.length} 个相关镜头）</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="grid gap-1.5">
        {actions.map(action => (
          <Button
            key={action.id}
            type="button"
            size="sm"
            variant={action.id === 'diagnosis_recommend' ? 'default' : action.id === 'diagnosis_skip' ? 'secondary' : 'outline'}
            className="justify-start"
            onClick={() => onAction(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
