param()

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $ProjectDir 'scripts\launch-local-app.js'

if (-not (Test-Path $Launcher)) {
  throw "Could not find $Launcher. Make sure this file stays next to the scripts folder."
}

function Resolve-NodeCommand {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command -and $command.Source) { return $command.Source }

  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command -and $command.Source) { return $command.Source }

  function Join-OptionalPath {
    param([string]$Root, [string]$Child)
    if ([string]::IsNullOrWhiteSpace($Root)) { return $null }
    return Join-Path $Root $Child
  }

  $candidates = @(
    (Join-OptionalPath ${env:ProgramFiles} 'nodejs\node.exe'),
    (Join-OptionalPath ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
    (Join-OptionalPath ${env:LOCALAPPDATA} 'Programs\nodejs\node.exe')
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }

  return $null
}

$node = Resolve-NodeCommand
if (-not $node) {
  throw 'Node.js was not found. Install Node.js, restart Windows if needed, then launch Salesforce Duplicate Reviewer again.'
}

& $node $Launcher
exit $LASTEXITCODE
