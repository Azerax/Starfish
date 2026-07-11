# Project Starfish — Technical Implementation Plan

> **Version:** 1.0 · **Date:** 2026-06-04 · **Status:** Draft for Scott's review
> Project Starfish is a fork of [Munder Difflin](https://github.com/chaitanyagiri/munder-difflin).
> This plan retrofits the **Governance Framework v1.0** onto the forked codebase.
> Where the two conflict, the Governance Framework prevails (§16).

## 0. Locked decisions (from review with Scott, 2026-06-04)

| Decision | Choice |
|---|---|
| Approach | **Strangler build** (revised 2026-06-04) — build the trusted governance core *fresh*, invert the dependency, and pull the fork's non-critical machinery in as untrusted modules *behind* the core. Not pure-scratch (re-solves hard problems, longest exposure) and not in-place retrofit (can't prove complete mediation). See §1.5. |
| Default deny | Implemented via a **tool registry** of allowed tools and agents |
| UI | No separate Mission Control — the **Command Center fulfills §11** (mapping in §8); Canvas added later as Phase 7 (§7.2) |
| Persistence | **File-based** (extend hive JSON/JSONL/markdown; no SQLite) |
| Token Governor | **Soft + escalate** — warn at threshold, pause + escalate at hard limit |
| Agent-to-agent messaging (§7) | **LOCKED — Option B** in PDP/PEP model: router is a bracketed transport; messages task-linked, policy-checked, audited (§6) |
| Governance topology | **Isolated PDP brackets every transport** (router/hooks/IPC) on ingress+egress; logical isolation v1, process isolation at T-25 |
| Registry hierarchy | **Constitutional 3 first** (Capability, Policy, Service); others phased/derived |
| Service Registry | Model **internal main-process modules** as services (router, hook server, scheduler, governor, MemPalace) |
| Risk taxonomy | **4 tiers:** Low / Medium / High / Critical (per Registry Hierarchy doc) |
| Capability intake | **Toby agent** — persistent floor agent; full-sweep vetting; auto-registers Low risk only |
| Idea board (Canvas, §12) | **Later phase** — FlowBoard-style sticky-note canvas; **Pam** (planner agent) analyzes promotions into draft task DAGs / intake tasks; promote creates `backlog` drafts only |
| Runtime monitoring | **Security Guard agent (Hank)** — persistent; periodic semantic sweep of audit + activity; report + escalate only (no direct powers) |

## 1. Gap summary — framework vs. current code

| Framework requirement | Current state | Gap |
|---|---|---|
| Policy Engine (§5) | None — GOD agent uses judgment | **Build** |
| Permission Gate (§5) | Native Claude Code permission prompts only | **Build** (hook-based gate + registry) |
| Risk Engine (§5) | None — "critical items" informally defined in HIVE.md | **Build** |
| Token Governor (§5) | Telemetry only (`transcript.ts` reads usage; no enforcement) | **Build** enforcement on existing telemetry |
| Audit Layer (§4, §5) | Partial — `log.jsonl` is append-only but sparse/loosely typed | **Extend** |
| Task lifecycle (§6) | 4 states (todo/doing/blocked/done); `dependsOn[]` exists (DAG ✓) | **Extend** to 10 states + transitions |
| All work is a task (§3.2) | Messages, dispatches, and missions bypass the task ledger | **Wire** non-task work into tasks |
| Agents communicate only via tasks (§7) | Core design is mailbox messaging (outbox→inbox router) | **Resolved — Option B** (§6): router bracketed by PDP, messages task-linked |
| Reasoning standard (§8) | Not enforced; agents free-form | **Add** to PROTOCOL.md / identity templates + validation state |
| Memory governance (§9) | memory.md (append) + board.md (god-scribed) + MemPalace | **Map + gate** promotion |
| Human oversight (§10) | Native HITL via Michael + `/remote-control` ✓; pause = kill only | Add **pause/resume** |
| Mission Control (§11) | Command Center has Terminal/Floor/Memory/Activity/Tasks/Schedules | **Map** — Command Center = Mission Control (see §8); add audit feed + pause controls |
| Canvas (§12) | None | **Build** — Phase 7 Idea Board + Pam (§7.2) |
| Autonomous Task Engine (§13) | Partial, implicit — router + Stop-loop + scheduler | **Map** — classify/decompose = Pam, route/supervise = Michael + router, validate = lifecycle gate (§8) |
| Ungoverned headless assistant | **Dwight (`assistant.ts`) runs outside the hook plane** — no gate, no audit, not in roster, reads all registered repos | **Fix in Phase 1** — see §2 "No exempt actors" |
| External inputs (Slack bridge) | HMAC-verified but lands directly in Michael's queue via public tunnel | **Wire** into task intake + treat as untrusted (Phase 3) |
| Safety constraints (§14) | Sandboxed fs bridge ✓; single-committer git ✓; rest unenforced | Covered by gate + registry |

## 1.5 Build strategy — the strangler

