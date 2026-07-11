# Governance Audit Questionnaire

A reusable audit instrument for **Starfish Governor**. Use it two ways:

- **Part 1 — Overlay / import readiness:** answered about a *target platform* before wrapping it in governance (`starfish govern`). Determines whether the platform *can* be governed and how.
- **Part 2 — Security / memory / attack-surface audit:** answered about *any* build — a target platform or Starfish itself — to expose weaknesses. Each item maps to a threat ID from the Threat Model.

## How to use

Work top to bottom. For each item, record the finding in **Answer / Findings** and set **Status**:

- **Pass** — control present and verified
- **Fail** — control absent or bypassable (a blocker)
- **Finding** — partial / needs mitigation / follow-up
- **N/A** — not applicable to this target (say why)

**Rule of thumb:** any **Fail** on a gate-integrity, code-execution, or authorization item is release-blocking. The two meta-questions at the end (M1–M2) are the lens for everything else — a control that depends on agent cooperation is not a control.

---

## Part 1 — Overlay / import readiness

*Answered about the target platform before governing it.*

### Enforcement seam & architecture

| # | Question | Feeds control | Answer / Findings | Status |
|---|----------|---------------|-------------------|--------|
| R1 | Is there a pre-execution interception point where every tool/action can be told allow/deny/ask *before* it runs? | Permission Gate / PEP seam | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R2 | Can that seam be made non-bypassable (no second privileged path, direct SDK call, or IPC route to a side effect)? | Complete mediation | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R3 | Can governance load first and fail closed if policy/registries/audit are missing or corrupt, with no flag to disable it? | Fail-closed boot | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R4 | Which way does dependency direction point — can the core stay isolated, or is a strangler wrap needed? | Isolation by dependency direction | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### Capabilities & side effects

| # | Question | Feeds control | Answer / Findings | Status |
|---|----------|---------------|-------------------|--------|
| R5 | What is the full capability inventory (tools, skills, functions, MCP servers, plugins, external calls)? | Capability registry / intake | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R6 | What side-effect surface exists (fs writes, network, shell, spend, messaging, third-party services)? | Risk Engine / boundary | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R7 | Is raw shell / arbitrary code execution reachable, directly or via templated commands? | Shell containment | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R8 | What is the filesystem/workspace boundary, and where can governance state live invisibly to agents? | Boundary engine | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### Work model & agents

| # | Question | Feeds control | Answer / Findings | Status |
|---|----------|---------------|-------------------|--------|
| R9 | Is there a task/work concept to bind purpose to ("no task, no tool")? | Task lifecycle | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R10 | How does external input enter (chat, API, webhooks, schedulers, issues)? | Untrusted-origin intake | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R11 | What is the agent topology (count, roles, orchestrator), and is any actor privileged in mechanism? | Orchestration / least privilege | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R12 | How do agents coordinate, and can that channel become a bracketed router? | Governed messaging | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### Identity, authority & human oversight

| # | Question | Feeds control | Answer / Findings | Status |
|---|----------|---------------|-------------------|--------|
| R13 | How is caller identity established, and can `from` be spoofed? | Router `from`-stamping | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R14 | Who is the root of trust, and can any automated actor create policy or elevate its own permissions? | Bounded autonomy | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R15 | Is there a HITL surface where escalations appear and a human can pause/redirect/abort? | Human-final-authority | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R16 | What is the spend / destructive-action authority, and what must always require a human? | Risk Engine (Critical) | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### Data, audit & deployment

| # | Question | Feeds control | Answer / Findings | Status |
|---|----------|---------------|-------------------|--------|
| R17 | Is there append-only, tamper-evident audit, written before the action? | Audit layer | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R18 | How are secrets/credentials handled (secure store vs. files/env/repo)? | Secret management | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R19 | What data leaves the machine, and does anything require consent (incl. processing third-party code/data)? | Privacy-safe / liability | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| R20 | Where and how does it run (OS, local vs. cloud, container), and at what throughput? | OS-sandbox feasibility / fatigue | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

---

## Part 2 — Security / memory / attack-surface audit

*Answered about any build to expose weaknesses. Threat IDs reference the Threat Model.*

### A. Gate & enforcement integrity

| # | Question | Threat | Answer / Findings | Status |
|---|----------|--------|-------------------|--------|
| A1 | Can an agent reach a side effect with no pre-execution check (child process, subagent `Task`, unregistered MCP call)? | T-01 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| A2 | Is *absence* of a gate decision a hard alarm, or a silent default-allow? | T-01/T-10 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| A3 | Are shim, settings, socket, registry, and audit files outside every write set and hash-checked at spawn? | T-02 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| A4 | On pathological input / timeout / exception / missing config, does the gate fail closed with a Critical audit? | T-03 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| A5 | Is there any launch path or flag that boots agents/tools without governance? | T-26 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| A6 | Is the registry the single source of truth, with cache derived and hash-reconciled (no file/cache divergence)? | T-13 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### B. Code-execution & shell surface

