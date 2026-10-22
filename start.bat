@echo off
cd /d "%~dp0"
if exist "%~dp0dist\MilkFrog-0.4.0-rust-x64.exe" (
  start "" "%~dp0dist\MilkFrog-0.4.0-rust-x64.exe"
  exit /b 0
)
if not exist "%~dp0rust\target\release\milkfrog.exe" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\rust.ps1" build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
start "" "%~dp0rust\target\release\milkfrog.exe"
