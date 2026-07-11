@echo off
setlocal enableextensions
title Project Starfish
color 0E

rem ============================================================
rem  Project Starfish launcher (a fork of Munder Difflin)
rem  Double-click this file to start the app. No command line
rem  knowledge needed - this window does the work for you.
rem  Closing this window stops the app.
rem ============================================================

rem Move into the app folder (this .bat sits one level above it)
cd /d "%~dp0Project Starfish"
if errorlevel 1 (
  echo.
  echo [X] Could not find the "Project Starfish" app folder next to this launcher.
  echo     Keep this .bat file in the same place you found it.
  echo.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo.
  echo [X] This does not look like the app folder ^(no package.json found^).
  echo     Expected: "%cd%"
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================
echo    Starting Project Starfish...
echo  ============================================
echo.

rem --- Check Node.js is installed -----------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js is not installed on this computer.
  echo.
  echo      Project Starfish needs Node.js 18 or newer to run.
  echo      1^) Go to https://nodejs.org
  echo      2^) Download and install the "LTS" version
  echo      3^) Then double-click this launcher again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set "NODEV=%%v"
echo  [ok] Node.js found ^(%NODEV%^)

rem --- First-run setup: install dependencies ------------------
if not exist "node_modules" (
  echo.
  echo  First-time setup detected. Installing the app's parts...
  echo  ^(This happens only once and may take several minutes.^)
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  [X] Setup did not finish cleanly.
    echo.
    echo      Most often this means the Windows build tools are missing
    echo      ^(needed to build the terminal component^). Install them with:
    echo        - "Desktop development with C++" from Visual Studio Build Tools
    echo          https://visualstudio.microsoft.com/visual-cpp-build-tools/
    echo      Then double-click this launcher again.
    echo.
    pause
    exit /b 1
  )
  echo.
  echo  [ok] Setup complete.
)

rem --- Launch the app -----------------------------------------
echo.
echo  Opening the Project Starfish window...
echo  ^(Leave this small window open while you use the app.
echo    Closing it will close Project Starfish.^)
echo.
call npm run dev

echo.
echo  Project Starfish has closed. You can close this window.
pause
