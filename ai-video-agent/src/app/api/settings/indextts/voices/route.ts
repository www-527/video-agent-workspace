import { readdir } from 'fs/promises';
import { join } from 'path';
import { NextResponse } from 'next/server';
import { getIndexTtsSettings } from '@/lib/indextts-settings';

interface IndexTtsVoice {
  name: string;
  path: string;
}

const LOCAL_VOICES_DIR = join(
  process.cwd(),
  'local tts',
  'yzylauncher-win-Indextts20-260616',
  'win-unpacked',
  'python',
  'voices',
);

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.m4a', '.ogg', '.aac']);

export async function GET() {
  const settings = await getIndexTtsSettings();
  const baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
  const localVoices = await listLocalPresetVoices();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${baseUrl}/api/voices`, { signal: controller.signal });
    clearTimeout(timer);

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (localVoices.length) {
        return NextResponse.json({
          warning: payload.detail || payload.error || `IndexTTS API response error: ${response.status} ${response.statusText}`,
          voices: localVoices,
        });
      }
      return NextResponse.json(
        { error: payload.detail || payload.error || `IndexTTS API response error: ${response.status} ${response.statusText}` },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ...payload,
      voices: mergeVoices(normalizeVoices(payload.voices), localVoices),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'IndexTTS API connection timed out. Please check whether the service is running.'
      : `IndexTTS API is not running or the address is incorrect: ${baseUrl}`;
    if (localVoices.length) {
      return NextResponse.json({ warning: message, voices: localVoices });
    }
    return NextResponse.json({ error: message, voices: [] }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const settings = await getIndexTtsSettings();
  const baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');

  try {
    const response = await fetch(`${baseUrl}/api/voices`, {
      method: 'POST',
      body: await req.formData(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: payload.detail || payload.error || `${response.status} ${response.statusText}` }, { status: 502 });
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: `IndexTTS voice upload failed: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const settings = await getIndexTtsSettings();
  const baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
  const name = new URL(req.url).searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'voice name is required' }, { status: 400 });

  try {
    const response = await fetch(`${baseUrl}/api/voices/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: payload.detail || payload.error || `${response.status} ${response.statusText}` }, { status: 502 });
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: `IndexTTS voice delete failed: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}

async function listLocalPresetVoices(): Promise<IndexTtsVoice[]> {
  try {
    const entries = await readdir(LOCAL_VOICES_DIR, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && AUDIO_EXTENSIONS.has(getExtension(entry.name).toLowerCase()))
      .map(entry => ({
        name: entry.name,
        path: join(LOCAL_VOICES_DIR, entry.name),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  } catch {
    return [];
  }
}

function normalizeVoices(value: unknown): IndexTtsVoice[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const voice = item as Partial<IndexTtsVoice>;
      if (!voice.name || !voice.path) return null;
      return { name: voice.name, path: voice.path };
    })
    .filter((voice): voice is IndexTtsVoice => Boolean(voice));
}

function mergeVoices(remoteVoices: IndexTtsVoice[], localVoices: IndexTtsVoice[]): IndexTtsVoice[] {
  const voicesByName = new Map<string, IndexTtsVoice>();
  for (const voice of [...localVoices, ...remoteVoices]) {
    voicesByName.set(voice.name, voice);
  }
  return Array.from(voicesByName.values()).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

function getExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index) : '';
}
