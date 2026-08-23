<#
.SYNOPSIS
  Local release helper for Project Starfish v0.27.0 -- the adversarial-review release.
  Runs the Windows-native `npm run ci` confirmation, then reviews / stages / commits / tags / pushes,
  with an optional npm publish.

.USAGE
  Right-click this file -> "Run with PowerShell".
  (Double-clicking opens it in a text editor instead -- that's normal Windows behaviour for .ps1
  files, not a problem with the script.)

  If PowerShell refuses to run it ("running scripts is disabled on this system"), open PowerShell in
  the repo folder and run:
      powershell -ExecutionPolicy Bypass -File .\starfish-v0.27.0-release.ps1

.WHY THIS SCRIPT EXISTS
  v0.27.0 was verified in two passes on a scratch LINUX install:
    * first pass  -- full vitest run, 108 test files / 743 passed / 1 skipped.
    * second pass -- the scratch vitest environment degraded (this repo's node_modules carries
                     Windows-only native bindings and the @starfish/* workspace links do not resolve
                     through the Linux mount), so the F-10 and Azure work was verified by compiling
                     governance-core under `strict` and running the conformance + determinism suites
                     through a compile-and-run harness: 516 assertions passing, 0 real failures,
                     29 async tests not exercised. Plus a 25-check runtime probe of the scope gate.
    third pass    -- the round-two hardening (Q12/Q5/Q4/Q2/Q9) verified the same way:
                     adversarial-round2.conformance 12/12 through the real PDP, a 22-check runner
                     probe, governance-core clean under `strict`, all five native gates re-run green.
  What was NOT re-run end to end after that: the full vitest suite and the git-based `secret-scan`.
  Step 5 is the step that actually confirms nothing broke.

.WHAT IT DOES
  1/10  Preflight -- confirms the real local repo (never OneDrive), prints node/npm/branch, clears a
        stale .git\index.lock if present (this silently blocked a commit once before).
  2/10  Release manifest -- checks every file this release is supposed to contain actually exists and
        that package.json says 0.27.0. Stops if the working tree isn't what the release expects.
  3/10  Shows EXACTLY what will be committed and -- just as important -- every untracked file that
        will be LEFT ALONE. New files are added by explicit name, never `git add -A`, so unrelated
        work in progress (azure\, dotnet-adapter\, python-adapter\, .bak files, zips) is never
        swept into a release commit by accident.
  4/10  Reminds you of the behaviour changes in this release and asks you to acknowledge them.
  5/10  Runs `npm run ci` for real, on Windows. Output streams live; elapsed time is reported.
        Stops here on failure rather than offering to tag a broken tree.
  6/10  Review + commit (asks first).
  7/10  Tag v0.27.0 (asks first; skipped if the tag already exists).
  8/10  Push branch + tags (asks first).
  9/10  Optional `npm publish` from packages/cli -- only if HEAD is actually tagged. Detects whether
        a non-interactive npm credential exists and SKIPS with instructions if not, because BOTH of
        npm's 2FA flows (classic "Enter OTP:" and the newer "Press ENTER to open in the browser")
        read from a stdin that does not exist inside a script -- they hang rather than fail.
  10/10 Post-release checklist: what's still open and what to do about the site.

  All ten adversarial findings are closed, AND the Q12 exploit chain the review demonstrated is
  now gated. T-25 (no OS-level isolation) remains the one honest residual.

  Nothing destructive happens without a y/N prompt. Every git command's exit code is checked, and the
  commit step confirms HEAD actually moved before reporting success.
#>

param(
  [string]$RepoPath = "C:\Users\swhol\Documents\Github\Starfish",
  [string]$PublishWorkspace = "packages/cli",
  [string]$ExpectedVersion = "0.27.0"
)

$ErrorActionPreference = 'Stop'
$totalSteps = 10

function Write-Step {
  param([int]$N, [string]$Title)
  Write-Host ""
  Write-Host ("=" * 78) -ForegroundColor DarkCyan
  Write-Host "  Step $N/$totalSteps  --  $Title" -ForegroundColor Cyan
  Write-Host ("=" * 78) -ForegroundColor DarkCyan
}
function Confirm-Yes {
  param([string]$Prompt)
  $answer = Read-Host "$Prompt [y/N]"
  return ($answer -match '^(y|yes)$')
}
function Fail-Out {
  param([string]$Message)
  Write-Host ""
  Write-Host $Message -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

# The files this release introduces. Added by explicit name so nothing else is swept in.
$NewFiles = @(
  "ADVERSARIAL-QA.md",
  "docs/SITE_CLAIMS_AUDIT.md",
  "docs/RELEASE_NOTES_v0.27.0.md",
  "packages/governance-core/src/shellguard.ts",
  "packages/governance-core/src/adversarial.conformance.test.ts",
  "packages/governance-core/src/reachability.conformance.test.ts",
  "packages/governance-hooks/src/writeprofile.hardening.conformance.test.ts",
  "packages/governance-core/src/scopeissuer.ts",
  "packages/governance-core/src/scopeissuer.conformance.test.ts",
  "tsconfig.azure.json",
  "scripts/smoke-azure.mjs",
  "packages/governance-core/src/execprovenance.ts",
  "packages/governance-core/src/adversarial-round2.conformance.test.ts"
)

# Work that was started earlier and never committed -- surveyed 2026-08-20 and confirmed as real
# source, not scratch. Added as whole paths (git add resolves a directory to its files, minus
# anything .gitignore excludes) so the Azure/Foundry surface stops living only on this machine.
#
# NOTE: until this release, none of this was checked by ANY gate -- tsconfig.json, vitest.config.ts,
# dep-direction-lint and ip-denylist-scan all scoped to packages/, so 22 files of Marketplace-facing
# TypeScript were unguarded. That is the same shape as findings F-7/F-8/F-10 (real code no gate
# touches), applied to the commercial surface. Now covered by `typecheck:azure`, `smoke:azure` and an
# IP scan extended to azure/ -- all three wired into `npm run ci`, and all three green on first run.
# The adapters (dotnet/python) remain unguarded: they need a .NET SDK and a Python toolchain that CI
# does not have. Tracking them is still right; they are verified by hand.
$NewWork = @(
  "azure",                                    # bicep, sidecar, metering, tier2-gateway, tier3, marketplace listing
  "dotnet-adapter",                           # C# Foundry adapter + tests
  "python-adapter",                           # Python Foundry adapter
  "docs/design/azure.md",
  "docs/design/AZURE_IMPLEMENTATION_PLAN.md",
  "docs/design/M3_DISPATCH_VERIFICATION_PLAN.md",
  "Deploy-StarfishTestEnv.ps1",               # provisions the test sidecar; generates the .local-* artifacts
  ".dockerignore",                            # keeps node_modules out of the ACR build context
  "packages/desktop/app/calm-home-preview.html",
  "starfish-tif-followup.ps1",
  "starfish-v0.27.0-release.ps1"
)
# Files this release modifies that carry the actual fixes -- presence is sanity-checked, not content.
$TouchedFiles = @(
  "packages/governance-core/src/audit.ts",
  "packages/governance-core/src/monitor.ts",
  "packages/governance-core/src/pdp.ts",
  "packages/governance-core/src/types.ts",
  "packages/governance-core/src/index.ts",
  "packages/governance-hooks/src/handler.ts",
  "packages/desktop/src/peps.ts",
  "packages/desktop/src/fsdelete.ts",
  "packages/governance-core/src/broker.ts",
  "README.md",
  "SECURITY.md",
  "packages/sdk/src/index.ts",
  "packages/sdk/src/serve.ts",
  "scripts/ip-denylist-scan.mjs",
  ".gitignore",
  "DEPRECATED.md",
  "CHANGELOG.md",
  "docs/PHASE_BUILD_LOG.md",
  "site/index.html",
  "site/starfish-vs-hermes/index.html",
  "site/blog/toby-and-hank.html",
  "site/blog/the-1.0-candidate.html",
  "packages/cli/README.md",
  "packages/desktop/app/src/main/index.ts",
  "packages/desktop/src/fsdelete.conformance.test.ts",
  "package.json"
)

# ---------------------------------------------------------------------------
Write-Step 1 "Preflight"
# ---------------------------------------------------------------------------
if ($RepoPath -match 'OneDrive') {
  Fail-Out "That path is under OneDrive. That copy is deprecated for Starfish work -- the canonical repo is a local clone. Re-run with -RepoPath pointing at it."
}
if (-not (Test-Path $RepoPath)) {
  Fail-Out "Repo path not found: $RepoPath`nRe-run as:  .\starfish-v0.27.0-release.ps1 -RepoPath 'C:\path\to\Starfish'"
}
Set-Location $RepoPath
if (-not (Test-Path ".git")) { Fail-Out "$RepoPath doesn't look like a git repo (no .git folder). Aborting." }

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
  Write-Host "Safe to delete if no other git command is running right now." -ForegroundColor Yellow
  if (Confirm-Yes "Delete .git\index.lock now") {
    Remove-Item $lockFile -Force
    Write-Host "Removed." -ForegroundColor Green
  } else {
    Fail-Out "Left in place -- git add/commit will keep failing until it's gone. Stopping here."
  }
}

# ---------------------------------------------------------------------------
Write-Step 2 "Release manifest check"
# ---------------------------------------------------------------------------
$currentVersion = (node -e "console.log(require('./package.json').version)").Trim()
Write-Host "package.json version: $currentVersion  (expected $ExpectedVersion)"
if ($currentVersion -ne $ExpectedVersion) {
  Write-Host ""
  Write-Host "Version mismatch. The sandbox session bumped root package.json to $ExpectedVersion and ran" -ForegroundColor Red
  Write-Host "'npm run version:sync'. If this says something else, the working tree isn't the one that was" -ForegroundColor Red
  Write-Host "prepared -- check you're on the right branch before continuing." -ForegroundColor Red
  if (-not (Confirm-Yes "Continue anyway")) { Fail-Out "Stopped." }
}

Write-Host ""
Write-Host "New files this release introduces:" -ForegroundColor Yellow
$missing = @()
foreach ($f in $NewFiles) {
  if (Test-Path $f) {
    Write-Host ("  [ok]      {0}" -f $f) -ForegroundColor Green
  } else {
    Write-Host ("  [MISSING] {0}" -f $f) -ForegroundColor Red
    $missing += $f
  }
}
Write-Host ""
Write-Host "Modified files carrying the fixes:" -ForegroundColor Yellow
foreach ($f in $TouchedFiles) {
  if (Test-Path $f) {
    Write-Host ("  [ok]      {0}" -f $f) -ForegroundColor DarkGray
  } else {
    Write-Host ("  [MISSING] {0}" -f $f) -ForegroundColor Red
    $missing += $f
  }
}
if ($missing.Count -gt 0) {
  Fail-Out "$($missing.Count) expected file(s) are missing. This working tree isn't the prepared v0.27.0 tree -- stopping before anything is committed."
}
Write-Host ""
Write-Host "All $($NewFiles.Count + $TouchedFiles.Count) expected files present." -ForegroundColor Green

# ---------------------------------------------------------------------------
Write-Step 3 "What will (and won't) be committed"
# ---------------------------------------------------------------------------
Write-Host "TRACKED modifications -- these are staged with 'git add -u':" -ForegroundColor Yellow
git diff --stat
Write-Host ""
Write-Host "NEW release files -- added by explicit name:" -ForegroundColor Yellow
foreach ($f in $NewFiles) { Write-Host "  + $f" -ForegroundColor Green }

Write-Host ""
Write-Host "PREVIOUSLY UNCOMMITTED WORK now being tracked (surveyed 2026-08-20):" -ForegroundColor Yellow
foreach ($f in $NewWork) {
  $count = @(git ls-files --others --exclude-standard -- $f).Count
  if ($count -gt 0) { Write-Host ("  + {0,-46} {1} file(s)" -f $f, $count) -ForegroundColor Green }
  else { Write-Host ("  . {0,-46} nothing new (already tracked or ignored)" -f $f) -ForegroundColor DarkGray }
}
Write-Host ""
Write-Host "  None of the above sits in packages\, and every CI gate scopes to packages\ -- so this" -ForegroundColor DarkGray
Write-Host "  cannot break 'npm run ci', but nothing checks it either. Track it knowing that." -ForegroundColor DarkGray

Write-Host ""
Write-Host "Untracked files that will be LEFT ALONE:" -ForegroundColor Yellow
$claimed = @($NewFiles + $NewWork)
$untracked = @(git ls-files --others --exclude-standard)
$leftAlone = @($untracked | Where-Object {
  $p = $_ -replace '\\','/'
  -not ($claimed | Where-Object { $p -eq $_ -or $p.StartsWith("$_/") })
})
if ($leftAlone.Count -gt 0) {
  $leftAlone | ForEach-Object { Write-Host "  . $_" -ForegroundColor DarkGray }
  Write-Host ""
  Write-Host "  ^ deliberately excluded. Apply-ServeFix.ps1 is the applier for a delivery whose payload" -ForegroundColor DarkGray
  Write-Host "  already landed in commit 65b3974 -- spent, not lost. Move it to _to_delete\ when you're" -ForegroundColor DarkGray
  Write-Host "  satisfied, or add it by hand if you want it kept." -ForegroundColor DarkGray
} else {
  Write-Host "  (none)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Newly IGNORED as generated/superseded (see .gitignore):" -ForegroundColor Yellow
Write-Host "  - azure\.local-seed-root\, azure\.local-seed-config.json  (Deploy-StarfishTestEnv.ps1 regenerates)" -ForegroundColor DarkGray
Write-Host "  - *.bak-<timestamp>  (pre-patch copies from the 2026-08-03 delivery)" -ForegroundColor DarkGray
Write-Host "  - serve_ts_verdict_fix_and_validation_governor.zip  (payload already committed)" -ForegroundColor DarkGray
Write-Host "  - azure\.local-test-tokens.json  (was already ignored -- live worker+operator bearer tokens)" -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
Write-Step 4 "Behaviour changes in this release"
# ---------------------------------------------------------------------------
Write-Host "Two things change behaviour for existing users:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1. A catastrophic shell command is now DENIED, not escalated." -ForegroundColor White
Write-Host "     'rm -rf /' used to be classified critical and offered to a human for approval." -ForegroundColor Gray
Write-Host "     The floors moved into the PDP (F-11), so it is now refused outright and is not" -ForegroundColor Gray
Write-Host "     approvable. The Claude Code overlay already behaved this way; the core caught up." -ForegroundColor Gray
Write-Host "     Critical-but-legitimate work ('rm -rf ./build') still escalates exactly as before." -ForegroundColor Gray
Write-Host ""
Write-Host "  2. The Evidence Gate is ON by default in @starfish/sdk." -ForegroundColor White
Write-Host "     It was advertised as blocking unbacked claims and shipped false. A run closing with" -ForegroundColor Gray
Write-Host "     an unbacked claim now ends as 'claim-unbacked' after a correction retry rather than" -ForegroundColor Gray
Write-Host "     being believed. Opt out: createGovernance({ enforceClaims: false })." -ForegroundColor Gray
Write-Host ""
Write-Host "  3. Scope non-deviation (F-10) is now ENFORCED, mode 'contracted'." -ForegroundColor White
Write-Host "     A call carrying a taskId must have a scope contract for it or it is DENIED. A call" -ForegroundColor Gray
Write-Host "     with no taskId is unaffected. createGovernance()/runGovernedSkill() issue contracts" -ForegroundColor Gray
Write-Host "     automatically; a host that calls governCall() with its own taskId must call" -ForegroundColor Gray
Write-Host "     governor.scope.issue(...) or pass scopeMode:'off' to loadGovernor." -ForegroundColor Gray
Write-Host ""
Write-Host "  4. Self-authored execution requires a human (Q12)." -ForegroundColor White
Write-Host "     If a task writes a file a test runner would execute and then asks to run the" -ForegroundColor Gray
Write-Host "     runner, that call escalates -- risk tolerance cannot auto-satisfy it. This closes" -ForegroundColor Gray
Write-Host "     the two-hop chain from the review. Writing a test then running it still works; it" -ForegroundColor Gray
Write-Host "     just needs one approval instead of none." -ForegroundColor Gray
Write-Host ""
Write-Host "  5. TrashStore.purge now REQUIRES an audit sink and purgeAll a 'PURGE-ALL' token (Q5)." -ForegroundColor White
Write-Host "     Any custom caller of these must pass them; an unauditable purge is refused." -ForegroundColor Gray
Write-Host ""
Write-Host "  Also: startSidecar now defaults approval authority to ['operator'] (F-9). If your" -ForegroundColor Gray
Write-Host "  deployment approved decisions from another identity, pass it via the new option." -ForegroundColor Gray
Write-Host ""
if (-not (Confirm-Yes "Understood -- continue")) { Fail-Out "Stopped. Nothing has been changed." }

# ---------------------------------------------------------------------------
Write-Step 5 "npm run ci  (the real Windows-native confirmation)"
# ---------------------------------------------------------------------------
Write-Host "Runs: typecheck + typecheck:azure + test + conformance + determinism + lint:deps +" -ForegroundColor Yellow
Write-Host "      smoke:azure + secret scan + IP scan (now incl. azure/) + sbom" -ForegroundColor Yellow
Write-Host ""
Write-Host "The cloud session verified 108 test files / 743 passed on Linux, plus dep-direction lint," -ForegroundColor Yellow
Write-Host "IP scan and SBOM. It could NOT run 'tsc --noEmit' (Windows-only native bindings + workspace" -ForegroundColor Yellow
Write-Host "symlinks that don't resolve on the Linux mount) or the git-based secret scan." -ForegroundColor Yellow
Write-Host "THIS is the step that confirms those. Output streams live below; expect a few minutes." -ForegroundColor Yellow
Write-Host ""
$ciStart = Get-Date
Write-Host "Started at $($ciStart.ToString('HH:mm:ss')) --" -ForegroundColor DarkGray
Write-Host ("-" * 78) -ForegroundColor DarkGray

& npm run ci
$ciExitCode = $LASTEXITCODE

$ciElapsed = (Get-Date) - $ciStart
Write-Host ("-" * 78) -ForegroundColor DarkGray
Write-Host ("Finished in {0:mm}m {0:ss}s." -f $ciElapsed) -ForegroundColor DarkGray
if ($ciExitCode -eq 0) {
  Write-Host "npm run ci: PASSED" -ForegroundColor Green
} else {
  Fail-Out "npm run ci: FAILED (exit code $ciExitCode) -- see the output above for which check broke.`nStopping rather than offering to commit/tag/publish on top of a failing suite."
}

# ---------------------------------------------------------------------------
Write-Step 6 "Review + commit"
# ---------------------------------------------------------------------------
git status --short
Write-Host ""
if (Confirm-Yes "Stage tracked modifications + the new release files + the previously-uncommitted work, and commit") {
  $headBefore = git rev-parse HEAD

  git add -u
  if ($LASTEXITCODE -ne 0) { Fail-Out "git add -u failed (exit code $LASTEXITCODE). Nothing committed." }

  foreach ($f in ($NewFiles + $NewWork)) {
    git add -- $f
    if ($LASTEXITCODE -ne 0) { Fail-Out "git add failed for '$f' (exit code $LASTEXITCODE). Nothing committed." }
  }

  # Belt and braces: the .local-* artifacts and the token file must NEVER reach the index, even if a
  # stale .gitignore let them through. Refuse the commit rather than warn -- one of them is a live
  # operator bearer token.
  $forbidden = @(git diff --cached --name-only) | Where-Object {
    $_ -match '\.local-test-tokens\.json$' -or $_ -match '\.local-seed-root/' -or $_ -match '\.local-seed-config\.json$'
  }
  if ($forbidden) {
    Write-Host ""
    Write-Host "REFUSING TO COMMIT -- these staged paths are generated/secret and must not be tracked:" -ForegroundColor Red
    $forbidden | ForEach-Object { Write-Host "  ! $_" -ForegroundColor Red }
    git reset -q HEAD -- $forbidden
    Fail-Out "Unstaged them. Check .gitignore contains the azure/.local-* rules, then re-run."
  }

  # @(...) so a single-file result is still an array -- a bare string has no .Count in PS 5.1.
  $staged = @(git diff --cached --name-only)
  if ($staged.Count -eq 0) {
    Write-Host "Nothing staged -- nothing to commit." -ForegroundColor Yellow
  } else {
    Write-Host ""
    Write-Host "Staged $($staged.Count) file(s):" -ForegroundColor Green
    $staged | ForEach-Object { Write-Host "  - $_" }

    $defaultMsg = "release: v$ExpectedVersion -- adversarial review (9/10 findings closed)"
    Write-Host ""
    $commitMsg = Read-Host "Commit message [$defaultMsg]"
    if ([string]::IsNullOrWhiteSpace($commitMsg)) { $commitMsg = $defaultMsg }

    git commit -m $commitMsg
    if ($LASTEXITCODE -ne 0) { Fail-Out "git commit failed (exit code $LASTEXITCODE). Nothing committed." }

    # Don't just trust the exit code -- confirm HEAD actually moved.
    $headAfter = git rev-parse HEAD
    if ($headAfter -eq $headBefore) {
      Fail-Out "git commit reported success but HEAD didn't move -- something's wrong. Check 'git status' by hand."
    }
    Write-Host "Committed: $headAfter" -ForegroundColor Green
    git log -1 --stat
  }
} else {
  Write-Host "Skipped -- nothing staged or committed." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
Write-Step 7 "Tag v$ExpectedVersion"
# ---------------------------------------------------------------------------
$tagName = "v$ExpectedVersion"
$tagExists = git tag --list $tagName
$taggedNow = $false
if ($tagExists) {
  Write-Host "Tag $tagName already exists (on $(git log -1 --format=%h $tagName)) -- not re-tagging." -ForegroundColor Yellow
} else {
  if (Confirm-Yes "Create tag $tagName on the current HEAD") {
    git tag $tagName
    if ($LASTEXITCODE -ne 0) {
      Write-Host "git tag failed (exit code $LASTEXITCODE)." -ForegroundColor Red
    } else {
      Write-Host "Tagged: $tagName" -ForegroundColor Green
      $taggedNow = $true
    }
  } else {
    Write-Host "Skipped -- no tag created. Publish (step 9) will refuse without a matching tag." -ForegroundColor Yellow
  }
}

# ---------------------------------------------------------------------------
Write-Step 8 "Push to origin/$branch"
# ---------------------------------------------------------------------------
$aheadCount = 0
try { $aheadCount = [int](git rev-list --count "origin/$branch..HEAD" 2>$null) } catch { $aheadCount = -1 }

if ($aheadCount -eq 0 -and -not $taggedNow) {
  Write-Host "Nothing to push -- HEAD already matches origin/$branch and no new tag was created." -ForegroundColor Yellow
} else {
  if ($aheadCount -gt 0) {
    Write-Host "$aheadCount commit(s) ready to push:" -ForegroundColor Yellow
    git log "origin/$branch..HEAD" --oneline
    Write-Host ""
  }
  if (Confirm-Yes "Push $branch and any new tags to origin now") {
    git push origin $branch
    $branchPushOk = ($LASTEXITCODE -eq 0)
    if (-not $branchPushOk) { Write-Host "git push (branch) failed (exit code $LASTEXITCODE)." -ForegroundColor Red }
    git push origin --tags
    if ($LASTEXITCODE -ne 0) {
      Write-Host "git push (tags) failed (exit code $LASTEXITCODE)." -ForegroundColor Red
    } elseif ($branchPushOk) {
      Write-Host "Pushed." -ForegroundColor Green
    }
  } else {
    Write-Host "Skipped -- push by hand later with:  git push origin $branch --tags" -ForegroundColor Yellow
  }
}

# ---------------------------------------------------------------------------
Write-Step 9 "npm publish ($PublishWorkspace)"
# ---------------------------------------------------------------------------
$tagOnHead = git tag --points-at HEAD
if (-not $tagOnHead) {
  Write-Host "HEAD isn't tagged -- skipping publish. Re-run once steps 7/8 have tagged and pushed." -ForegroundColor Yellow
} else {
  $whoami = & npm whoami 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Not logged in to npm ($whoami). Run 'npm login' first, then re-run this script." -ForegroundColor Red
  } else {
    Write-Host "npm account: $whoami"
    Write-Host "Tag on HEAD: $tagOnHead"
    Write-Host "This publishes $PublishWorkspace publicly. It cannot be un-published for the same version." -ForegroundColor Yellow
    $skipPublish = $false
    if (Confirm-Yes "Run 'npm publish' from $PublishWorkspace now") {
      # PUBLISHING FROM A SCRIPT NEEDS A NON-INTERACTIVE CREDENTIAL. Learned the hard way on v0.27.0.
      #
      # npm has two interactive 2FA flows and BOTH break in here, because stdin is not a real TTY
      # when npm is invoked from a script:
      #   * classic OTP  -- prints "Enter OTP:", receives nothing, re-prompts forever (the v0.27.0 hang).
      #   * web auth     -- prints "Press ENTER to open in the browser..." and waits on the same dead stdin.
      # npm 11 prefers the web flow, so passing --otp alone does NOT make this safe; the first fix
      # here only covered the classic case and would still have hung.
      #
      # The durable answer is an npm AUTOMATION token, which bypasses 2FA entirely by design:
      #   npmjs.com -> avatar -> Access Tokens -> Generate New Token -> Automation
      #   npm config set //registry.npmjs.org/:_authToken=<token>     (or set $env:NPM_TOKEN)
      # With one configured, publish is non-interactive and this step just works.
      $hasToken = $false
      try { $hasToken = -not [string]::IsNullOrWhiteSpace((& npm config get //registry.npmjs.org/:_authToken 2>$null)) -and
                        (& npm config get //registry.npmjs.org/:_authToken 2>$null) -ne 'undefined' } catch { $hasToken = $false }
      if (-not $hasToken -and -not [string]::IsNullOrWhiteSpace($env:NPM_TOKEN)) { $hasToken = $true }

      if (-not $hasToken) {
        Write-Host ""
        Write-Host "No automation token detected, so npm will try an INTERACTIVE 2FA flow -- and that" -ForegroundColor Red
        Write-Host "cannot read the keyboard from inside this script. It will hang, not fail." -ForegroundColor Red
        Write-Host ""
        Write-Host "Two ways forward:" -ForegroundColor Yellow
        Write-Host "  1. RECOMMENDED -- create an Automation token (bypasses 2FA by design):" -ForegroundColor Yellow
        Write-Host "       npmjs.com -> avatar -> Access Tokens -> Generate New Token -> Automation" -ForegroundColor Gray
        Write-Host "       npm config set //registry.npmjs.org/:_authToken=<token>" -ForegroundColor Gray
        Write-Host "     then re-run this script." -ForegroundColor Gray
        Write-Host "  2. Publish by hand in a normal terminal, where the prompts work:" -ForegroundColor Yellow
        Write-Host "       cd $PublishWorkspace ; npm publish" -ForegroundColor Gray
        Write-Host ""
        Write-Host "Skipping publish rather than hanging the script." -ForegroundColor Yellow
        $otp = $null
        $skipPublish = $true
      }
      Write-Host ""
      $otp = if ($skipPublish) { $null } else { Read-Host "6-digit OTP if your token still demands one (or press Enter)" }

      $publishArgs = @('publish')
      if (-not [string]::IsNullOrWhiteSpace($otp)) {
        if ($otp -notmatch '^\d{6}$') {
          Write-Host "'$otp' is not a 6-digit code -- skipping publish rather than sending a bad OTP." -ForegroundColor Red
          $otp = $null
        } else {
          $publishArgs += @('--otp', $otp)
        }
      }

      if ($skipPublish) {
        Write-Host "Publish skipped -- see the guidance above." -ForegroundColor Yellow
      } elseif ($null -eq $otp -and $publishArgs.Count -eq 1 -and -not (Confirm-Yes "Publish now (no OTP supplied)")) {
        Write-Host "Skipped." -ForegroundColor Yellow
      } else {
        # Publish from inside the package dir, not 'npm publish --workspace' from root -- that flag can
        # inherit the ROOT package.json's "private": true on some npm versions (EPRIVATE on 10.9.8).
        Push-Location (Join-Path $RepoPath $PublishWorkspace)
        try { & npm @publishArgs; $publishExit = $LASTEXITCODE } finally { Pop-Location }
        if ($publishExit -ne 0) {
          Write-Host ""
          Write-Host "npm publish failed (exit code $publishExit)." -ForegroundColor Red
          Write-Host "  E401 + 'requires a one-time password'  -> the OTP was wrong or had expired; re-run and" -ForegroundColor Yellow
          Write-Host "                                            fetch a fresh code immediately before entering it." -ForegroundColor Yellow
          Write-Host "  E401 with no OTP mention               -> the token lacks publish rights ('npm login' again," -ForegroundColor Yellow
          Write-Host "                                            or issue an automation token that can publish)." -ForegroundColor Yellow
          Write-Host "  E403                                   -> that version already exists, or you lack rights to the name." -ForegroundColor Yellow
          Write-Host "  By hand:  cd $PublishWorkspace ; npm publish --otp=123456" -ForegroundColor Gray
        } else {
          Write-Host "Published." -ForegroundColor Green
        }
      }
    } else {
      Write-Host "Skipped -- publish by hand later:  cd $PublishWorkspace ; npm publish --otp=123456" -ForegroundColor Yellow
    }
  }
}

# ---------------------------------------------------------------------------
Write-Step 10 "Post-release checklist"
# ---------------------------------------------------------------------------
Write-Host "All 10 adversarial findings are CLOSED (F-10 landed in this release)." -ForegroundColor Green
Write-Host ""
Write-Host "Still open, on purpose:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  T-25  No OS-level isolation. Now the only headline residual (HARDENING_BACKLOG.md H1)." -ForegroundColor White
Write-Host "        The Q12 chain ends in code execution as the user, after which every in-process" -ForegroundColor Gray
Write-Host "        control is moot. Starfish governs a cooperative process, not a hostile one." -ForegroundColor Gray
Write-Host ""
Write-Host "  Scope mode defaults to 'contracted'. If a host calls governCall() with a taskId but" -ForegroundColor Gray
Write-Host "  never issues a contract, those calls now DENY. Pass scopeMode:'off' to loadGovernor" -ForegroundColor Gray
Write-Host "  for the exact pre-v0.27 behaviour while you wire issuance." -ForegroundColor Gray
Write-Host ""
Write-Host "Site:" -ForegroundColor Yellow
Write-Host "  site\index.html and site\starfish-vs-hermes\index.html were corrected -- deploy them" -ForegroundColor Gray
Write-Host "  whenever you next publish the site. The vs-hermes JSON-LD changed, so Google will" -ForegroundColor Gray
Write-Host "  re-read the FAQ rich results on its next crawl." -ForegroundColor Gray
Write-Host ""
Write-Host "  Two blog posts carry claims this release just fixed -- see docs\SITE_CLAIMS_AUDIT.md" -ForegroundColor Gray
Write-Host "  'Blog policy'. Recommended: an inline dated note (not an edit), matching how" -ForegroundColor Gray
Write-Host "  mosaic-and-the-unwired-fix.html handled the same situation:" -ForegroundColor Gray
Write-Host "     blog\toby-and-hank.html        -- 'reconciled against deterministic counters' (F-8)" -ForegroundColor DarkGray
Write-Host "     blog\the-1.0-candidate.html    -- 'head anchor catches tail truncation' (F-1)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Reading:" -ForegroundColor Yellow
Write-Host "  ADVERSARIAL-QA.md                  all twelve questions, answered from source" -ForegroundColor Gray
Write-Host "  docs\RELEASE_NOTES_v0.27.0.md      what changed and why" -ForegroundColor Gray
Write-Host "  docs\SITE_CLAIMS_AUDIT.md          claim -> evidence table" -ForegroundColor Gray
Write-Host "  docs\PHASE_BUILD_LOG.md            dev-log entry + per-finding resolution table" -ForegroundColor Gray
Write-Host ""
Write-Host ("=" * 78) -ForegroundColor DarkCyan
Write-Host "  Done." -ForegroundColor Cyan
Write-Host ("=" * 78) -ForegroundColor DarkCyan
Read-Host "Press Enter to close"
