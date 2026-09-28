'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bot, ImageIcon, RadioTower, Send, User } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { AITraceEvent } from '@/lib/ai/trace';
import type { ChatMessage } from '@/types';

const MAX_HISTORY_MESSAGES = 100;

interface ConversationHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  messages: readonly ChatMessage[];
}

type TimelineEvent =
  | { kind: 'message'; id: string; timestamp: string; message: ChatMessage }
  | { kind: 'trace'; id: string; timestamp: string; trace: AITraceEvent };

/** A chronological three-party transcript: relay, Agent, and user. */
export function ConversationHistoryDialog({ open, onOpenChange, projectId, messages }: ConversationHistoryDialogProps) {
  const [traces, setTraces] = useState<AITraceEvent[]>([]);
  const [traceLoadFailed, setTraceLoadFailed] = useState(false);
  const visibleMessages = open ? messages.slice(-MAX_HISTORY_MESSAGES) : [];
  const visibleTraces = open ? traces.slice(-MAX_HISTORY_MESSAGES) : [];
  const hiddenCount = Math.max(0, messages.length - visibleMessages.length);
  const timeline = useMemo(() => buildTimeline(visibleMessages, visibleTraces), [visibleMessages, visibleTraces]);

  useEffect(() => {
    if (!open || typeof fetch !== 'function') return;

    const controller = new AbortController();
    setTraceLoadFailed(false);
    void fetch(`/api/projects/${projectId}/ai-traces`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Trace request failed (${response.status})`);
        const data = await response.json() as { traces?: AITraceEvent[] };
        setTraces(Array.isArray(data.traces) ? data.traces.slice(-MAX_HISTORY_MESSAGES) : []);
      })
      .catch(error => {
        if ((error as { name?: string }).name !== 'AbortError') setTraceLoadFailed(true);
      });

    return () => controller.abort();
  }, [open, projectId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5 pr-12">
          <DialogTitle>三方对话记录</DialogTitle>
          <DialogDescription>
            按时间展示中转站、Agent 与用户的完整往来。中转调用包含 System Prompt、传入内容、输出和图片缩略图；每类最多保留最近 {MAX_HISTORY_MESSAGES} 条。
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[min(72vh,820px)]">
          <div className="min-w-[780px] p-5">
            <ThreePartyHeader />
            {hiddenCount ? (
              <p className="my-4 rounded-md border border-dashed bg-muted/35 px-3 py-2 text-center text-xs text-muted-foreground">
                更早的 {hiddenCount} 条对话未显示；此处仅保留最近 {MAX_HISTORY_MESSAGES} 条。
              </p>
            ) : null}
            {traceLoadFailed ? (
              <p className="my-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                中转站调用记录暂时无法读取，请稍后重新打开。
              </p>
            ) : null}
            {timeline.length ? (
              <div className="space-y-5 py-4">
                {timeline.map(event => <TimelineRow key={event.id} event={event} />)}
              </div>
            ) : (
              <p className="my-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">暂无可查看的对话或中转调用记录。</p>
            )}
          </div>
        </ScrollArea>

        <div className="border-t px-6 py-3 text-right text-xs text-muted-foreground">
          对话 {visibleMessages.length} / {messages.length} 条；中转调用 {visibleTraces.length} / {MAX_HISTORY_MESSAGES} 条
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThreePartyHeader() {
  return (
    <div className="sticky top-0 z-10 grid grid-cols-3 gap-4 border-b bg-background/95 pb-3 pt-1 text-xs font-semibold backdrop-blur">
      <div className="flex items-center gap-2 text-amber-700"><RadioTower className="size-4" />中转站</div>
      <div className="flex items-center justify-center gap-2 text-primary"><Bot className="size-4" />Agent</div>
      <div className="flex items-center justify-end gap-2 text-slate-700">用户<User className="size-4" /></div>
    </div>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  return (
    <article className="grid grid-cols-3 gap-x-4 [content-visibility:auto]">
      <time className="col-span-3 mb-2 flex items-center gap-2 text-[11px] text-muted-foreground" dateTime={event.timestamp}>
        <span className="h-px flex-1 bg-border" />
        {formatTimestamp(event.timestamp)}
        <span className="h-px flex-1 bg-border" />
      </time>
      {event.kind === 'message'
        ? <MessageBubble message={event.message} />
        : <TraceBubbles trace={event.trace} />}
    </article>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <section className={cn('min-w-0 rounded-2xl border p-4 shadow-sm', isUser
      ? 'col-start-3 border-slate-200 bg-slate-50/90'
      : 'col-start-2 border-primary/20 bg-primary/[0.04]')}>
      <BubbleTitle icon={isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />} label={isUser ? '用户输入' : 'Agent 输出'} />
      <p className="whitespace-pre-wrap break-words text-sm leading-6">{readMessageContent(message)}</p>
    </section>
  );
}

function TraceBubbles({ trace }: { trace: AITraceEvent }) {
  return (
    <>
      <section className="min-w-0 rounded-2xl border border-amber-200 bg-amber-50/75 p-4 shadow-sm">
        <BubbleTitle icon={<RadioTower className="size-3.5" />} label="中转站收到的调用" />
        <TraceMetadata trace={trace} />
        <TextPayload label="System Prompt" value={trace.system} />
        <TextPayload label="Agent 传入内容" value={trace.user} />
        <ImageThumbnails images={trace.visualInputs} />
      </section>
      <section className="col-start-2 min-w-0 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 shadow-sm">
        <BubbleTitle icon={<Send className="size-3.5" />} label="Agent 收到的响应" />
        {trace.reasoning ? <TextPayload label="Agent 推理" value={trace.reasoning} /> : null}
        <TextPayload label="Agent 输出" value={trace.output || '（本次调用未返回可显示文本。）'} />
        {trace.error ? <TextPayload label="调用错误" value={trace.error} tone="error" /> : null}
      </section>
    </>
  );
}

function BubbleTitle({ icon, label }: { icon: ReactNode; label: string }) {
  return <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold">{icon}{label}</h3>;
}

function TraceMetadata({ trace }: { trace: AITraceEvent }) {
  const entries = [
    ['中转站', trace.relayBaseURL || '未使用中转站'],
    ['阶段', trace.stage],
    ['模型', trace.actualModel || trace.model],
    ['接口', trace.apiMode],
    ['状态', trace.responseStatus || trace.finishReason],
    ['调用', `${trace.attempt}/${trace.maxAttempts} · ${trace.durationMs} ms`],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <dl className="mb-3 grid gap-x-2 gap-y-1 text-xs sm:grid-cols-[3.25rem_minmax(0,1fr)]">
      {entries.map(([label, value]) => (
        <div className="contents" key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TextPayload({ label, value, tone }: { label: string; value: string; tone?: 'error' }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className={cn('mb-1 text-[11px] font-medium text-muted-foreground', tone === 'error' && 'text-destructive')}>{label}</p>
      <pre className={cn('whitespace-pre-wrap break-words rounded-xl border bg-background/80 p-3 font-sans text-xs leading-5', tone === 'error' && 'border-destructive/30 text-destructive')}>{value}</pre>
    </div>
  );
}

function ImageThumbnails({ images }: { images: AITraceEvent['visualInputs'] }) {
  if (!images?.length) return null;
  return (
    <div className="mt-3 border-t border-amber-200/80 pt-3">
      <p className="mb-2 flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><ImageIcon className="size-3.5" />传入图片（缩略图）</p>
      <div className="flex flex-wrap gap-2">
        {images.map((image, index) => (
          <figure key={`${image.label || 'image'}-${index}`} className="w-28">
            {image.thumbnailDataUrl ? (
              // Trace thumbnails are data URLs captured from the exact image sent upstream.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image.thumbnailDataUrl} alt={image.label || `传入图片 ${index + 1}`} className="aspect-video w-28 rounded-lg border bg-muted object-cover" loading="lazy" />
            ) : (
              <div className="grid aspect-video place-items-center rounded-lg border bg-muted text-muted-foreground"><ImageIcon className="size-5" /></div>
            )}
            <figcaption className="mt-1 truncate text-[10px] text-muted-foreground" title={image.label}>
              {image.label || `图片 ${index + 1}`}{image.byteLength ? ` · ${formatBytes(image.byteLength)}` : ''}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function buildTimeline(messages: readonly ChatMessage[], traces: readonly AITraceEvent[]): TimelineEvent[] {
  return [
    ...messages.map((message, index) => ({ kind: 'message' as const, id: `message-${message.id || index}`, timestamp: message.createdAt, message })),
    ...traces.map((trace, index) => ({ kind: 'trace' as const, id: `trace-${trace.id || index}`, timestamp: trace.startedAt, trace })),
  ].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function readMessageContent(message: ChatMessage): string {
  if (message.content.trim()) return message.content;
  if (message.metadata?.kind === 'error') return `错误：${message.metadata.message}`;
  if (message.metadata?.kind === 'frame_progress') return `分镜生成进度：${message.metadata.current}/${message.metadata.total}`;
  if (message.metadata?.kind === 'pending') return 'Agent 正在处理…';
  return '（此条 Agent 输出不包含可显示的文本内容。）';
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
