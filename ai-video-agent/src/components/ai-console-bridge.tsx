'use client';

import { useEffect } from 'react';
import type { AITraceEvent } from '@/lib/ai/trace';

export function AIConsoleBridge() {
  useEffect(() => {
    if (!['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return;
    const source = new EventSource('/api/debug/ai-events');
    source.onmessage = message => {
      const trace = JSON.parse(message.data) as AITraceEvent;
      const prefix = `[AI][${trace.stage}][${trace.id.slice(0, 8)}]`;
      console.groupCollapsed(`${prefix} ${trace.error ? '失败' : '完成'} · ${(trace.durationMs / 1000).toFixed(1)}s`);
      console.groupCollapsed(`${prefix} 输入`);
      console.log('System prompt\n', trace.system);
      console.log('User prompt\n', trace.user);
      if (trace.visualInputs?.length) {
        console.log('Visual inputs (ordered)', trace.visualInputs.map((image, index) => ({
          order: index + 1,
          label: image.label || `image-${index + 1}`,
          mimeType: image.mimeType || 'unknown',
          byteLength: image.byteLength,
        })));
      }
      console.groupEnd();
      console.groupCollapsed(`${prefix} 思考`);
      console.log(trace.reasoning || '模型未提供 reasoning');
      console.groupEnd();
      console.groupCollapsed(`${prefix} 输出`);
      console.log(trace.output ?? '无输出');
      console.groupEnd();
      console.log(`${prefix} 模型`, trace.model);
      if (trace.actualModel) console.log(`${prefix} 实际模型`, trace.actualModel);
      if (trace.apiMode) console.log(`${prefix} API 模式`, trace.apiMode);
      if (trace.relayBaseURL) console.log(`${prefix} 中转站`, trace.relayBaseURL);
      if (trace.reasoningEffort) console.log(`${prefix} 推理强度`, trace.reasoningEffort);
      if (trace.responseId) console.log(`${prefix} response_id`, trace.responseId);
      if (trace.responseStatus) console.log(`${prefix} response_status`, trace.responseStatus);
      if (trace.terminationMode) console.log(`${prefix} termination`, trace.terminationMode);
      if (trace.downgradeReason) console.warn(`${prefix} 降级原因`, trace.downgradeReason);
      console.log(`${prefix} 耗时`, `${(trace.durationMs / 1000).toFixed(1)}s`);
      console.log(`${prefix} Token`, trace.tokens || '接口未提供 Token 用量');
      console.log(`${prefix} 尝试`, `${trace.attempt}/${trace.maxAttempts}`);
      if (trace.finishReason) console.log(`${prefix} finish_reason`, trace.finishReason);
      if (typeof trace.outputLength === 'number') console.log(`${prefix} output.length`, trace.outputLength);
      if (typeof trace.reasoningLength === 'number') console.log(`${prefix} reasoning.length`, trace.reasoningLength);
      if (trace.error) console.error(`${prefix} 错误`, trace.error);
      console.groupEnd();
    };
    return () => source.close();
  }, []);

  return null;
}
