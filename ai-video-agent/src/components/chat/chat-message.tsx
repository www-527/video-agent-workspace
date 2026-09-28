'use client';

import { useState } from 'react';
import { Bot, Loader2, User } from 'lucide-react';
import { ChatActions } from '@/components/chat/chat-actions';
import { FrameReviewCard } from '@/components/chat/frame-review-card';
import { FrameStructureReviewCard } from '@/components/chat/frame-structure-review-card';
import { FrameTuneReviewCard } from '@/components/chat/frame-tune-review-card';
import { ClarificationCard } from '@/components/chat/brief-cards/clarification-card';
import { BriefReviewCard } from '@/components/chat/brief-cards/brief-review-card';
import { DirectorDiagnosisCard } from '@/components/chat/diagnosis-cards/director-diagnosis-card';
import { ChangeSetCard, CheckpointCard } from '@/components/chat/change-set-cards/change-set-card';
import { OutlineCard } from '@/components/outline/outline-card';
import { OutlineDialog } from '@/components/outline/outline-dialog';
import { Progress } from '@/components/ui/progress';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { ChatMessage, FrameReviewDraft, MessageAction, MessageMetadata, ProjectDetail } from '@/types';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  project: ProjectDetail;
  onProjectChange: (p: ProjectDetail) => void;
  onAction?: (action: MessageAction) => void;
  onSendText?: (text: string) => void;
  onRewriteDraft?: (text: string, draft: FrameReviewDraft) => void;
  onAppendAssistantText?: (text: string) => void | Promise<void>;
}

