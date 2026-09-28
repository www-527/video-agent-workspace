'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, CircleStop, Clock3, Code2, Loader2, MessageSquareCode,
  Paperclip, RotateCcw, Send, Server, ShieldCheck, TimerReset, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  isCodexTestImageMimeType,
  validateCodexTestImageMetadata,
  validateCodexTestRequestImages,
  type CodexTestImageInput,
} from '@/lib/ai/codex-test-images';
import type { CodexTestStreamEvent } from '@/lib/ai/codex-test-chat';
import { CodexProtocolDiagnostics } from '@/components/codex-protocol-diagnostics';

interface MaskedKeyItem {
  id: string;
  name: string;
  maskedKey: string;
  selectedModel: string;
  baseURL: string;
  apiProtocol: 'auto' | 'responses' | 'chat.completions';
  source: 'saved' | 'environment';
  active: boolean;
}

interface MaskedKeyList {
  items: MaskedKeyItem[];
  activeId: string | null;
  configured: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: ImageAttachment[];
}

interface ImageAttachment extends CodexTestImageInput {
  id: string;
  previewUrl: string;
}

interface Diagnostics {
  phase: 'idle' | 'connecting' | 'streaming' | 'completed' | 'stopped' | 'failed';
  requestCount: number;
  firstEventMs?: number;
  firstTextMs?: number;
  durationMs?: number;
  responseId?: string;
  responseStatus?: string;
  eventCount: number;
  usage?: { input?: number; output?: number; total?: number };
  error?: string;
}

const INITIAL_DIAGNOSTICS: Diagnostics = {
  phase: 'idle',
  requestCount: 0,
  eventCount: 0,
};

