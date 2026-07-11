# Project Starfish — Product Requirements Document (PRD)

> **Version:** 1.0 · **Date:** 2026-06-04 · **Author:** Scott (Galactic Command) · **Status:** Draft for review
> **Doc set:** Governance Framework (constitution) · Master Build Plan (strategy) · Detailed Implementation Plan (execution/tests) · Risk & Compliance Registry · Threat Model · UI & Theme Spec. This PRD defines **what** we're building and **why**; those define **how**.

---

## 1. Overview

### 1.1 Problem
Custom Claude builds and skill packs are proliferating — people bundle skills, tools, and MCP servers into bespoke agents — but they ship with **no governance**: no authorization, no audit, no risk control, no boundary enforcement. An agent can call any tool, read anything, run shell commands, and act on the user's machine with no oversight. As these builds move from hobby to business-critical, that's an unacceptable security, compliance, and trust gap.

### 1.2 Vision
**Governance you can drop onto any Claude build.** Project Starfish delivers a portable governance layer that, with one command and the user's consent, brings an existing skills build under a strict, auditable, default-deny governance model — and a reference desktop app that makes governed multi-agent work legible and even delightful (a starship bridge where governed agents run "missions").

> **One-liner:** *Everyone ships skills. Nobody ships governance. Starfish is the governance.*

### 1.3 Products
1. **Starfish Governor (the product)** — a portable, headless governance overlay distributed as a Claude Code plugin / CLI. Wraps any skills build.
2. **Project Starfish (the reference app)** — a desktop application (the GCS Starfish bridge) that embeds the same governance core and visualizes governed agents at work.

Both are built from one `governance-core`. This PRD covers both, with the Governor as the primary commercial product.

## 2. Goals & non-goals

### 2.1 Goals
- G1. Make any existing Claude skills build governed with **one command + consent**.
- G2. Enforce the constitutional model: default-deny, all-work-is-a-task, deterministic, fully auditable, bounded autonomy, fail-closed, human-final-authority.
- G3. No control depends on agent cooperation (holds against an adversarial/injected agent).
- G4. Local-first and private — nothing leaves the machine without explicit consent.
- G5. Be **legally shippable** — IP-clean, properly licensed assets, honest claims.
- G6. Make governance *legible and pleasant*, not a compliance tax (the bridge UI, PADD/COMMS clarity).

### 2.2 Non-goals (v1)
- N1. Not a cloud/SaaS service; no remote multi-tenant control plane.
- N2. Not a replacement for Claude/Claude Code; it governs them.
- N3. Not a general MDM/endpoint-security product.
- N4. Not an OS-level sandbox in v1 (planned hardening; hooks-based enforcement first).
- N5. Not shipping the full-Trek personal skin commercially (IP-safe Fleet pack only).

## 3. Personas

- **Galactic Command / the operator (Scott).** Power user / small-business owner running custom Claude builds. Wants automation *and* control; not necessarily a security engineer. Needs sensible defaults, clear consent, and an audit trail.
- **The builder.** Ships custom Claude builds / skill packs to others; wants to add governance as a differentiator and reduce their own liability.
- **The skeptical stakeholder.** A client/manager who must trust that an AI agent won't exfiltrate data or run something destructive; needs evidence (audit, policy, reports).
- **The agents (governed subjects).** Not users — the governed. Includes a possibly-adversarial or prompt-injected agent; the system must hold regardless.

## 4. Use cases / user stories

- U1. *As the operator,* I run `starfish govern ./my-skill-pack` and, after reviewing a scored inventory, my skills run under governance — so I get automation without blind trust.
- U2. *As the operator,* I add a new skill and Intake Control (Oh Brian) vets it, scores its risk, and either auto-adds it (Low) or quarantines it with recommended fixes — so nothing dangerous slips in.
- U3. *As the operator,* I watch a "mission" run on the bridge and can pause, redirect, or abort at any time — so I'm always in control.
- U4. *As the operator,* when an agent attempts something risky (spend, destructive, external), it escalates to me for approval — so high-stakes actions never happen silently.
- U5. *As the stakeholder,* I review an audit trail / mission report showing exactly what each agent did and why it was allowed — so I can trust the system.
- U6. *As the builder,* I bundle the Governor plugin with my build so my users get governance out of the box.
- U7. *As the operator,* I brain-dump ideas on a board and the planner (D8A) turns them into a governed, reviewable task plan — so ideas become safe execution.
- U8. *As the operator,* an agent that fails or violates policy is clearly surfaced (a redshirt casualty + audit link) — so I can see and diagnose failures at a glance.

## 5. Functional requirements

