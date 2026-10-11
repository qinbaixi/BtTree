@echo off
rem One-click desktop build for Windows: installs dependencies when needed, builds the installer and
rem the portable exe into release\. Set OWLBT_NONINTERACTIVE=1 to skip Explorer and the final pause.
setlocal EnableExtensions
cd /d "%~dp0"
set "EXIT_CODE=0"

where node >nul 2>&1
if errorlevel 1 (
  echo owl-bt: Node.js was not found. Install Node.js 22.12 or newer from https://nodejs.org and run this file again.
  set "EXIT_CODE=1"
)

if "%EXIT_CODE%"=="0" (
  where npm >nul 2>&1
  if errorlevel 1 (
    echo owl-bt: npm was not found. It normally comes with Node.js; reinstall Node.js and run this file again.
    set "EXIT_CODE=1"
  )
)

if "%EXIT_CODE%"=="0" (
  if not exist "node_modules" (
    echo owl-bt: installing dependencies with npm ci
    call npm ci
    if errorlevel 1 set "EXIT_CODE=1"
  )
)

if "%EXIT_CODE%"=="0" (
  echo owl-bt: building the desktop app with npm run package
  call npm run package
  if errorlevel 1 set "EXIT_CODE=1"
)

if "%EXIT_CODE%"=="0" (
  echo owl-bt: build finished. Release folder: "%~dp0release"
  if not "%OWLBT_NONINTERACTIVE%"=="1" explorer "%~dp0release"
  exit /b 0
)

echo owl-bt: the build failed. See the messages above.
if not "%OWLBT_NONINTERACTIVE%"=="1" pause
exit /b 1
