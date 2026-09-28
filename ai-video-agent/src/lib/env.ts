/**
 * 环境变量集中校验与导出。
 * 启动时调用 ensureEnv()，缺失关键变量时给出友好提示。
 */
export function ensureEnv(): { ok: boolean; missing: string[] } {
  const required = ['DATABASE_URL', 'AI_BASE_URL', 'AI_MODEL'] as const;
  const missing: string[] = [];
  for (const key of required) {
    if (!process.env[key] || process.env[key]?.startsWith('"')) {
      missing.push(key);
    }
  }
  return { ok: missing.length === 0, missing };
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL || '',
  AI_BASE_URL: process.env.AI_BASE_URL || '',
  AI_API_KEY: process.env.AI_API_KEY || '',
  AI_MODEL: process.env.AI_MODEL || 'gemini-3-flash-preview',
  AI_TUNE_MODEL: process.env.AI_TUNE_MODEL || process.env.AI_MODEL || 'gemini-3-flash-preview',
  AI_TUNE_MAX_TOKENS: numberEnv('AI_TUNE_MAX_TOKENS', 500),
  AI_TUNE_NO_THINKING: process.env.AI_TUNE_NO_THINKING !== 'false',
  AI_TUNE_TIMEOUT_MS: numberEnv('AI_TUNE_TIMEOUT_MS', 15000),
  AI_HTML_MAX_TOKENS: numberEnv('AI_HTML_MAX_TOKENS', 16000),
  AI_HTML_NO_THINKING: process.env.AI_HTML_NO_THINKING !== 'false',
  TTS_PROVIDER: process.env.TTS_PROVIDER || 'tencent',
  EDGE_TTS_VOICE: process.env.EDGE_TTS_VOICE || 'zh-CN-XiaoxiaoNeural',
  EDGE_TTS_RATE: process.env.EDGE_TTS_RATE || '+0%',
  TTS_VOICE: process.env.TTS_VOICE || '501000',
  TENCENTCLOUD_SECRET_ID: process.env.TENCENTCLOUD_SECRET_ID || '',
  TENCENTCLOUD_SECRET_KEY: process.env.TENCENTCLOUD_SECRET_KEY || '',
  TENCENTCLOUD_TTS_REGION: process.env.TENCENTCLOUD_TTS_REGION || 'ap-beijing',
  TENCENTCLOUD_TTS_SPEED: Number(process.env.TENCENTCLOUD_TTS_SPEED || -0.2),
  TENCENTCLOUD_TTS_VOLUME: Number(process.env.TENCENTCLOUD_TTS_VOLUME || 0),
  TENCENTCLOUD_TTS_SAMPLE_RATE: Number(process.env.TENCENTCLOUD_TTS_SAMPLE_RATE || 24000),
  INDEXTTS_BASE_URL: process.env.INDEXTTS_BASE_URL || 'http://127.0.0.1:9000',
  INDEXTTS_API_BASE_URL: process.env.INDEXTTS_API_BASE_URL || 'http://127.0.0.1:9010',
  INDEXTTS_GRADIO_BASE_URL: process.env.INDEXTTS_GRADIO_BASE_URL || process.env.INDEXTTS_BASE_URL || 'http://127.0.0.1:9000',
  INDEXTTS_ADAPTER_MODE: process.env.INDEXTTS_ADAPTER_MODE === 'gradio' ? 'gradio' : 'api',
  INDEXTTS_VOICE: process.env.INDEXTTS_VOICE || '',
  INDEXTTS_REFERENCE_AUDIO: process.env.INDEXTTS_REFERENCE_AUDIO || '',
  INDEXTTS_SPEED: Number(process.env.INDEXTTS_SPEED || 1),
  INDEXTTS_TEMPERATURE: Number(process.env.INDEXTTS_TEMPERATURE || 0.8),
  INDEXTTS_TOP_P: Number(process.env.INDEXTTS_TOP_P || 0.8),
  INDEXTTS_TOP_K: Number(process.env.INDEXTTS_TOP_K || 30),
  INDEXTTS_FORMAT: (process.env.INDEXTTS_FORMAT === 'wav' ? 'wav' : 'mp3') as 'mp3' | 'wav',
  INDEXTTS_TIMEOUT_MS: Number(process.env.INDEXTTS_TIMEOUT_MS || 120000),
  PEXELS_API_KEY: process.env.PEXELS_API_KEY || '',
  PEXELS_SEARCH_TIMEOUT_MS: numberEnv('PEXELS_SEARCH_TIMEOUT_MS', 15000),
  TAVILY_API_KEY: process.env.TAVILY_API_KEY || '',
  TAVILY_MAX_RESULTS: Number(process.env.TAVILY_MAX_RESULTS || 3),
  TAVILY_MAX_QUERIES: Number(process.env.TAVILY_MAX_QUERIES || 3),
  APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || 'AI 视频制作智能体',
};
