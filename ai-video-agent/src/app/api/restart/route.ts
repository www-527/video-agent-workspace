import { NextRequest, NextResponse } from 'next/server';
import { hasManagedAppLauncher, requestManagedAppRestart } from '@/lib/app-restart';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin'); const host = request.headers.get('host');
  if (origin) { try { if (new URL(origin).host !== host) return NextResponse.json({ error: '不允许从其他站点重启程序' }, { status: 403 }); } catch { return NextResponse.json({ error: '重启请求来源无效' }, { status: 400 }); } }
  if (!await hasManagedAppLauncher()) return NextResponse.json({ error: '自动重启需要通过工作区根目录的“启动AI视频程序.cmd”启动。当前服务不会自行关闭。' }, { status: 409 });
  await requestManagedAppRestart(); return NextResponse.json({ ok: true });
}
