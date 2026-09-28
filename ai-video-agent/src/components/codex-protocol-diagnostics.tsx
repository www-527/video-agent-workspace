'use client';

import { useMemo, useState } from 'react';
import { Check, Clipboard, FileJson, Globe2, Radio, Route } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CodexTestStreamEvent } from '@/lib/ai/codex-test-chat';

export function CodexProtocolDiagnostics({
  events,
  phase,
}: {
  events: CodexTestStreamEvent[];
  phase: 'idle' | 'connecting' | 'streaming' | 'completed' | 'stopped' | 'failed';
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const snapshot = useMemo(() => {
    const meta = events.find(event => event.type === 'meta');
    const httpResponse = events.find(event => event.type === 'http.response');
    const rawEvents = events.filter(event => event.type === 'upstream.event' || event.type === 'stream.done');
    const final = [...events].reverse().find(event => event.type === 'response.completed' || event.type === 'error');
    return { meta, httpResponse, rawEvents, final, clientPhase: phase };
  }, [events, phase]);

  async function copyDiagnostics() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1_500);
    } catch {
      setCopyState('failed');
    }
  }

  const meta = snapshot.meta?.type === 'meta' ? snapshot.meta : undefined;
  const request = meta?.request;
  const http = snapshot.httpResponse?.type === 'http.response' ? snapshot.httpResponse : undefined;
  const final = snapshot.final?.type === 'response.completed' || snapshot.final?.type === 'error'
    ? snapshot.final : undefined;
  const stopped = phase === 'stopped';

  return (
    <section className="mt-4 space-y-2" aria-label="完整协议诊断">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">完整协议诊断</p>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={copyDiagnostics} disabled={!events.length}>
          {copyState === 'copied' ? <Check className="mr-1 h-3 w-3" /> : <Clipboard className="mr-1 h-3 w-3" />}
          {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制 JSON'}
        </Button>
      </div>

      <DiagnosticDetails title="请求" icon={<Route className="h-3.5 w-3.5" />} count={request ? 1 : 0}>
        {request ? (
          <div className="space-y-2">
            <KeyValue label="实际端点" value={request.endpoint} />
            <KeyValue label="方法 / 请求体" value={`${request.method} · ${formatBytes(request.bodyBytes)}`} />
            <JsonBlock label="脱敏请求头" value={request.headers} />
            <JsonBlock label="实际请求 JSON" value={request.body} />
            <JsonBlock label="关联 ID" value={request.correlation} />
          </div>
        ) : <Empty />}
      </DiagnosticDetails>

      <DiagnosticDetails title="HTTP 响应" icon={<Globe2 className="h-3.5 w-3.5" />} count={http ? 1 : 0}>
        {http ? (
          <div className="space-y-2">
            <KeyValue label="HTTP 状态" value={`${http.status} ${http.statusText}`.trim()} />
            <KeyValue label="响应头耗时" value={formatMs(http.elapsedMs)} />
            <KeyValue label="Content-Type" value={http.contentType ?? '接口未提供'} />
            <JsonBlock label="脱敏响应头" value={http.headers} />
          </div>
        ) : <Empty />}
      </DiagnosticDetails>

      <DiagnosticDetails title="原始 SSE" icon={<Radio className="h-3.5 w-3.5" />} count={snapshot.rawEvents.length}>
        {snapshot.rawEvents.length ? (
          <div className="space-y-2">
            {snapshot.rawEvents.map((event, index) => event.type === 'stream.done' ? (
              <div key={`done-${index}`} className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[10px]">
                <div className="flex justify-between gap-2 font-mono"><span>#{event.sequence} [DONE]</span><span>+{formatMs(event.elapsedMs)} · {formatBytes(event.bytes)}</span></div>
              </div>
            ) : (
              <details key={`${event.sequence}-${index}`} className="rounded-md border bg-white p-2">
                <summary className="cursor-pointer text-[10px] text-slate-700">
                  <span className="font-mono">#{event.sequence} {event.eventType}</span>
                  <span className="ml-2 text-muted-foreground">+{formatMs(event.elapsedMs)} · {formatBytes(event.bytes)}</span>
                  {!event.known ? <Badge variant="outline" className="ml-2 h-4 border-amber-200 px-1 text-[9px] text-amber-700">未知</Badge> : null}
                  {event.truncated ? <Badge variant="outline" className="ml-2 h-4 border-red-200 px-1 text-[9px] text-red-700">已截断</Badge> : null}
                </summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950 p-2 text-[10px] leading-4 text-slate-100">{pretty(event.payload)}</pre>
                {event.parseError ? <p className="mt-1 text-[10px] text-red-600">解析错误：{event.parseError}</p> : null}
              </details>
            ))}
          </div>
        ) : <Empty />}
      </DiagnosticDetails>

      <DiagnosticDetails title="传输汇总" icon={<FileJson className="h-3.5 w-3.5" />} count={final || stopped ? 1 : 0}>
        {final ? (
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <KeyValue label="结束方式" value={final.terminationMode} />
            <KeyValue label="响应数据" value={formatBytes(final.responseBytes)} />
            <KeyValue label="原始事件" value={`${final.eventCount} 个`} />
            <KeyValue label="未知事件" value={`${final.unknownEventCount} 个`} />
            <KeyValue label="收到 [DONE]" value={final.doneReceived ? '是' : '否'} />
            <KeyValue label="诊断截断" value={final.diagnosticsTruncated ? '是' : '否'} />
          </div>
        ) : stopped ? (
          <div className="grid grid-cols-2 gap-2 text-[10px]"><KeyValue label="结束方式" value="aborted" /><KeyValue label="客户端状态" value="用户停止或关闭窗口" /></div>
        ) : <Empty />}
      </DiagnosticDetails>

      <p className="text-[9px] leading-4 text-muted-foreground">认证信息和 encrypted_content 已在服务端脱敏。这里显示的是应用层 HTTP/SSE 证据，不包含 DNS、TCP、TLS 分阶段耗时。</p>
    </section>
  );
}

function DiagnosticDetails({ title, icon, count, children }: {
  title: string; icon: React.ReactNode; count: number; children: React.ReactNode;
}) {
  return (
    <details className="rounded-lg border bg-slate-50 p-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-slate-700">
        <span className="flex items-center gap-1.5">{icon}{title}</span>
        <Badge variant="outline" className="h-5 px-1.5 text-[9px]">{count}</Badge>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium text-slate-600">{label}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950 p-2 text-[10px] leading-4 text-slate-100">{pretty(value)}</pre>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-md border bg-white p-2"><p className="text-[9px] text-muted-foreground">{label}</p><p className="mt-0.5 break-all font-mono text-[10px] text-slate-700">{value}</p></div>;
}

function Empty() {
  return <p className="text-[10px] text-muted-foreground">发送测试消息后显示</p>;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatMs(value: number): string {
  return value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(1)} s`;
}

function formatBytes(value: number): string {
  return value < 1_024 ? `${value} B` : `${(value / 1_024).toFixed(1)} KiB`;
}
