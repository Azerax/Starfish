# Starfish Import Assessment — Simon Scrapes' "Agentic OS"

**Subject system:** `C:\Users\swhol\Documents\Github\Simon\agentic-os` — a Claude Code project template ("Agentic OS", by Simon Scrapes / Agentic Academy).
**Assessed against:** Starfish import checklist (enforcement seam, capabilities, work model, identity, audit, deployment).
**Date:** 2026-07-04. Starfish is a fork of Munder Difflin.

---

## What the system actually is

Not a bespoke platform — it's a **Claude Code wrapper**. The runtime is the Claude Code CLI (`claude -p`), spawned as headless subprocesses by two hosts:

- **Command Centre** — a Next.js app (`command-centre/src`) at `localhost:3000`. Chat/task API routes spawn `claude` via `process-manager.ts`.
- **Cron runtime** — `command-centre/src/lib/cron-runtime.js` runs markdown jobs from `cron/jobs/` headlessly, also via `claude -p`.

State: **SQLite** (`better-sqlite3`) for tasks/approvals; **PGLite / Postgres+pgvector** for memory. Local-first, per-user, Node-based, not containerized.

This matters for Starfish: **you are not patching a platform, you are wrapping a CLI you don't control.** The enforcement primitives you get are the ones Claude Code exposes.

---

## 1. Enforcement seam & architecture

**Is there a pre-execution interception point? — YES, but it's Claude Code's, not the platform's.**
Two mechanisms exist:
- `--permission-prompt-tool` MCP bridge (`command-centre/scripts/permission-prompt-mcp.cjs`). When wired, every tool call routes to this MCP server, which writes a `pending` row to `approval_requests` in SQLite and **blocks until a human decides** (`waitForDecision` polls every 500ms). This is a genuine allow/deny/ask seam.
- `PreToolUse` hooks (`gsd-prompt-guard.js`, `branch-guard.js`).

**Can the seam be made non-bypassable? — NO, as currently built.** Critical findings:
- The default permission mode is literally `bypassPermissions`. `permission-mode.ts` hardcodes `fallback: PermissionMode = "bypassPermissions"` in every resolver, and `"auto"` is remapped to `bypassPermissions`.
- **Cron always runs `--dangerously-skip-permissions`** (`buildCronClaudeArgs`, cron-runtime.js line ~2445) for root workspace jobs; client jobs use `--permission-mode dontAsk`. Either way the human seam is skipped.
- `process-manager.ts`: `permissionMode = cronJobSlug ? "bypassPermissions" : (taskRow.permissionMode || "bypassPermissions")`. The permission-prompt MCP is **only attached when `mode !== "plan" && mode !== "bypassPermissions"`** (line ~1338). So on the default path, the seam isn't even loaded.
- The two `PreToolUse` hooks are **advisory only**. `gsd-prompt-guard.js` header: *"Action: Advisory warning (does not block)."* `branch-guard.js` "nudges." Neither returns a deny.

Net: the seam exists but is **opt-in and off by default**. The common paths (cron, tasks) execute unmediated.

**Can governance load first and fail closed? — NO.** Nothing halts or safe-modes if the permission MCP, hooks, or audit are missing/corrupt. The spawner simply proceeds with whatever flags it built; a missing permission-prompt tool on a bypass task changes nothing because it was never going to be consulted. There is no "policy engine present or refuse to run" gate.

**Dependency direction — entangled; strangler required.** Permission logic (`permission-mode.ts`, `identity/permissions.ts`, `task-permissions.ts`) lives *inside* the Next.js app and imports platform types (`@/types/task`, `./store`). There is no isolated, import-nothing governance core. An in-place patch would spread through the app; a **strangler wrap is the correct approach** — which aligns with your existing Starfish strangler decision.

---

## 2. Capabilities & side effects

