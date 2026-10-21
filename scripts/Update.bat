@echo off
setlocal
set "UPDATE_SHARE=Z:\ChessExplorer\updates"
if not exist "%UPDATE_SHARE%\Update-App.ps1" (
    echo Update folder unavailable: %UPDATE_SHARE%
    echo Check that drive Z: is connected and an update has been published.
    pause
    exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%UPDATE_SHARE%\Update-App.ps1" -InstallDirectory "%~dp0app" -ShareDirectory "%UPDATE_SHARE%" %*
set "UPDATE_RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %UPDATE_RESULT%
