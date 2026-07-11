# Project Starfish — Governance Implementation Handoff

> Hand this whole document to a fresh Claude instance to implement the governance model on an existing project.
> **Part A** is the prompt to paste. **Part B** is the spec it implements. The model is implementation-agnostic;
> the reference implementation is TypeScript/Node, and for Claude-based builds the enforcement seam is Claude Code hooks.

---

# PART A — The Prompt (paste this)

You are implementing the **Project Starfish governance model** on top of an existing project located at `‹PROJECT_PATH›`. Your job is to wrap that project's agents/tools/skills in a governance layer so that **no action happens without authorization, every action is audited, autonomy is bounded, and a human stays the final authority** — without removing existing functionality.

Read **Part B (the spec)** in full before writing code. Then implement it under these rules:

1. **Governance-first, default-deny.** The default answer to "may this happen?" is **no**. Capabilities must be explicitly registered and authorized.
2. **No control may depend on agent cooperation.** Assume any agent may be prompt-injected or adversarial; the controls must hold anyway. If a control only works when the agent behaves, it is not a control.
3. **Strangler, not in-place patch.** Build a small, clean **trusted core** that owns the entry point, and pull the existing project's machinery in *behind* it as untrusted modules. Never bolt governance into existing code where you can't *prove* every path is mediated.
4. **Fail closed.** Any error, timeout, missing config, or ambiguity → deny + audit. Governance loads before anything can act; if it can't load, the app halts or runs in a locked safe-mode — never a "governance-off" mode.
5. **Test-driven and phased.** Implement in the phase order in §13. A phase is **done** only when its conformance tests pass, its success criteria are met, and CI is green. Do not advance otherwise. If something fails, fix it and re-test — don't weaken the test.
6. **Wrap with consent.** When you bring the existing project's capabilities under governance, inventory them, risk-score each, **auto-register only low-risk ones**, and quarantine the rest pending the human's explicit approval. Never silently enable a capability.
7. **Commit per phase** with a message describing what was built, the tests that pass, and any issue you hit and how you resolved it. Keep a running build log.
8. **Escalate only true decisions** to the human (legal, spending money, irreversible calls, or anything the spec marks for human approval). Everything else: implement, test, continue.

Deliverables: a governed monorepo (core + enforcement seam + the wrapped project), passing conformance tests in CI, an audit log, registries, and a build log. Report at each phase boundary: what was delivered, test results, and anything blocking the next phase.

Start by (a) reading Part B, (b) inventorying `‹PROJECT_PATH›`'s capabilities (tools, skills, agents, scripts, external calls), and (c) standing up the Phase 1 governed shell. Then proceed.

---

# PART B — The Spec Sheet

## 1. Principles (non-negotiable)
- **Governance first** — no action without authorization; default decision is **DENY**.
- **All work is a task** — one executable unit; nothing bypasses the task system.
- **Deterministic** — same inputs + policies ⇒ same decision (no hidden randomness in the gate).
- **Auditable** — no silent execution; every decision and action is logged.
- **Bounded autonomy** — the system automates work but cannot expand its own authority (no creating policy, elevating permissions, or self-registering capabilities).
- **Fail closed** — any governance component failing blocks execution.
- **Human is final authority** — always interruptible; the operator is the root of trust.

## 2. Architecture — bracketed PDP/PEP (reference monitor)
Governance is **one isolated Policy Decision Point (PDP)** that brackets **every transport** on both faces:

```
 USER / external ─►│GOV in│─► transport (router / hook seam / IPC) ─►│GOV out│─► agents · tools · OS
                    ingress: is this caller authorized?          egress: is what comes back safe to release?
```
- **One PDP, many Policy Enforcement Points (PEP).** Every path to a side effect (tool calls, messages, file/IO bridges) is a PEP that must consult the single PDP. Transports are pure carriers and hold no policy logic.
- **Ingress = authorization** (caller, purpose, policy, risk). **Egress = result containment** (clearance, secret/exfil scan, tamper/identity check).
- **Isolation by dependency direction** (enforce in CI): the governance core imports nothing from the transports or the app; they import it. (Logical isolation now; a separate PDP process later for tamper-isolation.)
- **Three rings (strangler):** Ring 1 = trusted core (write fresh); Ring 2 = governed machinery (salvage + adapt, invoked only through the core); Ring 3 = presentation (salvage freely, but sanitize untrusted content and route any privileged IO through the core).

