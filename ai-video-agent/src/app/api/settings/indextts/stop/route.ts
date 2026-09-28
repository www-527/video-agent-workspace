import { execFile } from 'child_process';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const INDEXTTS_API_PORT = 9010;

function execFileAsync(file: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function POST() {
  if (process.platform !== 'win32') {
    return NextResponse.json(
      { error: '当前关闭服务接口仅支持 Windows 本地 IndexTTS 整合包' },
      { status: 400 },
    );
  }

  const script = [
    `$connections = Get-NetTCPConnection -LocalPort ${INDEXTTS_API_PORT} -State Listen -ErrorAction SilentlyContinue`,
    'if (-not $connections) { exit 3 }',
    '$connections | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction Stop }',
  ].join('; ');

  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ]);

    return NextResponse.json({
      ok: true,
      message: 'IndexTTS 服务已关闭',
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 3) {
      return NextResponse.json({
        ok: true,
        message: 'IndexTTS 服务未在运行',
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `IndexTTS 关闭失败：${message}` },
      { status: 500 },
    );
  }
}
