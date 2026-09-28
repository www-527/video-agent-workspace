import { aiKeyStore } from '@/lib/ai-key-store';
import { createGPTClient } from './providers/gpt-relay';

export interface GPTCapabilityCheck {
  supported: boolean;
  error?: string;
}

export interface GPTCapabilityReport {
  checkedAt: string;
  configuredModel: string;
  actualModel?: string;
  responses: GPTCapabilityCheck;
  structuredOutput: GPTCapabilityCheck;
  imageGenerationProbed: false;
}

export async function probeGPTCapabilities(keyId: string): Promise<GPTCapabilityReport> {
  const credential = await aiKeyStore.getSnapshot(keyId);
  const client = createGPTClient(credential);
  let actualModel: string | undefined;
  const responses = await check(async () => {
    const response: any = await client.responses.create({
      model: credential.model,
      input: 'Reply with OK.',
      reasoning: { effort: 'low' },
      max_output_tokens: 32,
    } as any);
    actualModel = typeof response.model === 'string' ? response.model : undefined;
    if (!readOutputText(response)) throw new Error('响应为空');
  }, credential.apiKey);

  const structuredOutput = responses.supported
    ? await check(async () => {
      const response: any = await client.responses.create({
        model: credential.model,
        input: 'Return {"ok":true}.',
        text: { format: { type: 'json_object' } },
        reasoning: { effort: 'low' },
        max_output_tokens: 48,
      } as any);
      JSON.parse(readOutputText(response));
    }, credential.apiKey)
    : { supported: false, error: 'Responses API 不可用，已跳过' };

  return {
    checkedAt: new Date().toISOString(),
    configuredModel: credential.model,
    actualModel,
    responses,
    structuredOutput,
    imageGenerationProbed: false,
  };
}

async function check(task: () => Promise<void>, apiKey: string): Promise<GPTCapabilityCheck> {
  try {
    await task();
    return { supported: true };
  } catch (error) {
    return { supported: false, error: sanitizeError(error, apiKey) };
  }
}

function readOutputText(response: any): string {
  if (typeof response?.output_text === 'string') return response.output_text.trim();
  return (Array.isArray(response?.output) ? response.output : [])
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((item: any) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item: any) => item.text)
    .join('\n')
    .trim();
}

function sanitizeError(error: unknown, apiKey: string): string {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(apiKey, '[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
    .slice(0, 500);
}
