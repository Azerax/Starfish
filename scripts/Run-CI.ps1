<#
.SYNOPSIS
  Runs the full Starfish CI chain locally and reports EVERY stage, not just the first failure.

.DESCRIPTION
  `npm run ci` chains its stages with &&, so it stops at the first non-zero exit. That is correct for
  a gate and unhelpful for triage: you fix one thing, re-run, wait, and discover the next one. This
  runs each stage independently, keeps going after a failure, writes per-stage logs, and prints one
  summary table at the end.

  Same stages as .github/workflows/ci.yml, in the same order, plus the two Azure stages that
  `npm run ci` includes and the workflow does not.

.PARAMETER Quick
  Only the stages affected by governance-core policy changes: typecheck, conformance, determinism,
  dep lint. Skips the scans, SBOM, Azure and the CLI bundle. Use while iterating.

.PARAMETER Stage
  Run only the named stage(s). Accepts npm script names, e.g. -Stage test:conformance,lint:deps

.PARAMETER KeepLogs
  Keep the log directory even when everything passes (default: kept only if something failed).

.EXAMPLE
  .\scripts\Run-CI.ps1
.EXAMPLE
  .\scripts\Run-CI.ps1 -Quick
.EXAMPLE
  .\scripts\Run-CI.ps1 -Stage test:conformance
#>

[CmdletBinding()]
param(
  [switch] $Quick,
  [string[]] $Stage,
  [switch] $KeepLogs
)

# npm writes progress and warnings to stderr. With $ErrorActionPreference = 'Stop' that aborts the
# script on a perfectly healthy stage, so exit codes are checked explicitly instead.
$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Write-Head($text) {
  Write-Host ''
  Write-Host ('=' * 78) -ForegroundColor DarkGray
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host ('=' * 78) -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Pre-flight. Cheap checks that explain a confusing failure before it happens.
# ---------------------------------------------------------------------------
Write-Head 'Pre-flight'

if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) {
  Write-Host "ERROR: no package.json in $RepoRoot - is this the Starfish repo root?" -ForegroundColor Red
  exit 2
}

foreach ($exe in 'node', 'npm') {
  $cmd = Get-Command $exe -ErrorAction SilentlyContinue
  if (-not $cmd) { Write-Host "ERROR: '$exe' is not on PATH." -ForegroundColor Red; exit 2 }
}

$nodeVer = (& node --version) 2>$null
Write-Host "  repo        : $RepoRoot"
Write-Host "  node        : $nodeVer   (CI uses 20)"
Write-Host "  npm         : $((& npm --version) 2>$null)"

if ($nodeVer -notmatch '^v20\.') {
  Write-Host "  NOTE: CI pins Node 20. A different major can pass or fail differently." -ForegroundColor Yellow
}

if (-not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
  Write-Host "  node_modules: MISSING - run 'npm ci' first." -ForegroundColor Red
  exit 2
}
Write-Host "  node_modules: present"

# Commit + tree state, so a pasted summary is attributable to a known state.
$gitOk = $null -ne (Get-Command git -ErrorAction SilentlyContinue)
if ($gitOk) {
  $sha    = (& git rev-parse --short HEAD) 2>$null
  $branch = (& git rev-parse --abbrev-ref HEAD) 2>$null
  $dirty  = (& git status --porcelain) 2>$null
  $dirtyN = if ($dirty) { ($dirty | Measure-Object).Count } else { 0 }
  Write-Host "  commit      : $sha on $branch"
  Write-Host "  working tree: $(if ($dirtyN -eq 0) { 'clean' } else { "$dirtyN uncommitted file(s)" })"
}

# ---------------------------------------------------------------------------
# Stage list. Mirrors .github/workflows/ci.yml, plus the Azure stages from `npm run ci`.
# ---------------------------------------------------------------------------
$AllStages = @(
  @{ Name = 'scan:secrets';      Why = 'secret scan (supply chain)' }
  @{ Name = 'typecheck';         Why = 'tsc --noEmit, type layer' }
  @{ Name = 'typecheck:azure';   Why = 'tsc --noEmit, azure tsconfig' }
  @{ Name = 'test';              Why = 'all unit tests' }
  @{ Name = 'test:conformance';  Why = 'conformance suites' }
  @{ Name = 'test:determinism';  Why = 'determinism suites' }
  @{ Name = 'lint:deps';         Why = 'ring order core<hooks<sdk<overlay<desktop<ui' }
  @{ Name = 'smoke:azure';       Why = 'azure adapter smoke' }
  @{ Name = 'scan:ip';           Why = 'IP denylist (compliance)' }
  @{ Name = 'sbom';              Why = 'SBOM + license check' }
  @{ Name = 'build:cli';         Why = 'CLI bundle' }
)

