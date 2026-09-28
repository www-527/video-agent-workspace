import { randomUUID } from 'crypto';
import { access, mkdir, rename, writeFile } from 'fs/promises';
import path from 'path';

const runtimeDir = path.join(process.cwd(), '.tmp');
const markerPath = path.join(runtimeDir, 'managed-app-launcher.json');
const requestPath = path.join(runtimeDir, 'managed-app-restart.json');

export async function hasManagedAppLauncher() { try { await access(markerPath); return true; } catch { return false; } }
export async function requestManagedAppRestart() {
  await mkdir(runtimeDir, { recursive: true });
  const temp = `${requestPath}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify({ id: randomUUID(), requestedAt: new Date().toISOString() }), 'utf8');
  await rename(temp, requestPath);
}
