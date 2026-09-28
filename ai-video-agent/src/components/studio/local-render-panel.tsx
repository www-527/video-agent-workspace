'use client';

import { AlertTriangle, CheckCircle2, Clock3, Database, FileWarning, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { RenderJobSnapshot } from '@/lib/render/types';

export function LocalRenderPanel({
  job,
  onClose,
  onRetryScene,
}: {
  job: RenderJobSnapshot;
  onClose: () => void;
  onRetryScene: (sceneId: string) => void;
}) {
  const activeScene = job.scenes.find(scene => ['rendering', 'encoding', 'realtime-fallback'].includes(scene.stage));
  const isTerminal = ['completed', 'cancelled', 'failed', 'partial-failed'].includes(job.stage);
  const slowestStage = getSlowestStage(job);
  return (
    <aside className="absolute bottom-4 right-4 z-40 w-[420px] overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/95 text-white shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between border-b border-slate-800 px-5 py-4">
        <div>
          <div className="text-sm font-semibold">本地离线渲染</div>
          <div className="mt-1 text-xs text-slate-400">
            {activeScene ? `当前：第 ${activeScene.index + 1} 镜 · ${activeScene.title}` : job.message}
          </div>
        </div>
        {isTerminal ? (
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-white" aria-label="关闭渲染详情">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className="space-y-4 px-5 py-4">
        <div>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-slate-300">{stageLabel(job.stage)}</span>
            <span className="font-mono tabular-nums">{job.progress}%</span>
          </div>
          <Progress value={job.progress} className="h-2 bg-slate-800" />
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Counter icon={<Database className="h-3.5 w-3.5" />} label="缓存" value={job.cacheHits} />
          <Counter icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="离线" value={job.offlineRendered} />
          <Counter icon={<Clock3 className="h-3.5 w-3.5" />} label="回退" value={job.realtimeFallbacks} />
          <Counter icon={<FileWarning className="h-3.5 w-3.5" />} label="失败" value={job.failedScenes} danger={job.failedScenes > 0} />
        </div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>共 {job.scenes.length} 镜</span>
          <span>预计剩余 {formatRemaining(job.estimatedRemainingMs)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
            <div className="text-slate-500">总耗时 / 峰值并发</div>
            <div className="mt-1 text-slate-200">{formatDuration(job.elapsedMs)} / {job.peakConcurrency || 0}</div>
            <div className="mt-1 truncate text-slate-500">最慢阶段：{slowestStage}</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
            <div className="text-slate-500">最慢分镜</div>
            <div className="mt-1 truncate text-slate-200" title={job.slowestScene?.title}>
              {job.slowestScene ? `${job.slowestScene.title} · ${formatDuration(job.slowestScene.elapsedMs)}` : '计算中'}
            </div>
          </div>
        </div>
        {job.scenes.some(scene => scene.stage === 'failed') ? (
          <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
            {job.scenes.filter(scene => scene.stage === 'failed').map(scene => (
              <div key={scene.id} className="rounded-lg border border-red-900/70 bg-red-950/35 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-red-200">
                    <AlertTriangle className="h-3.5 w-3.5 flex-none" />
                    <span className="truncate">第 {scene.index + 1} 镜 · {scene.title}</span>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 border-red-800 bg-transparent px-2 text-[11px] text-red-200 hover:bg-red-900" onClick={() => onRetryScene(scene.id)}>
                    <RotateCcw className="mr-1 h-3 w-3" />重试
                  </Button>
                </div>
                <div className="mt-2 text-[11px] leading-relaxed text-red-300/75">
                  {scene.error?.type ? `[${scene.error.type}] ` : ''}{scene.error?.message || '未知渲染错误'}
                </div>
                {scene.error?.logPath ? (
                  <a
                    href={`/api/render-jobs/${encodeURIComponent(job.id)}/logs?sceneId=${encodeURIComponent(scene.id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-[11px] text-sky-400 hover:text-sky-300 hover:underline"
                  >
                    查看错误日志
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {job.visualWarnings.length ? (
          <details className="rounded-lg border border-amber-900/60 bg-amber-950/25 p-3 text-xs">
            <summary className="cursor-pointer font-medium text-amber-200">全片视觉问题清单（{job.visualWarnings.length}）</summary>
            <div className="mt-2 max-h-32 space-y-1.5 overflow-y-auto text-[11px] leading-relaxed text-amber-100/70">
              {job.visualWarnings.map((warning, index) => {
                const scene = job.scenes.find(item => item.id === warning.sceneId);
                return <div key={`${warning.sceneId}-${index}`}>第 {(scene?.index ?? 0) + 1} 镜：{warning.message}</div>;
              })}
            </div>
          </details>
        ) : null}
      </div>
    </aside>
  );
}

function Counter({ icon, label, value, danger = false }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${danger ? 'border-red-900/70 bg-red-950/30 text-red-300' : 'border-slate-800 bg-slate-900 text-slate-300'}`}>
      <div className="flex items-center gap-1 text-[10px] text-slate-500">{icon}{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function stageLabel(stage: RenderJobSnapshot['stage']) {
  if (stage === 'cancelling') return '正在取消';
  return ({
    queued: '排队中',
    'checking-compatibility': '兼容性检查',
    'rendering-scenes': '逐帧渲染',
    'encoding-scenes': '分镜编码',
    'muxing-audio': '音频封装',
    'generating-subtitles': '生成字幕',
    assembling: '最终合成',
    completed: '已完成',
    cancelled: '已取消',
    failed: '失败',
    'partial-failed': '部分失败',
  })[stage];
}

function formatRemaining(ms: number | null) {
  if (ms === null) return '计算中';
  if (ms <= 0) return '0 秒';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 秒';
  const seconds = Math.round(ms / 100) / 10;
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

function getSlowestStage(job: RenderJobSnapshot) {
  const entries: Array<[string, number]> = [
    ['准备', job.metrics?.preparationMs || 0],
    ['分镜渲染', job.metrics?.sceneWallMs || 0],
    ['最终拼接', job.metrics?.assemblyMs || 0],
    ['字幕封装', job.metrics?.subtitleMuxMs || 0],
    ['成片验证', job.metrics?.validationMs || 0],
  ];
  return entries.sort((left, right) => right[1] - left[1])[0]?.[0] || '计算中';
}
