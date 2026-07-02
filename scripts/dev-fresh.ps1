<#
.SYNOPSIS
  Reset Project Starfish onboarding and launch the desktop app in dev.

.DESCRIPTION
  Clears the two pieces of state that make the app skip first-run setup:
    <base-root>/state/onboarding.json   (the "done" flag)
    <base-root>/.starfish-init.lock     (the one-init-per-install lock)
  Then runs `npm run dev` in packages/desktop/app so the onboarding wizard
  shows again.

  The base root can vary (dev default is <app>/.starfish; onboarding may have
  picked ~/Starfish or a custom folder). With no -Root, the script clears every
  likely candidate it finds. Pass -Root to target one exactly.

  Governance seed, audit log and registry are NOT touched — only the onboarding
  flag and the init lock. Your API key in the OS keychain is untouched.

.EXAMPLE
  pwsh ./scripts/dev-fresh.ps1
  pwsh ./scripts/dev-fresh.ps1 -Root "C:\Users\swhol\Starfish"
  pwsh ./scripts/dev-fresh.ps1 -DryRun
  pwsh ./scripts/dev-fresh.ps1 -NoLaunch      # reset only, don't start dev
#>

[CmdletBinding()]
param(
  [string]$Root,
  [string]$ProjectRoot = "C:\Users\swhol\Starfish",   # the REAL base root the dev app should boot against
  [switch]$Reset,                                       # opt-in: clear onboarding + init lock (forces re-setup)
  [switch]$NoLaunch,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
function Info($m) { Write-Host "    $m" -ForegroundColor Gray }
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "    ! $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "    x $m" -ForegroundColor Red; exit 1 }

# --- locate repo + app ---
$repo = Split-Path -Parent $PSScriptRoot
$app  = Join-Path $repo 'packages/desktop/app'
if (-not (Test-Path $app)) { Die "app not found at $app" }
Step "Repo: $repo"
Info "App : $app"

# --- resolve candidate base roots ---
$candidates = New-Object System.Collections.Generic.List[string]
if ($Root) {
  $candidates.Add($Root)
} else {
  if ($env:STARFISH_PROJECT_ROOT) { $candidates.Add($env:STARFISH_PROJECT_ROOT) }
  $candidates.Add((Join-Path $app '.starfish'))          # dev default: cwd/.starfish
  $candidates.Add((Join-Path $HOME 'Starfish'))          # onboarding suggested default
}
# de-dup, keep only existing dirs
$roots = $candidates | Where-Object { $_ } | Select-Object -Unique | Where-Object { Test-Path $_ }

Step "Reset onboarding state"
if (-not $Reset) {
  Info "Skipping reset (pass -Reset to clear onboarding + init lock). Your install stays intact."
} elseif (-not $roots -or $roots.Count -eq 0) {
  Info "No existing base root found among candidates - nothing to clear (fresh install will onboard on launch)."
  foreach ($c in ($candidates | Select-Object -Unique)) { Info "  checked: $c" }
} else {
  $cleared = 0
  foreach ($r in $roots) {
    $onb  = Join-Path $r 'state/onboarding.json'
    $lock = Join-Path $r '.starfish-init.lock'
    foreach ($f in @($onb, $lock)) {
      if (Test-Path $f) {
        if ($DryRun) { Info "[dry-run] would delete: $f" }
        else { Remove-Item $f -Force; Info "deleted: $f"; $cleared++ }
      } else { Info "absent : $f" }
    }
  }
  if (-not $DryRun) { Info "Cleared $cleared file(s). Next launch will show onboarding." }
}

# --- launch dev ---
if ($NoLaunch) { Warn "skipping launch (-NoLaunch)"; exit 0 }
if ($DryRun)   { Warn "dry run - not launching"; exit 0 }

if ($ProjectRoot) { $env:STARFISH_PROJECT_ROOT = $ProjectRoot; Info "STARFISH_PROJECT_ROOT = $ProjectRoot (dev boots against your real base root)" }
Step "Launch: npm run dev  (in $app)"
Push-Location $app
try { & npm run dev } finally { Pop-Location }
