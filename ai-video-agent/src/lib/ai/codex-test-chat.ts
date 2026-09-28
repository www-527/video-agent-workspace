import type { AIKeySnapshot } from '@/lib/ai-key-store';
import {
  buildResponsesURL,
  streamCodexResponses,
  type CodexDiagnosticHeaders,
  type CodexHTTPDiagnostic,
  type CodexRawEventDiagnostic,
  type CodexRequestDiagnostic,
  type CodexResponsesInputMessage,
  type CodexResponsesStreamEvent,
  type CodexResponsesUsage,
  type CodexTerminationMode,
  type FetchImplementation,
} from './providers/codex-responses';

export type CodexTestInputMessage = CodexResponsesInputMessage;
export type CodexTestUsage = CodexResponsesUsage;
export type CodexTestStreamEvent = CodexResponsesStreamEvent;
export type {
  CodexDiagnosticHeaders,
  CodexHTTPDiagnostic,
  CodexRawEventDiagnostic,
  CodexRequestDiagnostic,
  CodexTerminationMode,
};
export { buildResponsesURL };

const CODEX_TEST_INSTRUCTIONS = '你是独立的 API 连接测试助手。直接回答用户问题并保持上下文一致。不要创建或修改视频项目，不要声称调用未提供的工具，也不要输出隐藏推理过程。';

export async function* streamCodexTestChat(input: {
  credential: AIKeySnapshot;
  messages: CodexTestInputMessage[];
  abortSignal?: AbortSignal;
  fetchImpl?: FetchImplementation;
}): AsyncGenerator<CodexTestStreamEvent> {
  yield* streamCodexResponses({
    credential: input.credential,
    instructions: CODEX_TEST_INSTRUCTIONS,
    messages: input.messages,
    abortSignal: input.abortSignal,
    fetchImpl: input.fetchImpl,
  });
}
