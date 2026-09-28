@echo off
setlocal EnableExtensions
title AI Video Agent

set "ROOT=%~dp0"
set "APP_DIR=%ROOT%ai-video-agent"
set "APP_URL=http://localhost:3000"

if not exist "%APP_DIR%\package.json" goto missing_project

where node.exe >nul 2>nul
if errorlevel 1 goto missing_node

where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_npm

cd /d "%APP_DIR%"
if errorlevel 1 goto cd_failed

set "PORT_PID="
for /f %%P in ('powershell.exe -NoProfile -Command "$connection = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue ^| Select-Object -First 1; if ($connection) { $connection.OwningProcess }"') do set "PORT_PID=%%P"
if defined PORT_PID (
  if exist ".tmp\managed-app-launcher.json" goto already_running
  powershell.exe -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/settings/tts' -TimeoutSec 3; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
  if errorlevel 1 goto unmanaged_running
  echo [RESTART] Stopping the previous AI Video Agent...
  taskkill /PID %PORT_PID% /T /F >nul 2>nul
  if errorlevel 1 goto stop_previous_failed
  timeout /t 2 /nobreak >nul
)

if not exist "node_modules" (
  echo [SETUP] Installing dependencies...
  call npm.cmd install
  if errorlevel 1 goto install_failed
)

echo [START] Starting AI Video Agent...
echo [URL]   %APP_URL%
echo [NOTE]  Keep this launcher window open while using the app.
echo.

rem Open the browser only after Next.js has compiled the home page. Opening it
rem before the first compile finishes can leave the browser waiting for chunks
rem that do not exist yet and cause ChunkLoadError.
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "$url='%APP_URL%'; for ($i=0; $i -lt 240; $i++) { try { $response=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5; if ($response.StatusCode -eq 200) { Start-Process $url; exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; exit 1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\scripts\run-managed-app.ps1" -ProjectRoot "%APP_DIR%"

echo.
echo [STOP] The managed application has stopped.
exit /b 0

:already_running
echo [READY] AI Video Agent is already running.
echo [URL]   %APP_URL%
powershell.exe -NoProfile -Command "$url='%APP_URL%'; for ($i=0; $i -lt 60; $i++) { try { $response=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5; if ($response.StatusCode -eq 200) { Start-Process $url; exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 goto startup_timeout
exit /b 0

:unmanaged_running
echo [ERROR] Port 3000 is occupied by an app that was not started by this launcher.
echo [TIP]   Close the existing AI Video Agent, then double-click this launcher again.
goto failed

:stop_previous_failed
echo [ERROR] The previous AI Video Agent could not be stopped automatically.
echo [TIP]   Close its terminal or run this launcher as Administrator, then try again.
goto failed

:startup_timeout
echo [ERROR] The server did not become ready in time.
echo [TIP]   Close this window, wait a few seconds, then run the launcher again.
goto failed

:missing_project
echo [ERROR] Project not found:
echo %APP_DIR%
goto failed

:missing_node
echo [ERROR] Node.js was not found. Install Node.js 20 or newer first.
goto failed

:missing_npm
echo [ERROR] npm was not found. Reinstall Node.js first.
goto failed

:cd_failed
echo [ERROR] Cannot enter the project directory.
goto failed

:install_failed
echo [ERROR] Dependency installation failed. Check the network and retry.
goto failed

:failed
echo.
pause
exit /b 1
