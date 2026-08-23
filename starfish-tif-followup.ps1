<#
.SYNOPSIS
  Local release helper for Project Starfish — the steps that can only be done on your machine: clearing
  the stale git lock, a native Windows `npm run ci` confirmation, an optional version bump, reviewing +
  committing + tagging + pushing, publishing to npm, and cleaning up the scratch folder.

.USAGE
  Right-click this file -> "Run with PowerShell".
  (Double-clicking opens it in a text editor instead of running it — that's normal Windows behaviour
  for .ps1 files, not a problem with the script.)

  If PowerShell refuses to run it ("running scripts is disabled on this system"), open PowerShell in
  the repo folder and run:  powershell -ExecutionPolicy Bypass -File .\starfish-tif-followup.ps1

.WHAT IT DOES
  1/9  Preflight — confirms you're pointed at the real local repo (never OneDrive), prints node/npm,
       and clears a stale .git\index.lock if one is found (this silently blocked a commit once before).
  2/9  Shows `git status` and the current package.json version so you see exactly where things stand.
  3/9  Runs `npm run ci` for real, on Windows — the sandbox can only verify this on Linux, so this is
       the step that actually confirms nothing broke. Stops here on failure.
  4/9  Optional version bump — asks for a new version (or press Enter to keep the current one), then
       runs `npm run version:sync` to propagate it to every workspace package.
  5/9  Shows everything currently modified/staged and offers to commit it (asks first; y/n). Only
       tracked files (`git add -u`) — new untracked files are never swept in silently. Checks the exit
       code of every git command AND confirms HEAD actually moved before calling it a success.
  6/9  Offers to tag the commit `vX.Y.Z` (asks first; y/n). Skipped if that tag already exists.
  7/9  Shows what's ahead of origin, then offers to push the branch and tag (asks first; y/n).
  8/9  Offers to publish (asks first; y/n) — runs `npm publish` from inside packages/cli directly
       (not `--workspace` from root, which can wrongly inherit the root package.json's `private: true`
       on some npm versions). Checks `npm whoami` first so you know which account it'll publish under,
       and only runs if the tag step actually produced a tag (this session or a prior one) so you're
       never publishing an untagged version.
  9/9  Offers to empty `_to_delete\` via the Recycle Bin — recoverable, not a hard delete (asks first).

  Deliberately NOT automatic: `npm publish --provenance` (only works from a supported CI/OIDC
  environment, not a local machine) and anything on the legal/"Needs Scott" list from earlier sessions.
#>

param(
  [string]$RepoPath = "C:\Users\swhol\Documents\Github\Starfish",
  [string]$PublishWorkspace = "packages/cli"
)

$ErrorActionPreference = 'Stop'
$totalSteps = 9

function Write-Step {
  param([int]$N, [string]$Title)
  Write-Host ""
  Write-Host "== Step $N/$totalSteps -- $Title ==" -ForegroundColor Cyan
}

function Confirm-Yes {
  param([string]$Prompt)
  $answer = Read-Host "$Prompt [y/N]"
  return ($answer -match '^(y|yes)$')
}

# ---------------------------------------------------------------------------
Write-Step 1 "Preflight"
# ---------------------------------------------------------------------------
if ($RepoPath -match 'OneDrive') {
  Write-Host "This path looks like it's under OneDrive. That copy is deprecated for Starfish work --" -ForegroundColor Red
  Write-Host "the canonical repo is $RepoPath. Re-run with -RepoPath pointing at the real local clone." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}
if (-not (Test-Path $RepoPath)) {
  Write-Host "Repo path not found: $RepoPath" -ForegroundColor Red
  Write-Host "Re-run as:  .\starfish-tif-followup.ps1 -RepoPath 'C:\path\to\Starfish'" -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 1
}
Set-Location $RepoPath
if (-not (Test-Path ".git")) {
  Write-Host "$RepoPath doesn't look like a git repo (no .git folder). Aborting." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}
$branch = git rev-parse --abbrev-ref HEAD
Write-Host "Repo:   $RepoPath"
Write-Host "Node:   $(node -v)"
Write-Host "npm:    $(npm -v)"
Write-Host "Branch: $branch"

$lockFile = Join-Path $RepoPath ".git\index.lock"
if (Test-Path $lockFile) {
  Write-Host ""
  Write-Host "Found a stale .git\index.lock -- this blocks every git add/commit until it's removed." -ForegroundColor Red
  Get-Item $lockFile | Format-List Name, Length, LastWriteTime
  Write-Host "This is safe to delete if no other git command is running right now (it's just a stale" -ForegroundColor Yellow
  Write-Host "leftover, not something git is actively using)." -ForegroundColor Yellow
  if (Confirm-Yes "Delete .git\index.lock now") {
    Remove-Item $lockFile -Force
    Write-Host "Removed." -ForegroundColor Green
  } else {
    Write-Host "Left in place -- git add/commit will keep failing until this is gone. Stopping here." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
  }
}

# ---------------------------------------------------------------------------
Write-Step 2 "Current status"
# ---------------------------------------------------------------------------
$currentVersion = (node -e "console.log(require('./package.json').version)").Trim()
Write-Host "package.json version: $currentVersion"
Write-Host ""
git status --short

# ---------------------------------------------------------------------------
Write-Step 3 "npm run ci (typecheck + test + conformance + determinism + lint:deps + scans + sbom)"
# ---------------------------------------------------------------------------
Write-Host "This is the real, Windows-native confirmation -- the cloud session could only run a" -ForegroundColor Yellow
Write-Host "Linux copy of the suite. Output streams live below; this can take a couple of minutes." -ForegroundColor Yellow
Write-Host ""
& npm run ci
$ciExitCode = $LASTEXITCODE
if ($ciExitCode -eq 0) {
  Write-Host ""
  Write-Host "npm run ci: PASSED" -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "npm run ci: FAILED (exit code $ciExitCode) -- see the output above for which check broke." -ForegroundColor Red
  Write-Host "Stopping here rather than offering to commit/tag/publish on top of a failing suite." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

# ---------------------------------------------------------------------------
Write-Step 4 "Version bump (optional)"
# ---------------------------------------------------------------------------
$newVersion = Read-Host "Current version is $currentVersion -- enter a new version to bump to, or press Enter to keep it"
if ([string]::IsNullOrWhiteSpace($newVersion)) {
  Write-Host "Keeping $currentVersion." -ForegroundColor Yellow
  $targetVersion = $currentVersion
} else {
  if ($newVersion -notmatch '^\d+\.\d+\.\d+([-.].+)?$') {
    Write-Host "'$newVersion' doesn't look like a valid semver (expected e.g. 0.26.0). Aborting." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
  }
  npm version $newVersion --no-git-tag-version --allow-same-version
  if ($LASTEXITCODE -ne 0) {
    Write-Host "`nnpm version failed (exit code $LASTEXITCODE)." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
  }
  Write-Host "Bumped root package.json to $newVersion. Syncing workspace packages..." -ForegroundColor Green
  npm run version:sync
  if ($LASTEXITCODE -ne 0) {
    Write-Host "`nnpm run version:sync failed (exit code $LASTEXITCODE)." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
  }
  $targetVersion = $newVersion
}

