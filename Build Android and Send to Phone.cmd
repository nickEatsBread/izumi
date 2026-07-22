@echo off
setlocal
title Izumi Android Build and Install

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-android-and-install.ps1" %*
set "IZUMI_EXIT=%ERRORLEVEL%"

echo.
if not "%IZUMI_EXIT%"=="0" (
  echo Build or installation failed. Review the error above.
) else (
  echo Finished successfully.
)
echo.
pause
exit /b %IZUMI_EXIT%