**Capability inventory:** Bash (full shell), Read/Write/Edit, WebSearch/WebFetch, git, npm/npx, plus a large MCP + skill surface (HeyGen, DataForSEO, Firecrawl, OpenAI/Gemini image, WordPress publishing, Blotato social posting, Smartlead outreach, YouTube, etc.).

**Side-effect surface — very large.** Filesystem writes, network egress, raw shell, **spending money** (each cron run burns Claude plan credits, $0.01–$2.00; external APIs are metered), **sending messages / publishing** (social posts, WordPress live posts, cold-outreach campaigns).

**Raw shell reachable? — YES, directly.** The `Bash` tool is a first-class capability. `settings.json` allow-lists `Bash(npm run *)`, `Bash(npm install *)`, `Bash(npx *)` — npm scripts and npx are arbitrary-code vectors. There is a `deny` list (`rm`, `curl`, `wget`, `ssh`, `scp`, read `.env`/`*.pem`/`*.key`) — **but `settings.json` deny rules are not enforced under `--dangerously-skip-permissions`.** So the deny list protects only the non-bypass path, which is not the default.

**Filesystem / governance-state boundary — poor.** Governance state (SQLite DB, `.command-centre/`) sits in the workspace, agent-visible, and tasks run with `--add-dir <workspace>` and `Read(*)` allowed. Governance state is **not isolated from the agents it governs**.

---

## 3. Work model & agents

**Task concept — YES (good anchor).** A real `tasks` table (SQLite) with `permissionMode`, `model`, `projectSlug`, `cronJobSlug`; plus the GSD project framework and cron jobs. "No task, no tool" has something concrete to bind to.

**Ingress — multiple, some auto-dispatching.** Command Centre chat/API routes; cron markdown jobs (`cron/jobs/`); direct `claude` CLI; scheduled tasks. Cron **auto-dispatches headlessly with bypass** — no triage step.

**Agent topology.** Orchestrator = the Claude Code session / Command Centre; sub-agents via the Task tool; cron spawns *independent* headless `claude -p` processes. There is **no central bracketed router** — each spawn configures its own permissions.

**Coordination.** No inter-agent message bus to bracket; parallelism is independent OS processes. Simpler to reason about, but also means each process is its own trust domain.

---

## 4. Identity, authority & human oversight

**Caller identity / spoofing.** An identity layer exists (`identity/permissions.ts`: teams, roles `owner > admin > member`, memberships, grants, `requireTeamRole`) — **but it gates the multi-user memory platform, not agent tool calls.** For tool execution, "authority" = whatever permission mode is written on the task's SQLite row. **Confused-deputy risk:** anything that can write a task row (or a cron file) sets the execution authority. Cron files are plain markdown on disk.

**Root of trust.** The human at the Command Centre approval UI (`approval_requests` + `permission-picker.tsx`) — *only on non-bypass tasks.* The cron/bypass path has no human root of trust.

**Human-in-the-loop — exists but easily bypassed.** `approval_requests` + picker give real ask/allow/deny with a human, and `process-manager` can kill processes (pause/abort). But unattended tasks give **no ask surface at all**.

**Spend / destructive-action authority — no hard gate.** Nothing requires a human for money or irreversible actions. Cron spends credits and can publish/send outreach unattended.

---

## 5. Data, audit & privacy

**Append-only, tamper-evident audit? — Partial, and not tamper-evident.** There is an `audit_events` table (identity store) written INSERT-only ("history preserved, never deleted"), and grant/revoke write their audit event atomically. **But:** (a) it covers *team membership/grant* actions, not agent tool calls; (b) it's plain Postgres rows with **no hash chain / cryptographic tamper-evidence** — mutable by anyone with DB access. Tool-call decisions land in `approval_requests` rows and cron log files (best-effort, mutable). **No tamper-evident, log-before-action trail for tool execution exists today.**

**Secrets.** Plaintext `.env` (9+ API keys), agent-visible on the filesystem. Protected only by `settings.json` deny-reads — which the bypass path ignores.

