@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\server.ps1" -Action stop %*
if errorlevel 1 pause