# ---------------------------------------------------------------------------
Write-Step 5 "Review + commit"
# ---------------------------------------------------------------------------
Write-Host "Current working-tree status:"
git status --short
Write-Host ""
Write-Host "Diff (tracked files only):"
git diff --stat

if (Confirm-Yes "Stage all tracked modifications (git add -u) and commit them now") {
  $headBefore = git rev-parse HEAD

  git add -u
  if ($LASTEXITCODE -ne 0) {
    Write-Host "`ngit add failed (exit code $LASTEXITCODE) -- see the error above. Nothing committed." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
  }

  $staged = git diff --cached --name-only
  if (-not $staged) {
    Write-Host "Nothing tracked was modified -- nothing to commit." -ForegroundColor Yellow
  } else {
    Write-Host "Staged:"
    $staged | ForEach-Object { Write-Host "  - $_" }
    $defaultMsg = "release: v$targetVersion"
    $commitMsg = Read-Host "Commit message [$defaultMsg]"
    if ([string]::IsNullOrWhiteSpace($commitMsg)) { $commitMsg = $defaultMsg }

    git commit -m $commitMsg
    if ($LASTEXITCODE -ne 0) {
      Write-Host "`ngit commit failed (exit code $LASTEXITCODE) -- see the error above. Nothing committed." -ForegroundColor Red
      Read-Host "Press Enter to close"
      exit 1
    }

    # Don't just trust the exit code -- confirm HEAD actually moved before claiming success.
    $headAfter = git rev-parse HEAD
    if ($headAfter -eq $headBefore) {
      Write-Host "`ngit commit reported success but HEAD didn't move -- something's wrong. Check 'git status' by hand." -ForegroundColor Red
      Read-Host "Press Enter to close"
      exit 1
    }
    Write-Host "Committed: $headAfter" -ForegroundColor Green
    git log -1 --stat
  }
} else {
  Write-Host "Skipped -- nothing staged or committed." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
Write-Step 6 "Tag v$targetVersion"
# ---------------------------------------------------------------------------
$tagName = "v$targetVersion"
$tagExists = git tag --list $tagName
$taggedNow = $false
if ($tagExists) {
  Write-Host "Tag $tagName already exists (on $(git log -1 --format=%h $tagName)) -- not re-tagging." -ForegroundColor Yellow
} else {
  if (Confirm-Yes "Create tag $tagName on the current HEAD") {
    git tag $tagName
    if ($LASTEXITCODE -ne 0) {
      Write-Host "`ngit tag failed (exit code $LASTEXITCODE)." -ForegroundColor Red
    } else {
      Write-Host "Tagged: $tagName" -ForegroundColor Green
      $taggedNow = $true
    }
  } else {
    Write-Host "Skipped -- no tag created. Publish (step 8) will refuse without a matching tag." -ForegroundColor Yellow
  }
}

# ---------------------------------------------------------------------------
Write-Step 7 "Push to origin/$branch"
# ---------------------------------------------------------------------------
$aheadCount = 0
try {
  $aheadCount = [int](git rev-list --count "origin/$branch..HEAD" 2>$null)
} catch {
  $aheadCount = -1
}

if ($aheadCount -eq 0 -and -not $taggedNow) {
  Write-Host "Nothing to push -- HEAD already matches origin/$branch, and no new tag was created." -ForegroundColor Yellow
} else {
  if ($aheadCount -gt 0) {
    Write-Host "$aheadCount commit(s) ready to push, including:" -ForegroundColor Yellow
    git log "origin/$branch..HEAD" --oneline
    Write-Host ""
  }
  if (Confirm-Yes "Push $branch and any new tags to origin now") {
    git push origin $branch
    $branchPushOk = ($LASTEXITCODE -eq 0)
    if (-not $branchPushOk) {
      Write-Host "`ngit push (branch) failed (exit code $LASTEXITCODE) -- see the error above." -ForegroundColor Red
    }
    git push origin --tags
    if ($LASTEXITCODE -ne 0) {
      Write-Host "`ngit push (tags) failed (exit code $LASTEXITCODE) -- see the error above." -ForegroundColor Red
    } elseif ($branchPushOk) {
      Write-Host "Pushed." -ForegroundColor Green
    }
  } else {
    Write-Host "Skipped -- push by hand later with:  git push origin $branch --tags" -ForegroundColor Yellow
  }
}

# ---------------------------------------------------------------------------
Write-Step 8 "npm publish ($PublishWorkspace)"
# ---------------------------------------------------------------------------
$tagOnHead = git tag --points-at HEAD
if (-not $tagOnHead) {
  Write-Host "HEAD isn't tagged (nothing points at the current commit) -- skipping publish." -ForegroundColor Yellow
  Write-Host "Re-run this script once step 6/7 have actually tagged and pushed a release." -ForegroundColor Yellow
} else {
  $whoami = & npm whoami 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Not logged in to npm ($whoami). Run 'npm login' first, then re-run this script." -ForegroundColor Red
  } else {
    Write-Host "npm account: $whoami"
    Write-Host "Tag on HEAD: $tagOnHead"
    Write-Host "This will publish $PublishWorkspace publicly to the npm registry. It cannot be un-published" -ForegroundColor Yellow
    Write-Host "for the same version once out." -ForegroundColor Yellow
    if (Confirm-Yes "Run 'npm publish' from $PublishWorkspace now") {
      # Publish from inside the package directory, not via 'npm publish --workspace' from the root.
      # That flag can inherit the ROOT package.json's "private": true on some npm versions (seen on
      # 10.9.8 as an EPRIVATE error even though the workspace package itself has no `private` field) --
      # cd'ing into the package sidesteps root-context resolution entirely.
      Push-Location (Join-Path $RepoPath $PublishWorkspace)
      try {
        npm publish
        $publishExit = $LASTEXITCODE
      } finally {
        Pop-Location
      }
      if ($publishExit -ne 0) {
        Write-Host "`nnpm publish failed (exit code $publishExit) -- see the error above." -ForegroundColor Red
      } else {
        Write-Host "Published." -ForegroundColor Green
      }
    } else {
      Write-Host "Skipped -- publish by hand later with:  npm publish --workspace $PublishWorkspace" -ForegroundColor Yellow
    }
  }
}

