# Master completion plan — everything left, in the best order

> **Date:** 2026-07-10 · One place that sequences every open action to a 1.0 launch ("as functional as OpenClaw, minus the security issues"). Owner tags: **[me]** = I can do it here · **[Scott]** = needs your creds / machine / legal.
> Rule: nothing new starts until the thing it depends on is green. Critical path is marked **★**.

---

## Autonomous session log — 2026-07-10 (Scott AFK)

**Shipped (no approval needed, in-repo):**
- `docs/comparisons/STARFISH_VS_OPENCLAW.md` — respectful, honest parity + security-delta (incidents → controls).
- `docs/comparisons/STARFISH_VS_HERMES.md` — respectful comparison; self-authored-skill governance angle.
- `SECURITY.md` — responsible-disclosure policy + plain-language security model + honest non-claims.
- **Ring-3 theme default flipped off Fleet:** added neutral `CALM` to `packages/desktop/src/theme.ts`, made it the `ThemeRegistry` default, exported it, updated `theme-registry.conformance.test.ts` to assert the new default + list. Now "Fleet off by default" is true system-wide (renderer + ring-3).
- **RM-3 unification bridge:** added `assessmentFromTier()` to `score.ts` (additive, exported) so any 4-tier producer can emit a unified `RiskAssessment` through the one scorer. *Did NOT modify the tested producers (vetting/deletion/secrets/sources) — that re-scoring needs your `npm run ci` to confirm green, so it's queued, not shipped blind.*

**Verification status:** all changes are on real disk; pure-writing items carry no test risk. Code changes (ring-3 flip, `assessmentFromTier`) are additive and inspected, but the sandbox can't run your Windows-native vitest, so **the batch needs one `npm run ci` on your machine** to confirm green. The ring-3 test now expects `calm` as default (updated to match).

**Governance-consistent call I made while you were out:** I declined to re-score the tested producers (RM-3 proper) or touch anything I couldn't verify green, per "don't break what works / evidence-based." Those are staged below, not shipped.

---

