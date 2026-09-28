import { readFile, stat } from 'fs/promises';
import { basename, extname, join, normalize, resolve } from 'path';
import { NextRequest, NextResponse } from 'next/server';

const LOCAL_VOICES_DIR = resolve(
  process.cwd(),
  'local tts',
  'yzylauncher-win-Indextts20-260616',
  'win-unpacked',
  'python',
  'voices',
);

const MIME: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
};

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')?.trim();
  if (!name) return NextResponse.json({ error: 'voice name is required' }, { status: 400 });

  const filename = basename(name);
  if (filename !== name) return NextResponse.json({ error: 'voice name is invalid' }, { status: 400 });

  const fullPath = normalize(join(LOCAL_VOICES_DIR, filename));
  if (!fullPath.startsWith(LOCAL_VOICES_DIR)) {
    return NextResponse.json({ error: 'voice path is invalid' }, { status: 400 });
  }

  try {
    const fileStat = await stat(fullPath);
    if (!fileStat.isFile()) return NextResponse.json({ error: 'voice file not found' }, { status: 404 });

    const audio = await readFile(fullPath);
    const mime = MIME[extname(filename).toLowerCase()] || 'application/octet-stream';
    return new NextResponse(audio, {
      headers: {
        'content-type': mime,
        'content-length': String(fileStat.size),
        'cache-control': 'private, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ error: 'voice file not found' }, { status: 404 });
  }
}