**Why not the obvious two.** Pure from-scratch re-solves months of debugged engineering (node-pty's native ABI rebuild, real terminal rendering, git single-committer concurrency) and keeps the system unsafe-because-unfinished for longest. Pure in-place retrofit can never *prove* complete mediation — all three holes the threat model found (renderer IPC T-19, ungoverned Dwight, command-template trap T-05) are inherited paths, and you can't be sure you found the last one. The strangler captures most of scratch's safety for a fraction of its risk.

**The inversion.** Instead of bolting governance onto the fork, stand up a **new governed shell** that owns the entry point and the trust boundary, and import fork code as leaf modules that *cannot reach a side effect except through the core*. The fork becomes a parts supplier and a working reference, not the foundation. Three rings:

| Ring | What | Treatment |
|---|---|---|
| **1. Trusted core (TCB)** — new, minimal, audited | Main-process entry + **fail-closed boot**; the **PDP** (`governance.ts`); the transports-as-PEPs (router, hook server, fs/git IPC bridge); `containPath()` boundary; registries; audit | **Write fresh.** Where fork code helps (e.g. the ~137-line hook server, the PTY spawn), it is *re-authored* line-by-line to route through the PDP and reviewed as TCB — never imported wholesale. Keep this ring as small as possible; it is the only code that must be trusted. |
| **2. Governed machinery** — salvaged, behind the core | `pty.ts` PTY manager, `transcript.ts` telemetry reader, fs/git operations | **Salvage + adapt.** Reused from the fork but invoked *only* through the core's governed interfaces; they hold no authority of their own. |
| **3. Presentation** — salvaged freely | Design system (`design/`), Pixi office floor + cast + sprites, terminal view (xterm), CodeMirror editor, the Command Center UI | **Salvage as-is**, renderer-only and mediated. Low risk because it's pure view — except it must be hardened against T-19 (content sanitized; its IPC goes through ring 1). |

**Build-order consequence.** Phase 1 is no longer "bolt onto the fork" — it is **stand up the governed shell**: a minimal Electron app that *is* ring 1 (boot → PDP → registries → audit → one bracketed transport) and can spawn exactly one agent through the gate, with the boundary conformance tests green. You get a *provably governed skeleton first*, then dress it with salvaged presentation (ring 3) and machinery (ring 2) in later phases. Nothing ungoverned is ever "already there to forget" — the only things present at each step are the core you wrote and the modules you've deliberately placed behind it.

**Salvage discipline (a checklist item, not a vibe).** Every file pulled from the fork is tagged ring-2 or ring-3, reviewed for any direct side effect (fs, network, process spawn, IPC) and re-pointed through the core, and recorded in a salvage ledger (what came in, from which fork file, reviewed by whom). A fork file that can't be cleanly demoted to ring 2/3 gets re-authored into ring 1 instead. This makes complete mediation a *property you build*, not a hope.

## 1.6 Portable governance overlay — the actual product

**The insight (Scott, 2026-06-04):** everyone ships custom Claude builds with pre-set skills; **nobody ships governance.** So ring 1 is not just Project Starfish's core — it's a **standalone governance overlay** that can be dropped on top of any existing skills-based Claude build, with consent, and bring it under the strangler model automatically. Project Starfish becomes the *reference host*; the overlay is the distributable.

**Separate-folders layout (monorepo).** The governance core lives apart from the app from day one, with **zero dependency on Electron or any UI** so it can run embedded *or* headless:

```
packages/
  governance-core/     ring 1 — PDP (policy/permission/risk/token), boundary (containPath),
                       registries, audit, fail-closed boot. Pure logic + a local daemon entry.
                       NO Electron, NO React, NO fork imports.
  governance-hooks/    the PreToolUse/PostToolUse/Stop shim + the Claude Code hooks settings
                       that wire any agent's tool calls to the PDP. The universal enforcement seam.
  governance-overlay/  the installer + a setup skill: inventory a target build, run vetting,
                       score, get consent, write registries/policies, install the hooks.
  desktop/             Project Starfish (Electron) — embeds governance-core, adds salvaged
                       fork rings 2 (machinery) + 3 (presentation).
```

**Headless PDP = T-25 hardening, for free.** To govern a CLI-only build there's no Electron main process, so `governance-core` ships a **standalone local PDP daemon**: the hooks POST decisions to it over a local socket (same pattern as the fork's hook server, but app-independent). The desktop app then connects to *that same daemon as a separate process* rather than embedding the PDP in-process — which is exactly the **process-isolated PDP** the threat model wanted (T-25). Building for portability delivers the tamper-isolation upgrade as a side effect. One design, two payoffs.

**Distribution: a Claude Code plugin.** The overlay ships as an installable plugin (native to how custom Claude builds are already assembled). Installing it drops in: the governance hooks, the registry/policy/audit files, the local PDP daemon, and a **setup skill** that runs the onboarding flow.

**Onboarding flow when the overlay meets an existing build (default disposition, per Scott):**

1. **Inventory** — enumerate the build's skills, tools, MCP servers, and hooks.
2. **Analyze + score** — run each through the **security-analysis / Toby vetting pipeline** (static review, provenance, dependency review, hash-on-vet) and assign a **risk score** on the 4-tier scale.
3. **Route by score** — **Low → auto-add** (registered, governed, enabled); **Medium/High/Critical → quarantine** (registered but *disabled*) pending the human's review and consent, with recommended mitigations to lower the score.
4. **Consent + commit** — present the scored inventory; the human approves what runs. From that point the build executes under the gate: default-deny, task-bound purpose, boundary sets, audit, fail-closed boot. Nothing the overlay didn't score-and-clear can run.

