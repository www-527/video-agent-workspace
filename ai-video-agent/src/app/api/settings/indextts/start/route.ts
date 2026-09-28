import { spawn } from 'child_process';
import { access } from 'fs/promises';
import { join } from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const INDEXTTS_DIR = join(process.cwd(), 'local tts', 'yzylauncher-win-Indextts20-260616');
const START_SCRIPT = join(INDEXTTS_DIR, 'start_api.bat');

export async function POST() {
  try {
    await access(START_SCRIPT);
  } catch {
    return NextResponse.json(
      { error: `IndexTTS 启动脚本不存在：${START_SCRIPT}` },
      { status: 404 },
    );
  }

  try {
    const child = spawn('cmd.exe', ['/c', START_SCRIPT], {
      cwd: INDEXTTS_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    return NextResponse.json({
      ok: true,
      message: 'IndexTTS 服务启动中，模型加载完成后可以点击测试连接',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `IndexTTS 启动失败：${message}` },
      { status: 500 },
    );
  }
}
