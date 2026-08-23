<#
.SYNOPSIS
  Deploys site/ to Cloudflare Pages, discovering the project name rather than guessing it.

.USAGE
  Right-click -> "Run with PowerShell", or:
      powershell -ExecutionPolicy Bypass -File .\Deploy-Site.ps1

.WHY THIS EXISTS
  `wrangler pages deploy` needs three things that are easy to get wrong by hand:
    1. The ASSET DIRECTORY, named explicitly. Standing in site/ is not enough -- wrangler still
       errors with "Must specify a directory of assets to deploy". (site/wrangler.toml now supplies
       it via pages_build_output_dir, but this script passes it anyway so it works either way.)
    2. The PROJECT NAME. Get it wrong and wrangler offers to CREATE a new project rather than
       failing -- silently producing a second, unlinked site. This script lists your real projects
       and makes you pick, so that cannot happen by typo.
    3. A clean publish root. Pages uploads EVERYTHING in the directory, so a stray zip becomes a
       public URL. Step 2 checks for that before anything is uploaded.

.WHAT IT DOES
  1/5  Preflight -- repo path, wrangler present, logged in.
  2/5  Publish-root audit -- lists exactly what would go live, and refuses on archives/junk.
  3/5  Project discovery -- lists your Cloudflare Pages projects and confirms the target.
  4/5  Deploy (asks first).
  5/5  Post-deploy verification -- fetches the live page and checks the corrected v0.27.0 claims
       are actually being served, rather than trusting that the upload worked.
#>

param(
  [string]$RepoPath   = "C:\Users\swhol\Documents\Github\Starfish",
  [string]$SiteDir    = "site",
  [string]$ProjectName = "",                       # blank = discover interactively
  [string]$LiveUrl    = "https://projectstarfish.ca"
)