Priority = MoSCoW (M=Must, S=Should, C=Could, W=Won't-yet). Each traces to implementation-plan tests (TC) and the phase that delivers it.

### 5.1 Governance core (the engine)
| ID | Requirement | Pri | Phase | Verify |
|---|---|---|---|---|
| FR-1 | **Default-deny Permission Gate** — every tool/action denied unless explicitly authorized | M | 1 | TC-1.1/1.2 |
| FR-2 | **Reference-monitor mediation** — no agent acts on the system directly; only tools, via the gate, on both ingress & egress | M | 1–2 | TC-2.5.2 |
| FR-3 | **Task-bound purpose** — no tool runs without an active task it serves ("no task, no tool") | M | 3 | TC-3.2 |
| FR-4 | **4-tier risk classification** (Low/Med/High/Critical) driving allow/ask/deny | M | 2 | TC-2.2 |
| FR-5 | **Policy engine** — ordered rules, default-deny, `allow/deny/ask`, `ask`→human | M | 2 | TC-2.1 |
| FR-6 | **Complete audit** — every action + decision logged (8 domains), tamper-evident, no silent execution | M | 1 | TC-1.7, G-4 |
| FR-7 | **Filesystem boundaries** — nothing visible above project root; nothing written outside the workspace | M | 1 | TC-1.3/1.4/1.5 |
| FR-8 | **No raw shell** — Bash only via vetted command-templates or escorted Critical exception | M | 2 | TC-2.3/2.5 |
| FR-9 | **Fail-closed boot** — governance loads first; no launch path skips it | M | 1 | TC-1.6, TC-9.6 |
| FR-10 | **Deterministic decisions** — same inputs+policy ⇒ same decision | M | 2 | TC-2.1 |
| FR-11 | **Token/resource governor** — budgets + rate limits; soft-warn then pause+escalate | S | 3 | TC-3.5 |
| FR-12 | **Headless PDP daemon** — governance runs without the desktop app (for CLI builds) | M | 1 | TC-7.6 |

### 5.2 Capability lifecycle (intake & registry)
| ID | Requirement | Pri | Phase | Verify |
|---|---|---|---|---|
| FR-13 | **Capability registry** — single source of truth for tools/skills/agents; unregistered = unusable | M | 1 | TC-1.1 |
| FR-14 | **Intake & vetting (Oh Brian)** — new capability vetted (static, provenance, deps, hash), risk-scored | M | 5 | TC-5.1/5.3 |
| FR-15 | **Hash-on-vet** — "vetted" means exact bytes; drift → deny + re-vet | M | 5 | TC-5.2 |
| FR-16 | **Disposition by score** — Low auto-add; Medium+ quarantine pending consent | M | 5 | TC-5.3 |
| FR-17 | **Intake routing (PADD vs COMMS)** — classify inbound as deterministic skill / reasoning mission / new-capability | S | 3 | TC-3.7/3.8 |

### 5.3 Orchestration & agents
| ID | Requirement | Pri | Phase | Verify |
|---|---|---|---|---|
| FR-18 | **Task lifecycle** — 10-state machine; illegal transitions rejected | M | 3 | TC-3.1 |
| FR-19 | **All work is a task** — dispatches, missions, issues, Slack → tasks first | M | 3 | TC-3.6 |
| FR-20 | **Proposer ≠ approver** — an agent cannot self-authorize work | M | 3 | TC-3.3 |
| FR-21 | **Orchestrator (Captain Mykel)** — triage/route/adjudicate; privileged in role, gated in mechanism | M | 1–4 | TC-S-15 |
| FR-22 | **Governed messaging** — agents coordinate only via task-linked, policy-checked, audited messages | M | 4 | TC-4.1/4.2 |
| FR-23 | **Security monitor (Constable Gooey)** — periodic semantic sweep; report+escalate only | S | 6 | TC-6.1/6.2 |
| FR-24 | **Planner (D8A) + Idea Board** — brain-dump → governed task drafts (review before dispatch) | S | 8 | TC-8.1 |
| FR-25 | **Memory governance** — promotion to shared knowledge gated on validation + provenance | S | 4 | TC-4.4 |

### 5.4 The overlay product (Starfish Governor)
| ID | Requirement | Pri | Phase | Verify |
|---|---|---|---|---|
| FR-26 | **`starfish govern <pack>`** — inventory → vet → score → consent → install gate + agents | M | 7 | TC-7.1/7.2 |
| FR-27 | **Consent-gated** — nothing enabled without explicit operator approval | M | 7 | TC-7.2 |
| FR-28 | **Boundary auto-set** — governed pack contained to its folder | M | 7 | TC-7.3 |
| FR-29 | **Idempotent re-govern** — re-run hash-checks; only drift re-prompts | S | 7 | TC-7.4 |
| FR-30 | **Local-only** — no upload of pack contents or audit data | M | 7 | TC-7.5 |
| FR-31 | **Claude Code plugin packaging** — install wires hooks/registries/daemon | M | 7 | TC-7.6 |

### 5.5 Human oversight & UX
| ID | Requirement | Pri | Phase | Verify |
|---|---|---|---|---|
| FR-32 | **HITL escalation** — `ask`/Critical/High-findings surface to the operator for approve/deny | M | 2 | TC-2.2 |
| FR-33 | **Always interruptible** — pause/resume/abort any agent or mission | M | 3 | TC-3.5 |
| FR-34 | **Audit/activity view** — readable feed of decisions & actions (Activity / mission reports) | M | 1,2.5 | TC-2.5.1 |
| FR-35 | **Bridge UI** — the GCS Starfish: stations, PADD/COMMS routes, Mission Console, status counters | S | 9 | manual |
| FR-36 | **No command line required** — packaged launcher / installer | S | 9 | TC-9.6 |
| FR-37 | **Redshirt failure visualization** — terminal failures surfaced + linked to audit | C | 9 | TC-6.4 |
| FR-38 | **Theme-pack system** — IP-safe Fleet pack distributed; personal skins swappable | S | 9 | TC-9.1 |

## 6. Non-functional requirements
| ID | Requirement | Target |
|---|---|---|
| NFR-1 Performance | Gate decision latency | p95 < 50 ms (in-process) |
| NFR-2 Reliability | Fail-closed on any governance error | 100% (tested) |
| NFR-3 Security | No control bypassable by an adversarial agent | Threat-model gates closed |
| NFR-4 Privacy | No data egress without consent | 0 unexpected outbound (tested) |
| NFR-5 Determinism | Identical decision for identical (input, policy, ctx) | 1000× identical |
| NFR-6 Portability | Governs headless CLI builds (no Electron) | Yes |
| NFR-7 Compatibility | macOS first; Windows/Linux | macOS M; Win/Linux S |
| NFR-8 Auditability | No silent execution | 100% paired audit |
| NFR-9 Compliance | IP-clean, licensed assets, honest claims | All R&C release gates green |
| NFR-10 Usability | Onboard a pack without reading docs | Consent flow self-explanatory |

## 7. UX requirements (summary; full design in UI & Theme Spec)
- The bridge metaphor maps 1:1 to governance state (Mission Console = lifecycle, Activity Feed = audit, Galactic Command = HITL, Ship Status = telemetry).
- **PADD (green) vs COMMS (blue)** routes make "instant vs planned" self-evident.
- Consent screens show a **scored inventory** (per-item risk + recommended mitigations) before anything runs.
- Escalations are **decision-ready** (what/who/why/risk/diff/assessment) to avoid rubber-stamping.
- IP-safe Fleet cast: Grand Admiral Scotticus · Captain Mykel · First Officer · Oh Brian · Constable Gooey · D8A · Deck Crew, aboard the GCS Starfish.

## 8. Success metrics
- **Adoption:** time-to-first-governed-pack < 5 min; % of a build's skills successfully classified.
- **Safety:** 0 ungoverned tool executions in audit; 100% of Critical actions human-approved; escape-conformance suite green.
- **Trust:** operator can answer "what did the agent do and why was it allowed?" from the audit in < 1 min.
- **Health (anti-fatigue):** allow/deny/ask ratio tracked; escalation volume trending down as policies tune.
- **Quality:** all phase DoDs met; determinism + conformance suites green in CI.

## 9. Release criteria
- **MVP (internal):** Phases 0–2 — a provably governed core (default-deny, boundaries, fail-closed, audit, policy/risk, safe shell) with conformance + determinism suites green.
- **Product beta:** through Phase 7 — `starfish govern` works end-to-end on a real pack (e.g. SEO-local), local-only, consent-gated.
- **Paid GA:** Phase 9 — IP-safe themed, sandboxed, packaged; **all R&C compliance gates green** (G-IP/G-ART/G-DEPS/G-GOV/G-PRIV/G-SEC) and **⚖ legal sign-off** (IP, name clearance, EULA, AI-art license).

## 10. Dependencies & assumptions
- Depends on Claude Code's hook mechanism as the enforcement seam (until OS-sandbox hardening).
- Assumes Node/Electron toolchain on the operator's machine (or packaged installer).
- Assumes AI-art tool with commercial-use terms; provenance recorded.
- Salvages non-critical machinery from the Munder Difflin fork (strangler) under a salvage ledger.

## 11. Risks
Tracked in the **Risk & Compliance Registry**. Top items: IP/legal (⚖), AI-art licensing (⚖), hooks-not-OS residual (Phase 9 sandbox), prompt-injection & escalation-fatigue (managed, not eliminated). Security risks detailed in the Threat Model.

## 12. Open questions
- Product **name** (vs. "Project Starfish") + trademark clearance.
- v1 theme scope: light reskin vs. full bridge-stations.
- Pricing/licensing model for the Governor (out of scope for this PRD).
- Which AI-art tool (commercial terms + indemnification) to standardize on.

## 13. Out of scope (v1)
Cloud control plane · multi-tenant · mobile app · non-Claude agent runtimes · OS-level sandbox (deferred to post-v1 hardening) · marketplace/distribution of third-party themes.
