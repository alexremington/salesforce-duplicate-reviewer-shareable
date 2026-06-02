@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "NODE_SCRIPT=%SCRIPT_DIR%scripts\launch-local-app.js"

if not exist "%NODE_SCRIPT%" (
  echo Could not find "%NODE_SCRIPT%".
  echo Make sure this file stays next to the scripts folder.
  pause
  exit /b 1
)

set "NODE_EXE="
where node.exe >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node.exe"

if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE_EXE (
  echo Node.js is required to launch Salesforce Duplicate Reviewer.
  echo Install Node.js, close this window, then try again.
  echo If Node.js is already installed, restart Windows or add it to PATH.
  pause
  exit /b 1
)

"%NODE_EXE%" "%NODE_SCRIPT%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Salesforce Duplicate Reviewer failed to launch.
  echo Exit code: %EXIT_CODE%
  echo Review the messages above, then press any key to close this window.
  pause >nul
)

exit /b %EXIT_CODE%