$QuickNames = @('typecheck', 'test:conformance', 'test:determinism', 'lint:deps')

if ($Stage) {
  $unknown = $Stage | Where-Object { $_ -notin $AllStages.Name }
  if ($unknown) {
    Write-Host "ERROR: unknown stage(s): $($unknown -join ', ')" -ForegroundColor Red
    Write-Host "Valid: $($AllStages.Name -join ', ')"
    exit 2
  }
  $stages = $AllStages | Where-Object { $_.Name -in $Stage }
} elseif ($Quick) {
  $stages = $AllStages | Where-Object { $_.Name -in $QuickNames }
} else {
  $stages = $AllStages
}

$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir = Join-Path $env:TEMP "starfish-ci-$stamp"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

Write-Host "  logs        : $logDir"
Write-Host "  stages      : $($stages.Count)$(if ($Quick) { '  (-Quick)' })"

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
$results  = [System.Collections.Generic.List[object]]::new()
$overall  = [System.Diagnostics.Stopwatch]::StartNew()

foreach ($s in $stages) {
  $name = $s.Name
  Write-Head "$name  --  $($s.Why)"

  $logFile = Join-Path $logDir ("{0}.log" -f ($name -replace '[:\\/]', '_'))
  $sw = [System.Diagnostics.Stopwatch]::StartNew()

  # 2>&1 merges stderr so the log is the whole story. Tee-Object shows it live AND keeps it.
  & npm run $name 2>&1 | Tee-Object -FilePath $logFile
  $code = $LASTEXITCODE

  $sw.Stop()
  $ok = ($code -eq 0)

  # Pull a vitest-style tally out of the log when there is one, so the summary is informative.
  $tally = ''
  if (Test-Path $logFile) {
    $line = Select-String -Path $logFile -Pattern 'Tests\s+\d+\s+(passed|failed)' -ErrorAction SilentlyContinue |
            Select-Object -Last 1
    if ($line) { $tally = ($line.Line -replace '\s+', ' ').Trim() }
  }

  $results.Add([pscustomobject]@{
    Stage   = $name
    Result  = if ($ok) { 'PASS' } else { "FAIL ($code)" }
    Seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    Detail  = $tally
    Log     = $logFile
    Ok      = $ok
  })

  if ($ok) { Write-Host "  -> PASS  ($([math]::Round($sw.Elapsed.TotalSeconds,1))s)" -ForegroundColor Green }
  else     { Write-Host "  -> FAIL  exit $code  ($([math]::Round($sw.Elapsed.TotalSeconds,1))s)" -ForegroundColor Red }
}

$overall.Stop()

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Head 'Summary'
$results | Format-Table Stage, Result, Seconds, Detail -AutoSize

$failed = @($results | Where-Object { -not $_.Ok })
Write-Host ("total: {0:N1}s   passed: {1}   failed: {2}" -f `
  $overall.Elapsed.TotalSeconds, ($results.Count - $failed.Count), $failed.Count)

if ($failed.Count -gt 0) {
  Write-Host ''
  Write-Host 'FAILED STAGES' -ForegroundColor Red
  foreach ($f in $failed) {
    Write-Host ("  {0}" -f $f.Stage) -ForegroundColor Red
    Write-Host ("    log: {0}" -f $f.Log) -ForegroundColor DarkGray
    # First few failure-ish lines, so the console tells you enough to decide what to open.
    # ASCII-only pattern on purpose: this file has no BOM, and PowerShell 5.1 reads a BOM-less file
    # as ANSI, which mangles non-ASCII literals. The vitest cross/check glyphs would not match.
    $hits = Select-String -Path $f.Log -Pattern '(FAIL|AssertionError|error TS\d+|Error:|failed)' -ErrorAction SilentlyContinue |
            Select-Object -First 8
    foreach ($h in $hits) { Write-Host ("    {0}" -f ($h.Line.Trim())) -ForegroundColor DarkYellow }
  }
  Write-Host ''
  Write-Host "All logs: $logDir" -ForegroundColor Yellow
  Write-Host 'Re-run one stage with:  .\scripts\Run-CI.ps1 -Stage <name>' -ForegroundColor DarkGray
  exit 1
}

Write-Host ''
Write-Host 'ALL STAGES PASSED' -ForegroundColor Green
if (-not $KeepLogs) {
  Remove-Item $logDir -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "Logs kept: $logDir" -ForegroundColor DarkGray
}
exit 0