# ---------------------------------------------------------------------------
Write-Step 9 "Clean up _to_delete\"
# ---------------------------------------------------------------------------
$toDelete = Join-Path $RepoPath "_to_delete"
if (Test-Path $toDelete) {
  $items = Get-ChildItem $toDelete -Force
  if ($items.Count -eq 0) {
    Write-Host "_to_delete\ is empty -- nothing to do."
  } else {
    Write-Host "Contents of _to_delete\:"
    $items | ForEach-Object { Write-Host "  - $($_.Name)  ($([math]::Round($_.Length/1KB,1)) KB)" }
    if (Confirm-Yes "Send these to the Recycle Bin") {
      Add-Type -AssemblyName Microsoft.VisualBasic
      foreach ($item in $items) {
        if ($item.PSIsContainer) {
          [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($item.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin')
        } else {
          [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($item.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin')
        }
      }
      Write-Host "Moved to Recycle Bin (recoverable if you change your mind)." -ForegroundColor Green
    } else {
      Write-Host "Left in place." -ForegroundColor Yellow
    }
  }
} else {
  Write-Host "No _to_delete\ folder present -- nothing to do."
}

# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "== Done ==" -ForegroundColor Cyan
Write-Host "Still manual, on purpose: 'npm publish --provenance' (needs a CI/OIDC environment, not a" -ForegroundColor Yellow
Write-Host "local machine) and anything on the legal 'Needs Scott' list from earlier sessions." -ForegroundColor Yellow
Read-Host "Press Enter to close"