export function ChatMessageBubble({
  message,
  project,
  onProjectChange,
  onAction,
  onSendText,
  onRewriteDraft,
  onAppendAssistantText,
}: ChatMessageBubbleProps) {
  const isUser = message.role === 'user';
  const [outlineOpen, setOutlineOpen] = useState(false);
  const actions = message.metadata && 'actions' in message.metadata ? message.metadata.actions : undefined;
  const hasActions = Boolean(actions?.length);

  function handleAction(action: MessageAction) {
    if (action.id === 'view_outline') {
      setOutlineOpen(true);
      return;
    }
    onAction?.({ ...action, sourceMessageId: message.id });
  }

  return (
    <div className={cn('flex w-full gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-slate-200 text-slate-700' : 'bg-primary/10 text-primary',
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cn('flex max-w-[85%] flex-col', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-2xl px-3 py-2 text-sm shadow-sm',
            isUser
              ? 'rounded-tr-sm bg-slate-100 text-slate-900'
              : 'rounded-tl-sm border bg-white',
          )}
        >
          {message.metadata?.kind === 'outline' && (
            <div className="space-y-2">
              {message.content ? <p className="whitespace-pre-wrap break-words">{message.content}</p> : null}
              <OutlineCard outline={message.metadata.outline} project={project} onProjectChange={onProjectChange} />
            </div>
          )}

          {message.metadata?.kind === 'frame_progress' && (
            <ProgressCard metadata={message.metadata} />
          )}

          {message.metadata?.kind === 'asset_summary' && (
            <div className="space-y-2">
              {message.content ? <p className="whitespace-pre-wrap break-words">{message.content}</p> : null}
              <div className="flex flex-wrap gap-1">
                {message.metadata.assets.map(asset => (
                  <span key={asset.id} className="max-w-full truncate rounded-full border bg-slate-50 px-2 py-0.5 text-[11px] text-muted-foreground">
                    {asset.originalName}
                  </span>
                ))}
              </div>
            </div>
          )}

          {message.metadata?.kind === 'clarification' && (
            <ClarificationCard
              question={message.metadata.question}
              actions={message.metadata.actions}
              onAction={handleAction}
            />
          )}

          {message.metadata?.kind === 'brief_review' && (
            <BriefReviewCard
              brief={message.metadata.brief}
              actions={message.metadata.actions}
              onAction={handleAction}
            />
          )}

          {message.metadata?.kind === 'director_diagnosis' && (
            <DirectorDiagnosisCard
              diagnosis={message.metadata.diagnosis}
              actions={message.metadata.actions}
              onAction={handleAction}
            />
          )}

          {message.metadata?.kind === 'change_set' && (
            <ChangeSetCard
              changeSet={message.metadata.changeSet}
              actions={message.metadata.actions}
              onAction={handleAction}
            />
          )}

          {message.metadata?.kind === 'checkpoint' && (
            <CheckpointCard
              checkpointId={message.metadata.checkpointId}
              canRevert={message.metadata.canRevert}
              actions={message.metadata.actions}
              onAction={handleAction}
            />
          )}

          {message.metadata?.kind === 'frame_review' && (
            <FrameReviewCard
              draft={message.metadata.draft}
              project={project}
              onProjectChange={onProjectChange}
              onSendText={onSendText}
              onRewriteDraft={onRewriteDraft}
              onAppendAssistantText={onAppendAssistantText}
            />
          )}

          {message.metadata?.kind === 'frame_structure_review' && (
            <FrameStructureReviewCard
              draft={message.metadata.draft}
              project={project}
              onProjectChange={onProjectChange}
              onAppendAssistantText={onAppendAssistantText}
            />
          )}

          {message.metadata?.kind === 'frame_tune_review' && (
            <FrameTuneReviewCard
              draft={message.metadata.draft}
              project={project}
              onProjectChange={onProjectChange}
              onSendText={onSendText}
              onRewriteDraft={onRewriteDraft}
              onAppendAssistantText={onAppendAssistantText}
            />
          )}

          {message.metadata?.kind === 'error' && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1 text-xs text-destructive">
              {message.metadata.message}
            </div>
          )}

          {message.metadata?.kind === 'agent_run' && (
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                {['queued', 'running', 'cancelling'].includes(message.metadata.status)
                  ? <Loader2 className="size-3.5 animate-spin text-primary" />
                  : null}
                <span>{agentRunStatusLabel(message.metadata.status)}</span>
              </div>
              <p className="font-mono text-[10px] text-muted-foreground">任务 {message.metadata.runId.slice(0, 8)}</p>
            </div>
          )}

          {message.metadata?.kind === 'pending' && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            </div>
          )}

          {(!message.metadata || message.metadata.kind === 'text') && (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}

          {!isUser && hasActions
            && message.metadata?.kind !== 'pending'
            && message.metadata?.kind !== 'frame_progress'
            && message.metadata?.kind !== 'clarification'
            && message.metadata?.kind !== 'brief_review'
            && message.metadata?.kind !== 'director_diagnosis'
            && message.metadata?.kind !== 'change_set'
            && message.metadata?.kind !== 'checkpoint' ? (
            <ChatActions
              project={project}
              metadataActions={actions}
              hasOutlineCard={message.metadata?.kind === 'outline'}
              onAction={handleAction}
            />
          ) : null}
        </div>
        <span className="mt-1 px-1 text-[10px] text-muted-foreground">
          {formatRelativeTime(message.createdAt)}
        </span>
      </div>
      {project.outline ? (
        <OutlineDialog
          open={outlineOpen}
          onOpenChange={setOutlineOpen}
          project={project}
          onProjectChange={onProjectChange}
        />
      ) : null}
    </div>
  );
}

function ProgressCard({ metadata }: { metadata: Extract<MessageMetadata, { kind: 'frame_progress' }> }) {
  const pct = Math.round((metadata.current / metadata.total) * 100);
  return (
    <div className="space-y-2">
      <p className="text-sm">{messageText()}</p>
      <div className="flex items-center gap-2">
        <Progress value={pct} className="h-1.5 flex-1" />
        <span className="text-xs text-muted-foreground">
          {metadata.current}/{metadata.total}
        </span>
      </div>
    </div>
  );
}

function agentRunStatusLabel(status: Extract<MessageMetadata, { kind: 'agent_run' }>['status']) {
  if (status === 'queued') return '任务已排队';
  if (status === 'running') return '任务正在执行';
  if (status === 'cancelling') return '正在安全停止任务';
  if (status === 'completed') return '任务已完成';
  if (status === 'partial_failed') return '任务部分完成';
  if (status === 'cancelled') return '任务已停止';
  if (status === 'interrupted') return '任务已中断，可以恢复';
  return '任务执行失败';
}

function messageText() {
  return '正在生成分镜画面...';
}
