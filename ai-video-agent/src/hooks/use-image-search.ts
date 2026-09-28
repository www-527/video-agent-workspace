'use client';

import { useCallback, useRef, useState } from 'react';
import type { ProjectDetail } from '@/types';

export interface ImageSearchProgress {
  stage: string;
  label: string;
  current?: number;
  total?: number;
  message?: string;
  completed?: boolean;
  failed?: boolean;
}

export function useImageSearch(project: ProjectDetail, refresh: () => Promise<ProjectDetail | undefined>) {
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<ImageSearchProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (frameId?: string) => {
    setSearching(true);
    setProgress({ stage: 'analyzing', label: '分析分镜' });
    abortRef.current = new AbortController();
    try {
      const response = await fetch('/api/frames/html/image-search', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.uuid, frameId }), signal: abortRef.current.signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || '启动图片搜索失败。');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const block of events) {
          const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() || 'message';
          const valueLine = block.match(/^data:\s*(.+)$/m)?.[1];
          if (!valueLine) continue;
          const data = JSON.parse(valueLine) as ImageSearchProgress;
          if (event === 'error') throw new Error(data.message || '图片搜索失败。');
          if (event === 'aborted') setProgress({ ...data, stage: 'aborted', label: '已中断', failed: true });
          else if (event === 'done') {
            setProgress({ ...data, completed: true });
            await refresh();
          } else setProgress(data);
        }
      }
    } finally {
      setSearching(false);
    }
  }, [project.uuid, refresh]);

  const abort = useCallback(async () => {
    abortRef.current?.abort();
    setProgress({ stage: 'aborted', label: '已中断', message: '用户中断，已保存的素材会保留。', failed: true });
    await fetch('/api/frames/html/image-search/abort', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.uuid }) });
  }, [project.uuid]);

  return { searching, progress, start, abort };
}
