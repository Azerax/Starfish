# Project Starfish — Master Build Plan

> **Version:** 1.0 · **Date:** 2026-06-04 · **Status:** For Scott's review (plan only — no code until sign-off)
> **Supersedes:** "Project Starfish IMPLEMENTATION PLAN.md" (the accreted decision log) as the authoritative roadmap.
> **Companions:** "Project Starfish GOVERNANCE FRAMEWORK.txt" (constitutional), "Project Starfish IMPLEMENTATION PLAN (DETAILED).md" (outputs/tests/acceptance per phase), "Project Starfish RISK & COMPLIANCE REGISTRY.md" (risks + solutions + release gates), "Project Starfish THREAT MODEL.md", "Project Starfish UI THEME SPEC.md", "Registry Hierarchy Information.txt".
> Project Starfish is a fork of [Munder Difflin](https://github.com/chaitanyagiri/munder-difflin) — but per the build strategy below, it is being rebuilt as a new governed app that *salvages from* the fork, not a patched fork.

---

## 1. What we are building

**Two things, one core.**

1. **The product — a portable governance overlay.** A standalone, headless governance layer that drops on top of *any* existing Claude skills build, and with consent brings it under a strict governance model: default-deny, vetted capabilities, bounded autonomy, complete audit. One command — `starfish govern <skill-pack>` — turns an ungoverned bundle of skills into a governed one. The thesis: *everyone ships skills; nobody ships governance.*

2. **The reference host — Project Starfish.** A desktop app (Electron) that is the governance core's first and best consumer: a visual command bridge where governed agents work, coordinated by an orchestrator and supervised by you. Star-Trek-Starfleet themed (see §10).

Both are built from **one governance core** (`governance-core`). The app embeds it; the overlay ships it headless. They are never separate codebases.

## 2. Governing principles (from the Framework)

Non-negotiable, inherited from the constitutional Governance Framework:

- **Governance first** — no action without authorization; default decision is **DENY**.
- **All work is a task** — one executable unit; nothing bypasses the task system.
- **Deterministic** — same inputs + policies ⇒ same decision.
- **Auditable** — no silent execution; eight audit domains always recorded.
- **Bounded autonomy** — the system automates work but never expands its own authority.
- **Fail closed** — any governance component failing blocks execution.
- **Human is final authority** — always interruptible; the operator is the root of trust.

## 3. Architecture

### 3.1 The reference monitor — bracketed PDP/PEP

Governance is an **isolated decision authority that brackets every transport on both faces.** Nothing reaches an agent, tool, or the OS — and nothing comes back — without passing governance on the way *in* (authorization) and the way *out* (result containment).

```
  USER ─►│ GOV │─►┌───────────┐─►│ GOV │─► agents
  Slack  │ in  │  │ TRANSPORT  │  │ out │   tools
  render │     │  │ router /   │  │     │   fs / git / OS
         └─────┘  │ hook srv / │  └─────┘
            ▲      │ IPC bridge│      ▲
   ingress: is     └───────────┘   egress: is what
   this caller                      returns safe to
   authorized?                      deliver to this
                                    recipient?
```

- **One Policy Decision Point (PDP), many Policy Enforcement Points (PEP).** All decisions live in `governance-core`; the router, hook server, and renderer IPC are PEPs that must consult the PDP. Transports are pure carriers with no policy logic.
- **Isolation by dependency direction, enforced in CI.** Governance imports nothing from the transports; they import it. v1 = same process, logically isolated; later = a separate PDP process (see §3.3).
- **Ingress vs. egress answer different questions.** Ingress = caller/purpose/policy/risk. Egress = clearance, exfil-shaped output, untrusted-content wrapping, tamper detection.

### 3.2 The strangler — three rings

We build the trusted core fresh and pull fork code in *behind* it. Not pure-scratch (re-solves hard problems, longest unsafe window); not in-place retrofit (can't prove complete mediation — every hole the threat model found was an inherited path).

| Ring | What | Treatment |
|---|---|---|
| **1 · Trusted core (TCB)** | Fail-closed boot · PDP · transports-as-PEPs · boundary engine · registries · audit | **Write fresh.** Fork code only ever *re-authored* into this ring line-by-line and reviewed as TCB. Keep it minimal. |
| **2 · Governed machinery** | PTY manager, telemetry reader, fs/git ops | **Salvage + adapt.** Invoked only through the core's governed interfaces. |
| **3 · Presentation** | Design system, the bridge scene, terminal view, editors, Command Center UI | **Salvage freely.** Renderer-only, mediated, hardened against renderer-XSS (T-19). |

**Salvage discipline:** every fork file is tagged ring-2/3, reviewed for direct side effects, re-pointed through the core, and recorded in a **salvage ledger**. Files that can't be cleanly demoted get re-authored into ring 1. Complete mediation becomes a property we *build*, not hope for.

### 3.3 Monorepo layout (separate folders)

```
packages/
  governance-core/     ring 1 — PDP, boundary, registries, audit, fail-closed boot,
                       local PDP daemon entry. NO Electron, NO React, NO fork imports.
  governance-hooks/    PreToolUse/PostToolUse/Stop shim + Claude Code hook settings —
                       the universal enforcement seam wiring any agent to the PDP.
  governance-overlay/  the product installer: inventory a build → vet → score → consent →
                       install gate + Starfish agents. Ships as a Claude Code plugin.
  desktop/             Project Starfish (Electron) — embeds governance-core, adds
                       salvaged fork rings 2 + 3, the bridge UI.
```

**Headless PDP = T-25 hardening for free.** To govern CLI-only builds, `governance-core` ships a **standalone local PDP daemon**; hooks POST decisions to it over a local socket. The desktop app connects to that *same daemon as a separate process* rather than embedding it — which is exactly the process-isolated PDP the threat model wants (T-25). One design, two payoffs.

## 4. The governance core (ring 1) in detail

### 4.1 The five controls (the PDP)

- **Policy Engine** — ordered rules, first match wins, default deny. Rule: subject · action · resource · effect (`allow|deny|ask`). `ask` → native Claude Code HITL.
- **Permission Gate** — the choke point. Checks: tool registered? agent in `allowedAgents`? active task covers this invocation (task-bound purpose)? then policy + risk.
- **Risk Engine** — pure function, **4-tier**: **Low** (read-only → allow), **Medium** (workspace writes → policy or ask), **High** (external changes → policy + ask), **Critical** (destructive/spend/policy edits/raw shell → always human, no auto-allow).
- **Token Governor** — budgets per agent; **soft+escalate**: warn at threshold, pause + escalate at hard limit. Extends to rate limits (messages/min, tasks/hr).
- **Audit Layer** — append-only `audit.jsonl`, hash-chained, monthly rotation; the eight domains; surfaced in the UI.

### 4.2 The four gate invariants (from the threat model)

1. **Fail closed (T-03)** — any error/timeout/missing config → deny + Critical audit.
2. **Audit-before-act (T-10)** — decision line written+fsynced before `allow` returns.
3. **One enforcement implementation (T-19)** — agents *and* renderer IPC use the same functions; CI asserts no transport reaches a side effect without a PDP decision.
4. **Single source of truth (T-13)** — registry file canonical; cache derived, hash-checked, atomically swapped.

### 4.3 Enforcement boundaries

- **No agent acts on the OS directly — only tools do**, and only when (1) the agent is allowed and (2) the use matches a vetted, task-bound purpose. *No task, no tool.*
- **Filesystem boundary sets (per agent):** *visibility* = {project root, own hive dir, shared protocol/board/tasks}; *write* = {own worktree, own hive dir}. `hive/governance/`, `audit.jsonl`, and other agents' dirs are invisible to all agents. Paths canonicalized (realpath, `..`, symlinks, Windows 8.3/UNC) before checking; in-boundary symlink components rejected (T-04). **Conformance tests** (write-escape, read-escape, negative control) gate Phase 1.
- **Bash containment:** raw Bash is **never** allowed (in no allowlist). Shell work only via (a) Toby-vetted **command-template tools** (`execFile`, fixed binary, typed argv allowlist, `git --no-verify` + scrubbed config, `npm --ignore-scripts`, worktree cwd) or (b) an **escorted exception** (Critical, per-invocation human approval, metacharacter/path rejection). Repeated exceptions → vet a new template (T-05/T-06).
- **Boot integrity (T-26):** governance loads first and fails closed; no launch path or flag can skip it; the human launching the app is the one legitimate ungoverned action.
- **No exempt actors:** Michael is privileged in *role*, never *mechanism*; Dwight (the fork's headless assistant) is brought fully under the gate or not shipped.

### 4.4 The registries (Registry Hierarchy)

Constitutional three first — **Capability** (what exists), **Policy** (what's allowed), **Service** (what's running) — plus **Tool** and **Agent**. The rest (Skill, Workflow, Memory, Model, Task-Type, Event, Risk, Artifact) arrive as derived views or schema constants per phase. All file-based, committed by the single-committer hive git.

## 4.5 Two intake routes — deterministic skills vs. reasoning missions

Work enters the system two ways, and the distinction is real (not just thematic — see UI Theme Spec §4.5 "PADD vs COMMS"):

- **Skill invocation (deterministic / "PADD" / green route).** A call to an *already-registered, vetted* capability. Passes the Permission Gate (allowed · task-bound · policy · risk) and is audited, but needs **no planning cycle** — it routes straight to execution. This is the framework's deterministic core (§3.3) and the fast, cacheable, low-risk path.
- **Reasoning mission (agentic / "COMMS" / blue route).** Open-ended work that isn't a single known skill. Routed to the orchestrator for triage → enrichment → decomposition (a task DAG, which may itself spawn skill invocations) → execution → validation. Where bounded autonomy operates; every step governed.

**Intake Control (Toby / "Oh Brian")** classifies every inbound request into one of three routes: known skill → green; unknown reasoning → blue; **brand-new capability** → the vetting pipeline (§7). This makes the deterministic/agentic split a first-class routing decision, and gives the Skill Library / registry a clean meaning: if a capability isn't registered ("on the shelf"), it can't be invoked — default-deny, dramatized.

## 5. The agents

Persistent governed agents, each with a narrow allowlist. Starfleet personas in §10.

| Agent | Role | Authority |
|---|---|---|
| **Michael** · *Captain Mykel* — orchestrator (GOD) | Routes, adjudicates, scribes the board, escalates | Privileged role, gated mechanism. Cannot write governance state. |
| **Dwight** · *First Officer* — prep assistant | Enriches queued prompts with context | Headless, **now gated + audited + task-bound**; off until compliant. |
| **Toby** · *Oh Brian* — intake control | Classifies inbound (skill/mission/new-capability); vets every new skill/tool/agent | Read-only + provenance lookups; never writes registries (recommends; core registers). |
| **Hank** · *Constable Gooey* — security monitor | Periodic semantic sweep of audit + activity | Read-only; **report + escalate only**, never acts on agents. |
| **Pam** · *D8A* — planner | Decomposes missions / idea-board clusters into governed task drafts | Read-mostly; produces backlog drafts only. |

*(Internal IDs stay Michael/Dwight/Toby/Hank/Pam; the Fleet names are IP-safe display personas — UI Theme Spec §1.1.)*

## 6. The overlay product (`starfish govern`)

The distributable. Ships as a **Claude Code plugin**; the same engine backs a CLI.

**Flow:** inventory a target build (skills, tools, MCP servers, hooks) → **security analysis + Toby vetting** (static · provenance · dependency · hash-on-vet, assisted by a security-review skill) → **risk score** (4-tier) → **route by score** (Low auto-add; Medium/High/Critical quarantine pending consent, with mitigations) → **consent + commit** (install hooks, registries, policies, audit, fail-closed boot; set boundary = the pack folder; inject the Starfish agents).

**Worked example:**
```
> starfish govern ./SEO-local
  Inventorying … 7 skills · 2 MCP servers · 1 hooks file
  Security analysis (Toby pipeline) …
    keyword-research  Low   ✓ auto-added      serp-scraper  Medium ⚠ quarantined (network)
    content-writer    Low   ✓ auto-added      gsc-connector High   ⚠ quarantined (API+creds)
  4 Low auto-added · 3 quarantined pending review
  Installing gate · boundary = ./SEO-local · adding agents: Michael · Toby · Hank · Pam
  Done.  Review 3 quarantined items? [y/N]
```
Re-running re-scans (hash-checked) and only re-prompts on drift. Nothing uncleared ever runs.

## 7. Agent-to-agent messaging (§7) — resolved

Framework §7 prohibits *unmediated* agent communication. **Resolution: keep the mailbox bus, make the router a bracketed transport PEP.** Ingress: message must carry a `task` id for an active task the sender owns (else held); `from` stamped by the router; policy + risk evaluated. Egress: re-checked before delivery (recipient cleared, content unmutated, untrusted-origin wrapped). All audited. Because every message is now task-linked, a later move to strict task-only coordination is a small step, not a rewrite.

## 8. Security posture (threat model summary)

The design holds because **no control depends on agent cooperation.** Full analysis in THREAT MODEL.md (26 threats). The load-bearing few:

- **Command templates are arbitrary code execution** (git/npm hooks+scripts) — neutralized in §4.3.
- **The renderer is a second privileged path** — closed structurally by the bracketed PDP (§3.1).
- **Vet-once-mutate-later** — defeated by hash-on-vet (§6).
- **Task self-authorization** — blocked by proposer ≠ approver (Phase 3).
- **Watcher/planner injection** — fails safe (Hank/Pam can only report/draft; findings reconciled against deterministic counters).
- **Root residual: hooks are not an OS sandbox (T-25)** — closed by the process-isolated PDP (free from the overlay design) plus restricted-user/container agents in Phase 9.

## 9. Build roadmap (phases)

Each phase ships independently, keeps typecheck green, and is "done" only when its threat-model gates pass. **MVP = Phases 0–2** (a provably governed core). Effort is rough.

| Phase | Goal | Key deliverables | Acceptance (done when…) | Effort |
|---|---|---|---|---|
| **0 · Foundations** | Monorepo + governance constitution | `packages/` scaffold, CI, dependency-direction lint, salvage ledger, `GOVERNANCE.md` (framework verbatim), doc map | CI green; governance imports-nothing rule enforced in CI | ~3–4 d |
| **1 · Governed shell (ring 1)** | A provably-governed skeleton | governance-core (boot, PDP choke point, registries, audit, boundary engine); governance-hooks (shim, local PDP daemon, socket, artifact integrity); spawn ONE agent through the gate; boundary conformance suite | Unregistered tool denied; boundary escapes denied+audited; missing registry → fail closed; one agent runs governed end-to-end; conformance tests green | ~8–11 d |
| **2 · Decisions** | Policy + risk + safe shell | Policy Engine, Risk Engine (4-tier), ingress+egress wiring, `ask`→HITL, Bash containment (templates + escorted exception), determinism tests | Same inputs⇒same decision; High escalates; templates can't run repo hooks/scripts; raw Bash denied | ~4–6 d |
| **2.5 · Presentation (ring 3)** | Desktop shell over the core | desktop/ Electron app embedding the core; salvage design system, terminal view, scene, Command Center; renderer IPC through PDP; content sanitization | App boots the governed core; renderer IPC audited + gated; no unsanitized untrusted content rendered | ~4–6 d |
| **3 · Task system** | All work is a task | 10-state lifecycle state machine, task types, proposer≠approver, all-work-is-a-task wiring (dispatch/missions/issues/Slack), kanban mapping, Token Governor, reasoning standard | Illegal transitions rejected; no tool without a task; no self-authorization; budget hard-limit pauses+escalates | ~5–8 d |
| **4 · Messaging + memory** | Govern the bus and the brain | Router as bracketed PEP (task-linked, ingress+egress, from-stamping); memory promotion gated on validated task + provenance + revocable; GOVERNANCE conformance mappings | Message without task held; messages checked both faces; promotion requires validation | ~4–6 d |
| **5 · Toby (intake)** | Controlled capability entry | Intake task type, vetting pipeline (static·provenance·deps·hash, security-review skill), report artifact, core registration path, Low-auto/Medium+-quarantine | New capability only enters via Toby; hash drift→deny+re-vet; routing-by-score works | ~3–5 d |
| **6 · Hank (monitor)** | Catch what rules miss | Sweep mission, cursor, semantic review, finding tasks, escalation, findings-vs-counters cross-check, redshirt-casualty hook | Injected/failed states surfaced; Hank can't act; findings reconcile vs deterministic counters | ~2–3 d |
| **7 · Overlay product** | `starfish govern` | governance-overlay: inventory engine, the command, setup skill, Claude Code plugin packaging, consent flow, boundary auto-set, agent injection | `starfish govern ./SEO-local` works end-to-end; re-run hash-checks; nothing uncleared runs | ~6–9 d |
| **8 · Idea Board + Pam** | Brain-dump → governed plan | Canvas UI screen, canvas.json + IPC, promote→analysis task, Pam planner, draft-DAG review | Promote yields backlog drafts only; nothing dispatches without approval | ~5–8 d |
| **9 · Theme + harden + package** | Ship it | **IP-safe "Fleet" ring-3 theme** (bridge, original AI sprites, LCARS-*inspired* chrome, redshirts) via **theme-pack** (full-Trek skin personal-only, never distributed); purge all fork/LimeZu art; double-click launcher / packaged installer; OS-sandbox agents; audit rotation; release docs + EULA; **compliance CI gates** (IP token scan, asset/SBOM/secret scans) | All R&C compliance gates green; ⚖ legal sign-off; launches with no CLI; agents sandboxed; release built | ~8–12 d |

**Dependency spine:** 0 → 1 → 2 → 3 → (5 → 7) and (4, 6, 8) → 9. Phase 2.5 parallels 3+. The overlay (7) needs core + tasks + Toby.

## 10. Theme — Starfleet, not Borg

The mechanism is a hive (Borg-like substrate), but **the governance layer is precisely what makes it Starfleet, not Borg** — bounded autonomy, a chain of command, rules nobody can override, and *consent*. The Borg is "resistance is futile / no consent" — the literal anti-pattern of this product. That contrast is the origin story, not the brand. ("Starfish" → "Starfleet" is already a near-pun.)

| Starfish | Star Trek |
|---|---|
| You (final authority) | Starfleet Command / the Admiral |
| Michael (orchestrator) | The Captain |
| Dwight (prep) | First Officer / Spock |
| Toby (intake) | O'Brien at the transporter — nothing beams aboard unvetted |
| Hank (monitor) | Odo / Tactical — the constable who watches and reports |
| Pam (planner) | Data / Ops — analysis and sequencing |
| Policy registry / framework | Starfleet General Orders / the Prime Directive |
| PDP / permission gate | "Computer, authorization required — access denied" |
| The office floor | The bridge |

**Redshirts (a feature, not just a gag).** When an agent hits a **terminal failure** — Critical violation caught by Hank, killed by the gate, crash, or a failed task with no retries — its avatar dons a red shirt and "beams down" (and doesn't return), with a combadge marker and a casualty counter. It makes failure *glanceable* and points straight at the audit log. And it reinforces determinism: **nobody dies at random — a redshirt falls only to a real violation or failure, so if one drops, check the log.** Pure ring-3; zero governance impact.

**Asset licensing (do now, in Phase 9).** The fork's LimeZu sprites are *non-commercial* — they would block selling the overlay. The theme change is the moment to switch to commercially-licensed or original, generic-Starfleet (not trademarked) art, retiring the licensing constraint.

**Full design captured in `Project Starfish UI THEME SPEC.md`.** The bridge layout (U.S.S. Starfish), character designs (Captain Michael, Spock/Dwight, O'Brien/Toby at the transporter, Odo/Hank in security, Data/Pam at ops), the Mission Console, worker crew, the "every task is a mission" narrative, the full asset inventory, and the IP-safety guidance live there. **Key convergence:** the themed UI is a faithful visualization of the governance model — the Mission Console's six phases ARE the task lifecycle, the Activity Feed IS the audit log, Starfleet Command IS the HITL surface, Ship Status IS the service registry + telemetry. Bind the UI to live governance state, not fake readouts. **IP caution:** for the sellable product, keep the genre and drop the trademarks (LCARS-*inspired*, "fleet command", original officer designs); a theme-pack architecture lets a full-Trek skin stay personal-only.

## 11. Cross-cutting requirements

- **CI gates:** typecheck green; dependency-direction lint (governance imports nothing from transports); boundary conformance suite; determinism tests; "no side effect without a PDP decision" assertion.
- **Salvage ledger:** every fork file's origin, ring, and review recorded.
- **Audit hygiene:** hash-chained, monthly rotation, disk-full fails closed.
- **Determinism:** governance decisions are pure functions of (input, policy, context); no hidden randomness.
- **Docs:** `GOVERNANCE.md` constitutional; HIVE/SPEC subordinate notes; CHANGELOG per phase.

## 12. Open items & risks

- **OS sandbox (T-25)** is the top post-MVP hardening; the process-isolated PDP arrives free with the overlay, but restricted-user/container agents are Phase 9.
- **Escalation fatigue (T-21):** tune policies so routine work auto-allows; treat the allow/deny/ask ratio as a health metric.
- **Effort totals** are planning-grade, not commitments; revisit after Phase 1 (the riskiest phase) lands.
- **SEO-local pack** isn't connected to the workspace yet — connect it to dry-run the overlay against real skills.
- **Naming** for the sellable product (vs. "Project Starfish" the reference app) is undecided — needs a trademark clearance search (R&C L-5).
- **⚖ Legal sign-off** gates the paid release: Trek-IP-free distribution (L-1), product-name clearance (L-5), EULA/ToS (L-6/L-7), and AI-art commercial-license terms (A-1/A-2). Tracked in the Risk & Compliance Registry; not closeable by code alone.
- **Decisions locked 2026-06-04:** the distributed product is **IP-compliant** (IP-safe Fleet theme, no Trek/Office/LimeZu IP); **art is AI-generated** original (with a provenance ledger and per-asset license records). Full test cases, success criteria, and outputs are in the Detailed Implementation Plan; all risks and their solutions are in the Risk & Compliance Registry.

---

*Build nothing until this plan is signed off. Phase 0 begins on Scott's go.*
