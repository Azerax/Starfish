# Project Starfish — Risk & Compliance Registry

> **Version:** 1.0 · **Date:** 2026-06-04 · **Owner:** Scott (Admiral) · **Status:** Active
> Companion to the Master Build Plan, Implementation Plan, Threat Model, and Governance Framework.
> Every entry carries a **solution** and a **verification** (how we prove it's handled). Security entries
> summarize the Threat Model (full detail there); this registry adds legal, IP, AI-art, privacy,
> conformance, dependency, and operational coverage.
> *Not legal advice. Items marked ⚖ should be confirmed with a qualified attorney before commercial release.*

## 1. Scoring model

Likelihood (L) and Impact (I) each rated 1–5. **Inherent score = L × I** (before mitigation). **Residual** = score after the solution is in place. Tiers: 1–6 Low · 8–12 Medium · 15–20 High · 25 Critical.

A risk is **closed** when its solution is implemented *and* its verification passes. Until then it is **open** (mitigation planned) or **in-progress**.

## 2. Compliance gates (must ALL be green before any paid/distributed release)

| Gate | Requirement | Blocks release until |
|---|---|---|
| **G-IP** | No third-party trademarked IP in the distributed build (no Trek trade dress, no Office/NBC, no LimeZu assets) | L-1…L-5 closed |
| **G-ART** | Every shipped art asset has a clear commercial license + provenance record | A-1…A-3 closed |
| **G-DEPS** | Every shipped dependency is a permissive/compatible license; SBOM produced | D-1 closed |
| **G-GOV** | The build passes all governance-conformance tests (framework §1–§16) | G-1…G-7 closed |
| **G-PRIV** | No data leaves the user's machine without explicit consent; audit redaction works | P-1…P-3 closed |
| **G-SEC** | Threat-model Phase-gate threats closed; boundary + determinism + fail-closed suites green | S-block closed |

---

## 3. Security risks (S) — summarized from the Threat Model

| ID | Risk | L×I | Solution | Residual | Verify |
|---|---|---|---|---|---|
| **S-1** | Gate fails open on error/timeout (T-03) | 5×5=25 | Fail-closed: any error/timeout/missing config → deny + Critical audit | 5 | Unit tests feed garbage/timeout → assert deny |
| **S-2** | Command templates = arbitrary code exec via git/npm hooks (T-05/06) | 4×5=20 | `git --no-verify` + scrubbed config; `npm --ignore-scripts`; typed argv allowlist; execFile no-shell | 4 | Test: malicious `pre-commit`/`package.json` script never runs |
| **S-3** | Renderer IPC bypasses gate (T-19) | 4×5=20 | Bracketed PDP — renderer IPC is a PEP; CI asserts no side effect without a PDP decision | 3 | CI mediation assertion; renderer-origin audit lines present |
| **S-4** | Vet-once, mutate-later (T-11) | 4×4=16 | Hash-on-vet; gate verifies content hash before run; drift → deny+re-vet | 3 | Test: mutate a vetted skill → denied |
| **S-5** | Task self-authorization (T-07) | 3×5=15 | Proposer ≠ approver; scope derived from registry not agent text | 3 | Test: agent self-creates+assigns task → cannot execute |
| **S-6** | Hook/shim/settings tampering (T-01/02) | 3×5=15 | Enforcement artifacts outside all boundary sets; hash-checked at spawn; socket binds agent_id | 3 | Conformance test: agent cannot write shim/settings/socket |
| **S-7** | Filesystem escape (read above root / write outside workspace) | 4×5=20 | `containPath()` boundary sets; canonicalize (realpath/`..`/symlink/8.3/UNC); deny in-boundary symlink components | 4 | Mandatory conformance suite (write-escape, read-escape, negative control) |
| **S-8** | Raw Bash inheritance | 4×5=20 | Raw Bash never allowed (no allowlist); shell only via vetted templates or escorted Critical exception | 4 | Test: raw Bash denied for all agents |
| **S-9** | Launch path skips governance (T-26) | 3×5=15 | Fail-closed boot; governance loads first; no flag disables PDP; same boot for every launcher | 3 | Test: boot with missing registry → app halts/safe-mode |
| **S-10** | Prompt injection via external content (T-09) | 5×3=15 | Untrusted-origin tagging; backlog triage; least-privilege allowlists; Hank semantic sweep | 6 | Test: Slack/web/issue content flagged, not auto-dispatched |
| **S-11** | Injecting the watcher/planner (T-22) | 3×3=9 | Hank/Pam report/draft only; findings reconciled vs deterministic counters; content wrapped as data | 4 | Test: injected "all clear" with denials present → discrepancy alarm |
| **S-12** | Audit gap on crash / tamper / overflow (T-10/14) | 3×4=12 | Audit-before-act; hash-chained lines; monthly rotation; disk-full fails closed | 3 | Test: kill mid-decision → no unlogged execution; edit a line → chain breaks |
| **S-13** | Resource exhaustion / runaway (T-15) | 3×3=9 | Token Governor budgets + rate limits; worktree quotas; Stop-loop caps | 4 | Test: message/task flood → held+escalated |
| **S-14** | Hooks ≠ OS sandbox (root residual T-25) | 3×5=15 | Process-isolated PDP (free from overlay); restricted-user/container agents (Phase 9) | 6 | Phase 9: agent runs under restricted user; TOCTOU mitigations |
| **S-15** | Confused-deputy via Michael (T-08) | 2×4=8 | Michael gated in mechanism; `from` stamped by router; content-as-data; no transitive authority | 3 | Test: message asking Michael to write registry → refused |

**S-block closed when:** S-1, S-2, S-3, S-7, S-8, S-9 verified by automated suites; remainder mitigated with tests.

---

## 4. IP & legal compliance (L) ⚖

| ID | Issue | L×I | Solution | Residual | Verify |
|---|---|---|---|---|---|
| **L-1** | Star Trek trademark/trade dress in a *sold* product: LCARS look, "Starfleet"/"Federation"/"U.S.S."/NCC, combadge/delta, Vulcan/Spock-Data-Odo-O'Brien likenesses | 5×5=25 | **IP-safe "Fleet" theme for distribution:** LCARS-*inspired* (not replica) panel language; rename to generic "Fleet Command", "the ship", original hull designation; original officer designs not modeled on actors/species; keep only non-protectable elements (first names, generic sci-fi). Full-Trek skin stays **personal-only**, never distributed (theme-pack architecture, L-1a). | 5 (⚖ confirm) | Distribution build contains no listed marks; legal review sign-off; asset diff vs personal skin |
| **L-1a** | Personal full-Trek skin accidentally bundled in release | 3×5=15 | Theme-pack architecture; only the "Fleet" pack is bundled; CI denylist scans build for Trek tokens (LCARS, Starfleet, U.S.S., NCC, Vulcan, Spock…) | 3 | CI token-scan on release artifact = 0 hits |
| **L-1b** | IP-safe **Fleet cast names** too close to trademarked character names | 3×4=12 | **Resolved 2026-06-04.** Final cast all low-risk: Captain Mykel, **First Officer** (generic rank — replaces the flagged "Spokk"), Oh Brian, **Constable Gooey** (original comedic name riffing on the shapeshifter trait — replaces the flagged "Constable Ono"), D8A, Deck Crew, Grand Admiral Scotticus, GCS Starfish, Galactic Command. "Spokk" may remain a **personal-skin** nickname only. ⚖ light confirm. | 4 (⚖) | Release token-scan (incl. "Spokk") = 0 hits; cast contains only generic ranks + original names |
| **L-2** | The fork's LimeZu sprites are **non-commercial** — cannot ship in a paid product | 5×5=25 | Purge all LimeZu/fork art; replace with original AI art (see A-section); CI asserts no LimeZu files in build | 2 | Build manifest contains zero fork-origin art (salvage ledger + CI) |
| **L-3** | "Munder Difflin" / The Office (NBC) branding remnants | 4×4=16 | Complete rebrand to Project Starfish/Fleet (in progress); strip Office cast art/names from distribution; only first-name agent labels remain (non-protectable) | 3 | CI scan: no "Munder/Difflin/Dunder/Mifflin/Office" in build |
| **L-4** | Upstream code license compliance (Munder Difflin = MIT, with non-commercial *asset* carve-out) | 2×4=8 | MIT permits commercial code reuse with attribution; include upstream MIT notice + attribution; strip carved-out assets (L-2); salvage ledger records provenance | 2 | LICENSE/NOTICE present; ledger complete |
| **L-5** | Product name trademark conflict ("Project Starfish" / chosen product name) | 3×4=12 | Trademark clearance search before launch; pick a clear mark; ⚖ counsel | 6 (⚖) | Clearance search documented; no live conflicting mark |
| **L-6** | Overlay processes *other people's* skills/code/data (third-party builds) — liability, ToS | 3×4=12 | Local-only processing; explicit consent before governing a pack; no upload of pack contents; clear ToS/EULA disclaiming warranty on vetting; vetting is "assistive, not a guarantee" | 6 (⚖) | EULA present; no network egress of pack contents (P-1 test) |
| **L-7** | Misrepresenting security ("guaranteed safe") → consumer-protection/liability | 2×4=8 | Honest marketing: "reduces risk / enforces governance," never "100% safe"; document residuals (this registry) | 4 | Marketing copy review vs claims policy |

---

## 5. AI-generated art compliance (A) ⚖

| ID | Issue | L×I | Solution | Residual | Verify |
|---|---|---|---|---|---|
| **A-1** | The chosen AI image tool's terms may not grant commercial use or output ownership | 4×5=20 | Use a generator whose ToS **explicitly grants commercial rights to outputs** (e.g. paid tiers of major tools); keep a screenshot/record of the license terms at generation time; prefer tools offering IP indemnification | 4 (⚖ confirm) | License record per asset batch; tool ToS archived |
| **A-2** | AI output inadvertently reproduces protected work (a recognizable LCARS panel, an actor's face, a trademarked logo) | 4×5=20 | Prompt hygiene — never prompt with Trek/actor/brand names; human review every asset for resemblance; modify/redraw; run a reverse-image sanity check on hero assets | 4 (⚖) | Per-asset review log; no flagged resemblance |
| **A-3** | Provenance / auditability of art assets (which tool, which prompt, when, license) | 3×3=9 | **Art provenance ledger**: every shipped asset records tool, prompt, date, license terms, reviewer | 2 | Ledger complete; 1:1 with shipped assets |
| **A-4** | Copyrightability of purely AI art is uncertain (may not be protectable by you) | 2×3=6 | Accept (assets need not be *yours* to *use*, only safe to use); add human modification to strengthen any claim if desired | 4 | N/A (accepted; documented) |

---

## 6. Privacy & data (P)

| ID | Issue | L×I | Solution | Residual | Verify |
|---|---|---|---|---|---|
| **P-1** | Sensitive content (files, transcripts, repo, Slack, governed pack) leaving the machine | 4×5=20 | Local-first by design; no cloud egress without explicit opt-in; overlay processes packs locally; network is default-deny for agents | 3 | Network-egress test: no outbound with pack/audit content |
| **P-2** | Audit log accumulates secrets/PII (paths, tokens, message bodies) | 3×4=12 | Audit redaction pass (mask secrets/tokens/PII patterns); audit outside boundary sets; access-controlled | 4 | Test: seeded secret in a tool input is masked in audit |
| **P-3** | Secret management (Slack signing secret, AI-tool API keys, future creds) | 3×4=12 | Secrets in OS keychain/secure store, never in repo or boundary sets; `.gitignore` + secret-scan CI | 3 | CI secret-scan = 0; secrets not in any committed file |

---

## 7. Governance-framework conformance (G)

| ID | Framework requirement | Solution (how we comply) | Verify |
|---|---|---|---|
| **G-1** | Governance first / default-deny (§3.1) | PDP default-deny; unregistered → deny | Test: unknown tool denied |
| **G-2** | All work is a task (§3.2) | Every dispatch/mission/issue/Slack msg → task first; no tool without a task | Test: tool call with no task → denied |
| **G-3** | Deterministic (§3.3) | Decisions are pure functions of (input, policy, context) | Determinism test: same inputs ⇒ same decision, 1000× |
| **G-4** | Auditability (§4) | All 8 domains logged; no silent execution | Test: every tool call has paired audit lines |
| **G-5** | Bounded autonomy (§3.5) | System cannot create policy/elevate/self-replicate; Toby recommends, core registers | Test: agent cannot write governance files |
| **G-6** | Human final authority / interruptible (§10) | HITL escalation; pause/resume; kill | Test: pause halts agent at next hook event |
| **G-7** | Constitutional supremacy (§16) | GOVERNANCE.md is authoritative; conflicts resolve to it | Doc check; conformance suite tagged to sections |

---

## 8. Dependencies & operational (D / O)

| ID | Issue | L×I | Solution | Residual | Verify |
|---|---|---|---|---|---|
| **D-1** | A bundled dependency carries a copyleft/incompatible license | 2×4=8 | SBOM + license scan in CI; allowlist permissive (MIT/Apache/BSD/ISC); review any others | 2 | CI license scan green; SBOM produced |
| **D-2** | Dependency supply-chain compromise (malicious npm package) | 3×4=12 | Lockfile pinned + hash; `npm ci` only; dependency review on bumps; no `postinstall` from untrusted | 6 | Lockfile integrity check; CI audit |
| **O-1** | Escalation fatigue → rubber-stamping (T-21) | 4×3=12 | Tune policies so routine auto-allows; decision-ready prompts; batch low-urgency; allow/deny/ask ratio as health metric | 6 | Metric tracked; periodic policy review task |
| **O-2** | Upstream drift from the fork | 3×2=6 | No live merge; fork = parts/reference; salvage ledger enables deliberate re-pulls | 4 | Ledger present |
| **O-3** | Audit log unbounded growth | 3×2=6 | Monthly rotation; disk-full fails closed | 3 | Rotation test; disk-full → deny |
| **O-4** | Key person / single maintainer | 3×3=9 | Documentation set (this doc suite); plan reproducible by an agent team | 6 | Docs complete |

---

## 9. Top residual risks (accept & monitor)

After mitigation, the highest residuals are **L-1/L-5/L-6 (IP/legal, ⚖ need counsel)**, **A-1/A-2 (AI-art licensing, ⚖)**, **S-14 (hooks-not-OS until Phase 9)**, and **S-10/O-1 (injection & human fatigue — managed, never eliminated)**. These are tracked, not closed-by-code; the ⚖ items gate commercial release pending legal sign-off.

## 10. Change log
- v1.0 (2026-06-04) — initial registry; security from Threat Model v1.0; IP/AI-art per Scott's decisions (IP-compliant + AI art).
