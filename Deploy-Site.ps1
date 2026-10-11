<#
.SYNOPSIS
  Manual deploy of site/ to projectstarfish.ca. The automated path is
  .github/workflows/deploy-site.yml — use this only when CI is unavailable.

.USAGE
  powershell -ExecutionPolicy Bypass -File .\Deploy-Site.ps1

.WHAT CHANGED (2026-09-26)
  This script previously deployed via Cloudflare PAGES (`wrangler pages deploy`, interactive
  `pages project list` discovery, and a `site/wrangler.toml` carrying `pages_build_output_dir`).

  All three of those were wrong:
    * projectstarfish.ca is NOT a Pages project. It is a Worker with static assets,
      `misty-bread-80fa`, with the domain bound as a custom domain. wrangler.toml at the repo root
      says so explicitly, and notes that `wrangler pages project list` "will not find it".
    * There is no site/wrangler.toml, and there never was in this layout.
    * Project discovery is now pointless: there is exactly one target and it is named in config.

  So the script deployed to the wrong product using a config file that does not exist. It is
  rewritten here rather than deleted, because the three CHECKS it carried are the valuable part and
  are now enforced in both paths (here and in the workflow).

.THE THREE FAILURE MODES THESE CHECKS EXIST FOR
  1. WRONG WORKER NAME. wrangler.toml's own warning: change `name` and wrangler creates a NEW worker
     rather than updating the live one — "a second site nobody is looking at, with no error to tell
     you." A silent success is the failure, so the name is asserted before deploying.
  2. DIRTY PUBLISH ROOT. Everything in site/ becomes a public URL, so a stray archive or .env is a
     disclosure. Refused before upload.
  3. UNVERIFIED UPLOAD. "No unbacked word" applies to deploys: a success message is not evidence the
     live site changed. The live page is fetched and compared against what is committed.
#>

param(
  [string]$RepoPath       = "C:\Users\swhol\Documents\Github\Starfish",
  [string]$SiteDir        = "site",
  [string]$ExpectedWorker = "misty-bread-80fa",
  [string]$LiveUrl        = "https://projectstarfish.ca",
  [switch]$Yes                                   # skip the confirmation prompt
)

