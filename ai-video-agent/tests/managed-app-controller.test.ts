import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('managed app controller', () => {
  it('tracks the development server process used by the launcher', async () => {
    const script = await readFile(
      path.join(process.cwd(), 'scripts', 'run-managed-app.ps1'),
      'utf8',
    );

    expect(script).toContain("Get-Command npm.cmd -ErrorAction Stop");
    expect(script).toContain("-ArgumentList @('run', 'dev')");
    expect(script).toContain('return [int]$childProcess.Id');
    expect(script).toContain('function Stop-App');
    expect(script).toContain('Wait-Process -Id $processId');
    expect(script).not.toContain('$child.WaitForExit()');
  });
});
