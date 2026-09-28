import { NextResponse } from 'next/server';
import { indexTtsSettingsSchema } from '@/lib/indextts-settings';

export async function POST(req: Request) {
  const parsed = indexTtsSettingsSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'IndexTTS 参数无效' },
      { status: 400 },
    );
  }

  const baseUrl = (parsed.data.adapterMode === 'api'
    ? parsed.data.apiBaseUrl
    : parsed.data.gradioBaseUrl || parsed.data.baseUrl).replace(/\/+$/, '');
  const healthPaths = parsed.data.adapterMode === 'api' ? ['/api/status', '/api/health'] : ['/config'];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let response: Response | null = null;
    for (const healthPath of healthPaths) {
      response = await fetch(`${baseUrl}${healthPath}`, { signal: controller.signal });
      if (response.ok || response.status !== 404) break;
    }
    clearTimeout(timer);

    if (!response) {
      return NextResponse.json({ error: 'IndexTTS 服务无响应' }, { status: 502 });
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `IndexTTS 服务响应异常：${response.status} ${response.statusText}` },
        { status: 502 },
      );
    }

    const status = parsed.data.adapterMode === 'api' ? await response.json().catch(() => null) : null;
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'IndexTTS 连接超时，请检查模型是否加载完成'
      : `IndexTTS 服务未启动或地址错误：${baseUrl}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
