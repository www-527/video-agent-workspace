'use client';

import { useState } from 'react';
import { Loader2, MessageSquareText, RotateCcw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface APIChatMetadata {
  configuredModel: string;
  actualModel?: string;
  apiMode: 'responses' | 'chat.completions';
  responseId?: string;
  responseStatus?: string;
  fallbackReason?: string;
  tokens?: { prompt?: number; completion?: number; total?: number };
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: APIChatMetadata;
}

export function AIAPIChat({ keyId, keyName, model, embedded = false }: { keyId: string; keyName: string; model: string; embedded?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || loading) return;
    const userMessage: ChatMessage = { id: createMessageId(), role: 'user', content };
    const nextMessages = [...messages, userMessage].slice(-12);
    setMessages(nextMessages);
    setInput('');
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/settings/ai-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keyId,
          messages: nextMessages.map(message => ({ role: message.role, content: message.content })),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getResponseErrorMessage(body));
      const result = body as APIChatMetadata & { message: string };
      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: 'assistant',
        content: result.message,
        metadata: result,
      };
      setMessages(current => [...current, assistantMessage].slice(-12));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'API 对话失败');
    } finally {
      setLoading(false);
    }
  }

  function clearConversation() {
    setMessages([]);
    setError('');
    setInput('');
  }

  return (
    <section className={embedded ? 'space-y-3' : 'space-y-3 rounded-md border bg-white p-3'} aria-label="API 对话测试">
      <div className={`items-start justify-between gap-3 ${embedded ? 'hidden' : 'flex'}`}>
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <MessageSquareText className="h-4 w-4 text-primary" />
            API 对话测试
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            直接使用「{keyName}」和模型 <span className="font-mono">{model}</span>；只保留当前窗口最近 12 条消息，不写入项目。
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={clearConversation} disabled={!messages.length || loading}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          清空
        </Button>
      </div>

      <div className="max-h-72 space-y-2 overflow-y-auto rounded-md bg-slate-50 p-3" aria-live="polite">
        {messages.length ? messages.map(message => (
          <article
            key={message.id}
            className={`max-w-[92%] rounded-lg px-3 py-2 text-sm leading-6 ${message.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-white text-slate-800 shadow-sm'}`}
          >
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
            {message.metadata ? <ChatMetadata metadata={message.metadata} /> : null}
          </article>
        )) : (
          <p className="py-5 text-center text-xs text-muted-foreground">输入一句话，测试当前 API 是否能正常连续对话。</p>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在等待 API 返回……
          </div>
        ) : null}
      </div>

      <form className="space-y-2" onSubmit={handleSubmit}>
        <Textarea
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder="例如：请用一句话说明你是谁"
          aria-label="API 对话消息"
          maxLength={200_000}
          rows={3}
          disabled={loading}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted-foreground">{input.length}/200000</span>
          <Button type="submit" size="sm" disabled={loading || !input.trim()}>
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
            发送
          </Button>
        </div>
      </form>

      {error ? <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}

function getResponseErrorMessage(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const payload = body as { message?: unknown; error?: unknown };
    if (typeof payload.message === 'string') return payload.message;
    if (typeof payload.error === 'string') return payload.error;
  }
  return 'API 对话失败';
}

function ChatMetadata({ metadata }: { metadata: APIChatMetadata }) {
  return (
    <div className="mt-2 border-t border-slate-200 pt-1.5 font-mono text-[10px] leading-4 text-slate-500">
      <span>{metadata.apiMode}</span>
      <span> · {metadata.actualModel || metadata.configuredModel}</span>
      {metadata.tokens?.total !== undefined ? <span> · {metadata.tokens.total} tokens</span> : null}
      {metadata.responseStatus ? <span> · {metadata.responseStatus}</span> : null}
      {metadata.fallbackReason ? <span className="text-amber-700"> · 降级：{formatFallback(metadata.fallbackReason)}</span> : null}
      {metadata.responseId ? <p className="truncate" title={metadata.responseId}>ID: {metadata.responseId}</p> : null}
    </div>
  );
}

function formatFallback(reason: string): string {
  if (reason.includes(';')) return reason.split(';').map(formatFallback).join(' + ');
  if (reason === 'responses_api_unsupported') return 'Responses 不支持';
  if (reason === 'responses_upstream_request_failed') return 'Responses 上游转发失败';
  if (reason === 'responses_upstream_forbidden') return 'Responses 上游拒绝';
  if (reason === 'responses_temporarily_unavailable') return 'Responses 暂时不可用';
  if (reason === 'chat_token_limit_removed') return '已移除不兼容的 Token 上限';
  return reason;
}

let messageSequence = 0;
function createMessageId(): string {
  messageSequence += 1;
  return `${Date.now()}-${messageSequence}`;
}
