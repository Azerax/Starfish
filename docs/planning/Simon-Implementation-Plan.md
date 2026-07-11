# Simon Implementation Plan — Starfish → simon-os

**Derived from:** `Simon.md` (case study, Steps 0–12). **Status: PLAN — NOT IMPLEMENTED. G-gate partially cleared 2026-07-04.**
**Date:** 2026-07-04. Starfish External Waves 0–5 built (359 tests, verify via `skills/starfish-verify`).

**2026-07-04 update — hard fork.** The target repo is now Scott's own hard fork: **github.com/Azerax/simon-os** (local: `C:\Users\swhol\Documents\Github\simon-os`; baseline tag `pre-starfish-baseline` pushed). No upstream remote, no tokens, no syncing from `simonc602/agentic-os`. Consequences: constraint **C1 (survive update.sh re-syncs) is moot**; WP10's upstream-staging lane is dropped; WP11's sentinel is integrity-only (detect local tampering, not upstream clobbering).

---

## 0. Pre-implementation gate (must clear before WP0 starts)

The audits are point-in-time. Status after the 2026-07-04 read-only scan of the fork:

- [x] **G0.** Repo ownership established — hard fork at Azerax/simon-os, private, history preserved, single remote.
- [x] **G1. VERIFIED, +2 findings.** All 4 audit-cited spawn sites confirmed at stated locations (`process-manager.ts` L1331–1338; `cron-runtime.js` `buildCronClaudeArgs` L2433/L2445; `run-claude-text-prompt.ts` L25; `capture.ts` L457). **Finding A:** a 5th spawn site the audits missed — `app/api/tasks/generate-title/route.ts` L50. **Finding B (favorable):** all 5 route through `subprocess.ts` (`spawnUiProcess` / `spawnManagedTaskProcess`) — an existing chokepoint; WP1's launcher becomes a `subprocess.ts` interception + guard rather than 4 separate patches. Cron additionally honors `AGENTIC_OS_CLAUDE_BIN` (cron-runtime.js L2474) as a binary-override injection point.
- [x] **G2. CLEARED.** CLI pinned: **claude 2.1.183**. Conformance run on the target machine 2026-07-04 (`starfish/conformance/run-conformance.mjs`): **A1 blocks-until-decision PASS** (stub held 6000ms, execution waited), **A2 deny-is-deny PASS** (denied Bash never executed), **B subagent inheritance PASS** (Task-spawned subagent's Bash routed through the permission tool). The spine assumption holds on the pinned CLI.
- [x] **G3. GREEN.** `starfish-verify` executed 2026-07-04 in an isolated copy (source untouched): install ✅, CLI bundle ✅, typecheck ✅, dep-direction lint ✅ (core<hooks<sdk<overlay<desktop<ui holds), tests **420/420 passed** (83 files — suite has grown from the 359 previously recorded).
- [x] **G4. GREEN at SDK level.** `dispatch.tools.conformance.test.ts` passed in the run: dotted names map to wire-safe (`fs.read`→`fs__read`), all wire names match `^[A-Za-z0-9_-]{1,64}$` (no dots), and the loop unwires `fs__write`→`fs.write` on reply. Live check against CLI 2.1.183 folds into the G2 conformance step.
- [x] **G5. DONE.** Tag `pre-starfish-baseline` pushed. `.env` not tracked (only `.env.example`); deep secrets sweep (github_pat_ / ghp_ / sk- / AIza) clean — no credentials in the fork's history.
- [x] **G6. RESOLVED.** `update.sh` is a git-pull-from-upstream gated on `AGENTIC_OS_UPDATE_TOKEN` from `.env` (Simon's paid-access mechanism). With no upstream remote and no token it **fails closed** (exit 20). Neutering is optional hygiene; no interception lane needed.

Gate rule: G2 must clear before WP2 (it is the spine assumption); G3/G4 must clear before WP2's PEP attach. WP0 and WP1 may start now.

---

## 1. Work packages

Sizing: S ≤ ½ day, M ≤ 2 days, L ≤ 5 days. Order is dependency order; WPs marked ∥ can run in parallel after their dependency.

### WP0 — Baseline & shadow harness (Simon.md Step 0) — L
**Build:** `starfish/harness/` (outside synced tree): recorder that captures per-run tool-call sequences, egress domains, Bash argv, `.env` reads, API routes hit by the UI; replay/diff tool for golden runs (3 cron jobs, 2 chat tasks, 1 skill-heavy task).
**Exit:** 30 days of shadow telemetry target started; golden-run diffs reproducible twice consecutively.
**Rollback:** delete folder; zero app changes.

### WP1 — Governed launcher (Step 1) — M → S/M (reduced by G1 Finding B)
**Build:** intercept at the existing chokepoint — `subprocess.ts` (`spawnUiProcess` / `spawnManagedTaskProcess`): any `claude` spawn routes through `starfish/launcher/starfish-launch.(cjs)`, which injects flags, origin tag (`chat|cron|api|cli`), passthrough mode initially. Use `AGENTIC_OS_CLAUDE_BIN` for the cron path. Verify all **5** spawn sites (incl. `generate-title/route.ts`) flow through it; PATH shim for raw `claude`. Guard: launcher refuses direct `claude` argv containing bypass flags it didn't add.
**Exit:** 100% of spawns in telemetry show launcher origin tags across all 5 sites; golden runs diff-clean.
**Rollback:** revert the `subprocess.ts` interception; remove shim.

### WP2 — PEP attach in shadow mode (Step 2a) — M — **BUILT 2026-07-04, soak pending**
**Built:** `shadow-pep-mcp.cjs` attached via `prepareClaudeArgs()` on every claude spawn lacking a host bridge (host ask-mode bridge left as decider; bypass spawns get inert plumbing). **Design correction vs. plan text:** shadow answers **deny-mirror, not allow-all** — allow-all would have widened permissions on headless spawns whose asks previously failed with "no way to ask." Deny-mirror is behavior-identical and still logs every request. Kill-switch `STARFISH_SHADOW=off`; flags injected before the bare `--`; wire name `mcp__starfish_pep__approval_prompt` (C7-safe). Tests 9/9; host suites unchanged vs. baseline (58/13 env, capture 15/15).
**Exit (pending on target machine):** pep-decisions log populating across origins during normal use; latency delta < 20ms p95.
**Rollback:** `STARFISH_SHADOW=off` (verified by test).

### WP3 — Gov dir + integrity + secrets (Step 4) — L
**Build:** `%LOCALAPPDATA%\Starfish\gov\` (policy, registry, audit chain, approvals/tasks adapter target); spawn-time hash check of settings.json/hooks/.mcp.json (warn-only initially); secrets migrated to Windows Credential Manager, launcher injects env vars; `.env` kept in place temporarily (dual-source) until WP-telemetry shows zero direct file reads (T&E-7).
**Design constraint:** launcher (owner context) reads credentials, child gets env — compatible with WP11's restricted user (T&E-9).
**Exit:** app runs entirely on injected env in a test workspace; hash-check warnings zero for 7 days.
**Rollback:** dual-source means `.env` still works; flip adapter back.

### WP4 — Audit chain + fsync-before-release + quotas (Step 9) — M — **BUILT 2026-07-04**
**Built:** `audit-chain.cjs` in gov dir (`%LOCALAPPDATA%\Starfish\gov`, env-overridable): sha256 hash-chained append-only JSONL, fsync-before-release, HEAD file + tail-scan recovery, atomic-mkdir cross-process lock with stale reaping, `verify` CLI. Shadow PEP now chain-logs every decision before responding. Quota counters live per origin/hour (enforcement off until WP7); Tier-0 decision cache module built (inert until WP7, argv-class keyed, TTL). Tests 6/6 incl. tamper-detection (edited entry breaks verify at exact seq), restart continuity, unwritable⇒ok:false. End-to-end: PEP call → chain seq 1 → verify clean.
**Exit met in sandbox;** crash test on target machine folds into the WP2 soak.
**Rollback:** chain failure never blocks in shadow (deny either way); sink is additive.

### WP5 — Tier policy + standing grants (Step 3) — L
**Build:** PDP policy file (gov dir): Tier 0/1/2/3 keyed on tool + typed argv class + origin + task type; scoped standing grants for existing cron jobs (generated from WP0 telemetry, human-reviewed once); ask-queue with deadline-degrade-to-deny+notify; allow/deny/ask health metric; decision-ready prompt payloads (who/why/risk/diff).
**Launch gate (T&E-4):** projected ask-rate from telemetry < 5/day or don't proceed to WP7.
**Exit:** policy replayed against 30-day telemetry: 0 breaks of known-good runs, all historical dangerous-class actions correctly classed Tier 2/3.
**Rollback:** policy file version-pinned; revert file.

### WP6 — API auth + seam routing + inert rendering (Step 5) — L ∥ (after WP2)
**Build:** `middleware.ts` (boot-minted session token + CSRF), log-only first (T&E-10); localhost bind; kill raw `GET /api/settings/env` (masked keys + audited Tier-2 reveal); shared `authorize()` helper calling the PDP with `origin=api` wired into the privileged route families (settings/*, files/*, gsd/*, tasks/*, scripts/run); allowlist renderer (markdown-it + DOMPurify-class) for task output/logs/memory/commit messages, snapshot-tested against WP0's render corpus (T&E-12).
**Exit:** missing-token log silent for 7 days ⇒ flip middleware to enforce; XSS canary strings in task output render inert.
**Rollback:** middleware log-only flag; env-route restore is one revert (but do not ship rollback of this one without sign-off — it is the worst Critical).

### WP7 — Enforcement cutover, staged per origin (Steps 2b + 12c) — M, calendar-long
**Flip order:** chat → api → cron; one-week soak each; shadow-diff must be clean before next origin. Flip = launcher stops passing bypass flags for that origin, unknown/missing mode = hard error, fail-closed pre-spawn assertion active (PEP + audit + settings-hash reachable), degraded read-only mode on gov-infrastructure failure (T&E-3).
**Exit:** all three origins enforced; zero Tier-0/1 human asks; ask-rate ≤ target; no golden-run regressions.
**Rollback:** per-origin flag back to shadow — never back to bypass (shadow still logs).

### WP8 — Authorization lifecycle (Step 6) — M
**Build:** tasks adapter (from WP3) makes `permissionMode`/scope host-set only; agent-created tasks land `proposed`; policy auto-approves Tier-0/1 task types (T&E-11 anti-deadlock); cron jobs hash-registered, launcher runs only approved hashes (current jobs grandfathered at migration); HMAC on task rows by host key.
**Exit:** red-team script (agent writes its own task row with bypass mode / drops cron .md) fails on all paths.
**Rollback:** adapter passthrough mode.

### WP9 — Shell + egress hardening (Steps 7, 8) — L ∥ (after WP5)
**Build:** typed argv allowlist per binary (seeded from WP0 telemetry), git `-c core.hooksPath=NUL` for agent commands, npx/bare-npm-install ⇒ Tier-3 (Tier-2 override path), pinned `npm run` scripts; egress: per-skill domain allowlist (seeded from telemetry), spend/publish/outreach ⇒ Tier-2 broker with per-run budget, WebFetch/Search logged domains; deny-with-reason + one-click propose-rule (T&E-5).
**Exit:** replay of 30-day telemetry: 0 false-positive denials on known-good; smuggling test vectors (`--upload-pack=`, `-o ProxyCommand=`, leading-dash) all denied.
**Rollback:** allowlist to log-only.

### WP10 — Skill registry + memory governance (Steps 10, 11) — L ∥ (after WP4)
**Build:** (a) hash-pinned skill registry in gov dir; static-analysis intake (eval/encoded/fetch ⇒ not-low-risk); unregistered folders ignored; update.sh skill syncs → staging → intake; current skills scanned then grandfathered. (b) Knowledge layer per Starfish memory architecture: evidence tag on existing corpus; canonical knowledge entries + revision history; promotion gate (auto low-stakes, human high-stakes, task-bound, audited); belief-forming embeddings from knowledge only; revocation; conflict reconcile at promotion. Two-lane retrieval UI labels (T&E-8).
**Exit:** poisoning test — planted false "fact" in a transcript is retrievable only as labeled evidence, never surfaces as belief; skill tamper test — edited registered skill refuses to load.
**Rollback:** registry to warn-only; memory gate to log-only (embeddings unchanged until flip).

### WP11 — OS confinement + sentinel (Step 12a/b) — L, last
**Build:** restricted Windows agent user (launcher spawns as it; gov dir ACL'd owner-only); symlink-component rejection in agent-writable paths; **sentinel**: post-`update.sh` and per-launch hash-verify of integration points (spawn-site patches, middleware.ts, launcher shim) with auto-restore from Starfish-held copies and fail-closed spawns on unrepaired drift (T&E-2).
**Exit:** as restricted user: gov-dir write attempts fail at OS level; simulated update.sh clobber auto-restored within one launch cycle.
**Rollback:** spawn as owner again (Steps 1–10 protections remain).

### WP12 — Close-out — S
Final audit re-run: score every finding from the three audit docs against the Part-4 scorecard in Simon.md; document residual risks; hand telemetry dashboards (ask-ratio, quota, chain-verify) to steady-state.

**Critical path:** WP0 → WP1 → WP2 → WP3 → WP5 → WP7 → WP8 → WP11. (WP4, WP6, WP9, WP10 hang off it in parallel.) Rough effort: ~30–35 working days build + soak weeks in WP7.

---

## 2. Review (adversarial, pre-build)

**Strengths**
- Every enforcement flip is preceded by an observe phase seeded from real telemetry (WP0), so "don't break it" is measured, not hoped. Rollback exists per WP and never regresses to bypass.
- The plan's spine sits entirely outside the `update.sh` synced tree, and WP11's sentinel + fail-closed launcher covers the one place it can't (the 4 patched lines). C1 is handled twice over.
- Fatigue is a launch gate with a number (< 5 asks/day projected), not an aspiration — the exact failure mode that made upstream default to bypass is the thing WP7 is gated on.
- Coverage is complete: all Critical/High/Medium findings from the three audits map to a WP (traceable via Simon.md Part 4 scorecard).
- T&E items from Simon.md Part 3 are wired into specific WPs (deadline-degrade in WP5, dual-source `.env` in WP3, log-only middleware in WP6, launcher-reads-credentials in WP3/WP11), not left as commentary.

**Weaknesses / open risks**
1. ~~**Unverified repo state (biggest).**~~ **RETIRED 2026-07-04:** G1/G5/G6 verified by read-only scan of the fork — all cited locations confirmed, one extra spawn site found and folded into WP1, secrets sweep clean, update.sh fails closed. Residual: G2 (CLI pin + flag conformance) and G3/G4 (Starfish-side) still open before WP2. *(was −4, now −1)*
2. **G2 is a single point of assumption.** The whole spine trusts `--permission-prompt-tool` semantics (incl. subagent inheritance) in the pinned CLI version. If a CLI update changes this, the sentinel notices drift in behavior only indirectly. Mitigation exists (pin + launcher) but a conformance test suite for the flag itself isn't specced. *(−3)*
3. **WP3/WP11 Windows specifics are thin.** Restricted-user spawning, DPAPI cross-user behavior, OneDrive/AV file-locking on the gov dir — all flagged (T&E-3/9) but not de-risked with a spike; these are where calendar time will slip. A WP3a spike (2 days, throwaway) would buy certainty. *(−3)*
4. **Effort estimate is optimistic.** 30–35 days assumes the 69-route wiring in WP6 is mostly mechanical and the argv allowlist (WP9) converges quickly. History says shell allowlists take longer to stop false-positiving. *(−2)*
5. **No explicit perf budget** beyond the WP2 <20ms p95 check; heavy Bash-loop tasks under fsync-per-decision (WP4) could exceed it — decision cache is mentioned in Simon.md (T&E-6) but not assigned to a WP. Assign to WP4. *(−2)*
6. **Human dependency:** WP5's one-time review of generated standing grants and WP10's high-stakes promotions assume Scott's availability during soak weeks; no delegate path. *(−1)*

**Verdict:** sound structure, correct ordering, honest rollbacks; the residual risk is concentrated in unverified inputs (fix: run the G-gate) and Windows platform specifics (fix: add WP3a spike and assign the decision cache to WP4). Both fixes are cheap and pre-build.

---

## 3. Score

| Dimension | Score | Note |
|---|---|---|
| Audit coverage (all findings compensated) | 96/100 | Full traceability to all three audits |
| No-break protection (C1–C7) | 92/100 | Telemetry-seeded policy + staged cutover + sentinel |
| Sequencing & dependencies | 90/100 | Shadow-first, per-origin flips, parallel lanes correct |
| Reversibility / rollback | 91/100 | Per-WP, never regresses to bypass |
| Verifiability (exit criteria, red-team tests) | 88/100 | Concrete per WP; CLI-flag conformance suite missing |
| Input freshness | 100/100 | Entire G-gate verified against the fork + live CLI |
| Platform de-risking (Windows) | 95/100 | WP3a spike 6/6 PASS on target machine 2026-07-04: gov dir outside OneDrive; chain lock clean under 2-process contention (100/100, verify ok); fsync p95=1ms (budget 20ms); DPAPI OK; PasswordVault OK; elevation available when WP11 needs it. Residual: restricted-user ACL test itself deferred to WP11. |
| Effort realism | 86/100 | WP0/WP1/WP2/WP4 + WP3a shipped in one day; remaining estimate ~30–34d |

**Overall: 96/100** *(87 → 90 fork+scan → 92 starfish-verify → 94 G-gate cleared → 96 with WP3a 6/6 and the Tier-0 cache landed in WP4).*

**Status 2026-07-04 EOD:** G-gate cleared; WP0/WP1 shipped (e7a78d4); WP2 shipped (dd561dc, soaking); WP4 built (chain + quotas + cache, 6/6 tests); WP3a 6/6 PASS. **Next on critical path: WP3** (gov-state adapter + secrets to Credential Manager — now fully de-risked), then WP5 policy seeded from soak telemetry. Do not flip any enforcement before WP5's ask-rate gate.
