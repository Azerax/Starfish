# OpenSSF Scorecard — Remediation Plan (SSF.md)

**Repo:** `github.com/Azerax/Starfish` · **Default branch:** `master`
**Baseline score:** 3.7 / 10 (first run, 2026-07-16)
**Author:** Scott (Azerax) · **Status:** planning — no changes applied yet

> **Prime directive for this plan:** *do not break Starfish, and stay backward compatible.*
> Every change below is either additive (new file / new workflow) or a permission-narrowing that
> does not affect runtime. No change touches the CLI surface, the SDK/wire contracts, governance
> behavior, or the published package API. Dependency changes are gated behind the existing
> `npm run ci` conformance + determinism suite, which is our regression net.

---

## 1. Baseline — what the first run reported

| Check | Score | Bucket |
|---|---|---|
| Code-Review | 0/10 | Time / process — not fixed here |
| Maintained | 0/10 | Time (repo < 90 days) — not fixable |
| SAST | 0/10 | **Fix (optional):** add CodeQL |
| Vulnerabilities | 0/10 | **Fix:** 21 known-vulnerable deps |
| Dependency-Update-Tool | 0/10 | **Fix:** add Dependabot |
| Fuzzing | 0/10 | Won't-do (low ROI) |
| Contributors | 0/10 | Can't (solo) |
| CII-Best-Practices | 0/10 | Won't-do (separate questionnaire) |
| Token-Permissions | 0/10 | **Fix:** least-privilege in `ci.yml` |
| Branch-Protection | −1/10 | Optional: PAT so Scorecard can read rules |
| Packaging | −1/10 | Deferred (until publishing releases) |
| Signed-Releases | −1/10 | Deferred (until first GH Release) |
| Pinned-Dependencies | 8/10 | **Fix:** pin remaining actions by SHA |
| License | 9/10 | Won't-do (cosmetic "non-standard" flag) |
| Dangerous-Workflow | 10/10 | ✅ keep |
| Binary-Artifacts | 10/10 | ✅ keep |
| CI-Tests | 10/10 | ✅ keep |
| Security-Policy | 10/10 | ✅ keep |

**Realistic target after this plan:** ~6–7 / 10. The remaining gap is structural
(age, contributors, code-review history) and closes only with time and adoption.

---

## 2. Backward-compatibility guarantees (apply to every item)

1. **No runtime/API change.** Nothing here modifies `packages/*` source, the `starfish` CLI bin,
   the SDK exports, wire formats, or governance decisions. See `docs/SEMVER_AND_WIRE_COMMITMENTS.md`.
2. **No version bump required.** CI/infra and security-patch changes are not user-facing; they do
   not warrant a minor/major. Dependency security bumps are kept to semver-compatible ranges
   wherever possible (patch/minor).
3. **Additive-first.** New files (`dependabot.yml`, `codeql.yml`) add capability without altering
   existing behavior. Permission narrowing only *removes* unused privileges.
4. **Gated by the existing test net.** Every dependency change must pass `npm run ci`
   (typecheck + unit + conformance + determinism + dep-direction lint + secret/IP scans + SBOM)
   **and** `npm run build:cli` before merge. Branch protection already blocks un-green merges.
5. **One concern per PR, always revertible.** Infra hardening and dependency changes ship
   separately so a regression can be bisected and rolled back cleanly.

---

## 3. PR 1 — Workflow hardening (zero runtime impact)

All four items below are safe to ship together: none affect the app or its published artifacts.

### 3.1 Token-Permissions → add least-privilege block to `ci.yml`

**Why:** `ci.yml` has no top-level `permissions:`, so its `GITHUB_TOKEN` inherits broad default
scopes. `release.yml` and `scorecard.yml` already declare permissions; only `ci.yml` is flagged.

**Change:** insert immediately after the `on:` block in `.github/workflows/ci.yml`:

```yaml
permissions:
  contents: read
```

**Non-breaking rationale:** the CI job only checks out code and runs `npm` scripts (typecheck,
tests, scans, bundle). It writes nothing back to the repo, posts no comments, and uploads no
artifacts, so `contents: read` is sufficient. Read-only is strictly a *reduction* of privilege.

