param()

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Import-DotEnv {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) { continue }

    $parts = $trimmed.Split('=', 2)
    $key = $parts[0].Trim()
    if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
    if ([Environment]::GetEnvironmentVariable($key, 'Process')) { continue }

    $value = $parts[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($key, $value, 'Process')
  }
}

Import-DotEnv (Join-Path $ProjectDir '.env')

$Port = if ($env:DUPLICATE_REVIEWER_PORT) { $env:DUPLICATE_REVIEWER_PORT } elseif ($env:PORT) { $env:PORT } else { '5180' }
$Url = "http://127.0.0.1:$Port"
$LogDir = Join-Path $ProjectDir 'logs'
$OutLog = Join-Path $LogDir 'duplicate-reviewer.out.log'
$ErrLog = Join-Path $LogDir 'duplicate-reviewer.err.log'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Get-DuplicateReviewerHealth {
  try {
    return Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 2
  } catch {
    return $null
  }
}

function Test-DuplicateReviewer {
  $health = Get-DuplicateReviewerHealth
  return Test-DuplicateReviewerHealth $health
}

function Test-DuplicateReviewerHealth {
  param($Health)
  $health = $Health
  if (-not $health) { return $false }
  return $health.appId -eq 'salesforce-duplicate-reviewer' -or $health.salesforceMerge -eq $true
}

function Test-DuplicateReviewerRequiredFeatures {
  param($Health)
  if (-not (Test-DuplicateReviewerHealth $Health)) { return $false }
  return $Health.salesforceMerge -eq $true -and $Health.latestStagingFiles -eq $true
}

function Test-PortListening {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.ConnectAsync('127.0.0.1', [int]$Port)
    if (-not $connect.Wait(250)) { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Start-DuplicateReviewerServer {
  Write-Host 'Starting Salesforce Duplicate Reviewer...'
  Start-Process `
    -FilePath 'cmd.exe' `
    -ArgumentList "/c set PORT=$Port&& npm start >> `"$OutLog`" 2>> `"$ErrLog`"" `
    -WorkingDirectory $ProjectDir `
    -WindowStyle Hidden
}

$Health = Get-DuplicateReviewerHealth
if (-not (Test-DuplicateReviewerHealth $Health)) {
  if (Test-PortListening) {
    throw "Port $Port is already in use by a different local process. Stop that process or set DUPLICATE_REVIEWER_PORT in .env."
  }
  Start-DuplicateReviewerServer
} elseif (-not (Test-DuplicateReviewerRequiredFeatures $Health)) {
  if (-not $Health.pid) {
    throw "Salesforce Duplicate Reviewer is running but needs to be restarted for current features. Stop the existing server on port $Port, then run this launcher again."
  }
  Write-Host 'Restarting Salesforce Duplicate Reviewer to enable current features...'
  Stop-Process -Id ([int]$Health.pid) -Force -ErrorAction SilentlyContinue
  for ($attempt = 1; $attempt -le 40; $attempt += 1) {
    if (-not (Test-PortListening)) { break }
    Start-Sleep -Milliseconds 250
  }
  if (Test-PortListening) {
    throw "Port $Port is still in use after restart attempt. Stop the existing server, then run this launcher again."
  }
  Start-DuplicateReviewerServer
} else {
  Write-Host 'Salesforce Duplicate Reviewer is already running.'
}

Write-Host "Waiting for $Url..."
for ($attempt = 1; $attempt -le 40; $attempt += 1) {
  if (Test-DuplicateReviewer) {
    Write-Host "Opening $Url"
    Start-Process $Url
    exit 0
  }

  Start-Sleep -Milliseconds 250
}

Write-Error "The duplicate reviewer did not become ready in time. Stdout: $OutLog Stderr: $ErrLog"
