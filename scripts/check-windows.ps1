$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $ProjectRoot

$ExcludedParts = @('.git', 'Output', 'incoming', 'logs', 'node_modules')

function Test-IsExcludedPath {
  param([string]$Path)

  $relative = [System.IO.Path]::GetRelativePath($ProjectRoot, $Path)
  $parts = $relative -split '[\\/]'
  foreach ($part in $parts) {
    if ($ExcludedParts -contains $part) {
      return $true
    }
  }
  return $false
}

function Get-CheckedFiles {
  param([string]$Filter)

  Get-ChildItem -Path $ProjectRoot -Recurse -File -Filter $Filter |
    Where-Object { -not (Test-IsExcludedPath $_.FullName) }
}

function Test-PowerShellSyntax {
  param([string]$Path)

  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$parseErrors) | Out-Null
  if ($parseErrors.Count -gt 0) {
    $parseErrors | ForEach-Object { Write-Error "${Path}:$($_.Extent.StartLineNumber): $($_.Message)" }
    throw "PowerShell syntax check failed for $Path"
  }
}

function Invoke-NodeCheck {
  param([string]$Path)

  & node --check $Path
  if ($LASTEXITCODE -ne 0) {
    throw "JavaScript syntax check failed for $Path"
  }
}

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), 0)
  $listener.Start()
  try {
    return [int]$listener.LocalEndpoint.Port
  } finally {
    $listener.Stop()
  }
}

function Wait-ForHealth {
  param([string]$Url)

  for ($attempt = 1; $attempt -le 40; $attempt += 1) {
    try {
      Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
      return
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }

  throw "Server did not become ready at $Url"
}

Write-Host 'Checking JavaScript syntax...'
Get-CheckedFiles '*.js' | ForEach-Object { Invoke-NodeCheck $_.FullName }

Write-Host 'Checking PowerShell syntax...'
Get-CheckedFiles '*.ps1' | ForEach-Object { Test-PowerShellSyntax $_.FullName }

Write-Host 'Checking package metadata...'
& node -e "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8'))"
if ($LASTEXITCODE -ne 0) {
  throw 'package.json is not valid JSON.'
}

Write-Host 'Checking server contracts...'
& node scripts/check-server-contracts.js
if ($LASTEXITCODE -ne 0) {
  throw 'Server contract checks failed.'
}

Write-Host 'Checking Windows server startup...'
$port = Get-FreePort
$env:PORT = [string]$port
$baseUrl = "http://127.0.0.1:$port"
$outLog = Join-Path ([System.IO.Path]::GetTempPath()) 'duplicate-reviewer-windows-portability.out.log'
$errLog = Join-Path ([System.IO.Path]::GetTempPath()) 'duplicate-reviewer-windows-portability.err.log'
Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue

$process = Start-Process `
  -FilePath 'node' `
  -ArgumentList 'server.js' `
  -WorkingDirectory $ProjectRoot `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

try {
  Wait-ForHealth $baseUrl
} catch {
  if (Test-Path $outLog) { Get-Content $outLog }
  if (Test-Path $errLog) { Get-Content $errLog }
  throw
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
}

Write-Host 'Windows portability checks passed.'