export function CodexAPITestDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [keyList, setKeyList] = useState<MaskedKeyList | null>(null);
  const [selectedKeyId, setSelectedKeyId] = useState('');
  const [keyError, setKeyError] = useState('');
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [imageError, setImageError] = useState('');
  const [diagnostics, setDiagnostics] = useState<Diagnostics>(INITIAL_DIAGNOSTICS);
  const [events, setEvents] = useState<CodexTestStreamEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const loading = diagnostics.phase === 'connecting' || diagnostics.phase === 'streaming';
  const selectedKey = useMemo(
    () => keyList?.items.find(item => item.id === selectedKeyId) ?? null,
    [keyList, selectedKeyId],
  );

  useEffect(() => {
    if (!open || keyList) return;
    let active = true;
    setLoadingKeys(true);
    setKeyError('');
    void fetch('/api/settings/ai-keys', {
      headers: { 'content-type': 'application/json' },
    }).then(async response => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || '读取 Key 列表失败');
      if (!active) return;
      const result = body as MaskedKeyList;
      setKeyList(result);
      setSelectedKeyId(result.activeId || result.items[0]?.id || '');
    }).catch(error => {
      if (active) setKeyError(error instanceof Error ? error.message : '读取 Key 列表失败');
    }).finally(() => {
      if (active) setLoadingKeys(false);
    });
    return () => { active = false; };
  }, [keyList, open]);

  useEffect(() => () => {
    abortRef.current?.abort();
    previewUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const element = conversationRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      abortRef.current?.abort(new DOMException('Dialog closed', 'AbortError'));
      clearConversation(true);
    }
    onOpenChange(nextOpen);
  }

  async function sendMessage() {
    const content = input.trim();
    if ((!content && !pendingImages.length) || !selectedKey || loading) return;

    const userMessage: ChatMessage = { id: createMessageId(), role: 'user', content, images: pendingImages };
    const assistantId = createMessageId();
    const assistantMessage: ChatMessage = { id: assistantId, role: 'assistant', content: '' };
    const requestMessages = [...messages, userMessage].slice(-12);
    setMessages([...requestMessages, assistantMessage].slice(-12));
    setInput('');
    setPendingImages([]);
    setImageError('');
    setEvents([]);
    setDiagnostics({ ...INITIAL_DIAGNOSTICS, phase: 'connecting' });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch('/api/settings/codex-test-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keyId: selectedKey.id,
          messages: requestMessages.map(message => ({
            role: message.role,
            content: message.content,
            ...(message.images?.length ? {
              images: message.images.map(({ dataUrl, mimeType, byteSize }) => ({ dataUrl, mimeType, byteSize })),
            } : {}),
          })),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `API 测试失败（HTTP ${response.status}）`);
      }
      if (!response.body) throw new Error('浏览器未收到流式响应体');

      await consumeSSE(response.body, event => {
        setEvents(current => [...current, event]);
        applyEvent(event, assistantId, setMessages, setDiagnostics);
      });
    } catch (error) {
      if (controller.signal.aborted) {
        setDiagnostics(current => ({ ...current, phase: 'stopped' }));
        setMessages(current => current.filter(message => message.id !== assistantId || message.content));
      } else {
        const message = error instanceof Error ? error.message : 'Codex API 测试失败';
        setDiagnostics(current => ({ ...current, phase: 'failed', error: message }));
        setMessages(current => current.filter(item => item.id !== assistantId || item.content));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function stopRequest() {
    abortRef.current?.abort(new DOMException('Stopped by user', 'AbortError'));
  }

  function clearConversation(force = false) {
    if (loading && !force) return;
    previewUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    previewUrlsRef.current.clear();
    setMessages([]);
    setEvents([]);
    setInput('');
    setPendingImages([]);
    setImageError('');
    setDiagnostics(INITIAL_DIAGNOSTICS);
  }

  async function addImages(files: File[]) {
    if (!files.length || loading) return;
    try {
      const metadata = files.map(file => {
        if (!isCodexTestImageMimeType(file.type)) throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 图片。');
        return { mimeType: file.type, byteSize: file.size };
      });
      validateCodexTestImageMetadata(metadata);
      const dataUrls = await Promise.all(files.map(readFileAsDataURL));
      const additions = dataUrls.map((dataUrl, index) => ({
        id: createMessageId(),
        dataUrl,
        mimeType: metadata[index]!.mimeType,
        byteSize: metadata[index]!.byteSize,
        previewUrl: URL.createObjectURL(files[index]!),
      }));
      validateCodexTestImageMetadata([...pendingImages, ...additions]);
      validateCodexTestRequestImages([
        ...messages.map(message => ({ role: message.role, content: message.content, images: message.images })),
        { role: 'user' as const, content: input.trim(), images: [...pendingImages, ...additions] },
      ]);
      additions.forEach(image => previewUrlsRef.current.add(image.previewUrl));
      setPendingImages(current => [...current, ...additions]);
      setImageError('');
    } catch (error) {
      setImageError(error instanceof Error ? error.message : '图片读取失败。');
    }
  }

  function removePendingImage(id: string) {
    setPendingImages(current => {
      const removed = current.find(image => image.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrlsRef.current.delete(removed.previewUrl);
      }
      return current.filter(image => image.id !== id);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[92dvh] max-h-[900px] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b bg-slate-50/80 px-5 py-4 pr-12 sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MessageSquareCode className="h-5 w-5" />
            </span>
            Codex API 测试
          </DialogTitle>
          <DialogDescription>
            独立 Responses 流式基准：一次发送只产生一个上游请求，不重试、不降级到 Chat。
          </DialogDescription>
        </DialogHeader>

        <div className="border-b px-5 py-3 sm:px-6">
          <div className="grid items-end gap-3 lg:grid-cols-[minmax(240px,1fr)_2fr]">
            <div className="space-y-1.5">
              <Label htmlFor="codex-test-key">测试 Key</Label>
              <select
                id="codex-test-key"
                aria-label="Codex 测试 Key"
                value={selectedKeyId}
                onChange={event => setSelectedKeyId(event.target.value)}
                disabled={loadingKeys || loading || !keyList?.items.length}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {!keyList?.items.length ? <option value="">暂无可用 Key</option> : null}
                {keyList?.items.map(item => (
                  <option key={item.id} value={item.id}>{item.name}{item.active ? ' · 当前' : ''}</option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2 text-xs">
              <Badge variant="secondary">Codex 兼容 Responses</Badge>
              <Badge variant="outline">stream: true</Badge>
              <Badge variant="outline">store: false</Badge>
              <Badge variant="outline">HTTP retries: 0</Badge>
              {selectedKey ? <Badge variant="outline" className="max-w-full truncate font-mono">{selectedKey.selectedModel}</Badge> : null}
            </div>
          </div>
          {selectedKey ? (
            <div className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>名称：{selectedKey.name}</span>
              <span className="truncate">中转站：{fingerprintBaseURL(selectedKey.baseURL)}</span>
              <span>配置协议：{selectedKey.apiProtocol}</span>
              <span>来源：{selectedKey.source === 'environment' ? '环境变量' : '已保存'}</span>
            </div>
          ) : null}
          {loadingKeys ? <p className="mt-2 text-xs text-muted-foreground">正在读取 Key 列表……</p> : null}
          {keyError ? <p role="alert" className="mt-2 text-xs text-destructive">{keyError}</p> : null}
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
            <div ref={conversationRef} className="min-h-[260px] flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4 sm:p-5" aria-live="polite">
              {messages.length ? messages.map(message => (
                <article
                  key={message.id}
                  className={`max-w-[92%] rounded-xl px-3.5 py-2.5 text-sm leading-6 shadow-sm ${message.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'border bg-white text-slate-800'}`}
                >
                  {message.content ? <p className="whitespace-pre-wrap break-words">{message.content}</p> : message.role === 'user' ? (
                    <p className="text-xs">已发送 {message.images?.length ?? 0} 张图片</p>
                  ) : (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />等待首个文本事件……
                    </span>
                  )}
                </article>
              )) : (
                <div className="flex min-h-[220px] flex-col items-center justify-center text-center text-muted-foreground">
                  <Code2 className="mb-3 h-8 w-8 text-primary/60" />
                  <p className="text-sm font-medium text-slate-700">Codex 格式通信基准</p>
                  <p className="mt-1 max-w-md text-xs leading-5">选择 Key 后发送一句话，窗口会增量显示 Responses SSE 输出，并记录真实传输指标。</p>
                </div>
              )}
            </div>

            <form className="space-y-2 border-t bg-white p-4 sm:p-5" onSubmit={event => { event.preventDefault(); void sendMessage(); }}>
              {pendingImages.length ? <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm">
                {pendingImages.map(image => <div key={image.id} className="group relative h-20 w-20 overflow-hidden rounded-xl border bg-slate-100">
                  <img src={image.previewUrl} alt="待发送图片" className="h-full w-full object-cover" />
                  <button type="button" aria-label="移除图片" onClick={() => removePendingImage(image.id)} disabled={loading} className="absolute right-1 top-1 rounded-full bg-slate-900/80 p-0.5 text-white hover:bg-slate-900 disabled:opacity-50">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>)}
              </div> : null}
              <Textarea
                value={input}
                onChange={event => setInput(event.target.value)}
                onPaste={event => {
                  const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
                  if (files.length) {
                    event.preventDefault();
                    void addImages(files);
                  }
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="输入测试消息；Enter 发送，Shift+Enter 换行"
                aria-label="Codex API 测试消息"
                rows={3}
                maxLength={200_000}
                disabled={loading}
                className="min-h-24 resize-none rounded-2xl shadow-sm"
              />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="添加图片" onClick={() => imageInputRef.current?.click()} disabled={loading}>
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <span>{input.length}/200000</span>
                  <span>最近 12 条消息 · 仅保存在当前窗口</span>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => clearConversation()} disabled={loading || (!messages.length && !events.length)}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />清空
                  </Button>
                  {loading ? (
                    <Button type="button" size="sm" variant="destructive" onClick={stopRequest}>
                      <CircleStop className="mr-1.5 h-3.5 w-3.5" />停止
                    </Button>
                  ) : (
                    <Button type="submit" size="sm" disabled={!selectedKey || (!input.trim() && !pendingImages.length)}>
                      <Send className="mr-1.5 h-3.5 w-3.5" />发送
                    </Button>
                  )}
                </div>
              </div>
              <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={event => {
                void addImages(Array.from(event.target.files ?? []));
                event.target.value = '';
              }} />
              {imageError ? <p role="alert" className="text-xs text-destructive">{imageError}</p> : null}
            </form>
          </div>

          <aside className="max-h-[34dvh] overflow-y-auto bg-white p-4 lg:max-h-none lg:p-5" aria-label="Codex API 诊断信息">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4 text-primary" />通信诊断</h3>
              <StatusBadge phase={diagnostics.phase} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-1">
              <Metric icon={<Server className="h-3.5 w-3.5" />} label="真实请求" value={`${diagnostics.requestCount} 次`} />
              <Metric icon={<TimerReset className="h-3.5 w-3.5" />} label="首事件" value={formatMs(diagnostics.firstEventMs)} />
              <Metric icon={<Clock3 className="h-3.5 w-3.5" />} label="首文本" value={formatMs(diagnostics.firstTextMs)} />
              <Metric icon={<Clock3 className="h-3.5 w-3.5" />} label="总耗时" value={formatMs(diagnostics.durationMs)} />
              <Metric icon={<Code2 className="h-3.5 w-3.5" />} label="流事件" value={`${diagnostics.eventCount} 个`} />
              <Metric icon={<ShieldCheck className="h-3.5 w-3.5" />} label="状态" value={diagnostics.responseStatus || '—'} />
            </div>
            {diagnostics.usage ? (
              <div className="mt-3 rounded-lg border bg-slate-50 p-3 text-xs leading-5">
                <p className="font-medium text-slate-700">Token 用量</p>
                <p className="mt-1 text-muted-foreground">输入 {diagnostics.usage.input ?? '—'} · 输出 {diagnostics.usage.output ?? '—'} · 总计 {diagnostics.usage.total ?? '—'}</p>
              </div>
            ) : null}
            {diagnostics.responseId ? <p className="mt-3 truncate font-mono text-[10px] text-muted-foreground" title={diagnostics.responseId}>ID: {diagnostics.responseId}</p> : null}
            {diagnostics.error ? <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">{diagnostics.error}</p> : null}

            <CodexProtocolDiagnostics events={events} phase={diagnostics.phase} />
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function applyEvent(
  event: CodexTestStreamEvent,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setDiagnostics: React.Dispatch<React.SetStateAction<Diagnostics>>,
) {
  if (event.type === 'meta') {
    setDiagnostics(current => ({ ...current, phase: 'connecting', requestCount: event.requestCount }));
  } else if (event.type === 'http.response') {
    setDiagnostics(current => ({ ...current, responseStatus: `HTTP ${event.status}` }));
  } else if (event.type === 'response.created') {
    setDiagnostics(current => ({
      ...current,
      phase: 'streaming',
      firstEventMs: current.firstEventMs ?? event.elapsedMs,
      responseId: event.responseId,
      responseStatus: event.status,
    }));
  } else if (event.type === 'response.output_text.delta') {
    setMessages(current => current.map(message => message.id === assistantId
      ? { ...message, content: message.content + event.delta }
      : message));
    setDiagnostics(current => ({
      ...current,
      phase: 'streaming',
      firstEventMs: current.firstEventMs ?? event.elapsedMs,
      firstTextMs: current.firstTextMs ?? event.elapsedMs,
    }));
  } else if (event.type === 'response.completed') {
    setMessages(current => current.filter(message => message.id !== assistantId || message.content.trim()));
    setDiagnostics(current => ({
      ...current,
      phase: 'completed',
      firstEventMs: event.firstEventMs ?? current.firstEventMs,
      firstTextMs: event.firstTextMs ?? current.firstTextMs,
      durationMs: event.durationMs,
      responseId: event.responseId ?? current.responseId,
      responseStatus: event.status,
      eventCount: event.eventCount,
      usage: event.usage,
      error: undefined,
    }));
  } else if (event.type === 'error') {
    setMessages(current => current.filter(message => message.id !== assistantId || message.content.trim()));
    setDiagnostics(current => ({
      ...current,
      phase: 'failed',
      durationMs: event.durationMs,
      eventCount: event.eventCount,
      responseStatus: event.status ? `HTTP ${event.status}` : current.responseStatus,
      error: event.message,
    }));
  }
}

export async function consumeSSE(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: CodexTestStreamEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) parseSSEBlock(block, onEvent);
      if (done) break;
    }
    if (buffer.trim()) parseSSEBlock(buffer, onEvent);
  } finally {
    reader.releaseLock();
  }
}

function parseSSEBlock(block: string, onEvent: (event: CodexTestStreamEvent) => void) {
  const data = block.split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n');
  if (!data || data === '[DONE]') return;
  onEvent(JSON.parse(data) as CodexTestStreamEvent);
}

function StatusBadge({ phase }: { phase: Diagnostics['phase'] }) {
  const labels: Record<Diagnostics['phase'], string> = {
    idle: '待命', connecting: '连接中', streaming: '流式输出',
    completed: '已完成', stopped: '已停止', failed: '失败',
  };
  const className = phase === 'completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : phase === 'failed' ? 'border-red-200 bg-red-50 text-red-700'
      : phase === 'streaming' || phase === 'connecting' ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-slate-200 bg-slate-50 text-slate-600';
  return <Badge variant="outline" className={className}>{labels[phase]}</Badge>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border p-2.5">
      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">{icon}{label}</p>
      <p className="mt-1 truncate text-xs font-medium text-slate-800" title={value}>{value}</p>
    </div>
  );
}

function formatMs(value?: number): string {
  return value === undefined ? '—' : value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(1)} s`;
}

function fingerprintBaseURL(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '无效地址';
  }
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败。'));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('图片读取失败。'));
    reader.readAsDataURL(file);
  });
}

let messageSequence = 0;
function createMessageId(): string {
  messageSequence += 1;
  return `${Date.now()}-${messageSequence}`;
}