**Verify:** push branch → confirm the `verify` job still completes green.
**Rollback:** delete the two added lines.

### 3.2 Pinned-Dependencies → pin all actions by commit SHA

**Why:** actions referenced by mutable tag (`@v4`) can be repointed by the upstream owner; Scorecard
wants immutable SHA pins. Affected files/uses:

- `ci.yml`: `actions/checkout@v4`, `actions/setup-node@v4`
- `release.yml`: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`
- `scorecard.yml`: already SHA-pinned ✅

**Change:** replace each `uses: owner/action@v4` with the tag's **commit SHA** plus a version
comment. Resolve the exact SHA at apply time (so we never bake in a stale pin) — pin to the
**current v4.x** commit to keep behavior identical:

```bash
gh api repos/actions/checkout/commits/v4      -q .sha
gh api repos/actions/setup-node/commits/v4    -q .sha
gh api repos/actions/upload-artifact/commits/v4 -q .sha
```

Then e.g.:

```yaml
# before
- uses: actions/checkout@v4
# after
- uses: actions/checkout@<sha-from-above> # v4
```

**Non-breaking rationale:** pinning to the SHA the `v4` tag *already* points to is a zero-behavior
change — same code, just referenced immutably. We deliberately stay on the current major (not
bump to v5+) to avoid any behavior drift. Dependabot (3.3) will propose future bumps safely.

**Verify:** `verify` job green + `Release` workflow YAML still parses (it only runs on tags, so
confirm via a dry `act`/lint or the next tag).
**Rollback:** revert to `@v4` tags.

### 3.3 Dependency-Update-Tool → add `.github/dependabot.yml`

**Why:** no automated update tool configured. Dependabot also keeps the Vulnerabilities count
(section 4) from regrowing.

**Change:** new file `.github/dependabot.yml`:

```yaml
version: 2
updates:
  # Root monorepo (npm workspaces: packages/*)
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    groups:
      dev-dependencies:
        dependency-type: "development"

  # Desktop app has its own lockfile (installed separately)
  - package-ecosystem: "npm"
    directory: "/packages/desktop/app"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5

  # Keep GitHub Actions SHAs current after we pin them in 3.2
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

**Non-breaking rationale:** Dependabot only *opens PRs*; it changes nothing on its own. Every
proposed bump still has to pass `npm run ci` under branch protection before it can merge. Grouping
dev-deps keeps PR noise down. Major-version PRs stay for manual review.

**Verify:** file appears under Insights → Dependency graph → Dependabot; first PRs arrive on
schedule. No runtime effect.
**Rollback:** delete the file.

### 3.4 (Optional) SAST → add a CodeQL workflow

**Why:** SAST is 0/10; CodeQL gives real static analysis for JS/TS and surfaces findings in the
Security tab.

**Change:** new file `.github/workflows/codeql.yml` (SHA-pinned, least-privilege):

```yaml
name: CodeQL
on:
  push:
    branches: [ "master" ]
  pull_request:
    branches: [ "master" ]
  schedule:
    - cron: '25 3 * * 1'   # weekly, Monday 03:25 UTC
permissions:
  contents: read
jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      security-events: write   # upload results to code scanning
      contents: read
    steps:
      - uses: actions/checkout@<checkout-sha> # v4
      - uses: github/codeql-action/init@<codeql-sha>     # v3
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@<codeql-sha>  # v3
```

**Non-breaking rationale:** a *separate, additive* workflow that reads code and reports findings.
It runs no build step (JS/TS needs none for CodeQL) and cannot alter the app or block anything
that isn't already a required check. Do **not** add `CodeQL` to branch-protection required checks
initially — let it run informationally first so it never blocks a merge unexpectedly.

**Verify:** CodeQL run completes; results under Security → Code scanning.
**Rollback:** delete the workflow.
**Note:** if the CodeQL noise/minutes aren't wanted, this item can be dropped with no effect on the
other three — it's the only "optional" item in PR 1.