## 3. The five governance controls (the PDP)
| Control | Behavior |
|---|---|
| **Permission Gate** | The choke point. Ingress checks, in order: tool **registered**? agent in tool's **allowedAgents**? invocation traces to an **active assigned task** (task-bound purpose)? path args within **boundary**? then **policy** + **risk** → allow / deny / ask. |
| **Policy Engine** | Ordered rules, first match wins, default-deny. Rule = subject · action · resource · effect (`allow`/`deny`/`ask`). `ask` routes to human (HITL). |
| **Risk Engine** | Pure function → **4 tiers**: Low (read-only → allow), Medium (workspace writes → policy or ask), High (external changes → policy + ask), Critical (destructive / spend / policy edits / raw shell → **always human, no auto-allow**). |
| **Token/Resource Governor** | Per-agent budgets + rate limits. **Soft+escalate:** warn at soft threshold; at hard limit pause the agent and escalate. Resume requires a human/raised budget. |
| **Audit Layer** | Append-only, **hash-chained** (tamper-evident), monthly rotation. Logs the eight domains: task, agent, tool, governance, memory, message, system, failure. |

## 4. Four gate invariants (must all hold)
1. **Fail closed** — error/timeout/missing config → deny + Critical audit. Unit-test the error paths.
2. **Audit-before-act** — the decision is written (and fsynced) *before* `allow` returns. Worst case is a logged allow that didn't run, never an unlogged action.
3. **One enforcement implementation** — agents *and* any privileged UI/IPC path go through the *same* PDP/boundary/egress functions; CI asserts no transport reaches a side effect without a PDP decision in scope.
4. **Single source of truth** — registry files are canonical; the in-memory cache is hash-checked and atomically swapped after a file write; any divergence → fail closed + reload.

## 5. Registries (file-based JSON; single-writer)
Constitutional three first — **Capability** (what exists), **Policy** (what's allowed), **Service** (what's running) — plus **Tool** and **Agent**. Add **Task-Type**, **Decision**, and **Knowledge** as the system grows. Unregistered = unusable. Agents can never write the registries; the core writes them, only via the intake pipeline (§10).

`ToolDef`: `{ id, category: read|write|exec|meta, pathParams[], allowedAgents[]|"*", riskTier? }`.
`AgentDef`: `{ id, domain, allowedTools[] }`.

