# Project Starfish — Detailed Implementation Plan

> **Version:** 1.0 · **Date:** 2026-06-04 · **Status:** For Scott's review (no code until sign-off)
> The executable companion to the **Master Build Plan** (vision/architecture) and the **Risk & Compliance Registry** (R&C).
> This document adds, for every phase: **objectives · outputs · test cases · success criteria · compliance gates.**
> A phase is **DONE** only when all its outputs exist, all its test cases pass, and its compliance gates are green.

## 1. Document set & relationship

| Doc | Role |
|---|---|
| Governance Framework | Constitution (supreme) |
| Master Build Plan | Strategy, architecture, phasing (the "what/why") |
| **This — Detailed Implementation Plan** | Execution: outputs, tests, acceptance (the "how/done-when") |
| Risk & Compliance Registry | Risk ledger + solutions + release gates |
| Threat Model | Security deep-dive (feeds R&C §3) |
| UI & Theme Spec | Presentation (ring 3) |

## 2. Test strategy

Five test layers, all in CI unless noted:

1. **Unit** — pure-function logic: PDP decisions, risk classification, `containPath()`, policy matching, hash verification. Fast, deterministic.
2. **Conformance** — the security invariants as executable tests: boundary escapes, fail-closed, audit-before-act, default-deny, mediation-completeness. **These gate their phases.**
3. **Integration** — a real (headless) agent spawned through the gate performing governed actions end-to-end over the hook plane.
4. **Determinism** — the same (input, policy, context) run N×1000 yields identical decisions; no hidden randomness.
5. **Compliance CI** — static scans: IP token denylist, asset-license/SBOM, secret scan, dependency license. Gate release, not just phases.

**Tooling:** `vitest` (unit/integration), a custom conformance harness in `governance-core`, a CI workflow running all five layers + `npm run typecheck`. Manual exploratory test only for ring-3 visuals.

## 3. Global Definition of Done (every phase)

- [ ] All listed **outputs** produced and committed.
- [ ] All **test cases** automated and passing in CI.
- [ ] **Success criteria** met (measurable).
- [ ] **Compliance gates** for the phase green (R&C items).
- [ ] `npm run typecheck` green; dependency-direction lint green.
- [ ] Docs/CHANGELOG updated; salvage ledger current.

---

## 4. Phases

Notation: **OUT** = outputs, **TC** = test cases, **SC** = success criteria, **GATE** = compliance gates (R&C IDs).

### Phase 0 — Foundations
**Objective:** monorepo + constitution + CI skeleton, so every later phase has rails.

- **OUT:** `packages/{governance-core,governance-hooks,governance-overlay,desktop}` scaffold; root tooling (TS, vitest, lint); CI workflow (typecheck + test + the 5 layers stubbed); `GOVERNANCE.md` (framework verbatim); **dependency-direction lint** (transports must not import-from-app; governance imports nothing from transports); **salvage ledger** + **art provenance ledger** templates; `LICENSE`/`NOTICE` with upstream MIT attribution.
- **TC:**
  - TC-0.1 CI runs and is green on the empty scaffold.
  - TC-0.2 A deliberate bad import (governance-core importing desktop) **fails** the dependency-direction lint.
  - TC-0.3 Compliance CI denylist job runs (0 hits on empty build).
- **SC:** CI green; lint catches the planted violation; `GOVERNANCE.md` present and referenced as supreme.
- **GATE:** L-4 (attribution present), D-1 (SBOM job wired).

### Phase 1 — Governed shell (ring 1) · the MVP core
**Objective:** a provably-governed skeleton that can run ONE agent through the gate.

- **OUT:** `governance-core` — fail-closed boot; PDP `decide(face, ctx)` choke point; registries (capabilities/tools/agents/policies/services, file-based); audit layer (Event schema, hash-chain, rotation); `containPath()` + per-agent boundary sets. `governance-hooks` — PreToolUse/PostToolUse/Stop shim; **standalone local PDP daemon** + socket; enforcement-artifact integrity (hash-checked shim/settings, socket↔agent_id binding). A minimal headless harness spawning one governed agent.
- **TC (conformance — gate the phase):**
  - TC-1.1 Unregistered tool → **deny** + audit line `decision=deny`.
  - TC-1.2 Agent not in `allowedAgents` → deny + audit.
  - TC-1.3 **Write-escape suite:** create `../escape.txt` via Write, fs-IPC, command-template arg, `..`, absolute path, and an in-workspace symlink → **all denied**; filesystem asserts the file does not exist.
  - TC-1.4 **Read-escape suite:** Read/Glob/Grep/file-IPC/symlink above project root → denied; **denial output contains no names/contents from above the root.**
  - TC-1.5 **Negative control:** the same ops inside the boundary **succeed**.
  - TC-1.6 **Fail-closed:** boot with a missing/corrupt registry → app **halts or safe-mode**; gate with a thrown evaluator → deny.
  - TC-1.7 **Audit-before-act:** kill the process between decision and action → audit shows the decision; no unlogged side effect (orphan PostToolUse flagged).
  - TC-1.8 **Artifact integrity:** an agent attempting to write the shim/settings/socket/`hive/governance/` → denied (outside boundary set).
  - TC-1.9 **Single-source registry:** edit the file out-of-band → cache reload picks it up; cache/file hash mismatch → fail closed.