| # | Question | Threat | Answer / Findings | Status |
|---|----------|--------|-------------------|--------|
| B1 | Is raw shell reachable by any agent, directly or transitively? | T-05 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| B2 | For each command template, what scripts/hooks can it be made to run from its worktree (git hooks, npm scripts, git config)? Neutralized? | T-05 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| B3 | Can arguments smuggle behavior into a templated binary? Is there a typed argv allowlist? | T-06 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### C. Authorization logic

| # | Question | Threat | Answer / Findings | Status |
|---|----------|--------|-------------------|--------|
| C1 | Can an agent create + self-assign a task and write its own scope (self-authorization)? Proposer ≠ approver enforced? | T-07 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| C2 | Is task scope *derived* from registry + type + policy, not from agent-written free text? | T-07 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| C3 | Can a privileged/orchestrator actor be tricked into acting for an attacker? Privileged in role only, never mechanism? | T-08 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### D. Supply chain & capability intake

| # | Question | Threat | Answer / Findings | Status |
|---|----------|--------|-------------------|--------|
| D1 | Is each vetted capability pinned to a content hash the gate verifies at run time (drift → deny + re-vet)? | T-11 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| D2 | Does vetting flag obfuscation, encoded payloads, dynamic `eval`, and runtime-fetch as automatically not-Low? | T-12 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| D3 | Can any capability enter the registry outside the vetting pipeline? | T-11 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### E. Attack surface — entry points & egress

| # | Question | Threat | Answer / Findings | Status |
|---|----------|--------|-------------------|--------|
| E1 | Is every ingress (chat, API, webhook, issue, agent message, skill output) tagged untrusted and triaged, not auto-dispatched? | T-09 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| E2 | What network egress exists, and can any agent send data outbound? Is network default-deny? | T-09 / privacy | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| E3 | For any exposed endpoint (tunnel/webhook): authenticated, replay-guarded, and limited to backlog intake only? | T-18 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| E4 | Are secrets stored in a secure keystore, not files/env/repo readable by agents or the audit log? | T-14 / privacy | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### F. Second privileged path (UI / IPC)

| # | Question | Threat | Answer / Findings | Status |
|---|----------|--------|-------------------|--------|
| F1 | Does any UI/renderer/IPC layer hold its own fs/git capability that bypasses the agent gate? Routed through the one enforcement function and audited by origin? | T-19 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| F2 | Is all displayed untrusted content rendered inert, with no HTML/XSS path to privileged IPC? | T-19 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### G. Audit & resource integrity

| # | Question | Threat | Answer / Findings | Status |
|---|----------|--------|-------------------|--------|
| G1 | Is the decision written and fsynced *before* the action returns (no executed-but-unlogged action on crash)? | T-10 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| G2 | Is the audit log append-only and hash-chained so edits/deletions of past lines are detectable? | T-14 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| G3 | On disk-full / unwritable audit, does the gate deny rather than run ungoverned? | T-14 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| G4 | Are there rate limits and quotas (messages/min, tasks/hr, outbox count, worktree size) to contain runaways? | T-15 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### H. Memory audit

| # | Question | Threat | Answer / Findings | Status |
|---|----------|--------|-------------------|--------|
| H1 | Can an agent write "facts" straight into shared memory, or must claims originate from provenance-stamped evidence and pass a gate? | T-16 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| H2 | Does promoted knowledge record provenance (agent, task, evidence), bound to a *validated* task? | T-16 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| H3 | Are promoted entries revocable (revocation audited), and can knowledge from a later-failed task be flagged and pulled? | T-16 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| H4 | If semantic/vector recall exists, are embeddings built only from approved knowledge — never raw conversation or agent output? | memory arch | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| H5 | Is claim approval tiered by confidence + stakes so memory-scale approval doesn't become rubber-stamping? | T-21 / memory | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### I. Filesystem boundary & OS residual

| # | Question | Threat | Answer / Findings | Status |
|---|----------|--------|-------------------|--------|
| I1 | Is there a TOCTOU/symlink-swap window between path check and `open()`? Are in-boundary symlink components rejected? | T-04 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| I2 | Are agents OS-confined (restricted user/container/namespace), or do all guarantees rest on the agent honoring hooks? | T-25 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### J. Human factor & crown jewels

| # | Question | Threat | Answer / Findings | Status |
|---|----------|--------|-------------------|--------|
| J1 | Is the human over-asked (fatigue)? Is the allow/deny/ask ratio tracked, and are prompts decision-ready (what/who/why/risk/diff)? | T-21 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| J2 | Who can edit policy/registry/budget files? Is every edit Critical, human-only, audited, always-interrupt — no agent, not even intake? | T-23 | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

### Meta — the lens for everything above

| # | Question | Threat | Answer / Findings | Status |
|---|----------|--------|-------------------|--------|
| M1 | Does any control depend on the agent behaving? List every control that fails this test. | design rule | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |
| M2 | Where is the trusted computing base, and how small is it? Anything large/entangled is a finding. | trust model | | ☐ Pass ☐ Fail ☐ Finding ☐ N/A |

---

## Findings summary

| Severity | Count | Items |
|----------|-------|-------|
| Blocker (Fail on gate/exec/authz) | | |
| High | | |
| Medium | | |
| Low / accepted residual | | |

**Auditor:** ______________  **Target / build:** ______________  **Date:** ______________

**Sign-off:** ______________