**Egress / consent.** Local-first by default (PGLite, localhost), but skills call many external APIs. **No consent gate** on egress; it happens inside skill execution.

---

## 6. Deployment & scale

Local, per-user (Windows/Mac/Linux), Node/Next.js + Claude Code CLI, **not containerized**. Cron daemon for scheduling; multi-client workspaces; optional hosted Postgres for team memory. OS-sandboxing not present. Throughput is personal / small-team — so **approval fatigue is exactly why they default to bypass.** Any Starfish integration that forces human approval must solve fatigue (risk-tiered auto-allow) or it will be turned off.

---

## Verdict: Strangler wrap, and there is a clean insertion point

**In-place patch is not viable** (governance entangled in the app; you don't own the CLI). **Strangler wrap is correct** and matches your existing Starfish architecture.

The single most important finding: **Claude Code's `--permission-prompt-tool` is a real, universal PEP hook.** Starfish's PDP/PEP can register *as* that tool, so every tool call from every spawn routes to Starfish for allow/deny/ask — mediated by Starfish's policy engine, logged to Starfish's provenance-first audit before the side effect. The seam you need already exists; today it's just wired to a thin SQLite prompt and disabled by default.

To make it enforceable you must:
1. **Force the seam on every spawn.** Remove `--dangerously-skip-permissions` and the `bypassPermissions` defaults from `process-manager.ts` and `cron-runtime.js`; set Starfish PEP as `--permission-prompt-tool` unconditionally.
2. **Fail closed.** The spawner must refuse to launch `claude` if the Starfish PEP MCP isn't reachable (governance-loads-first).
3. **Convert advisory hooks to blocking**, or fold their checks into the PEP.
4. **Move governance state out of the agent-visible workspace** (or a separate store the `--add-dir` doesn't cover).
5. **Add Starfish's tamper-evident audit** for tool-call decisions (the existing `audit_events` table is membership-only and un-chained).
6. **Risk-tier auto-allow** to beat approval fatigue, with human gate reserved for spend / irreversible / egress.

---

## Five integration strategies, scored /100

**Option A — PEP-as-permission-prompt-tool, fail-closed spawner (strangler).** Register Starfish PDP/PEP as `--permission-prompt-tool` on every spawn; strip all bypass flags; spawner refuses to launch without the PEP. — **92/100.** Uses the one non-bypassable hook the CLI offers; minimal change to their app; matches your strangler + PDP/PEP model. Weakness: still trusts the CLI to honor the flag.

**Option B — Wrapper-launcher chokepoint.** Replace direct `claude` spawns with a Starfish launcher binary that is the *only* way to start an agent; it injects PEP config, audit, and identity, and is the enforced entry point. — **88/100.** Truly non-bypassable if you also block raw `claude`. Heavier; must intercept every spawn site (`process-manager`, `cron-runtime`, `run-claude-text-prompt`, `capture.ts`).

**Option C — OS-sandbox + egress broker.** Run each agent in a container/sandbox with no direct network; all side effects (shell, network, spend) go through a Starfish broker. — **80/100.** Strongest containment and solves the agent-visible-secrets problem. But large lift on a per-user local Windows setup; contradicts their zero-friction ethos.

**Option D — In-place patch of `permission-mode.ts` + hooks.** Flip defaults to deny, make hooks blocking, add audit in the app. — **55/100.** Fast, but entangled, fragile to their upstream `update.sh` (which re-syncs system files and would clobber you), and no isolated core.

**Option E — Fork Agentic OS under Starfish governance.** Vendor the whole thing inside Starfish, govern at import time. — **45/100.** Maximum control, but you inherit their entire maintenance surface and lose upstream updates; highest ongoing cost.

**Proceeding recommendation: Option A as the spine, borrowing B's launcher discipline for the spawn sites and C's egress broker for money/publish/outreach actions specifically.** That gives a non-bypassable, fail-closed seam with risk-tiered human gates only where they matter — importable without forking, and resilient to their `update.sh` because Starfish lives outside their synced system files.
