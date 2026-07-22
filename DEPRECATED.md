# Deprecated files & folders — Project Starfish

> **Date:** 2026-07-13 · A ledger of what is **no longer the source of truth**, what supersedes it, and
> what is safe to ignore. **Nothing here is auto-deleted** — this is a "do not trust / do not edit these"
> note. Verify a mapping before removing anything, especially the design docs flagged **KEEP**.
>
> **Canonical repo:** `C:\Users\swhol\Documents\Github\Starfish` (GitHub `Azerax/Starfish`).
> Constitutional source of truth: `GOVERNANCE.md`. **Current roadmap: `ROADMAP.md` at the repo root**
> (public-facing; consolidated 2026-07-20). `docs/ROADMAP.md` is now superseded/historical — its
> v0.13→v0.22 line is fully shipped. Internal detail: `docs/MASTER_COMPLETION_PLAN.md`,
> `docs/HARDENING_BACKLOG.md`, `docs/FEATURE_CANDIDATES.md`, `USABILITYROADMAP.md`.
>
> **2026-07-20 correction:** the 2026-07-13 relocation described below was a **copy, not a move** — all
> 23 originals were still tracked in `docs/planning/`, and `_not-starfish/` was never actually in
> `.gitignore`. Both are now fixed: everything lives in **`deprecated/`**, which *is* gitignored, and
> the tracked originals have been removed from the tree.

---

## 0. Where these live now (relocated 2026-07-13)

The unrelated + deprecated files listed below were **moved out of the tracked tree into `_not-starfish/`**
at the repo root, which is **gitignored**. Nothing was deleted — they remain on disk; delete or relocate
them yourself when ready. Subfolders:

- `_not-starfish/deprecated-planning/` — superseded planning docs (§3)
- `_not-starfish/archives/` — dead archives (§2)
- `_not-starfish/simon-os-and-agentic-os/` — the separate simon-os project (§5)
- `_not-starfish/stray/` — stray root artifacts (§6)

`docs/planning/` now retains **only live design references**: the Governed Execution suite (§4) and the
still-live `Starfish — Built-in Skills & File Templates (Out-of-the-Box Spec).md`.

---

## 1. Deprecated wholesale — the OneDrive folder