$ErrorActionPreference = 'Stop'
$total = 5
function Write-Step { param([int]$N,[string]$T)
  Write-Host ""; Write-Host ("=" * 78) -ForegroundColor DarkCyan
  Write-Host "  Step $N/$total  --  $T" -ForegroundColor Cyan
  Write-Host ("=" * 78) -ForegroundColor DarkCyan
}
function Confirm-Yes { param([string]$P) return ((Read-Host "$P [y/N]") -match '^(y|yes)$') }
function Fail-Out { param([string]$M) Write-Host ""; Write-Host $M -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

# ---------------------------------------------------------------------------
Write-Step 1 "Preflight"
# ---------------------------------------------------------------------------
if ($RepoPath -match 'OneDrive') { Fail-Out "That path is under OneDrive -- use the local clone." }
if (-not (Test-Path $RepoPath))  { Fail-Out "Repo not found: $RepoPath" }
Set-Location $RepoPath
$assets = Join-Path $RepoPath $SiteDir
if (-not (Test-Path $assets)) { Fail-Out "Asset directory not found: $assets" }

Write-Host "Repo:   $RepoPath"
Write-Host "Assets: $assets"
$wranglerVersion = (& npx wrangler --version 2>&1 | Select-Object -First 1)
if ($LASTEXITCODE -ne 0) { Fail-Out "wrangler not available. Install with:  npm i -g wrangler" }
Write-Host "Wrangler: $wranglerVersion"

$who = & npx wrangler whoami 2>&1 | Out-String
if ($who -match 'not authenticated|You are not logged in') {
  Write-Host "Not logged in to Cloudflare." -ForegroundColor Red
  if (Confirm-Yes "Run 'wrangler login' now (opens a browser)") { & npx wrangler login }
  else { Fail-Out "Cannot deploy without auth." }
}
Write-Host ($who.Trim() -split "`n" | Select-Object -First 6) -ForegroundColor Gray

# ---------------------------------------------------------------------------
Write-Step 2 "What would go live"
# ---------------------------------------------------------------------------
# Pages publishes the WHOLE directory. Anything sitting here becomes a fetchable URL, so show the
# operator the actual payload before uploading rather than after someone finds it.
$files = Get-ChildItem $assets -Recurse -File | Where-Object { $_.Name -ne '.assetsignore' }
Write-Host "$($files.Count) file(s), $([math]::Round(($files | Measure-Object Length -Sum).Sum/1KB,1)) KB total:" -ForegroundColor Yellow
$files | ForEach-Object { Write-Host ("  /{0}" -f ($_.FullName.Substring($assets.Length+1) -replace '\\','/')) -ForegroundColor Gray }

$junk = $files | Where-Object { $_.Extension -in '.zip','.tgz','.tar','.bak' -or $_.Name -like '*.bak-*' }
if ($junk) {
  Write-Host ""
  Write-Host "These are archives and would become PUBLIC download URLs:" -ForegroundColor Red
  $junk | ForEach-Object { Write-Host ("  ! /{0}" -f ($_.FullName.Substring($assets.Length+1) -replace '\\','/')) -ForegroundColor Red }
  Write-Host "Add them to $SiteDir\.assetsignore or move them out, then re-run." -ForegroundColor Yellow
  Fail-Out "Refusing to publish archives."
}
Write-Host ""
Write-Host "No archives or junk in the publish root." -ForegroundColor Green

# ---------------------------------------------------------------------------
Write-Step 3 "Which Pages project"
# ---------------------------------------------------------------------------
# A WRONG name does not error -- wrangler offers to create a new project, which silently gives you a
# second site nobody is looking at. So enumerate the real ones and pick from them.
Write-Host "Fetching your Cloudflare Pages projects..." -ForegroundColor Yellow
$listRaw = & npx wrangler pages project list 2>&1 | Out-String
Write-Host $listRaw -ForegroundColor Gray

if ([string]::IsNullOrWhiteSpace($ProjectName)) {
  Write-Host "Pick the project that serves $LiveUrl (exact name, from the table above)." -ForegroundColor Yellow
  $ProjectName = (Read-Host "Project name").Trim()
}
if ([string]::IsNullOrWhiteSpace($ProjectName)) { Fail-Out "No project name given." }

if ($listRaw -notmatch [regex]::Escape($ProjectName)) {
  Write-Host ""
  Write-Host "'$ProjectName' does not appear in your project list." -ForegroundColor Red
  Write-Host "Deploying anyway would CREATE a new project instead of updating the live site." -ForegroundColor Red
  if (-not (Confirm-Yes "Continue regardless (only if you are certain)")) { Fail-Out "Stopped." }
}
Write-Host "Target project: $ProjectName" -ForegroundColor Green

# ---------------------------------------------------------------------------
Write-Step 4 "Deploy"
# ---------------------------------------------------------------------------
Write-Host "About to upload $($files.Count) file(s) to Pages project '$ProjectName'." -ForegroundColor Yellow
Write-Host "This replaces the live production deployment for $LiveUrl." -ForegroundColor Yellow
if (-not (Confirm-Yes "Deploy now")) { Fail-Out "Stopped -- nothing uploaded." }

$start = Get-Date
& npx wrangler pages deploy $assets --project-name=$ProjectName
$deployExit = $LASTEXITCODE
Write-Host ("Elapsed: {0:mm}m {0:ss}s" -f ((Get-Date) - $start)) -ForegroundColor DarkGray
if ($deployExit -ne 0) { Fail-Out "wrangler pages deploy failed (exit $deployExit) -- see output above." }
Write-Host "Deployed." -ForegroundColor Green

# ---------------------------------------------------------------------------
Write-Step 5 "Verify the LIVE site actually changed"
# ---------------------------------------------------------------------------
# "wrangler said OK" is not evidence the corrected copy is being served -- CDN caching, a wrong
# project, or a preview-vs-production mixup all look like success at the CLI. Check the bytes.
Write-Host "Waiting 10s for propagation..." -ForegroundColor Gray
Start-Sleep -Seconds 10

$checks = @(
  @{ Url = "$LiveUrl/starfish-vs-hermes/"; Must = 'not in the current release'; Why = 'Arena is roadmap-labelled (was claimed as live)' },
  @{ Url = "$LiveUrl/starfish-vs-hermes/"; Must = 'scope contract';             Why = 'non-deviation claim (true as of v0.27.0)' },
  @{ Url = "$LiveUrl/";                    Must = 'Turn on task-binding';       Why = 'task-binding qualified (was unconditional)' },
  @{ Url = "$LiveUrl/blog/toby-and-hank.html";     Must = 'Update, 2026-08-20'; Why = 'dated correction note (F-2/F-8)' },
  @{ Url = "$LiveUrl/blog/the-1.0-candidate.html"; Must = 'Update, 2026-08-20'; Why = 'dated correction note (F-1)' }
)
$bad = 0
foreach ($c in $checks) {
  try {
    $body = (Invoke-WebRequest -Uri $c.Url -UseBasicParsing -Headers @{ 'Cache-Control' = 'no-cache' }).Content
    if ($body -match [regex]::Escape($c.Must)) { Write-Host ("  ok    {0}  --  {1}" -f $c.Url, $c.Why) -ForegroundColor Green }
    else { Write-Host ("  STALE {0}  --  missing: {1}" -f $c.Url, $c.Why) -ForegroundColor Red; $bad++ }
  } catch { Write-Host ("  ERROR {0}  --  {1}" -f $c.Url, $_.Exception.Message) -ForegroundColor Red; $bad++ }
}

Write-Host ""
if ($bad -eq 0) {
  Write-Host "All $($checks.Count) live checks passed -- the corrected v0.27.0 claims are being served." -ForegroundColor Green
} else {
  Write-Host "$bad of $($checks.Count) checks did not find the expected text." -ForegroundColor Red
  Write-Host "Usually CDN cache. Purge in the Cloudflare dashboard (Caching -> Purge Everything)," -ForegroundColor Yellow
  Write-Host "wait a minute, and re-run. If it persists, the deploy may have gone to a different project." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Reminder: the vs-hermes page carries FAQPage JSON-LD. Once live, validate at" -ForegroundColor Gray
Write-Host "  https://search.google.com/test/rich-results" -ForegroundColor Gray
Read-Host "Press Enter to close"
