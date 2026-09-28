param([Parameter(Mandatory = $true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
$runtimeDir = Join-Path $ProjectRoot '.tmp'; $marker = Join-Path $runtimeDir 'managed-app-launcher.json'; $request = Join-Path $runtimeDir 'managed-app-restart.json'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Set-Content -LiteralPath $marker -Value (@{ controllerPid = $PID; startedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress) -Encoding utf8
function Start-App {
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $childProcess = Start-Process -FilePath $npm -ArgumentList @('run', 'dev') -WorkingDirectory $ProjectRoot -PassThru
  if (-not $childProcess -or -not $childProcess.Id) { throw 'The managed app process did not expose a PID.' }
  return [int]$childProcess.Id
}
function Stop-App([int]$processId) {
  if ($processId -le 0) { return }
  if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { return }
  taskkill /PID $processId /T /F | Out-Null
  try { Wait-Process -Id $processId -Timeout 10 -ErrorAction SilentlyContinue } catch {}
}
$childPid = Start-App
try {
  while ($true) {
    Start-Sleep -Milliseconds 500
    if (Test-Path -LiteralPath $request) {
      Remove-Item -LiteralPath $request -Force
      Stop-App $childPid
      $childPid = Start-App
    }
    if ($childPid -gt 0 -and -not (Get-Process -Id $childPid -ErrorAction SilentlyContinue)) {
      $childPid = 0
    }
    if ($childPid -eq 0 -and $Host.UI.RawUI.KeyAvailable -and $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown').Character -match '[Rr]') {
      $childPid = Start-App
    }
  }
} finally {
  Stop-App $childPid
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
}
