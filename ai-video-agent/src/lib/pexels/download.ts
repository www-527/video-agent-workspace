import { mkdir, rename, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { env } from '@/lib/env';
import type { PexelsPhoto } from './client';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export interface PexelsImageInput {
  dataUrl: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteLength: number;
}

export async function downloadPexelsPhoto(opts: { projectId: string; frameId: string; photo: PexelsPhoto; abortSignal?: AbortSignal }): Promise<string> {
  assertSafeSegment(opts.projectId, '项目 ID');
  assertSafeSegment(opts.frameId, '分镜 ID');
  const url = opts.photo.src.large2x || opts.photo.src.large || opts.photo.src.original;
  if (!url || !isTrustedPexelsImageUrl(url)) throw new Error('Pexels 图片下载地址无效。');
  const timeout = AbortSignal.timeout(env.PEXELS_SEARCH_TIMEOUT_MS);
  const signal = opts.abortSignal ? AbortSignal.any([opts.abortSignal, timeout]) : timeout;
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`图片下载失败（${response.status}）。`);
  const type = response.headers.get('content-type')?.split(';')[0].toLowerCase() || '';
  const ext = MIME_EXTENSIONS[type];
  if (!ext) throw new Error('图片格式不受支持。');
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_FILE_BYTES) throw new Error('图片文件超过 15MB 限制。');
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length || data.length > MAX_FILE_BYTES) throw new Error('图片文件为空或超过 15MB 限制。');
  if (!matchesImageSignature(data, type)) throw new Error('图片文件内容与声明格式不一致。');
  const directory = join(process.cwd(), 'data', 'pexels', opts.projectId);
  await mkdir(directory, { recursive: true });
  const filename = `${opts.frameId}-${opts.photo.id}.${ext}`;
  const targetPath = join(directory, filename);
  const temporaryPath = join(directory, `${filename}.${process.pid}-${Date.now()}.tmp`);
  await writeFile(temporaryPath, data);
  try {
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return `/api/data/pexels/${opts.projectId}/${filename}`;
}

/**
 * Reads a rule-approved Pexels candidate into a transient image input without
 * writing it to the project. The caller may send the returned data URL to one
 * visual request, but it must never persist the value in project/audit JSON.
 */
export async function fetchPexelsPhotoImageInput(opts: {
  photo: PexelsPhoto;
  abortSignal?: AbortSignal;
}): Promise<PexelsImageInput> {
  const url = opts.photo.src.large2x || opts.photo.src.large || opts.photo.src.original;
  if (!url || !isTrustedPexelsImageUrl(url)) throw new Error('Pexels 候选图片地址无效。');
  const response = await fetch(url, { signal: opts.abortSignal, cache: 'no-store' });
  if (!response.ok) throw new Error(`视觉候选图片读取失败（${response.status}）。`);
  const type = response.headers.get('content-type')?.split(';')[0].toLowerCase() || '';
  if (!(type in MIME_EXTENSIONS)) throw new Error('视觉候选图片格式不受支持。');
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_FILE_BYTES) throw new Error('视觉候选图片超过 15MB 限制。');
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length || data.length > MAX_FILE_BYTES) throw new Error('视觉候选图片为空或超过 15MB 限制。');
  if (!matchesImageSignature(data, type)) throw new Error('视觉候选图片文件内容与声明格式不一致。');
  return {
    dataUrl: `data:${type};base64,${data.toString('base64')}`,
    mimeType: type as PexelsImageInput['mimeType'],
    byteLength: data.length,
  };
}

function assertSafeSegment(value: string, label: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`${label}格式不安全。`);
}

function isTrustedPexelsImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && (url.hostname === 'pexels.com' || url.hostname.endsWith('.pexels.com'));
  } catch {
    return false;
  }
}

function matchesImageSignature(data: Buffer, type: string): boolean {
  if (type === 'image/jpeg') return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (type === 'image/png') return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/webp') return data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  return false;
}
