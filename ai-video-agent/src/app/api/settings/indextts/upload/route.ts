import { extname } from 'path';
import { NextResponse } from 'next/server';
import { getIndexTtsSettings } from '@/lib/indextts-settings';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac']);

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: '请选择要上传的音频文件' }, { status: 400 });
  }

  const extension = extname(file.name).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(extension)) {
    return NextResponse.json({ error: '仅支持 mp3、wav、m4a、flac、ogg、aac 音频' }, { status: 400 });
  }

  const settings = await getIndexTtsSettings();
  const baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
  const proxyFormData = new FormData();
  proxyFormData.append('file', file, file.name);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(settings.timeoutMs, 60000));
    const response = await fetch(`${baseUrl}/api/references`, {
      method: 'POST',
      body: proxyFormData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const payload = await response.json().catch(() => ({})) as {
      reference?: { id?: string; name?: string; url?: string; format?: string };
      detail?: string;
      error?: string;
    };
    if (!response.ok || !payload.reference?.id) {
      throw new Error(payload.detail || payload.error || `${response.status} ${response.statusText}`);
    }

    return NextResponse.json({
      referenceId: payload.reference.id,
      reference: payload.reference,
      path: payload.reference.id,
      filename: payload.reference.name || file.name,
    });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'IndexTTS 参考音频上传超时'
      : `IndexTTS 参考音频上传失败：${error instanceof Error ? error.message : String(error)}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
