@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\wiki-editor\start.ps1"
if errorlevel 1 pause
