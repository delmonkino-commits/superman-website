@echo off
cd /d "%~dp0"
title SuperMan - Free setup
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or higher is required. Get it for free: https://nodejs.org/
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git is required. Get it for free: https://git-scm.com/downloads
  pause
  exit /b 1
)
call npm run setup
if errorlevel 1 echo Setup failed. Check the instructions in README.md.
pause
