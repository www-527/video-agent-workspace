'use client';

import { Button } from '@/components/ui/button';
import type { BriefQuestion, MessageAction } from '@/types';

export function ClarificationCard({
  question,
  actions,
  onAction,
}: {
  question: BriefQuestion;
  actions: MessageAction[];
  onAction: (action: MessageAction) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium text-slate-900">{question.question}</p>
        <p className="mt-1 text-xs text-muted-foreground">只需要选一个；如果不想决定，可以交给 AI。</p>
      </div>
      <div className="grid gap-1.5">
        {actions.map((action, index) => {
          const choice = question.choices[index];
          return (
            <Button
              key={action.value || action.label}
              type="button"
              variant={action.variant === 'secondary' ? 'secondary' : 'outline'}
              className="h-auto justify-start px-3 py-2 text-left"
              onClick={() => onAction(action)}
            >
              <span>
                <span className="block text-xs font-medium">{action.label}</span>
                {choice?.effect ? <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">{choice.effect}</span> : null}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