## Phase 0 — Green the foundation ★ (gate for everything)
The risk wiring, scope contract, and hardening are implemented + logic-verified, but not confirmed in your real suite (I can't run the Windows-native vitest here).
- **[Scott]** Run `npm run ci` locally. Expected green: scope (RM), normalization hardening, RM-0 scorer, RM-1/RM-2 risk wiring (I reproduced the `pdp.risk` contract 11/11 unchanged).
- **[me]** Fix anything red immediately.
- **Exit:** full suite green on your machine. *Nothing below ships until this passes.*

## Phase 1 — Finish the risk system ★
- **[me] RM-3** Unify the remaining producers (`vetting`, `deletion`, `secrets`, `sources`) onto the single `assessRisk()` — the "one risk model" decision. Each keeps its current tier by derivation; suite stays green.
- **[me] RM-4** Risk Tolerance setting: governed persistence, fail-safe-to-Low on corrupt, audited change, double-confirm write path.
- **[me] RM-5** Surface it: composite score + descriptor (Clear→Forbidden) + floor flags in the Bridge approval card; the Risk Tolerance screen; the persistent "Risk: Medium" header chip.
- **[me] RM-6** Calibration pass (expand category signals as real evidence allows; keep golden-vector tests pinned).
- **Exit:** risk system fully wired, `npm run ci` green, tolerance visible + operable.

## Phase 2 — Finish the product surface ★ (unblocks screenshots + the office-worker)
Driven by `PERSONAS_AND_GAPS.md`. The API-key wall is the single biggest blocker to any non-technical value.
- **[Scott decision + me] The API-key wall.** Choose: managed/platform key, one-tap BYO-key flow, or both. Build the chosen flow so Marcus reaches value without knowing what an API key is. **← highest-leverage item.**
- **[me]** Chat-first entry: elevate COMM to a plain "What do you need?" surface (OpenClaw parity + non-technical entry).
- **[me]** Friendly approvals: plain-language approval copy; routine safe work stays quiet under sensible Risk-Tolerance defaults.
- **[me]** Onboarding first-run → one successful governed task in <5 min; a seeded "try me" sample.
- **[me]** Output delivery: skills write to an obvious folder + a "reveal file" action.
- **[me]** Neutral vocabulary: rename PADD/COMM to plain labels; flip the ring-3 `theme.ts` default off Fleet (+ update its test) so "Fleet off by default" is true system-wide.
- **Exit:** a non-technical user installs → connects → completes a real task, calmly, in one sitting. UI is screenshot-ready in light + dark.

## Phase 3 — Package the 10 skills ★
Scaffolds exist (`skills/`); make them real and registered.
- **[me]** Import the document engines (docx/pdf/pptx/xlsx) from `anthropics/skills`; deepen the 5 authored skills (research/organizer/compose/notes/recall/schedule) with their governed-tool bindings.
- **[me]** Bundle `skill-creator` built-in (your decision).
- **[me]** Run all 10 (+ skill-creator) through the **Arena**; sign; register via `starter-skills.json`; wire into the Skill Library.
- **[me]** Seed the "watch it get denied" attack demo in-app (Priya's wow moment).
- **Exit:** 10 governed skills usable from the chat entry, vetted + signed; the empty-product gap is closed.

## Phase 4 — Proof + parity (can overlap Phase 3)
- **[me]** Surface persistent memory ("remembers across sessions") + background/scheduled work in the UI.
- **[me]** The in-app zero-change "attack → denied → audited" demo, wired to the Bridge.
- **[me/Scott] Messaging connector (WhatsApp / Telegram)** — the deferred parity piece. Governed: inbound messages become gated tasks; every action still audited. Do this AFTER the above per your sequencing. Needs a connector decision + credentials.
- **Exit:** the OpenClaw-parity story (files, web, memory, background, messaging) is demonstrable — all governed.

## Phase 5 — Go-to-market assets (needs Phase 2 UI for screenshots)
- **[me]** Capture screenshots (Bridge, approval card, onboarding, Risk Tolerance) in light + dark — for README, site, and git release notes.
- **[me] Comparison pages** (respectful framing — OpenClaw made agentic AI accessible to millions; Starfish lets that scale safely): **Starfish vs OpenClaw** and **Starfish vs Hermes**. *(Can start now — research done, no code dependency.)*
- **[me]** README hero + 3-line pitch; website refresh (`site/`); a security page ("how we'd have stopped ClawBleed / malicious skills / shadow installs"); `SECURITY.md` + disclosure policy.
- **[me]** 60–90s demo video/GIF from the zero-change demo.
- **Exit:** a credible public presence with screenshots + a clear, honest comparison.

## Phase 6 — Release mechanics (mostly [Scott])
- **[Scott]** Push the unpushed commits (v0.13→v0.22 + this session's work); tag **v1.0**.
- **[Scott]** `npm publish` with provenance/OIDC + SBOM (set `NPM_TOKEN`); signed desktop installer.
- **[Scott]** Legal sign-off: finalize `TRADEMARK.md` / `COMMERCIAL.md`, product-name clearance, IP-safe theme confirmation.
- **[Scott]** Independent external security review (the v0.22 exit item).
- **[Scott]** Rotate the live `.env ATLASCLOUD_API_KEY`.
- **Exit:** Starfish 1.0 is published, signed, and legally clear.

---

## The critical path (shortest line to a launchable 1.0)
**Phase 0 green → RM-3/4/5 → API-key flow + chat entry + onboarding → package the 10 skills → screenshots + comparison pages + security page → [Scott] push/publish/legal.**

Everything else (RM-6 calibration, messaging connector, demo video, website polish) hangs off that line and can run in parallel or as fast-follow.

## What I can start on immediately (no dependency / no creds)
1. **Comparison pages** (Phase 5) — research done, pure writing.
2. **RM-3** producer unification (Phase 1) — additive, backward-compatible.
3. **Neutral vocabulary + ring-3 default flip** (Phase 2) — small, self-contained.

## Standing "Needs Scott" (blocks Phase 6, and the key-flow decision blocks Phase 2)
API-key strategy · `npm run ci` run · push/tag/publish · legal · external review · rotate the live key · confirm the 10-skill set · name OpenClaw directly in comparisons (or imply).
