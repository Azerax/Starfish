# Launch readiness analysis (re-run 2026-06-21)

Evidence-based. Scope: is Project Starfish ready to put in front of users? Verdict up front:
**The CLI / Claude Code overlay is launch-ready as the public product after a short checklist; the desktop
UI is not, and should be positioned as a research preview.** Overall: ~7.5/10 today, ~9/10 after the
pre-launch checklist below.

## Scorecard

| Area | Status | Notes |
|------|--------|-------|
| Core governance engine | **READY** | 310 conformance/determinism tests green; deny-by-default, audit, boundary, evidence gate, self-integrity. |
| CLI / Claude Code overlay (the product) | **READY (soft-launch)** | R0-verified on CC 2.1.183; friction solved (writes profile + backups); visible (`[Starfish]` status line + prefixed reasons); one-command self-elevating managed lockdown; `doctor`/`attest`. Pending: publish 0.10.1, one live session, Step 4. |
| Desktop UI (GCS Starfish) | **NOT READY** | Typechecks now, but never launched since the live wiring, and cannot dispatch agents (Phase 3 unbuilt). Ship as "research preview", not a launch claim. |
| Distribution / npm | **MOSTLY** | 0.10.0 live (Apache-2.0, good README+keywords). 0.10.1 staged, unpublished. No git tags / GitHub Releases yet. |
| Website + SEO | **READY** | projectstarfish.ca live, devlog blog, modern keyword-rich pages. Minor: set GitHub Topics/About; verify OG card renders. |
| README / docs | **READY (needs hygiene)** | Root + npm READMEs strong. `docs/` has many INTERNAL planning docs (plans, assessments, NEEDS_SCOTT_APPROVAL) - review before public eyes. |
| Legal / licensing | **READY for OSS** | LICENSE (Apache-2.0), NOTICE, TRADEMARK, COMMERCIAL, CONTRIBUTING all present. Trademark filing + commercial terms still want a lawyer (not an OSS-launch blocker). |
| Security positioning | **READY** | Strategy A in-band surfaces #1-#8 fixed; OS-trust boundary (#9-13) documented out of scope. "Research preview" framing is honest and appropriate. |

## What changed since the last analysis (all positive)
- Friction critique resolved: per-project/session `writes` profile (`ask`|`auto`) + versioned backups; the
  system-risk floor stays fixed. Mode 1 is no longer "a wall of prompts."
- Visibility added: `[Starfish]` status line + `[Starfish]`-prefixed decision reasons.
- One-command lockdown: self-elevating managed install (UAC / sudo).
- 0.10.0 published to npm (verified) with corrected license + governance SEO; 0.10.1 staged.
- Desktop app now typechecks (was failing); a real daemon strictness bug fixed.

## Pre-launch checklist (ordered; small, mostly verification + publish)
1. **Publish 0.10.1** so the live npm experience includes the status line, friction profile, and
   self-elevation (0.10.0 has overlay governance but the rough UX). `release.ps1` is ready.
2. **Run Step 4 on a real machine**: `starfish install --claude-code --managed` (elevated) -> `starfish doctor`
   all PASS -> re-run R0 Step 4. This is the one unverified security gate (managed overrides `disableAllHooks`).
3. **One full live Claude Code session, governed end to end** on a real task. R0 proved the hook contract;
   this proves the daily loop (and exercises the writes profile + status line + audit in anger).
4. **Tag + Releases + GitHub metadata**: tag v0.9.0/0.9.3/0.10.0/0.10.1, create the GitHub Releases from the
   notes files, set the repo About description + Topics + website (the biggest discovery lever, still likely empty).
5. **Docs hygiene**: keep user docs (README, CHANGELOG, OVERLAY_USAGE, release notes); move or clearly mark
   internal planning docs (BRIDGE_LIVE_PLAN, FULL_GOVERNED_BUILD_PLAN, ROUTE1_OVERLAY_PLAN, SEED_REFACTOR_PLAN,
   USABILITY_ASSESSMENT, NEEDS_SCOTT_APPROVAL) as dev notes; confirm none contain anything you would not want public.
6. **Position the UI honestly** wherever it appears (site/README): "GCS Starfish desktop - research preview;
   observe + approve today, autonomous builds coming." Avoid implying it runs agents now.

## Known limitations to state at launch (honesty = trust, esp. for this audience)
- Hook enforcement governs the **Claude Code CLI**; a different runner is out of scope (and is itself a
  denied tool call from inside a governed session).
- Full tamper-resistance needs the **managed install** (admin) + OS file permissions; a local-root attacker
  is out of scope (OS sandboxing, T-25).
- Token/USD accounting in overlay mode is **approximate** (CC holds the model usage).
- Desktop UI does not run agents yet.

## Recommendation
Do checklist items 1-4 (publish, verify lockdown, one live session, tag/topics) - that is the gap between
"the code is ready" and "ready to tell people." Launch the **CLI/overlay** as the product with a
research-preview label; keep the **desktop UI** as a visible-but-unfinished preview. Items 5-6 are quick
hygiene. Lawyer review and UI Phase 3 are post-launch.
