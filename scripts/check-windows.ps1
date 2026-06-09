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
& node ../automation-shared-resources/scripts/check-js-syntax.js . --exclude Output --exclude incoming --exclude logs --exclude node_modules
if ($LASTEXITCODE -ne 0) {
  throw 'JavaScript syntax checks failed.'
}

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

Write-Host 'Checking staging routing defaults...'
$contactsOutDir = 'C:/Users/runneradmin/OneDrive - POLITICO/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-contacts'
$accountsOutDir = 'C:/Users/runneradmin/OneDrive - POLITICO/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-accounts'
$env:OUT_DIR = $contactsOutDir
$contactsDryRun = (& scripts/run-staging-contacts-bulk-query.sh --dry-run) -join "`n"
if ($contactsDryRun -notmatch '/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-contacts') {
  Write-Host $contactsDryRun
  throw 'Staging Contacts did not resolve to the canonical Salesforce Pulls staging folder.'
}
if ($contactsDryRun -notmatch 'Bulk poll interval ms: 5000') {
  Write-Host $contactsDryRun
  throw 'Staging Contacts bulk polling was not pinned to the faster handoff interval.'
}
if ($contactsDryRun -notmatch 'Latest JSON: C:/Users/runneradmin/OneDrive - POLITICO/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-contacts/salesforce-report-latest.json') {
  Write-Host $contactsDryRun
  throw 'Staging Contacts did not preserve the canonical latest JSON output flow.'
}
if ($contactsDryRun -notmatch 'Compatibility CSV: C:/Users/runneradmin/OneDrive - POLITICO/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-contacts/salesforce-report-latest.csv') {
  Write-Host $contactsDryRun
  throw 'Staging Contacts did not preserve the canonical compatibility CSV output flow.'
}
$bulkQueryWrapper = Get-Content scripts/run-salesforce-bulk-query.sh -Raw
if ($bulkQueryWrapper -notmatch 'sf org auth show-access-token') {
  throw 'Bulk query wrapper did not use sf org auth show-access-token.'
}
$env:OUT_DIR = $accountsOutDir
$accountsDryRun = (& scripts/run-staging-accounts-bulk-query.sh --dry-run) -join "`n"
if ($accountsDryRun -notmatch '/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-accounts') {
  Write-Host $accountsDryRun
  throw 'Staging Accounts did not resolve to the canonical Salesforce Pulls staging folder.'
}
if ($accountsDryRun -notmatch 'Bulk poll interval ms: 5000') {
  Write-Host $accountsDryRun
  throw 'Staging Accounts bulk polling was not pinned to the faster handoff interval.'
}
if ($accountsDryRun -notmatch 'Latest JSON: C:/Users/runneradmin/OneDrive - POLITICO/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-accounts/salesforce-report-latest.json') {
  Write-Host $accountsDryRun
  throw 'Staging Accounts did not preserve the canonical latest JSON output flow.'
}
if ($accountsDryRun -notmatch 'Compatibility CSV: C:/Users/runneradmin/OneDrive - POLITICO/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-accounts/salesforce-report-latest.csv') {
  Write-Host $accountsDryRun
  throw 'Staging Accounts did not preserve the canonical compatibility CSV output flow.'
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
  -ArgumentList 'server/server.js' `
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