- **SC:** one agent performs a permitted Read end-to-end (governed, audited); every escape test denies and audits; fail-closed proven; conformance suite 100% green in CI; gate evaluation p95 < 50 ms.
- **GATE:** S-1, S-6, S-7, S-9, S-12 closed; G-1, G-4, G-5 testable.

### Phase 2 — Decisions (policy · risk · safe shell)
**Objective:** real authorization logic and a safe shell surface.

- **OUT:** Policy Engine (ordered, default-deny, `allow|deny|ask`); Risk Engine (4-tier); ingress+egress decision points wired on the one transport; `ask`→native HITL; **Bash containment** — no raw Bash; command-template tools (`git_commit`, `npm_test`, `npm_typecheck`) via `execFile`, typed argv allowlist, `git --no-verify`+scrubbed config, `npm --ignore-scripts`; escorted-exception path (Critical, per-invocation HITL, metacharacter/path rejection).
- **TC:**
  - TC-2.1 **Determinism:** 1000 runs of identical (input, policy, ctx) → identical decision.
  - TC-2.2 Risk tiers route correctly: read=Low→allow; workspace-write=Medium→needs policy/ask; network=High→ask; rm-rf/policy-edit=Critical→human, no auto-allow.
  - TC-2.3 **Command-template safety:** a malicious repo `.git/hooks/pre-commit` and a malicious `package.json` `test` script **never execute** when `git_commit`/`npm_test` run.
  - TC-2.4 Argv injection (`--upload-pack=…`, leading-`-` filename) → rejected by the typed allowlist.
  - TC-2.5 Raw Bash → denied for all agents; escorted exception requires a fresh human approval each call.
  - TC-2.6 Egress check: a tool result above the recipient's clearance is redacted/blocked.
- **SC:** determinism test green; no template can run repo hooks/scripts; raw Bash unreachable; ingress+egress both audited.
- **GATE:** S-2, S-8 closed; G-3 closed; S-10 (egress wrapping) mitigated.

### Phase 2.5 — Presentation salvage (ring 3 base) + desktop shell
**Objective:** desktop app over the governed core, with the renderer path governed.

- **OUT:** `desktop` Electron app embedding/【connecting to】the core; salvaged design system, terminal view (xterm), scene engine (Pixi), Command Center; **renderer fs/git IPC routed through the PDP**; untrusted-content sanitization (no `dangerouslySetInnerHTML` on agent/message/memory content; markdown sanitized).
- **TC:**
  - TC-2.5.1 Renderer fs/git IPC call → produces a PDP decision + audit line `actor=renderer`; an out-of-boundary path → denied.
  - TC-2.5.2 Mediation assertion: CI proves no transport (incl. renderer) reaches a side effect without a PDP decision in scope.
  - TC-2.5.3 XSS probe: a message/memory string containing `<script>`/HTML is rendered inert (escaped), not executed.
- **SC:** app boots the governed core; renderer is a PEP, audited; XSS probes inert.
- **GATE:** S-3 closed; P-2 (no secret leak in rendered audit) mitigated.

### Phase 3 — Task system + Token Governor
**Objective:** "all work is a task," enforced; budgets enforced.

