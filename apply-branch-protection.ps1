# Applies branch protection to master on Azerax/Starfish so the OpenSSF
# Scorecard "Branch-Protection" check scores well. Requires GitHub CLI (gh)
# authenticated with a token that has 'repo' admin scope:  gh auth login
#
# To push toward the maximum Scorecard score later, edit branch-protection.json
# and set  required_approving_review_count  to 1 (you'll then need a second
# reviewer/account to approve PRs before merging).

$ErrorActionPreference = "Stop"
$Repo   = "Azerax/Starfish"
$Branch = "master"
$Json   = Join-Path $PSScriptRoot "branch-protection.json"

Write-Host "[1/2] Applying branch protection to $Repo ($Branch)..."
gh api -X PUT "repos/$Repo/branches/$Branch/protection" `
  -H "Accept: application/vnd.github+json" `
  --input "$Json"

Write-Host "[2/2] Verifying..."
gh api "repos/$Repo/branches/$Branch/protection" `
  -q '{force_push: .allow_force_pushes.enabled, deletions: .allow_deletions.enabled, admins: .enforce_admins.enabled, linear: .required_linear_history.enabled, checks: .required_status_checks.contexts}'

Write-Host "Done. Branch protection is active on $Branch."
