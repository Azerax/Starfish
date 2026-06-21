<#
.SYNOPSIS
  Release helper for Project Starfish: bundle + publish project-starfish to npm,
  tag the release in git, push, and (optionally) create the GitHub Release.

.DESCRIPTION
  Run from anywhere; it locates the repo root from this script's location.
  Version is read from packages/cli/package.json unless -Version is given.
  Nothing destructive happens without confirmation. Use -DryRun to preview.

.EXAMPLE
  pwsh ./scripts/release.ps1
  pwsh ./scripts/release.ps1 -DryRun
  pwsh ./scripts/release.ps1 -BackfillTags        # also tag v0.9.0 / v0.9.3 (best-effort, by commit message)
  pwsh ./scripts/release.ps1 -SkipPublish         # tag + GitHub release only
#>

[CmdletBinding()]
param(
  [string]$Version,
  [switch]$DryRun,
  [switch]$SkipPublish,
  [switch]$SkipTests,
  [switch]$BackfillTags
)

$ErrorActionPreference = 'Stop'

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" -ForegroundColor Gray }
function Warn($m) { Write-Host "    ! $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "    x $m" -ForegroundColor Red; exit 1 }
function Run($cmd) {
  Write-Host "    $ $cmd" -ForegroundColor DarkGray
  if ($DryRun) { return }
  & cmd /c $cmd
  if ($LASTEXITCODE -ne 0) { Die "command failed (exit $LASTEXITCODE): $cmd" }
}
function Confirm($m) {
  if ($DryRun) { Info "[dry-run] would ask: $m"; return $true }
  $a = Read-Host "$m [y/N]"
  return ($a -eq 'y' -or $a -eq 'Y')
}

# --- locate repo root ---
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'package.json'))) { Die "repo root not found (expected package.json at $root)" }
Set-Location $root
Step "Repo root: $root"

# --- read version ---
$cliPkgPath = Join-Path $root 'packages/cli/package.json'
if (-not (Test-Path $cliPkgPath)) { Die "missing $cliPkgPath" }
$cliPkg = Get-Content $cliPkgPath -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $cliPkg.version }
$tag = "v$Version"
Info "Package : $($cliPkg.name)"
Info "Version : $Version  (tag $tag)"
if ($cliPkg.version -ne $Version) { Warn "package.json version is $($cliPkg.version) but releasing $Version" }

# --- preflight ---
Step "Preflight checks"
try { $null = & git rev-parse --is-inside-work-tree 2>$null } catch { Die "not a git repository" }
$dirty = (& git status --porcelain)
if ($dirty) { Warn "working tree has uncommitted changes:"; (& git status --short) | ForEach-Object { Info $_ }
  if (-not (Confirm "Continue with a dirty working tree?")) { Die "aborted: commit or stash first" } }

if (& git rev-parse -q --verify "refs/tags/$tag" 2>$null) { Die "tag $tag already exists. Bump the version or delete the tag." }

if (-not $SkipPublish) {
  try { $who = (& npm whoami) 2>$null } catch { $who = $null }
  if (-not $who) { Die "not logged in to npm. Run: npm login" }
  Info "npm user: $who"
}

# --- install (so prepublishOnly can bundle) ---
Step "Install dependencies (root)"
Run "npm install --no-audit --no-fund"

# --- tests ---
if (-not $SkipTests) {
  Step "Run tests"
  Run "npm test"
} else { Warn "skipping tests (-SkipTests)" }

# --- build the CLI bundle (also run by prepublishOnly, done here for visibility) ---
Step "Build CLI bundle"
Run "npm run build:cli"

# --- publish ---
if (-not $SkipPublish) {
  Step "Publish $($cliPkg.name)@$Version to npm"
  if (Confirm "Publish to npm now?") {
    Run "npm publish -w $($cliPkg.name) --access public"
  } else { Warn "skipped npm publish" }
} else { Warn "skipping publish (-SkipPublish)" }

# --- tag + push ---
Step "Tag $tag and push"
if (Confirm "Create git tag $tag at HEAD and push it?") {
  Run "git tag -a $tag -m `"Project Starfish $tag`""
  Run "git push origin $tag"
} else { Warn "skipped tagging" }

# --- optional backfill of historical tags (best-effort, by commit subject) ---
if ($BackfillTags) {
  Step "Backfill historical tags (best-effort)"
  $map = @{ 'v0.9.0' = 'first public'; 'v0.9.3' = 'init and license' }
  foreach ($t in $map.Keys) {
    if (& git rev-parse -q --verify "refs/tags/$t" 2>$null) { Info "$t already exists, skipping"; continue }
    $sha = (& git log --all --grep $map[$t] -i --format='%H' -n 1)
    if ($sha) {
      Info "$t -> $sha  ($(& git log -1 --format='%s' $sha))"
      if (Confirm "Tag $t at that commit and push?") {
        Run "git tag -a $t $sha -m `"Project Starfish $t`""
        Run "git push origin $t"
      }
    } else { Warn "no commit matched '$($map[$t])' for $t - tag it manually if you want the changelog link to resolve" }
  }
}

# --- GitHub release ---
Step "GitHub Release"
$notes = Join-Path $root "docs/RELEASE_NOTES_$tag.md"
$hasGh = $false
try { $null = (& gh --version) 2>$null; $hasGh = ($LASTEXITCODE -eq 0) } catch { $hasGh = $false }
if ($hasGh) {
  if (Test-Path $notes) {
    if (Confirm "Create GitHub release $tag from $notes ?") {
      Run "gh release create $tag --title `"Project Starfish $tag`" --notes-file `"$notes`""
    }
  } else {
    Warn "no release notes at $notes; creating from CHANGELOG generation instead"
    if (Confirm "Create GitHub release $tag with auto-generated notes?") {
      Run "gh release create $tag --title `"Project Starfish $tag`" --generate-notes"
    }
  }
} else {
  Warn "GitHub CLI (gh) not found. Create the release manually:"
  Info "https://github.com/Azerax/Starfish/releases/new?tag=$tag"
  if (Test-Path $notes) { Info "Paste the body from: $notes" }
}

Step "Done."
Info "Released $($cliPkg.name)@$Version. Verify: https://www.npmjs.com/package/$($cliPkg.name)"
if ($DryRun) { Warn "This was a DRY RUN - nothing was changed." }