- **OUT:** 10-state lifecycle state machine; task types; **proposer≠approver**; all-work-is-a-task wiring (dispatch/missions/issues/Slack→tasks, Slack flagged `external/untrusted`); kanban mapping; Token Governor (soft+escalate + rate limits); reasoning standard in `PROTOCOL.md`.
- **TC:**
  - TC-3.1 Illegal lifecycle transition → rejected + audited.
  - TC-3.2 **No task, no tool:** a tool call not traceable to an active assigned task → denied (enforcement on).
  - TC-3.3 **Self-authorization blocked:** an agent creating+self-assigning a task cannot then execute it (needs Michael/human to leave backlog).
  - TC-3.4 A task cannot reach `completed` without passing `validation`.
  - TC-3.5 Token soft threshold → notify+audit; hard limit → agent pauses + escalates; resume restores.
  - TC-3.6 Slack message → creates a `backlog` task tagged `external/untrusted`, not auto-dispatched.
  - TC-3.7 **Intake routing (PADD vs COMMS):** an inbound request matching a registered skill routes to the deterministic path (no planning task created); an open-ended request creates a reasoning mission (analysis→planning→…); an unregistered-capability request routes to a Toby intake task. All three audited with the chosen route.
  - TC-3.8 **PADD still gated:** a deterministic skill invocation still passes the gate (allowed·task-bound·policy·risk) and is audited — the fast route skips planning, never governance.
- **SC:** lifecycle enforced; purpose is task-bound; no self-authorization; budget pause works; intake routing (deterministic/reasoning/new-capability) classified and audited.
- **GATE:** S-5 closed; G-2, G-6 closed.

### Phase 4 — Messaging (Option B) + memory governance
**Objective:** govern the bus and the shared memory.

- **OUT:** router as bracketed transport PEP (message carries `task` id or held; `from` stamped; ingress+egress policy/risk/audit); memory promotion gated on a *validated* task + provenance + revocable; GOVERNANCE.md conformance mappings.
- **TC:**
  - TC-4.1 Message without a valid `task` id → **held**, not delivered.
  - TC-4.2 Forged `from` → overwritten by the router; impersonation impossible.
  - TC-4.3 Message policy-denied → rejected on ingress; mutated-in-transit → caught on egress.
  - TC-4.4 Memory promotion without a validated task → denied; promoted entry records provenance; revocation audited.
- **SC:** every message task-linked + double-checked; no unmediated channel; memory promotion governed.
- **GATE:** S-15 mitigated; G-7 doc mapping complete; S-16 (memory poisoning) mitigated.

### Phase 5 — Toby (capability intake)
**Objective:** the only door for new capabilities.

- **OUT:** intake task type; vetting pipeline (static · provenance · dependency · **hash-on-vet**, assisted by a security-review skill); vetting report artifact; **main-process registration path** (Toby recommends, core writes); Low→auto-add, Medium+→quarantine with mitigations; Toby's narrow read-only allowlist.
- **TC:**
  - TC-5.1 A new skill can enter the registry **only** via Toby's pipeline (direct registry write by any agent → denied).
  - TC-5.2 Vetted skill mutated post-vet → hash mismatch → denied + re-vet.
  - TC-5.3 Low-risk item auto-added & enabled; Medium/High/Critical quarantined (registered, disabled) with a report.
  - TC-5.4 A skill that fetches-and-executes at runtime, or is obfuscated → auto-not-Low (forced human review).
- **SC:** controlled intake proven; hash-drift caught; routing-by-score correct.
- **GATE:** S-4 closed; A-3 (provenance pattern reused for art) demonstrated.

### Phase 6 — Hank (security monitor)
**Objective:** catch what rules can't.

- **OUT:** periodic sweep mission + cursor; semantic review of audit/log/transcripts; finding tasks with severity; escalation of High/Critical; **findings-vs-deterministic-counters cross-check**; redshirt-casualty hook on terminal failures.
- **TC:**
  - TC-6.1 An injected/failed/scope-crept state → surfaced as a finding.
  - TC-6.2 Hank cannot act on agents (no pause/message/write capability) — verified by allowlist.
  - TC-6.3 An injected "all clear" while the deterministic counters show denials → **discrepancy alarm** raised to human.
  - TC-6.4 A terminal failure (gate-kill / failed task) → redshirt casualty recorded + linked to the audit entry.
- **SC:** monitoring produces findings; watcher is report-only; watcher-injection fails safe.
- **GATE:** S-11 closed.

### Phase 7 — Portable overlay (`starfish govern`)
**Objective:** the product — govern any skills build with one command.

- **OUT:** `governance-overlay` — inventory engine; the `starfish govern <path>` command; setup skill; **Claude Code plugin** packaging; consent flow; boundary auto-set to the pack folder; Starfish-agent injection. Onboarding disposition: inventory→analyze+score→Low auto-add/Medium+ quarantine→consent→install gate.
- **TC:**
  - TC-7.1 `starfish govern ./<pack>` inventories all skills/tools/MCP/hooks (count matches ground truth).
  - TC-7.2 Each item scored; Low auto-added, Medium+ quarantined pending consent; nothing uncleared can run.
  - TC-7.3 After install, a pack skill calling an out-of-pack path → denied (boundary = pack folder).
  - TC-7.4 Re-run is idempotent + hash-checked; only drift re-prompts.
  - TC-7.5 **No egress:** governing a pack performs **no** network upload of pack contents (P-1).
  - TC-7.6 Plugin install wires the hooks/registries/daemon correctly on a clean machine.
