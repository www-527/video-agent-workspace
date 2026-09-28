import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, statSync } from 'fs';
import { join, normalize, resolve, sep } from 'path';
import { Readable } from 'stream';

interface RouteContext {
  params: { path: string[] };
}

/**
 * GET /api/data/[...path]
 * 服务 data/ 目录下的本地文件（图片、音频）。
 * 路径越界检查：必须落在 DATA_ROOT 之下。
 */
const DATA_ROOT = resolve(process.cwd(), 'data');

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.srt': 'application/x-subrip; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const rel = params.path.join('/');
    const privateRoot = params.path[0]?.toLowerCase();
    if (privateRoot === 'project-assets' || privateRoot === 'project-checkpoints') {
      return NextResponse.json({ error: '该文件不可通过通用数据接口访问' }, { status: 404 });
    }
    const fullPath = normalize(join(DATA_ROOT, rel));
    if (fullPath !== DATA_ROOT && !fullPath.startsWith(`${DATA_ROOT}${sep}`)) {
      return NextResponse.json({ error: '路径非法' }, { status: 400 });
    }
    const ext = fullPath.slice(fullPath.lastIndexOf('.')).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: '不允许访问目录' }, { status: 404 });
    }
    const parsedRange = parseByteRange(req.headers.get('range'), stat.size);
    const start = parsedRange?.start ?? 0;
    const end = parsedRange?.end ?? stat.size - 1;
    const stream = createReadStream(fullPath, { start, end });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: parsedRange ? 206 : 200,
      headers: {
        'content-type': mime,
        'content-length': String(end - start + 1),
        'accept-ranges': 'bytes',
        ...(parsedRange ? { 'content-range': `bytes ${start}-${end}/${stat.size}` } : {}),
        'cache-control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[GET /api/data]', err);
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }
}

function parseByteRange(value: string | null, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const requestedStart = match[1] ? Number(match[1]) : 0;
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(requestedStart) || !Number.isFinite(requestedEnd) || size <= 0) return null;
  const start = Math.max(0, Math.min(size - 1, requestedStart));
  const end = Math.max(start, Math.min(size - 1, requestedEnd));
  return { start, end };
}
