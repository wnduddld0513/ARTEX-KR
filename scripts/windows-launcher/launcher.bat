@echo off
setlocal
chcp 65001 >nul 2>&1
title ARTEX-KR
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1" %*
exit /b %ERRORLEVEL%
