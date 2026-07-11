# Governed Execution — Non-Deviation Enforcement (Implementation Plan)

> **Version:** 1.0 · **Date:** 2026-07-04 · **Status:** Buildable implementation plan
> **Project:** Project Starfish (Scott's governance system). *Not a fork; Munder Difflin was a visual reference only.*
> **Companion to:** `Governed Execution — Runtime Safety Layer Plan.md` (this is the "stay on mission" layer of that plan).
> **Grounded in shipped code:** `@starfish/governance-core` (task lifecycle `tasks.ts`, boundary `boundary.ts`, risk/policy, capability ledger `vetting.ts`, monitor `monitor.ts`, PDP `pdp.ts`), planner `planner.ts`, the PreToolUse→PDP hook seam.

---

## 1. What "non-deviation" means (and why it's a separate layer)

The **safety catalog** (the 15 failure classes in the runtime-safety plan) stops actions that are *dangerous in themselves* — `rm -rf`, secret leaks, injection. **Non-deviation** stops actions that are *individually harmless but off-mission*: an agent doing something **outside the specific task it was approved to perform**, even using tools it is generally permitted to use.

> Safety asks: *"Is this action dangerous?"* — Non-deviation asks: *"Is this action part of the job I was actually authorized to do?"*

Concrete deviations non-deviation catches that the safety layer does **not**:
- An agent tasked with "fix the login bug in `auth.ts`" starts editing `billing.ts` — no boundary violation, no destructive command, but **out of task scope**.
- An agent approved to "summarize the Q3 report" instead sends an email — a legitimate capability, wrong mission.
- An agent given a 5-step plan jumps to step 5, skipping the approved sequence.
- An agent quietly expands its own remit ("while I'm here, I'll also refactor the whole module").

This is the per-task expression of the framework's **bounded autonomy** (§3.5: *the system may automate work but may not expand its own authority*) and **reasoning standard** (§8: no skipping the approved plan). "No task, no tool" (already built) requires *a* task; **non-deviation requires conformance to *that task's approved envelope*.**

---

## 2. The Scope Contract (the "mission envelope")

Every task, at the moment it is **approved out of backlog** (the `backlog → analysis` transition, done by a human/orchestrator — never the proposer), is bound to an immutable **Scope Contract** derived deterministically from `task type ∩ assignee's registry entry ∩ policy ∩ (the planner's plan, if any)`:

```
ScopeContract {
  taskId,
  objective,                       // the approved goal (human-readable + tags)
  allowedTools[]:  string[],       // tools this TASK may use (⊆ the agent's general allowlist)
  pathScope[]:     glob[],         // paths this TASK may read/write (⊆ the agent's boundary set)
  budget:          { usd, tokens, calls },   // this task's slice of the agent's budget
  plan?:           PlanStep[],     // for reasoning missions: ordered/DAG steps (from Pam)
  amendmentsOf?:   contractId,     // provenance if this is an approved expansion of a prior contract
  approvedBy, approvedAt, hash     // who approved, when, and a content hash (tamper-evident)
}
PlanStep { id, intent, tools[], paths[], dependsOn[] }
```

Key properties:
- **Narrower than the agent's general grants.** The agent's registry allowlist + boundary set are the *outer* limit; the contract is the *inner*, task-specific limit. Non-deviation enforces the inner one.
- **Set at approval, immutable during execution.** The approving authority (human/orchestrator) fixes the envelope; the executing agent cannot change it (proposer≠approver already prevents self-approval).
- **Derived, not agent-authored.** The agent never writes its own contract — it's computed from governed inputs, so an agent can't widen its remit by writing an ambitious task body (closes the same hole as task self-authorization, T-07).
- **Amendable only through re-approval** (§7 escape hatch below).
- **Commands are task-scoped, not agent-scoped (Scott, 2026-07-04).** A command-template (`npm_*`, `git_*`, a build/deploy) may run **only if that specific command is in `contract.allowedTools`** (and referenced by a plan step, if the task is planned). **No task can trigger `npm` — or any command — that isn't *its* command.** A task scoped to "fix the login bug" cannot run `npm publish`, `npm install`, or a deploy, even though the agent is generally permitted them elsewhere. Command scope is the *inner* limit; the agent's registry allowlist is only the outer one.
- **Hash-bound + audited**, like every other governance artifact.

---

## 3. Deviation taxonomy

Each candidate action is checked against the current task's contract. Deviations split into **deterministic** (hard, structural — block) and **semantic** (soft, judgment — flag/confirm, never silently block):

| Class | Deviation | Detection | Determinism | Intervention |
|---|---|---|---|---|
| **D1 Tool** | Uses a tool not in `contract.allowedTools` (even if generally allowed) | Set membership | Deterministic | **Block** |
| **D2 Path** | Touches a path outside `contract.pathScope` (though inside the outer boundary) | Glob membership after `containCheck` | Deterministic | **Block** |
| **D3 Capability** | Invokes a capability not enabled for this task / not plan-referenced | Ledger + contract | Deterministic | **Block** |
| **D4 Sequence** | Executes a plan step out of order / a step whose `dependsOn` aren't done | Plan DAG state | Deterministic | **Block or require-confirmation** |
| **D5 Budget** | Exceeds the task's slice of budget/calls | Counter vs `contract.budget` | Deterministic | **Pause + escalate** |
| **D6 Scope-expansion** | Tries to spawn subtasks / broaden objective beyond the contract | Contract diff | Deterministic | **Escalate** (needs re-approval) |
| **D7 Objective drift** | Action is in-scope structurally but not advancing the objective ("busywork"/wandering) | Semantic (Hank/LLM) vs objective + plan | **Semantic** | **Flag/finding** (+ optional require-confirmation); reconciled vs deterministic counters, never a silent block |

D1–D6 are pure functions of `(action, contract, ledgers)` — deterministic, fast, and the backbone. D7 is the semantic supplement: it can *raise* a concern for a human, but it can never *approve* on its own and its "all clear" is reconciled against the deterministic counters (same fail-safe pattern as the security monitor).

---

## 4. The conformance validator in the PDP

Non-deviation is one **validator in the PDP pipeline** (inserted right after identity/scope, before risk — see the runtime-safety plan §3.3). It runs only when the action is bound to a task (`taskId`) that has an approved contract:

```
conformance(action, contract) -> Verdict
  if !contract               -> defer (task still in backlog / no contract) → block per "no task, no tool"
  if action.tool ∉ contract.allowedTools           -> BLOCK  (D1)
  for p in action.paths: if p ∉ contract.pathScope -> BLOCK  (D2)
  if action.capability not enabled/plan-referenced  -> BLOCK  (D3)
  if plan present and step not ready (deps unmet)   -> CONFIRM/BLOCK (D4)
  if task.budgetUsed + cost > contract.budget       -> ESCALATE (D5)
  if action implies scope expansion                 -> ESCALATE (D6)
  else                                              -> ALLOW (deterministic pass)
  // D7 (objective drift) runs async in Hank's sweep, not on the hot path
```

- **Deterministic + fast:** D1–D4 are set/glob/DAG lookups — µs–ms, comfortably inside the 10 ms budget; they add no I/O beyond the already-loaded contract.
- **Fail-closed:** no contract for an executing task, or a contract hash mismatch → block.
- **Outcomes** map to the five verdicts (allow/block/require-confirmation/auto-repair/escalate). Non-deviation rarely auto-repairs (scope isn't safely repairable) — its levers are block, confirm, and escalate-for-re-approval.

---

### 4.1 Pre/post-task file attestation (the integrity backstop)
Non-deviation on the *action stream* is real-time; **file attestation is the after-the-fact proof** that a task changed only what it was authorized to — and it catches anything that slipped the live gate (Scott, 2026-07-04).

- **Pre-snapshot (task start):** on the `→ execution` transition, the core records a manifest — the hash of every file within `contract.pathScope` plus the set of files that exist. This is the task's baseline.
- **Post-compare (before `completed`):** on the `execution → validation`/`completed` path, the core re-hashes and diffs. The change set (created / modified / deleted) **must be a subset of the task's declared write scope**. Any file changed, created, or deleted **outside** the declared writes is a **deviation** — even if the write itself passed the real-time gate (defense-in-depth: the gate and the diff must both agree).
- **Interventions:** an out-of-scope change **blocks the `completed` transition**, raises a finding, and — because the pre-snapshot exists — enables **deterministic rollback** of the offending change (reversibility). An in-scope-but-unexpected change (e.g., a file the plan didn't mention) → require-confirmation.
- **Why it's powerful:** it converts "trust the gate caught every write" into "prove the end state matches the authorized scope." It also gives every task **reversibility** (the pre-snapshot is a backup), turning many irreversible mistakes into recoverable ones, and it's the concrete backstop against boundary-escape TOCTOU (attacks 8–12) and contract-swap (32): the *outcome* is checked, not just the *intent*.
- **Cost control:** hash only files under `pathScope` (not the whole disk); large binaries hashed by size+mtime+sample; snapshot is O(scope), not O(worktree).

## 5. Composition with existing code

Non-deviation wires shipped pieces together; almost nothing is greenfield:
- **Task lifecycle** (`tasks.ts`) — the contract attaches at the `backlog → analysis` approval; `proposer≠approver` already guarantees the agent can't approve/expand its own. Add a `contract` field to `Task`.
- **Boundary derivation** (`boundaryForAgent`) — `contract.pathScope ⊆ boundarySet`; non-deviation is the *task-specific narrowing* of the boundary the gate already enforces.
- **Capability ledger** (`vetting.ts`) — `contract.allowedTools` must all be enabled capabilities.
- **Planner** (`planner.ts`) — Pam's promoted drafts already produce a plan/DAG; that plan becomes `contract.plan` on approval, so D4 (sequence) reuses the existing `parentId`/`dependsOn` structure.
- **Policy engine** (`policy.ts`) — contributes to contract derivation and can add task-specific `allow/deny/ask` on `action:*`.
- **Security monitor** (`monitor.ts`) — D7 (objective drift) is a Hank sweep finding, reconciled against deterministic counters (its established fail-safe).
- **Audit** — contract set/amendment and every deviation are hash-chained audit events.
- **Token governor** (`tokens.ts`) — D5 reuses per-agent budgets, sliced per task.

---

## 6. Build increments (each with adversarial tests + success criteria)

Layered on the shipped core; each keeps CI green and ships adversarial tests proving an *off-mission* action is caught. Numbered **ND-n**; slots alongside the GX increments in the runtime-safety plan.

| Increment | Adds | Adversarial test cases (must pass) | Success criteria |
|---|---|---|---|
| **ND-1 · Scope Contract** | `ScopeContract` type; deterministic derivation at approval; attach to `Task`; hash + audit | A task's contract = `type ∩ registry ∩ policy`; `allowedTools ⊆ agent allowlist`, `pathScope ⊆ boundary`; an agent-authored ambitious task body does **not** widen the contract | Contracts derived deterministically, narrower than general grants, hash-bound; set only at human/orchestrator approval |
| **ND-2 · Tool + path conformance (D1/D2)** | Conformance validator in the PDP for tool/path scope | Task scoped to `{read_file in /proj/src}`: agent calls `write_file` → **blocked (D1 tool deviation)**; agent reads `/proj/secrets/*` (inside boundary, outside pathScope) → **blocked (D2 path deviation)**; an in-scope read → **allowed** | Off-scope tool/path actions blocked even when generally permitted; in-scope actions pass; p95 < 10 ms |
| **ND-3 · Capability + command + sequence (D3/D4)** | Capability + **command-template** scope check; plan-DAG readiness check | Invoking a capability not in the task's plan → blocked (D3); a task **not scoped for `npm`** runs a `npm_*` template → **blocked** (command not in contract) even though the agent generally may; executing plan step 5 while step 2's deps are unmet → **blocked/confirm (D4)** | Only plan-referenced capabilities/commands run; **no task triggers a command that isn't its command**; plan order/DAG enforced |
| **ND-3b · Pre/post-task file attestation** | Pre-snapshot of `pathScope` at execution start; post-compare before completion; rollback from snapshot | A task writes a file **outside its declared write scope** (even if the write passed the live gate) → **caught by the post-compare, completion blocked, change rolled back**; an in-scope task's diff ⊆ declared writes → passes | End state provably matches authorized scope; out-of-scope changes caught post-hoc + reversible; every task gains a backup |
| **ND-4 · Budget + scope-expansion (D5/D6)** | Per-task budget slice; expansion detector + governed **amendment** flow | Agent exceeds the task's call/token slice → **paused + escalated (D5)**; agent tries to spawn out-of-scope subtasks / broaden objective → **escalated, not enacted (D6)**; a human-approved amendment yields a *new* contract | Per-task budget enforced; no self-expansion; amendment requires approver ≠ agent |
| **ND-5 · Earned auto-approval (trust ledger)** | Per-task Trust record (consecutive clean runs); eligibility as a governed claim (via `memory.ts`); bounded auto-approval of low-risk narrowings; instant revocation on any deviation | A **new** task's amendment → **routes to a human** (no track record); after **N** consecutive clean runs, a **low-risk narrowing** → **auto-approved by the orchestrator**; a **scope-expansion / higher-risk** amendment → **still human** even when eligible; **one deviation** → eligibility **revoked**, counter reset, back to human | Auto-approval only after proven history; bounded to low-risk; single deviation revokes; every grant/revocation audited with provenance |
| **ND-6 · Objective drift (D7, semantic)** | Hank sweep detects in-scope-but-off-objective wandering; reconciled vs counters | An in-scope action not advancing the objective → **raised as a finding** (not silently blocked); an injected "report all on-track" while deviations exist in the audit → **discrepancy alarm** | Objective drift surfaced as findings; semantic layer can flag/confirm but never approve; injection fails safe |
| **ND-7 · Deviation + trust metrics** | Deviation catch-rate + time-to-earned-autonomy into the reliability benchmark (GX-6) | Seeded off-mission suite run with non-deviation OFF vs ON; trust-earning run over a clean-history sequence | Per-class deviation catch rate (target **≥95%** on D1–D4), false-positive rate on legitimate in-scope work (target **<3%**); trust ledger earns/revokes correctly on seeded histories |

---

## 7. Interventions & the governed escape hatch

Non-deviation must not become a straitjacket that makes agents useless. The escape hatch is **governed scope amendment**:
1. An agent that legitimately needs to do adjacent work **proposes** a scope amendment (a task update: add a tool, widen a path, add a plan step) — with a reason.
2. The amendment is a gove