$ErrorActionPreference = 'Stop'
$total = 5
function Write-Step { param([int]$N, [string]$T)
  Write-Host ""; Write-Host ("=" * 78) -ForegroundColor DarkCyan
  Write-Host "  Step $N/$total  --  $T" -ForegroundColor Cyan
  Write-Host ("=" * 78) -ForegroundColor DarkCyan
}
function Confirm-Yes { param([string]$P) if ($Yes) { return $true } return ((Read-Host "$P [y/N]") -match '^(y|yes)$') }
function Fail-Out { param([string]$M) Write-Host ""; Write-Host $M -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

# ---------------------------------------------------------------------------
Write-Step 1 "Preflight"
# ---------------------------------------------------------------------------
if ($RepoPath -match 'OneDrive') { Fail-Out "That path is under OneDrive -- use the local clone." }
if (-not (Test-Path $RepoPath))  { Fail-Out "Repo not found: $RepoPath" }
Set-Location $RepoPath

$assets = Join-Path $RepoPath $SiteDir
if (-not (Test-Path $assets)) { Fail-Out "Asset directory not found: $assets" }

$cfg = Join-Path $RepoPath 'wrangler.toml'
if (-not (Test-Path $cfg)) {
  Fail-Out @"
wrangler.toml not found at the repo root.

Without it wrangler has no config and would either fail or invent a new worker. If it exists on your
machine but not in git, COMMIT IT -- the automated workflow checks out the repo and cannot see an
untracked file.
"@
}

Write-Host "Repo:   $RepoPath"
Write-Host "Assets: $assets"
$wranglerVersion = (& npx wrangler --version 2>&1 | Select-Object -First 1)
if ($LASTEXITCODE -ne 0) { Fail-Out "wrangler not available. Install with:  npm i -g wrangler" }
Write-Host "Wrangler: $wranglerVersion"

# ---------------------------------------------------------------------------
Write-Step 2 "Guard 1 -- worker name must match the live site EXACTLY"
# ---------------------------------------------------------------------------
$nameLine = (Select-String -Path $cfg -Pattern '^\s*name\s*=' | Select-Object -First 1).Line
if (-not $nameLine) { Fail-Out "wrangler.toml has no `name` key." }
$workerName = ($nameLine -replace '^\s*name\s*=\s*"?([^"]*)"?\s*$', '$1').Trim()
Write-Host "wrangler.toml name = '$workerName'"

if ($workerName -ne $ExpectedWorker) {
  Fail-Out @"
Worker name is '$workerName' but the live site is '$ExpectedWorker'.

Deploying under a different name CREATES A NEW WORKER and reports success. You would get a second
site nobody is looking at, and no error. If the rename is deliberate, pass -ExpectedWorker and update
.github/workflows/deploy-site.yml in the same commit.
"@
}
Write-Host "Name guard passed." -ForegroundColor Green

# ---------------------------------------------------------------------------
Write-Step 3 "Guard 2 -- publish-root audit (everything here becomes public)"
# ---------------------------------------------------------------------------
$files = Get-ChildItem -Path $assets -Recurse -File
Write-Host "--- files that would go live ---"
$files | ForEach-Object { Write-Host ("  " + $_.FullName.Substring($RepoPath.Length + 1)) }
$mb = [math]::Round(($files | Measure-Object -Sum Length).Sum / 1MB, 2)
Write-Host "--------------------------------"
Write-Host ("total: {0} file(s), {1} MB" -f $files.Count, $mb)

$badPatterns = @('*.zip','*.tgz','*.tar','*.tar.gz','*.7z','*.rar','*.bak','*.old','*.orig','*.swp','*~',
                 '.env','.env.*','*.pem','*.key','*.pfx','id_rsa*','*.sqlite','*.db','.DS_Store')
$junk = $files | Where-Object { $n = $_.Name; $badPatterns | Where-Object { $n -like $_ } }
if ($junk) {
  Write-Host ""
  $junk | ForEach-Object { Write-Host ("  " + $_.FullName) -ForegroundColor Red }
  Fail-Out "Refusing to publish -- the files above would become public URLs."
}

$secretRx = 'sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9\-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
$leaks = $files | Where-Object { $_.Extension -match '^\.(html|css|js|json|xml|txt|md|svg)$' } |
         Select-String -Pattern $secretRx -List
if ($leaks) {
  Write-Host ""
  $leaks | ForEach-Object { Write-Host ("  " + $_.Path) -ForegroundColor Red }
  Fail-Out "Refusing to publish -- credential-shaped string found in the publish root."
}
Write-Host "Publish root clean." -ForegroundColor Green

# What we will assert is live afterwards. Self-updating: whatever badge is committed must be served.
$indexPath = Join-Path $assets 'index.html'
$badge = ''
if (Test-Path $indexPath) {
  # The badge is its own <span>, separate from the brand link — match the span text only.
  # "project-starfish v0.28" exists in the RENDERED page but never in the source.
  $m = Select-String -Path $indexPath -Pattern '>(v[0-9]+\.[0-9]+[^<]*)<' | Select-Object -First 1
  if ($m) { $badge = $m.Matches[0].Groups[1].Value }
}
if ($badge) { Write-Host "Will verify the live page serves: '$badge'" } else { Write-Host "No version badge found -- will verify by page title only." -ForegroundColor Yellow }

# ---------------------------------------------------------------------------
Write-Step 4 "Deploy"
# ---------------------------------------------------------------------------
Write-Host "Target: Cloudflare Worker '$ExpectedWorker'  ->  $LiveUrl"
Write-Host "Command: wrangler deploy   (NOT 'wrangler pages deploy' -- this is not a Pages project)"
if (-not (Confirm-Yes "Deploy now?")) { Write-Host "Aborted."; exit 0 }

& npx wrangler deploy
if ($LASTEXITCODE -ne 0) { Fail-Out "wrangler deploy failed (exit $LASTEXITCODE)." }
Write-Host "Upload reported success." -ForegroundColor Green

# ---------------------------------------------------------------------------
Write-Step 5 "Guard 3 -- verify the LIVE site actually changed"
# ---------------------------------------------------------------------------
Write-Host "A success message is not evidence. Fetching $LiveUrl ..."
$ok = $false
for ($i = 1; $i -le 6; $i++) {
  Start-Sleep -Seconds 10
  try { $body = (Invoke-WebRequest -Uri $LiveUrl -UseBasicParsing -TimeoutSec 20).Content } catch { $body = '' }
  if (-not $body) { Write-Host "  attempt $i/6 -- no response yet"; continue }
  if ($badge) {
    if ($body.Contains($badge)) { $ok = $true; break }
    Write-Host "  attempt $i/6 -- reachable, badge not served yet"
  } else {
    if ($body -match '<title>Project Starfish') { $ok = $true; break }
    Write-Host "  attempt $i/6 -- reachable, title not matched yet"
  }
}

if ($ok) {
  Write-Host ""
  Write-Host "DEPLOY VERIFIED -- $LiveUrl is serving the committed content." -ForegroundColor Green
  if ($badge) { Write-Host "  live badge: $badge" -ForegroundColor Green }
} else {
  Fail-Out @"
Deploy reported success but $LiveUrl is NOT serving the committed content.

The most likely cause is the failure mode wrangler.toml warns about: the assets went to a worker
other than '$ExpectedWorker'. Check the Cloudflare dashboard for a recently-created worker, and
confirm which one has projectstarfish.ca bound as a custom domain.
"@
}
Read-Host "Press Enter to close"