`C:\Users\swhol\OneDrive\Documents\Claude\Projects\Project Starfish\` — **the entire folder is deprecated.**
All work happens in the GitHub repo (never OneDrive — the cloud-sync mount is stale/truncated for lagged
files). Every planning doc that was in this folder has already been copied into the repo at
**`docs/planning/`**, so the OneDrive copies are pure duplicates. Treat the OneDrive folder as read-only
history; do not edit or cite it.

## 2. Dead archives (now in `_not-starfish/archives/`)

| File | Why dead |
|---|---|
| `munder-difflin-fork-ARCHIVE-20260614.tgz` | Archive of the old munder-difflin *visual reference*. Starfish reuses **zero** of its code (it is not a fork). Historical only. |
| `starfish-phase0-stale-ARCHIVE-20260614.tgz` | Explicitly a **stale** phase-0 archive. Superseded by the current monorepo. |

## 3. Superseded planning docs (now in `_not-starfish/deprecated-planning/`)

These were the pre-build planning documents. They are kept for history but are **no longer current** — the
built product and the docs below are the source of truth. Do not plan or quote from these.

| Deprecated doc (now in `_not-starfish/deprecated-planning/`) | Superseded by (current) |
|---|---|
| `Project Starfish PRD.md` | The shipped product + `README.md`, `GOVERNANCE.md` |
| `Project Starfish IMPLEMENTATION PLAN.md`, `… (DETAILED).md`, `MASTER BUILD PLAN.md` | `docs/ROADMAP.md`, `docs/MASTER_COMPLETION_PLAN.md`, `CHANGELOG.md` + git log |
| `ROADMAP.md` (planning copy), `Starfish Release Roadmap.md` | `docs/ROADMAP.md`, `docs/MASTER_COMPLETION_PLAN.md`, `docs/LAUNCH_READINESS_PLAN.md` |
| `Project Starfish THREAT MODEL.md` | `docs/THREAT_CLASSES_AND_MITIGATIONS.md`, `docs/PERSONA_THREAT_MODEL.md`, `SECURITY.md` |
| `Project Starfish RISK & COMPLIANCE REGISTRY.md` | `docs/RISK_MATRIX.md`, `docs/COMPLIANCE_CONTROL_MAP.md`, `docs/RISK_MODEL_*.md` |
| `Project Starfish THEME SPEC.md`, `Project Starfish UI THEME SPEC.md` | `docs/design/UI_DIRECTIONS.md`, `packages/desktop/src/theme.ts` (calm default; Fleet optional) |
| `Project Starfish GOVERNANCE FRAMEWORK.txt`, `Project Starfish GOVERNANCE HANDOFF.md` | `GOVERNANCE.md` (constitutional source of truth) |
| `PROJECT_UNDERSTANDING.md` | `README.md` + the project memory wiki |
| `Registry Hierarchy Information.txt` | governance-core registries + the `README.md` architecture/rings table |
| `Governed Execution — Non-Deviation Enforcement (Implementation Plan).md` | **Implemented** (scope contract / non-deviation shipped). Plan is now historical. |

## 4. KEEP — still-live design references (do NOT deprecate)

These **stay in `docs/planning/`** and describe designs that are **not built yet** — they remain the
reference for future work. Leave them live. (The `Starfish — Built-in Skills…` spec also stays there for
the same reason.)

| Doc | Status |
|---|---|
| `Governed Execution — The Arena (Trust Proving Ground).md` | Unbuilt; feature candidate C1/C4 (`docs/FEATURE_CANDIDATES.md`) |
| `Governed Execution — Deception Cell (Honeypot Containment).md` | Unbuilt; feature candidate C7 |
| `Governed Execution — Sandboxed Execution for Untrusted Tasks.md` | Unbuilt design reference |
| `Governed Execution — Runtime Safety Layer Plan.md` | Design umbrella; parts shipped (non-deviation), parts pending |
| `Governed Execution — Adversarial Analysis (50 Attacks x 3 Mitigations).md` | Partly folded into `docs/RISK_MODEL_ADVERSARIAL_ANALYSIS.md` — **verify overlap before retiring** |

## 5. Not Starfish — belongs to the separate simon-os / Agentic-OS work

Moved to `_not-starfish/simon-os-and-agentic-os/` — part of the **separate** `simon-os` fork / Agentic-OS
import assessment, not Starfish (see memory `simon-os-fork`).
(`AUDIT_QUESTIONNAIRE.md` was **restored to `docs/`** on Scott's call — it's a live Starfish file, not simon-os.)

`Simon.md` · `Simon-Implementation-Plan.md` · `fork-simon-os.ps1` · `agentic-os-security-hardening-review.md`
· `agentic-os-starfish-import-assessment.md` · `agentic-os-threat-model-audit.md`
(`Launch Project Starfish.bat`, the old OneDrive launcher, is in `_not-starfish/deprecated-planning/`.)

## 6. Stale inside the current repo — update, don't delete

Not deprecated, but out of date and should be corrected:

| Item | Problem | Fix |
|---|---|---|
| `README.md` (Changelog line) + `packages/cli/README.md` | Say "Latest: **v0.10.0**" while `package.json` is **v0.23.0** | Bump the version references at next release pass |
| `packages/desktop/app/out/` | Build artifact predates the live-Governor wiring (~June 14); "typechecks" ≠ "runs" | Rebuild + verify launch (see `USABILITYROADMAP.md` M1) |
| Root `git` and `master` (0-byte files) | Look like stray files from a redirected git command | **Moved to `_not-starfish/stray/`** — verify and delete |

---

### Rule going forward
One source of truth per topic. When a planning doc is replaced by a shipped feature or a newer doc, add a
row here and point to the replacement — don't leave two live copies. OneDrive is never a work location.