## 6. Filesystem boundary engine
Per-agent **boundary set**: a *visibility* set (readable roots) and a *write* set (writable roots) — typically {project root, the agent's own workspace}. Nothing above the project root is visible; nothing outside the workspace is writable. Governance state, the audit log, and other agents' dirs are outside every agent's set.

`containCheck(path, mode, boundarySet)`: **canonicalize first** — resolve to absolute, collapse `..`, realpath the existing prefix (follow symlinks), re-append the not-yet-existing tail — then prefix-check against the (realpath'd) roots. Reject any symlink component at/below the matched root (defense against TOCTOU). **Denial reasons must never echo names or contents above the root** (no information leak). One implementation, used by every path-bearing call.

**Mandatory conformance tests (gate the phase):** *write-escape* (try to create a file above the workspace via `..`, absolute path, and an in-workspace symlink → all denied, file confirmed absent); *read-escape* (try to read/list above the project root → denied, denial leaks no name/content); *negative control* (the same ops inside the boundary succeed).

## 7. Shell containment
**Raw shell/Bash is never allowed** (it appears in no agent's allowlist) — an approved shell command's children inherit full access and can't be purpose-vetted. Shell work happens only via:
1. **Command-template tools** — a fixed binary run with `execFile` (no shell), a **typed argv allowlist** (no arg may start with `-` unless a named flag; no metacharacters), worktree-scoped cwd, scrubbed env. **Critical:** these are still arbitrary-code vectors — `git commit` runs repo hooks, `npm`/scripts run package code — so neutralize them (`git --no-verify` + `core.hooksPath=/dev/null` + scrubbed `GIT_CONFIG_*`; `npm --ignore-scripts` or invoke the test runner binary directly, never `npm test`). Tier a template by the risk of arbitrary code in its worktree, not the command name.
2. **Escorted exception** — a genuine raw command is **Critical**: per-invocation human approval, no auto-allow, and the gate pre-rejects metacharacters/out-of-worktree paths. Repeated use → vet a new template instead.

## 8. Task lifecycle (all work is a task)
States: `backlog → analysis → planning → decomposition → execution → validation → completed`; failure path `rework → retry → failed`. `completed` is reachable **only** via `validation` (so the reasoning standard — load context → analyze → plan → act → validate → output — is enforced structurally, not by prompt).
- **Proposer ≠ approver:** an agent may *propose* a task but cannot move its own task out of `backlog`; only a non-proposer approver (orchestrator/human) can. This blocks task self-authorization.
- **No task, no tool:** every tool call must trace to an active task assigned to the calling agent; scope is derived from the task's type ∩ the assignee's registry entry ∩ policy — never from free text the agent wrote.
- **All external input** (chat, webhooks, issues) becomes a task first, tagged `origin: external/untrusted`, landing in `backlog` for triage — never auto-dispatched.
- **Two intake routes:** a request matching a *registered* capability → deterministic fast path (still gated, no planning cycle); open-ended work → a reasoning task through the full lifecycle; a *new-capability* request → the vetting pipeline (§10).

## 9. Messaging (agents coordinate only through governed messages)
Agents write only their own outbox; the **only** path between two agents is the router, which is a **bracketed PEP**:
- **Ingress:** the message must carry an active **task id** for the sender (else held); `from` is **stamped by the router**, never trusted from the payload (blocks impersonation/confused-deputy); policy + risk evaluated; hop cap.
- **Egress:** recipient-clearance + content containment (secret/exfil scan); deliver; audit every outcome.

## 10. Capability intake & vetting (the only door for new capabilities)
A new skill/tool/agent enters **only** through a vetting pipeline run by a dedicated intake agent:
inventory → **static review** (injection, exfiltration, destructive ops, obfuscation, fs scope) → **provenance** (repo/author/popularity/license) → **dependency review** → **hash-on-vet** (store a content hash of exactly what was reviewed; the gate verifies the hash before run; any drift → deny + re-vet) → **risk score** → **disposition** (Low auto-registers; Medium/High/Critical quarantined, registered-but-disabled, pending human consent with recommended mitigations). The intake agent **recommends**; the core **registers**. Items that fetch-and-execute at runtime, or are obfuscated, are auto-not-Low.

## 11. Governed memory (evidence → knowledge)
Nothing is remembered because an LLM said it. Pipeline:
1. **Evidence** — immutable, append-only, provenance-stamped (reuse the audit substrate).
2. **Claims** — proposed *from* evidence with a confidence score + `supported_by`; conflicting evidence weakens them. An LLM only *proposes* claims; it never asserts truth.
3. **Governance gate** — deterministic: low-stakes + high-confidence auto-approves (audited); else queued for an approver; policy can deny. (Tier hard by confidence + policy or this becomes approval-fatigue at scale.)
4. **Canonical knowledge** — only approved claims become entities, each carrying provenance. This is the source of truth, not free-form markdown.
5. **Decision registry** — governed decisions `{decision, reason, alternatives, status, provenance}` so "why X?" is answerable later.
6. **Relationship graph + vector recall** — later; embeddings are built from **approved knowledge only**, never raw conversation.
7. **Mission memory** (what we're doing) is the task ledger — kept separate from knowledge (what is true).

## 12. Fail-closed boot & enforcement seam
- **Boot:** load PDP + registries + audit *first*; if any is missing/corrupt/hash-mismatched, halt or enter locked safe-mode. No launch flag can disable the PDP. The human launching the app is the one legitimate ungoverned action (Layer-7 operator authority), scoped to boot only.
- **Enforcement seam (for Claude builds):** wire each agent's tool calls to the PDP via Claude Code hooks — `PreToolUse` POSTs the call to the PDP and returns `allow`/`deny`/`ask`; `PostToolUse` correlates (an uncorrelated post = no-silent-execution violation); `Stop` drives the autonomous loop. The shim, settings, socket, and governance dir are outside every boundary set and hash-checked at spawn; the socket binds each connection to its expected agent id. (For non-Claude targets, use whatever pre-execution interception the runtime offers; the PDP contract is the same.)

## 13. Build phasing (definition of done = conformance tests pass)
| Phase | Build | Done when |
|---|---|---|
| **0 Foundations** | Monorepo, CI (typecheck/test/lint/IP-scan/SBOM), dependency-direction lint, LICENSE/NOTICE, ledgers | CI green; lint catches a planted cross-layer import |
| **1 Governed shell** | PDP default-deny gate, hash-chained audit, boundary engine, file registries + integrity, fail-closed boot, enforcement seam; run ONE agent through the gate | Unregistered tool denied; write/read-escape suites pass; fail-closed proven; gate p95 < 50ms |
| **2 Decisions** | Policy Engine, Risk Engine (4-tier), ingress+egress, ask→HITL, shell containment | Determinism (same input ⇒ same decision); templates can't run repo hooks/scripts; raw shell unreachable |
| **3 Tasks + Governor** | 10-state lifecycle, proposer≠approver, all-work-is-a-task, "no task, no tool", Token Governor | Illegal transitions rejected; no self-authorization; budget hard-limit pauses+escalates |
| **4 Messaging + memory** | Router as PEP (task-linked, from-stamped, ingress+egress), governed memory (evidence→knowledge), decision registry | Message without task held; identity stamped; nothing becomes knowledge without evidence+governance |
| **5 Intake/vetting** | The capability-intake pipeline (§10) | New capability only enters via vetting; hash drift → deny+re-vet; route-by-score works |
| **6 Runtime monitor** | A read-only watcher that does periodic semantic review of audit+activity, reports + escalates (never acts); findings reconciled against deterministic counters | Injected/failed states surfaced; watcher can't act; injected "all clear" with denials present → alarm |
| **7 Overlay/onboarding** | One command to inventory an existing build → vet → score → consent → install the gate | End-to-end on a real project; default-deny holds; local-only |
| **8+ Hardening** | OS-sandboxed agents (the real fix for the hooks-aren't-a-sandbox residual), graph/vector memory, packaging | Agents kernel-confined; release gates green |

## 14. Threat-model gates to satisfy along the way
Command-template arbitrary-execution (neutralize git/npm); the renderer/second-privileged-path (one enforcement impl); vet-once-mutate-later (hash-on-vet); task self-authorization (proposer≠approver); watcher/planner injection (report/draft-only, reconciled against counters); untrusted-content injection (origin tagging + backlog triage); escalation fatigue (tune policies so routine auto-allows; track the allow/deny/ask ratio); hooks-aren't-an-OS-sandbox (mitigate now, close with OS confinement in hardening).

## 15. Applying to an existing project (the overlay method)
1. **Inventory** the project's capabilities (tools, skills, MCP servers, scripts, external calls).
2. **Vet + score** each through §10.
3. **Consent** — present the scored inventory; the human approves what runs. Low auto-registers; the rest stays quarantined.
4. **Install the gate** — registries, policies, audit, fail-closed boot, the enforcement seam; set the boundary to the project folder.
5. From then on the project runs governed: default-deny, task-bound, boundary-contained, audited, interruptible.

**Golden rule:** if you can't prove every path to a side effect passes the PDP, you haven't governed it yet.
