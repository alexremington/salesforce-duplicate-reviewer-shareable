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

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to launch Salesforce Duplicate Reviewer.
  echo Install Node.js, close this window, then try again.
  pause
  exit /b 1
)

node "%NODE_SCRIPT%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Salesforce Duplicate Reviewer failed to launch.
  echo Exit code: %EXIT_CODE%
  echo Review the messages above, then press any key to close this window.
  pause >nul
)

exit /b %EXIT_CODE%