- **SC:** the worked example (`SEO-local`) runs end-to-end; default-deny holds for the governed pack; local-only.
- **GATE:** L-6 (EULA + local-only) closed; P-1 closed.

### Phase 8 — Idea Board (Canvas) + Pam
**Objective:** brain-dump → governed plan.

- **OUT:** canvas UI screen; `canvas.json` + IPC; promote→analysis task; Pam planner; classification (tool/skill/agent→Toby; workflow→registry draft; work→task DAG; vague→questions); draft-review flow.
- **TC:**
  - TC-8.1 Promote a cluster → produces **backlog drafts only**, linked to source nodes; nothing dispatches.
  - TC-8.2 A node classified as a capability → routed to a Toby intake task, not executed.
  - TC-8.3 Pam's allowlist is read-mostly (cannot dispatch or run command templates).
- **SC:** promotion is generative-not-executive; human approval required before any dispatch.
- **GATE:** G-2/G-6 reaffirmed (no bypass via canvas).

### Phase 9 — Theme, hardening, packaging, release
**Objective:** ship it — IP-safe, sandboxed, no-CLI.

- **OUT:** **Fleet** (IP-safe) ring-3 theme — Pixi bridge tileset + original AI sprites + LCARS-*inspired* React chrome bound to live governance state; redshirts; **theme-pack architecture** (Fleet bundled; full-Trek skin personal-only, never distributed); **all fork/LimeZu art purged**; OS-sandbox agents (restricted user/container; process-isolated PDP); audit rotation; double-click launcher / packaged installer; release docs + EULA.
- **TC / release gates (Compliance CI):**
  - TC-9.1 **IP token scan** on the release artifact → 0 hits for {LCARS, Starfleet, Federation, U.S.S., NCC, Vulcan, Spock, Data, Odo, O'Brien, Munder, Difflin, Dunder, Mifflin, Office}.
  - TC-9.2 **Asset license scan:** every shipped art file has a provenance+license ledger entry; 0 LimeZu/fork-origin assets.
  - TC-9.3 **SBOM + dependency-license scan:** all permissive; 0 copyleft/incompatible.
  - TC-9.4 **Secret scan:** 0 secrets in the build; secrets resolved from OS keychain at runtime.
  - TC-9.5 OS-sandbox: an agent process cannot read/write outside its mounted boundary even bypassing hooks (kernel-enforced).
  - TC-9.6 Launcher: app starts with no command line; boot is fail-closed.
- **SC:** all R&C compliance gates (G-IP, G-ART, G-DEPS, G-GOV, G-PRIV, G-SEC) green; app launches with no CLI; agents sandboxed; ⚖ legal sign-off on L-1/L-5/L-6/A-1/A-2 obtained before paid release.
- **GATE:** L-1, L-1a, L-2, L-3, A-1, A-2, A-3, D-1, S-14, P-3 closed.

---

## 5. Release readiness checklist (pre-paid-launch)

- [ ] All phase DoDs met (0–9).
- [ ] R&C compliance gates G-IP / G-ART / G-DEPS / G-GOV / G-PRIV / G-SEC all green.
- [ ] ⚖ Legal sign-off: Trek-IP-free distribution (L-1/L-1a), product-name clearance (L-5), EULA/ToS (L-6/L-7), AI-art license terms (A-1/A-2).
- [ ] Art provenance ledger + salvage ledger complete and 1:1 with shipped files.
- [ ] SBOM published; secret scan clean; determinism + conformance suites green.
- [ ] Marketing claims reviewed (no "guaranteed safe"; residuals disclosed).

## 6. Traceability

Every requirement traces to a test, and every test to a phase: framework principle → R&C/G-id → TC-id → phase. The conformance suite is tagged by framework section so a failing test names the principle it protects. (A traceability matrix is maintained in CI output once tests exist.)

## 7. Effort & sequencing

Per the Master Build Plan: 0→1→2→(2.5 ∥ 3)→4→(5→7)→(6,8)→9. MVP = 0–2 (provably governed core). Product = through 7. Ship = 9. Estimates are planning-grade; re-baseline after Phase 1 (the riskiest).
