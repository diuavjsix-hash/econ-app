@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\server.ps1" -Action menu %*
if errorlevel 1 pause