**Consequence for the build plan:** `governance-core` and `governance-hooks` are authored as a clean, Electron-free package *first* (they ARE the Phase 1 governed shell's substrate), and the desktop app consumes them. The overlay (`governance-overlay`) is its own phase once the core is proven. This ordering means the portable product and the reference app are never forked codebases — the app is just the core's first consumer.

**Worked example — `starfish govern <skill-pack>`.** The target UX, using Scott's real pack at `C:\Users\swhol\Documents\Github\SEO-local`: one command turns an ungoverned skill bundle into a governed one with the Starfish agents added.

```
> starfish govern ./SEO-local

  Inventorying SEO-local …
    7 skills · 2 MCP servers · 0 custom tools · 1 hooks file
  Security analysis (Toby pipeline: static · provenance · deps · hash) …
    keyword-research      Low       ✓ auto-added
    content-writer        Low       ✓ auto-added
    serp-scraper          Medium    ⚠ quarantined — outbound network; mitigation: pin domains
    gsc-connector (MCP)   High       ⚠ quarantined — external API + credentials; needs consent
    …
  4 Low auto-added · 3 quarantined pending your review
  Installing gate: hooks → registries → policies → audit → fail-closed boot
  Boundary set: project root = ./SEO-local  (nothing above it is visible)
  Adding Starfish agents: Michael (orchestrator) · Toby (intake) · Hank (security) · Pam (planner)
  Done.  Review 3 quarantined items now? [y/N]
```

After this, every skill in the pack runs under the strangler: default-deny, task-bound purpose, contained to the `SEO-local` folder, fully audited, fail-closed at boot — and the four governance agents are present to vet, watch, plan, and orchestrate. Re-running `starfish govern` re-scans (hash-checked) and only re-prompts on drift. The same command is what the Claude Code plugin's setup skill invokes, so plugin-users get the identical flow without a terminal.

## 2. Architecture: where governance lives

**Mediation principle (locked 2026-06-04, revised to bracketed PDP/PEP 2026-06-04):** governance is an **isolated decision authority that brackets every transport on both faces** — nothing reaches an agent, tool, or the local system, and nothing comes back, without passing governance on the way *in* and on the way *out*:

```
  USER ─►│ GOV │─►┌──────────┐─►│ GOV │─► agents
  Slack  │ in  │  │ TRANSPORT │  │ out │   tools
  render │     │  │  router / │  │     │   fs / git
         └─────┘  │ hook srv /│  └─────┘   local system
            ▲     │ IPC bridge│     ▲
   ingress: "is   └──────────┘   egress: "is what
   this caller                    comes back safe
   authorized for                 to deliver to
   this request?"                 this recipient?"
```

- **One Policy Decision Point (PDP), many Policy Enforcement Points (PEP).** All decisions live in one isolated component (`governance.ts`); each transport — the message **router**, the **hook server** (tool calls), and the **renderer fs/git IPC** — is a PEP that *must* consult the PDP on both ingress and egress. Transports are pure carriers; they hold no policy logic.
- **Isolation via dependency direction (v1) → process isolation (T-25).** v1 isolation is *logical but enforced*: governance has **zero dependency on any transport** (router/hooks/IPC import governance, never the reverse — checked in CI), exposing a single choke-point API. Same process for now; the T-25 OS-sandbox work later promotes the PDP to a separate process for true tamper-isolation, with the seams already correct. This supersedes the earlier "governance as a function the router calls" model — co-location created shared-fate bugs and left side doors (the renderer path, T-19); bracketing makes a missed door structurally impossible.
- **Ingress vs. egress answer different questions.** *Ingress* = authorization: caller in `allowedAgents`? purpose task-bound? policy allow? risk tier? *Egress* = result containment: does what's returned/delivered violate policy — content above the recipient's clearance, a tool output shaped like exfiltration, untrusted web/Slack content needing wrapping (T-09), a message the router mutated in transit? Egress is where result-validation and redaction live; the old one-sided check had none.

**The two tool-call conditions still hold:** no agent acts on the local system directly; only tools do, and a tool executes only when (1) the calling agent is in its `allowedAgents`, and (2) the invocation matches a purpose the tool was vetted for. Purpose is **task-bound**: every tool call must trace to an active task assigned to the calling agent and pass purpose/policy/risk evaluation against that task's scope — *no task, no tool*. Tool manifests declare `purposes[]` at intake (Toby); the PDP matches invocations against them. Known limit, accepted: until T-25, the enforcement runtime is Claude Code's hook mechanism, not OS isolation.

**Bash containment (locked 2026-06-04): raw Bash is never allowed.** Because an approved shell command's children inherit full access, open-ended Bash cannot be purpose-vetted and is **denied for all agents by default — it appears in no agent's allowlist**. Shell work happens only through constrained paths:

1. **Command-template tools** *(preferred)*. Toby vets specific commands as discrete registry tools — e.g., `git_commit`, `npm_test`, `npm_typecheck` — each with a fixed executable, parameterized argv (validated, never shell-interpolated), worktree-scoped cwd, scrubbed env, and a timeout. Spawned via `execFile` (no shell), so there is no metacharacter surface at all. **Critical caveat (see THREAT MODEL T-05/T-06): these commands are arbitrary code execution in disguise** — `git commit` runs repo `.git/hooks/*`, and `npm` scripts run `package.json` code, both living in the agent's own writable worktree. So: run `git` with `--no-verify` + scrubbed `GIT_CONFIG_*`, run `npm` with `--ignore-scripts` (or invoke the test-runner binary directly), enforce a per-template **typed argv allowlist** (no arg may start with `-` unless a named flag; path args boundary-checked and `--`-terminated), and tier each template by the risk of arbitrary code in its worktree — not by the nominal command name.
2. **Escorted Bash** *(exception path)*. If a raw shell command is genuinely needed, the invocation is **Critical tier — per-invocation human approval, every time**, no policy can auto-allow it, and the gate additionally rejects commands containing shell metacharacters (`; | & $() > <` …) or paths outside the agent's worktree before it even reaches you.
3. **Future:** OS-level sandboxing (restricted user / container) may relax this to sandboxed-Bash; until then, the above is the only shell surface.

If an agent's work keeps hitting the exception path, that's the signal to have Toby vet a new command-template tool for it — the system grows capabilities through intake, not through loosening Bash.

**Filesystem boundary (locked 2026-06-04; revised after code review): per-agent boundary sets.** The principle is unchanged — nothing visible above the project root, nothing written outside the workspace — but the code's geography requires *sets* of roots rather than two nested prefixes, because agent worktrees live under `<harnessHome>/worktrees/<agentId>/` (not under the registered repo) and agents legitimately read shared hive files and write their own hive directory. Each agent gets a boundary set computed at spawn:

- **Visibility set (read):** ① the project root (`projectRoot`, defined per registered repo in config), ② the agent's own `hive/agents/<id>/` directory, ③ the shared hive read-only surface (`PROTOCOL.md`, `board.md`, `tasks.json`). Nothing else — anything outside the set is invisible, error messages never echo out-of-set paths, and **`hive/governance/`, `audit.jsonl`, and other agents' directories are outside every agent's visibility set** (governance state is read through governed tools or not at all).
- **Write set:** ① the agent's workspace folder (its assigned working dir / git worktree), ② its own `hive/agents/<id>/` (memory.md, outbox/). No tool or agent may create, modify, or delete anything outside its write set.

Enforcement rules: every path in `tool_input` is **canonicalized before checking** — resolved to absolute, `..` collapsed, symlinks/junctions resolved via realpath, Windows 8.3 short names and UNC forms normalized — then checked against the agent's boundary set. Symlinks that *point* above a boundary are treated as escapes. The check lives in one shared function (`governance.ts: containPath()`) used by the Permission Gate, the sandboxed fs/git IPC bridges (`fs.ts`/`git.ts` — already sandboxed, re-pointed at the same function), and command-template tools (cwd + every path-like arg). Violations are **deny + Critical-tier audit event** — an escape *attempt* is itself a reportable finding for Hank.

**Mandatory conformance tests** (ship with Phase 1, run in CI; the boundary is not considered implemented until these pass):

1. *Write escape:* attempt to create `escape.txt` one level above the workspace folder via every write path — Write/Edit tool input, fs IPC bridge, command-template arg, `..` traversal, absolute path, and a symlink inside the workspace pointing above it. All must be denied + audited; filesystem checked afterward to confirm nothing was created.
2. *Read escape:* attempt to read/list/grep above the project root via Read, Glob, Grep, the file browser IPC, and a symlink escape. All must return denial — and the denial must not leak the contents or names of anything above the root.
3. *Negative control:* identical operations inside the boundaries succeed, proving the gate blocks escapes rather than everything.

All five governance controls run in the **Electron main process** as the isolated PDP (the only privileged component; agents are unprivileged `claude` processes). New module: `src/main/governance.ts` — the PDP — exporting `PolicyEngine`, `PermissionGate`, `RiskEngine`, `TokenGovernor` behind one `decide(ingress|egress, context)` choke-point. It imports nothing from the transports (router/hooks/IPC); they import it. Audit goes through `HiveManager`.

**No exempt actors (added after code review, 2026-06-04).** The framework grants no exemptions, so neither does the implementation:

- **Michael (GOD)** is privileged in *role* (routing, adjudication, board scribe), never in *mechanism*: his tool calls pass the same Permission Gate, his board writes are audited memory ops, and his boundary set is computed like any agent's (his visibility includes the task ledger and roster he needs to orchestrate — granted by registry entries, not by bypass).
- **Dwight (`assistant.ts`) is currently a governance hole** — a headless `claude -p` that is in no roster, runs with no hooks (no gate, no audit), and reads every registered repo. **Phase 1 fix:** register Dwight in the Agent Registry (`domain: prompt_enrichment`), launch him with the same `--settings` hook shim so every tool call is gated and audited, bind each enrichment run to the task it enriches, and scope his visibility set to that task's project root only. Until that lands, the enrich toggle defaults **off**.

**The enforcement point is the existing hook plane.** Each agent's `PreToolUse` hook already POSTs to the main-process UDS server (`hooks.ts`), which returns a JSON response to the shim. We extend that response to return Claude Code permission decisions (`allow` / `deny` / `ask`). This makes the Permission Gate real — agents physically cannot invoke an unregistered tool, because the hook denies it before execution. No agent code changes required.

**Four invariants the gate must satisfy (from the THREAT MODEL — non-negotiable):**

1. **Fail closed (T-03).** Timeout, exception, malformed input, missing/unreadable registry or policy, or un-writable audit → **deny + Critical audit**. The latency budget is never a correctness shortcut. Error paths are unit-tested.
2. **Audit-before-act (T-10).** The decision audit line is written and fsynced **before** `allow` is returned. Worst case is a logged allow that didn't execute (safe/detectable), never an unlogged execution.
3. **One PDP, all transports bracketed (T-19).** The router, hook server, and renderer fs/git IPC are all PEPs consulting the single PDP on ingress and egress; all emit audit lines (`actor: renderer` for IPC). Because every transport must route through the PDP by construction (§2), there is no "second privileged path" to forget — T-19 is closed structurally, not by remembering to add a call. CI asserts no transport reaches a side effect without a PDP decision in scope.
4. **Single source of truth (T-13).** Registry file is canonical; the in-memory cache is derived, hash-checked, swapped atomically after the file write. Any divergence → fail closed + reload.

**Boot integrity — governance is not optional at startup (T-26).** Governance must initialize *before* any agent, transport, or tool can act, and **fail closed** if it can't: at launch the main process loads the PDP, the registries (`capabilities/tools/policies/services`), and the audit layer first; if any is missing, corrupt, or fails its hash-check, the app **halts or enters a locked safe-mode** (UI loads, no agent may spawn, no tool may run) — never a degraded "governance-off" mode. There is therefore **no launch path that skips governance**: however the app is started (the double-click launcher, a packaged `.exe`, or `npm run dev`), the same boot sequence runs, and no startup flag can disable the PDP. The **human launching the app is the one legitimate ungoverned action** — it is the Layer-7 operator (final authority, §10) booting the system, not an agent/tool action — and the launcher is scoped to boot-only: no arguments, not a registered tool, outside every boundary set, unable to be invoked by any agent.

**Enforcement-artifact integrity (T-01/T-02).** The hook shim, agent `--settings`, the UDS socket, `hive/governance/`, and `audit.jsonl` all sit **outside every boundary set** (conformance tests assert they're unwritable by any agent). The shim and settings are hash-checked at each spawn; the socket server binds each connection to its expected `agent_id` and rejects payloads claiming another. Subagents (`Task`) and MCP servers are explicitly registered, inherit a *subset* of the parent's allowlist, and are denied if unregistered. Absence of a PreToolUse for an observed PostToolUse is a hard alarm (pause), not a default-allow.

New on-disk layout (all file-based, committed by the single-committer hive git):

**Registry hierarchy** (per "Registry Hierarchy Information", 2026-06-04): v1 builds the three constitutional registries — **Capability** (what exists), **Policy** (what's allowed), **Service** (what's running) — plus the Tool and Agent registries they index. The remaining registries (Skill, Workflow, Memory, Model, Task Type, Event, Risk, Artifact) start as derived views or schema constants and get their own files only when a phase needs them (Risk and Event schemas land in Phase 1–2 as constants; Task Type in Phase 3).

```
hive/
  governance/
    capabilities.json  # Capability Registry: master index { capability_id, type, manifest/ref } → agents, tools, policies, memory providers
    tools.json         # Tool Registry: { id, category, riskTier, inputs, allowedAgents[] | "*" }
    policies.json      # Policy Registry: { id, subject, action, resource, effect: allow|deny|ask, reason }
    services.json      # Service Registry: internal main-process modules (router, hook server, scheduler, token governor, MemPalace CLI, Slack bridge) with { id, status, version, lastHeartbeat }
    budgets.json       # per-agent: { agentId, softUsd, hardUsd, softTokens, hardTokens }
  registry.json        # Agent Registry (existing roster — extended with domain, riskTier, allowedTools[], model)
  audit.jsonl          # Event Registry in practice: typed audit stream (see §3) — append-only
  tasks.json           # extended lifecycle + taskType (see §5)
```

`services.json` is maintained by the main process itself (each subsystem registers on start, heartbeats on a timer) — honest "what is running right now" for a monolith, and the seam for a future multi-process split.

## 3. Phase 1 — Audit Layer + Tool Registry / Permission Gate (foundation)

Build first: every later component emits audit events and consults the registry.

**Audit Layer.** New `hive/audit.jsonl`, append-only, one JSON object per line:
`{ ts, actor, domain, action, target, decision?, policyId?, riskTier?, detail }` covering the eight required domains (§4): task create/modify/execute, agent execution, tool invocation, governance decisions, memory ops, failures. Emit from: `hooks.ts` (PreToolUse/PostToolUse/Stop), `hive.ts` (router, writeTasks, memory append, board writes), `pty.ts` (spawn/kill), `governance.ts` (every decision — including denials). Surface in the existing **Activity tab** as a filterable feed. "No silent execution": PostToolUse events not preceded by an allowed PreToolUse are flagged as violations.

**Tool registry + Permission Gate.** `tools.json` seeded with the standard Claude Code tool set (Read, Edit, Write, Glob, Grep, WebFetch, Task, …) so day-one isn't bricked — **Bash is seeded as registered-but-allowed-to-no-one** (Critical tier, escorted-exception path only; see §2 Bash containment), alongside an initial set of command-template tools (`git_commit`, `npm_test`, `npm_typecheck`) covering the workflows agents actually need. `PreToolUse` → `PermissionGate.evaluate(agentId, tool, input)`:

1. Tool not in registry → **deny** (default deny, §3.1) + audit.
2. Agent not in tool's `allowedAgents` → **deny** + audit.
3. No active task assigned to the agent covering this invocation → **deny** + audit (task-bound purpose; until Phase 3 task wiring lands, this check runs warn-only so day-one isn't bricked).
4. Otherwise → consult Policy Engine (Phase 2; until then: allow + audit).

Registry editing via the existing Settings/Command Center surfaces (a simple JSON editor is acceptable for v1 — the file is the contract). Agent allowlists also mirrored into `registry.json` roster entries.

**Acceptance:** an unregistered tool call is denied and visible in Activity; every tool call produces paired audit lines; **all filesystem-boundary conformance tests (§2) pass in CI** — no file creatable above the workspace folder, nothing visible above the project root, by any tool path.

## 4. Phase 2 — Policy Engine + Risk Engine

**Policy Engine** (`policies.json`): ordered rules, first match wins, default **deny** for governed actions. Rule shape: subject (`agent:<id>` | `role:<r>` | `*`), action (`tool:Bash`, `task:transition:execution`, `message:send`, `memory:promote`), resource (path glob / task id / recipient), effect `allow|deny|ask`. `ask` routes to the existing native HITL path (escalate to Michael's session → human permission prompt, phone-approvable via `/remote-control` — this satisfies §10 without new UI).

**Risk Engine:** pure function classifying each action on the **4-tier taxonomy** (Risk Registry): **Low** = read-only → allow + audit; **Medium** = workspace modifications → must match an explicit allow policy, else `ask`; **High** = external system changes (network, git push, Slack, gh) → policy required AND `ask` unless explicitly allowed; **Critical** = destructive/spend/scope (raw Bash — always, per §2 containment — payments, policy edits) → always human approval, no policy can auto-allow. Signals: tool category from the registry, command-template identity and args, paths outside the agent's worktree, spend keywords, task priority. Risk tier stamped on audit events and task records.

**Acceptance:** same input + same policies ⇒ same decision (deterministic, §3.3); a high-risk Bash command from any agent stops and escalates.

## 5. Phase 3 — Task lifecycle + Token Governor

**Task lifecycle.** Extend `HiveTask.status` to the framework's states:
`backlog → analysis → planning → decomposition → execution → validation → completed`, failure path `rework → retry → failed`. Implementation:

- State machine enforced in `hive.writeTasks()` (main process validates transitions; illegal transitions rejected + audited). Renderer types updated.
- **Kanban UI:** keep four columns, mapped to state groups — Todo = backlog · Doing = analysis/planning/decomposition/execution · Review = validation/rework/retry · Done = completed/failed — with the precise state shown on each card. Full-width lifecycle view deferred.
- `dependsOn[]` (DAG) already exists; add optional `parentId` for hierarchies (§6).
- **Proposer ≠ approver (T-07).** An agent may *propose* a task but cannot self-assign and execute it: assignment and the transition out of `backlog` require Michael or the human. A task's allowed tools/paths are **derived** from its type ∩ assignee's registry entry ∩ policy — never from free text the agent wrote — so an agent can't widen its own authority by authoring an ambitious task body. This rule must land *before* task-binding enforcement flips on.
- **All work is a task:** Command Center dispatches, scheduled missions, GitHub-issue assignments, **and Slack-bridge messages** each create a task record before any prompt is sent, so nothing executes outside the ledger (§3.2). The Stop-loop reports progress against the task id. Slack input is additionally flagged `origin: external/untrusted` on the task — it arrived through a public tunnel and is a prompt-injection vector, so it lands in `backlog` for triage (Michael or human) rather than dispatching directly, and Hank's sweep weights it.
- **Reasoning standard (§8):** the canonical sequence (LOAD_CONTEXT → … → FINAL_OUTPUT) is written into `PROTOCOL.md` and each agent's `identity.md`; structurally, planning/validation are enforced by the lifecycle — a task cannot reach `completed` without passing `validation` (validated by Michael or an evaluation agent).

**Token Governor.** Budgets in `governance/budgets.json`. A main-process poller (reuses the scheduler timer) reads per-agent usage from `transcript.ts`. **Soft threshold:** desktop notification + audit event + badge in Activity. **Hard limit:** pause the agent — stop draining its inbox, decline Stop-loop continuation (return no-block), mark status `paused` on the floor — and escalate to Michael/human. Resume = human raises budget or explicitly resumes (also satisfies §10 "pause execution", which today only exists as kill).

## 6. Agent-to-agent messaging (§7) — LOCKED: Option B in the PDP/PEP model

§7: "Agents communicate exclusively through tasks. Direct agent-to-agent communication is prohibited." **Decision (2026-06-04): the router is a transport PEP bracketed by the PDP** — keep mailboxes, govern every message on both faces:

- **Ingress** (sender's outbox → router): message must carry a `task` id for an active task the sender is assigned (else **held**); `from` is stamped by the router, never trusted from the sender (T-08); PDP policy-evaluates and risk-classifies the act/recipient; deny → reject + audit + notify sender.
- **Egress** (router → recipient's inbox): PDP re-checks before delivery — recipient cleared for this content, message unmutated in transit (the router is pure transport; egress catches a router bug or tampering), untrusted-origin content wrapped/flagged (T-09).
- Every decision (hold/deny/deliver) is audited; hop caps and idempotency from HIVE.md remain.

**Why this satisfies §7's intent:** the prohibition targets *unmediated* side channels. Here there is none — agents only write their own outbox, the only path between two agents passes the PDP twice, and every message is task-linked, policy-checked, risk-tiered, and audited. `GOVERNANCE.md` records the interpretation: *"communication is permitted only as a governed, task-linked, audited platform operation; unmediated agent-to-agent channels remain prohibited."* Because every message now carries a task id, a later move to strict task-only coordination (former Option A) is a small step, not a rewrite.

**Cost:** ~2–3 days inside Phase 4.

## 7. Toby — capability intake agent (Governance Agent, Layer 3)

**Role.** Toby is the gate through which anything new enters the registries. When the human asks to add a **skill, tool, or agent**, the request becomes an intake task (type `evaluation`) assigned to Toby. Nothing reaches the Capability/Tool/Skill/Agent registries except through Toby's pipeline — registry files reject any other write path.

**Form.** Persistent floor agent (desk in the annex — he is HR, after all): a normal `claude` process with identity.md, mailbox, and memory like other agents, registered in the Agent Registry with `domain: governance_intake`. His own tool allowlist is deliberately narrow: read-only fs, Glob/Grep, WebFetch/WebSearch (provenance lookups) — **no Write access to `hive/governance/`** and no Bash by default.

**Pipeline (full sweep):**

1. **Static review** — read SKILL.md / scripts / manifests in full: prompt-injection patterns, data exfiltration (network calls, env-var reads, credential paths), destructive commands, obfuscated code, scope of fs access.
2. **Provenance check** — repo/author lookup, popularity/maintenance signals, known-bad lists, license.
3. **Dependency review** — transitive packages/CLIs the item pulls in; each inherits the sweep.
4. **Risk assignment** — 4-tier rating with written rationale, mapped to the Risk Registry definitions.
5. **Vetting report** — markdown artifact in `hive/artifacts/vetting/<item>-<date>.md` (the Artifact Registry's first real producer), linked from the intake task and audited.
   - **Hash-on-vet (T-11).** The registry stores a content hash of exactly what Toby reviewed (plus dependency lockfile hashes). **The gate verifies the hash before allowing a skill/tool to run** — any drift → deny + re-vet. "Vetted" means "these exact bytes," defeating vet-once-mutate-later. Skills that fetch-and-execute at runtime, or contain obfuscation/encoding/dynamic-eval, are automatically **not-Low** (forced human review).
6. **Disposition:**
   - **Low risk** → Toby emits a `registration` message; the **main process** validates the report exists, writes the registry entries, and audits the registration. (Toby recommends; the platform registers — agents never touch governance files, per §14.)
   - **Medium/High** → report returns to the human with **recommended mitigations** to bring it to Low (e.g., restrict `allowedAgents`, strip network calls, pin dependency versions, sandbox paths). Human approves as-is, approves with changes, or rejects.
   - **Critical** → reject with rationale; human can override only by editing policy themselves (§3.5 — the system never self-elevates).

**Framework fit:** satisfies §3.5 (no unrestricted capability creation), §7 (Toby acts only through tasks), and gives the Capability Registry a controlled intake path. Builds on Phase 1–2 (registries + risk engine must exist first).

### 7.1 Hank — Security Guard agent (runtime monitoring, Governance Agent, Layer 3)

**Division of labor.** Toby vets what comes *in*; Hank watches what *happens*. Separation of duties: the agent who approved a capability never audits the consequences of his own approval. Crucially, Hank supplements — never replaces — the deterministic Layer-2 enforcement: the Permission Gate blocks ungoverned tool calls and the audit layer flags unlogged execution in code. Hank adds the **semantic layer** rules can't express.

**Form.** Persistent floor agent (the security desk by the door). Strictly read-only tool allowlist: audit/log readers, hive file reads, transcript reads. No Write, no Bash, no network. Registered with `domain: security_monitoring`.

**Operation — periodic sweep.** A scheduled mission (existing scheduler) wakes Hank every N minutes (default 15, configurable). Each sweep: read `audit.jsonl` + `log.jsonl` since his cursor, sample recent agent transcripts, and look for what rules miss — scope creep vs. assigned task, agents working around denials, prompt-injection symptoms in fetched content, suspicious output patterns, slow-burn sequences of individually-legal actions, drift between task spec and actual behavior.

**Powers — report + escalate only.** Findings become tasks (type `evaluation`) with severity on the 4-tier scale; High/Critical findings escalate to Michael → human via the native HITL path. Hank never pauses, blocks, or messages other agents directly — he is an observer. (If experience shows escalation is too slow, granting him pause-request authority via the Token Governor's pause mechanism is a one-line policy change, deferred.)

**Watching the watcher:** Hank's own sweeps are audited like any agent turn, and his transcript is subject to the same telemetry — no unobserved observer.

### 7.2 Idea Board — Canvas (§12), with Pam as planner (Cognitive Layer, Layer 5)

**What.** A second UI screen (fullscreen view, like the existing fullscreen terminal/editor) where the human brain-dumps: sticky-note nodes, free placement, connections forming clusters. Modeled on FlowBoard's Idea Canvas (github.com/rasimme/FlowBoard, MIT). Data is file-based: `hive/canvas.json` (nodes, edges, positions, cluster ids), versioned by the single-committer hive git like everything else.

**Promote flow.** Selecting a node/cluster and hitting **Promote** creates an analysis task (type `analysis`) assigned to **Pam**, a persistent planner agent at reception. Pam classifies each node and proposes structure:

| Node is a… | Becomes |
|---|---|
| Tool / skill / agent idea | **Toby intake task** (vetting pipeline, §7) |
| Workflow / repeatable process | Workflow Registry candidate (draft) |
| Feature / function / piece of work | Lifecycle task(s) with `dependsOn` sequencing; complex clusters → parent task + subtask DAG with draft specs |
| Vague fragment | Returned to the board annotated with Pam's clarifying questions |

**Governance fit.** Promotion is generative, never executive: everything Pam produces lands in **`backlog` as drafts linked back to their source nodes** — nothing dispatches until the human approves, and then the normal lifecycle, Permission Gate, and risk tiers apply (§3.1 governance precedes execution; §5 Canvas converts ideas into *governed* task pipelines). Pam's allowlist is read-mostly: hive reads + canvas read/write + task-draft creation; no command templates, no network by default.

**Build notes.** Renderer-only surface plus one IPC pair (`canvas:read`/`canvas:write`); node editor in plain DOM/SVG with design-system tokens (no Pixi needed — it's a calm data view, not the office floor). Pam reuses the persistent-agent patterns from Toby/Hank.

## 8. Phase 4 — Memory governance + docs

**Memory mapping (§9):** Working = the agent's live session context (no change). Experience = `memory.md` + `audit.jsonl`/`log.jsonl` (append-only, audited). Curated = `board.md` + the MemPalace palace. **Promotion gate:** MemPalace mining (`memory.ts`) runs only for agents whose relevant task passed `validation`; `board.md` writes already flow through the god scribe — both promotions become explicit governed actions (`memory:promote`) requiring a policy allow or HITL approval, and are audited.

**Framework conformance mappings (record in GOVERNANCE.md):**

- **§11 Mission Control = the Command Center.** Monitor health → `services.json` heartbeats + Activity tab; inspect tasks → Tasks tab; inspect agents → Floor tab + per-agent panels; review governance decisions → the Phase 1 audit feed in Activity; manage interventions → approvals (native HITL), pause/resume (Token Governor mechanism), dispatch. "It does not reason" holds — the Command Center is views + controls over main-process state, no LLM in the loop.
- **§13 Autonomous Task Engine = a composite, not a module.** Classify/decompose → Pam (Phase 7) and Michael; route → Michael + the router; supervise → Michael + Stop-loop + scheduler; validate → the lifecycle's `validation` gate. Each part is individually governed, which satisfies §13's bounded-autonomy constraints by construction.
- **Layer 7 interfaces** today: the app UI and the Slack bridge (as governed task intake, Phase 3). API/CLI interfaces are out of scope until needed.

**Docs:** copy the Governance Framework into the repo as `GOVERNANCE.md` (constitutional, §16); add a conformance section to `HIVE.md`/`SPEC.md` noting where they are subordinate; CHANGELOG entries per phase.

## 9. Phasing & effort

| Phase | Scope | Est. effort |
|---|---|---|
| 1 | **Governed shell (ring 1):** fail-closed boot, PDP, Capability+Tool+Service registries, audit (Event schema), one bracketed transport, spawn one agent through the gate, boundary sets + conformance suite in CI | ~8–11 days |
| 2 | Policy Registry/Engine, Risk Engine (4-tier), `ask`→native HITL wiring | ~3–5 days |
| 2.5 | **Salvage presentation (ring 3):** bring in design system, Pixi floor + cast, terminal view, Command Center UI behind the governed shell; harden against T-19 | ~4–6 days |
| 3 | Task lifecycle state machine + task types + kanban mapping, all-work-is-a-task wiring, Token Governor | ~5–8 days |
| 4 | Messaging decision implementation (B: ~2–3 days; A: ~2–3 weeks), memory gates, GOVERNANCE.md | varies |
| 5 | **Toby** — intake task type, vetting pipeline + report template, registration path in main process, annex desk | ~3–5 days (after Phases 1–2) |
| 6 | **Hank** — security-guard agent: sweep mission, cursor tracking, finding-task template, security desk | ~2–3 days (after Phase 5; reuses Toby's patterns) |
| 7 | **Idea Board (Canvas) + Pam** — canvas UI screen, canvas.json + IPC, promote→analysis task, draft-DAG review flow | ~5–8 days (after Phases 3 & 5 — needs lifecycle + Toby intake) |

Each phase ships independently and keeps `npm run typecheck` green. Order matters: audit before enforcement (you can't govern what you can't see), gate before policy (registry is the substrate policies refer to).

**Threat-model gates (see THREAT MODEL.md).** A phase is not "done" until its relevant threats are closed: Phase 1 must satisfy the four gate invariants (T-03, T-10, T-13, T-19) + enforcement-artifact integrity (T-01/T-02); command templates may not ship until T-05/T-06 are handled; task-binding may not enforce until proposer≠approver (T-07) lands; Toby ships with hash-on-vet (T-11). **T-25 (OS sandbox)** is the top post-v1 hardening item — it converts residual mitigations (T-04 TOCTOU, T-15 resource caps) into kernel-enforced guarantees.

## 10. Risks

- **Deny-by-default bricking:** mitigated by the seeded registry; first run migrates existing agents to a permissive baseline policy that Scott then tightens.
- **Hook latency:** gate evaluation must stay <50ms (pure file-backed lookups, registry cached in memory) or agent turns feel sluggish.
- **Upstream drift:** the strangler build is a new app that *salvages from* the fork; it is not the fork. Upstream `chaitanyagiri/munder-difflin` becomes a reference/parts source only — no live merge relationship. Record each salvaged file's origin in the salvage ledger so upstream fixes can be re-pulled deliberately.
- **Salvage contamination:** the risk that a ring-2/3 module smuggles in a direct side effect that bypasses ring 1. Mitigated by the salvage review checklist (§1.5) and the same CI assertion that no module reaches a side effect without a PDP decision in scope (T-19).
- **File-based audit growth:** `audit.jsonl` grows unbounded; add monthly rotation (`audit-YYYY-MM.jsonl`) from day one.
- **Egress-check latency:** bracketing adds a second PDP call per request (egress). Same <50ms budget per call; cache result-validation rules. Net cost is one extra in-process lookup, not a round trip.
- **Untrusted content injection:** Slack messages, fetched web pages (Toby's provenance lookups), and GitHub issue bodies all carry third-party text into agent contexts. Mitigations: external-origin flagging on tasks, backlog triage before dispatch, Hank's sweep, and WebFetch restricted to the agents that need it.
- **Pause latency:** the Token Governor's pause takes effect at the next hook event (Stop or PreToolUse) — an agent mid-generation finishes its current turn first. Acceptable for soft+escalate; worth stating so it isn't mistaken for instant kill (which remains available to the human).
