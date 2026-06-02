param()

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $ProjectDir 'scripts\launch-local-app.js'

if (-not (Test-Path $Launcher)) {
  throw "Could not find $Launcher. Make sure this file stays next to the scripts folder."
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
  $node = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $node -or -not $node.Source) {
  throw 'Node.js was not found on PATH. Install Node.js, close this window, then launch Salesforce Duplicate Reviewer again.'
}

& $node.Source $Launcher
exit $LASTEXITCODE