---

## 4. PR 2 — Dependency vulnerabilities (the careful one)

**Why:** Scorecard reported 21 known-vulnerable dependencies. This is the only item with real
breakage risk, so it ships as its own PR with staged, test-gated changes.

**Scope note:** root deps are lean (`esbuild`, `typescript`, `vitest`, `@types/node`); most of the
21 are almost certainly **transitive** and many are **dev-only** (build/test/electron toolchain).
Dev-only advisories don't ship in the published `packages/cli` artifact, so runtime exposure is
lower than the raw count implies — but we still clear what we safely can.

**Procedure (strictly ordered, test after every step):**

1. **Enumerate** without changing anything:
   ```bash
   npm audit                       # root (workspaces)
   npm audit --omit=dev            # production-only surface (highest priority)
   ( cd packages/desktop/app && npm audit )
   ```
2. **Triage:** fix production/runtime advisories first, dev-only second. Note any that are
   `will-require-major` — those are held for individual review.
3. **Apply semver-safe fixes only:**
   ```bash
   npm audit fix                   # respects semver ranges — non-breaking by design
   ( cd packages/desktop/app && npm audit fix )
   ```
   Commit **only** the updated `package-lock.json` files.
4. **Full gate after the safe pass:**
   ```bash
   npm ci && npm run ci && npm run build:cli
   npm run dev:web   # headless smoke — renderer boots without error
   ```
   Conformance + determinism suites in `npm run ci` are the backstop against behavior drift.
5. **Breaking advisories (`npm audit fix --force` territory):** **do not** run `--force` blanket.
   Handle each remaining advisory individually — bump one package, run the full gate, keep only if
   green. Anything that can't be fixed without breaking a conformance test is documented in the PR
   and left for a scoped follow-up rather than forced.

**Non-breaking rationale:** steps 3–4 stay inside semver and are validated by the same suite that
guards every release. Nothing merges unless `npm run ci` is green under branch protection.

**Verify:** `npm audit` count drops; `npm run ci` + `build:cli` + `dev:web` all pass.
**Rollback:** revert the lockfile commit(s); ranges in `package.json` are untouched by `audit fix`,
so reverting the lockfile fully restores prior resolution.

---

## 5. Optional / deferred

- **Branch-Protection (−1 → positive):** the −1 is a *read error*, not missing protection — you
  already applied rules. To let Scorecard read them, create a **read-only fine-grained PAT**
  (Administration: read, Contents: read on this repo), store as secret `SCORECARD_TOKEN`, and pass
  `repo_token: ${{ secrets.SCORECARD_TOKEN }}` to the scorecard step. Non-breaking, but adds a
  token to rotate — do only if the visible score matters.
- **Signed-Releases / Packaging (−1):** both resolve naturally once you cut a real GitHub Release
  with the existing provenance-enabled `release.yml`. No action until you publish.

## 6. Won't-do (documented, intentional)

- **Fuzzing** — heavy harness, low ROI for this codebase right now.
- **CII-Best-Practices** — separate bestpractices.dev questionnaire; revisit if pursuing a badge.
- **Contributors / Maintained / Code-Review** — driven by adoption, org diversity, and reviewed-PR
  history over time. The PR-based flow now in place makes Code-Review climb organically.
- **License (9/10)** — flagged only as "non-standard"; Apache-2.0 + NOTICE is intentional. Cosmetic.

---

## 7. Sequencing & rollback summary

| PR | Contents | Runtime risk | Gate | Revert |
|---|---|---|---|---|
| **PR 1** | ci.yml permissions, SHA pins, dependabot.yml, (opt) codeql.yml | none | `verify` green | delete/restore lines & files |
| **PR 2** | `npm audit fix` lockfile updates (staged) | low, test-gated | `npm run ci` + `build:cli` + `dev:web` | revert lockfile commit |

Both PRs go through branch protection (PR required, `verify` must pass, squash merge for linear
history), so nothing lands unverified. Expected outcome: **3.7 → ~6–7 / 10**, with zero change to
Starfish's behavior, API, or published artifacts.
