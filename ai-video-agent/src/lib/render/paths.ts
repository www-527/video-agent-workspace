import { access } from 'fs/promises';
import { join, resolve, sep } from 'path';

export const DATA_ROOT = resolve(process.cwd(), 'data');
export const RENDER_CACHE_ROOT = join(DATA_ROOT, 'render-cache');
export const RENDER_JOB_ROOT = join(DATA_ROOT, 'render-jobs');
export const RENDER_OUTPUT_ROOT = join(DATA_ROOT, 'render-output');
export const RENDER_WORK_ROOT = join(DATA_ROOT, 'render-work');

export function resolveDataUrlPath(value?: string | null): string | null {
  if (!value) return null;
  if (/^file:/i.test(value)) return decodeURIComponent(new URL(value).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const match = value.match(/^\/api\/data\/(.+)$/);
  if (!match) return null;
  const candidate = resolve(DATA_ROOT, ...match[1].split('/').filter(Boolean));
  if (candidate !== DATA_ROOT && !candidate.startsWith(`${DATA_ROOT}${sep}`)) return null;
  return candidate;
}

export async function findChromiumExecutable(): Promise<string> {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean) as string[];
  return firstExisting(candidates, '未找到 Chromium/Edge。请设置 CHROMIUM_PATH。');
}

export async function findFfmpegExecutable(): Promise<string> {
  return firstExisting([
    process.env.FFMPEG_PATH,
    join(DATA_ROOT, 'tools', 'ffmpeg.exe'),
    join(process.cwd(), 'local tts', 'yzylauncher-win-Indextts20-260616', 'win-unpacked', 'python', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    'ffmpeg',
  ].filter(Boolean) as string[], '未找到 FFmpeg。请设置 FFMPEG_PATH。', true);
}

export async function findFfprobeExecutable(): Promise<string> {
  return firstExisting([
    process.env.FFPROBE_PATH,
    process.env.FFMPEG_PATH ? join(process.env.FFMPEG_PATH, '..', 'ffprobe.exe') : undefined,
    join(DATA_ROOT, 'tools', 'ffprobe.exe'),
    join(process.cwd(), 'local tts', 'yzylauncher-win-Indextts20-260616', 'win-unpacked', 'python', 'ffmpeg', 'bin', 'ffprobe.exe'),
    'ffprobe',
  ].filter(Boolean) as string[], '未找到 FFprobe。请设置 FFPROBE_PATH。', true);
}

async function firstExisting(candidates: string[], message: string, allowCommand = false): Promise<string> {
  for (const candidate of candidates) {
    if (allowCommand && !candidate.includes('\\') && !candidate.includes('/')) return candidate;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through the local candidates.
    }
  }
  throw new Error(message);
}
