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

Write-Host 'Checking closeout Beads regression...'
& node scripts/check-closeout-beads.js
if ($LASTEXITCODE -ne 0) {
  throw 'Closeout Beads regression failed.'
}

Write-Host 'Checking server contracts...'
& node scripts/check-server-contracts.js
if ($LASTEXITCODE -ne 0) {
  throw 'Server contract checks failed.'
}

Write-Host 'Checking prod Contacts output repair...'
& node scripts/check-prod-contacts-output-repair.js
if ($LASTEXITCODE -ne 0) {
  throw 'Prod Contacts output repair checks failed.'
}

Write-Host 'Checking duplicate labels export defaults...'
$labelsDryRun = (& node scripts/run-salesforce-duplicate-label-export.js --object contact --dry-run) -join "`n"
$expectedLabelsSource = if ($IsWindows) {
  'Source CSV: $env:APPDATA\Salesforce Pulls\Duplicate Reviewer\staging\Output\staging-contacts\salesforce-report-latest.csv'
} else {
  "Source CSV: $HOME/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-contacts/salesforce-report-latest.csv"
}
if ($labelsDryRun -notmatch [regex]::Escape($expectedLabelsSource)) {
  Write-Host $labelsDryRun
  throw 'Duplicate labels export did not default to the canonical staging Contacts CSV.'
}

Write-Host 'Checking staging routing defaults...'
$contactsOutDir = 'C:/Users/runneradmin/OneDrive - POLITICO/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-contacts'
$accountsOutDir = 'C:/Users/runneradmin/OneDrive - POLITICO/Salesforce Pulls/Duplicate Reviewer/staging/Output/staging-accounts'
$prodContactsOutDir = 'C:/Users/runneradmin/OneDrive - POLITICO/Salesforce Pulls/Duplicate Reviewer/prod/Output/prod-contacts'
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
if ($contactsDryRun -notmatch 'Latest JSON: .*[\\/]Salesforce Pulls[\\/]Duplicate Reviewer[\\/]staging[\\/]Output[\\/]staging-contacts[\\/]salesforce-report-latest.json') {
  Write-Host $contactsDryRun
  throw 'Staging Contacts did not preserve the canonical latest JSON output flow.'
}
if ($contactsDryRun -notmatch 'Compatibility CSV: .*[\\/]Salesforce Pulls[\\/]Duplicate Reviewer[\\/]staging[\\/]Output[\\/]staging-contacts[\\/]salesforce-report-latest.csv') {
  Write-Host $contactsDryRun
  throw 'Staging Contacts did not preserve the canonical compatibility CSV output flow.'
}
$env:OUT_DIR = $prodContactsOutDir
$prodContactsDryRun = (& scripts/run-prod-contacts-bulk-query.sh --dry-run) -join "`n"
if ($prodContactsDryRun -notmatch '/Salesforce Pulls/Duplicate Reviewer/prod/Output/prod-contacts') {
  Write-Host $prodContactsDryRun
  throw 'Prod Contacts did not resolve to the canonical Salesforce Pulls prod folder.'
}
if ($prodContactsDryRun -notmatch 'Org alias: politico') {
  Write-Host $prodContactsDryRun
  throw 'Prod Contacts did not use the canonical prod Salesforce org alias.'
}
if ($prodContactsDryRun -notmatch 'Instance: https://login.salesforce.com') {
  Write-Host $prodContactsDryRun
  throw 'Prod Contacts did not use the canonical prod Salesforce instance URL.'
}
if ($prodContactsDryRun -notmatch 'SOQL file: .*/queries/report-00OVq00000CxYd3MAF.soql') {
  Write-Host $prodContactsDryRun
  throw 'Prod Contacts did not use the canonical prod Contacts query file.'
}
if ($prodContactsDryRun -notmatch 'Latest JSON: .*/Salesforce Pulls/Duplicate Reviewer/prod/Output/prod-contacts/salesforce-prod-contacts-latest.json') {
  Write-Host $prodContactsDryRun
  throw 'Prod Contacts did not preserve the canonical prod latest JSON output flow.'
}
if ($prodContactsDryRun -notmatch 'Compatibility CSV: .*/Salesforce Pulls/Duplicate Reviewer/prod/Output/prod-contacts/salesforce-prod-contacts-latest.csv') {
  Write-Host $prodContactsDryRun
  throw 'Prod Contacts did not preserve the canonical prod compatibility CSV output flow.'
}
$prodLauncher = Get-Content scripts/run-prod-contacts-bulk-query.sh -Raw
if ($prodLauncher -notmatch 'autoload_url="\$\{reviewer_url\}/\?autoload=prod-contacts&object=contact&notify=1&sticky=1&name=\$\{LATEST_JSON_NAME\}"') {
  throw 'Prod Contacts launcher did not open Duplicate Reviewer with the expected prod handoff URL.'
}
if ($prodLauncher -notmatch 'prod-contacts-output-repair\.js') {
  throw 'Prod Contacts launcher did not invoke the canonical output repair helper.'
}
if ($prodLauncher -notmatch 'reviewer_url="\$\("\$\{PROJECT_DIR\}/scripts/start-reviewer-server.sh" \| tail -n 1\)"') {
  throw 'Prod Contacts launcher did not start or reuse the reviewer server before opening the URL.'
}
if ($prodLauncher -notmatch 'name=\$\{LATEST_JSON_NAME\}') {
  throw 'Prod Contacts launcher did not target the prod latest JSON file.'
}
$startServer = Get-Content scripts/start-reviewer-server.sh -Raw
if ($startServer -notmatch 'PROD_CONTACTS_CSV') {
  throw 'Reviewer launcher did not pass the canonical prod Contacts CSV path to the server.'
}
$bulkQueryWrapper = Get-Content scripts/run-salesforce-bulk-query.sh -Raw
if ($bulkQueryWrapper -notmatch 'sf org display') {
  throw 'Bulk query wrapper did not use sf org display.'
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
if ($accountsDryRun -notmatch 'Latest JSON: .*[\\/]Salesforce Pulls[\\/]Duplicate Reviewer[\\/]staging[\\/]Output[\\/]staging-accounts[\\/]salesforce-report-latest.json') {
  Write-Host $accountsDryRun
  throw 'Staging Accounts did not preserve the canonical latest JSON output flow.'
}
if ($accountsDryRun -notmatch 'Compatibility CSV: .*[\\/]Salesforce Pulls[\\/]Duplicate Reviewer[\\/]staging[\\/]Output[\\/]staging-accounts[\\/]salesforce-report-latest.csv') {
  Write-Host $accountsDryRun
  throw 'Staging Accounts did not preserve the canonical compatibility CSV output flow.'
}
$stagingAccountsLauncher = Get-Content scripts/run-staging-accounts-bulk-query.sh -Raw
if ($stagingAccountsLauncher -notmatch 'start-reviewer-server.sh" --force-refresh') {
  throw 'Staging Accounts launcher did not force-refresh the reviewer server before opening the URL.'
}
$startServer = Get-Content scripts/start-reviewer-server.sh -Raw
if ($startServer -notmatch 'FORCE_REFRESH=0' -or $startServer -notmatch '--force-refresh') {
  throw 'Reviewer launcher did not add a force-refresh mode.'
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
