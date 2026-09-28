import { spawn } from 'child_process';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function stopDevelopmentServer() {
  const parentPid = process.ppid;

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(parentPid), '/T', '/F'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.unref();
    return;
  }

  try {
    process.kill(parentPid, 'SIGTERM');
  } catch {
    process.kill(process.pid, 'SIGTERM');
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const requestHost = request.headers.get('host');
  let originHost: string | null = null;

  if (origin) {
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ error: '关闭请求来源无效' }, { status: 400 });
    }
  }

  if (originHost && originHost !== requestHost) {
    return NextResponse.json({ error: '不允许从其他站点关闭程序' }, { status: 403 });
  }

  // Give the response enough time to reach the browser before stopping Next.js.
  setTimeout(stopDevelopmentServer, 800);

  return NextResponse.json({ ok: true });
}
