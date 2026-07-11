# Project Starfish v0.23.0 — release notes

**Date:** 2026-07-10 · **Theme:** a granular risk model, an operator Risk-Tolerance dial, a calm one-screen UI, and normalize-before-match hardening.

This is a large feature release on top of the v0.22.0 "1.0 candidate." It reworks how Starfish *determines* risk, makes that risk *visible and tunable* to the operator, redesigns the desktop surface for credibility and single-screen focus, and closes a class of path/host normalization bypasses. Full list in `CHANGELOG.md`.

## Highlights

### One risk model, 0–100
Risk is no longer a coarse 4-tier label. Every governed action is scored **1–10 across 50 categories** (`docs/RISK_MATRIX.md`) that roll up — **max-driven, not averaged** — into a **0–100 composite** with 10 human descriptors (Clear → Forbidden). A single dangerous dimension can't be diluted; **category floors** express the constitutional hard floors so the score can widen convenience but never open a dangerous door. The 4-tier `RiskTier` remains as a derived, backward-compatible view — the entire existing test suite passes unchanged. Adversarially reviewed: `docs/RISK_MODEL_ADVERSARIAL_ANALYSIS.md` (50 attacks × 3 scored mitigations).

### Risk Tolerance (Low / Medium)
An operator setting, **Low by default**. On **Medium**, actions scoring ≤ 70/100 run without asking — for people on spare machines, with backups, or experimenting. It **never lifts the hard floors, injection, or critical**. Governed like everything else: operator-only, **two-step confirmation to raise**, one click to drop, persisted per-workspace, audited, fail-safe-to-Low on corrupt config, applied to the live PDP. A persistent header chip shows it (Medium pulses).

### Non-deviation + input re-provenance
A per-task **Scope Contract** (allowed tools / path scope / commands / budget, hash-sealed) keeps an agent on its approved mission (deterministic D1–D4 checks in the gate). Input files a task picks are **hash-stamped and re-verified at use**, so a cloud-synced or swapped file (TOCTOU) is caught.

### Calm, one-screen UI
The desktop surface is now the **D5 "Split Cockpit"**: a risk-sorted approval queue plus full decision context (who / what / where / why / risk / boundary), on a professional **light/dark design-token** system with a neutral **Calm** default. The Fleet/Star-Trek theme is preserved as an **optional, off-by-default skin**. Approval cards show the risk **descriptor + score**. The live decision stream moved to its own **Activity** screen with an at-a-glance dashboard summary — codifying the rule that *nothing an operator must act on lives below the fold* (`docs/design/UI_ONE_SCREEN.md`). A flashing banner warns if Starfish is run as **admin/root** (Windows grants this by default; governed workers shouldn't).

### Security hardening
**Normalize-before-match** across the boundary engine, secret-path classifier, and egress guard: Windows `\`↔`/` separator equivalence (closes a boundary-escape), NTFS ADS / trailing-dot secret-name tricks, and trailing-FQDN-dot / IPv4-mapped-IPv6 host encodings.

### Skills & positioning
Ten governed launch-skill scaffolds (`skills/`) covering everyday work. Honest comparison pages — **Starfish vs OpenClaw** and **vs Hermes** — crediting what those projects did for agentic AI while making the governance case. A `SECURITY.md` with a responsible-disclosure policy and an honest security model.

## How to verify
`npm run ci` (typecheck + tests + conformance + determinism + dep-lint + secret/IP scans + SBOM). Run the desktop app (`cd packages/desktop/app && npm run dev`) to see the Bridge, Risk chip, Activity tab, and admin banner against the live engine.

## Honest limits (not in this release)
- **The 10 skills are scaffolds** — the document engines (import from anthropics/skills) and the Arena vetting aren't wired; they're not yet functional end-to-end.
- **RM-3 is unified at the decision point**, but the peripheral producers (vetting/deletion/secrets) still carry their own tier logic internally.
- **H5** primitive + scope methods exist; a task runner still needs to call them.
- OS-level process isolation (T-25), signed auto-update + blocklist, and the managed-key / chat-first surfaces are tracked in `HARDENING_BACKLOG.md` / `FEATURE_CANDIDATES.md`.

## Deferred to the owner (release mechanics)
`git commit` + push this batch; `npm run version:sync` (aligns the `@starfish/*` packages to 0.23.0); tag `v0.23.0`; `npm publish` with provenance/SBOM; signed installer; counsel-reviewed legal terms; independent external security review; rotate the live `.env` key.
