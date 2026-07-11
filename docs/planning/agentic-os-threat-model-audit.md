# Agentic OS — Threat-Model Audit (Starfish questionnaire)

System audited: `C:\Users\swhol\Documents\Github\Simon\agentic-os` (Simon Scrapes' "Agentic OS"), a Claude Code wrapper: Next.js "Command Centre" + cron runtime spawn `claude -p` subprocesses; SQLite for tasks/approvals; PGLite/Postgres+pgvector for memory. Local, per-user, not containerized.

Verdict legend: **PASS** / **PARTIAL** / **FAIL** / **N/A (not built)**. T-tags map to the Starfish threat model.

---

## Gate & enforcement integrity

**1. Side effect through an un-gated path — child process / `Task` subagent / MCP tool? (T-01) — FAIL.**
The default execution mode is `bypassPermissions` / `--dangerously-skip-permissions` (process-manager.ts, cron-runtime.js `buildCronClaudeArgs`). On that path **no tool call is gated at all** — Bash, Write, subagent `Task`, and MCP tools all execute unchecked. The permission-prompt MCP is only attached when `mode !== "bypassPermissions"` (process-manager.ts ~L1338), so the seam is off exactly when it would matter. Subagents inherit the parent's bypass. There is no per-tool routing to a single seam.

**2. Absence of a decision = violation, or silent allow? (T-01/T-10) — FAIL.** Silent allow. Every permission resolver in `permission-mode.ts` hardcodes `fallback = "bypassPermissions"` and remaps `"auto" → bypassPermissions`. A missing/unknown mode resolves to *allow-everything*, with no alarm.

**3. Enforcement artifacts outside every agent's write set + integrity-hashed at spawn? (T-02) — FAIL.** The SQLite DB (`approval_requests`, `tasks`), `.command-centre/`, `settings.json`, hooks, and `.env` all live in the workspace the agent runs in, with `--add-dir <workspace>` and `Write(*)`/`Read(*)` allowed. Nothing is hashed at spawn. An agent can edit its own governing settings and the approvals DB.

**4. Pathological input / timeout / missing config — fail closed or open? (T-03) — FAIL (open).** No governance-loads-first gate. The spawner builds argv and launches regardless of whether the permission MCP, hooks, or audit are present. A missing permission tool on a bypass task is a no-op; there is no Critical audit or halt.

**5. Alternate entry point that boots before/without governance? (T-26) — FAIL.** Multiple: the raw `claude` CLI (README's `centre`/direct use), cron daemon (`start-crons.sh`), and every Next.js API route that spawns processes directly (see "Second privileged path"). None share a single governed launcher.

**6. Registry single source of truth, cache derived + hash-reconciled? (T-13) — PARTIAL/N/A.** There is no capability *registry* in the Starfish sense. Skills are discovered from `.claude/skills/` frontmatter and reconciled against `AGENTS.md` **by the agent itself, "silently"** (AGENTS.md "Skill & MCP Reconciliation"). "On disk" is the source of truth; there is no hash reconciliation, so enforced ≠ audited is possible.

---

## Code-execution & shell surface

**1. Raw shell reachable? (T-05) — FAIL (yes, first-class).** The `Bash` tool is a core capability. Under bypass it is unrestricted.

**2. "Safe" command templates → git/npm script vectors neutralized? (T-05) — FAIL.** `settings.json` allow-lists `Bash(npm run *)`, `Bash(npm install *)`, `Bash(npx *)`. These execute `package.json` scripts and arbitrary npx packages — full arbitrary-code vectors from inside the worktree. `git` hooks (`pre-commit`) are not neutralized. And the allow-list is only consulted off the bypass path.

**3. Argument smuggling / typed argv allowlist? (T-06) — FAIL.** No typed argv allowlist. Command matching is glob prefix (`Bash(git add:*)` etc.), which does not stop `--upload-pack=`, `-o ProxyCommand=`, or leading-dash filenames. Off the bypass path only; on it, moot.

---

## Authorization logic

**1. Agent creates task, self-assigns, writes own scope → self-authorizes? Proposer ≠ approver? (T-07) — FAIL.** An agent with Bash/SQLite or file access can write a `tasks` row (including `permissionMode`) or drop a `cron/jobs/*.md` file that runs with bypass. Proposer and approver are **not separated**. The `approval_requests` human gate only exists on non-bypass tasks.

**2. Scope derived from registry+type+policy, or widened by task body? (T-07) — FAIL.** A task's authority is the `permissionMode` column on its own row; there is no policy deriving allowed scope from task type. An ambitious task body runs with whatever mode is set — default bypass.

**3. Privileged actor trickable (confused deputy)? Privileged in role only, not mechanism? (T-08) — FAIL.** The orchestrator/cron path is privileged **in mechanism** (it holds bypass). Injected content in a transcript, memory entry, or cron file can steer a privileged run. The advisory `gsd-prompt-guard` scans only `.planning/` writes and **does not block**.

---

## Supply chain & capability intake

**1. Vetted capability pinned to content hash, verified at run time? (T-11) — FAIL.** Skills are plain folders synced by `update.sh`; no content-hash pin, no run-time verification. A skill can be edited, dependency-bumped, or made to fetch-and-execute later with no gate.

**2. Vetting flags obfuscation / eval / runtime-fetch as not-low-risk? (T-12) — FAIL (no vetting pipeline).** Intake is "read frontmatter, add to registry, tell the user" (AGENTS.md). No static analysis for `eval`, encoded payloads, or runtime fetch.

**3. Capability can enter registry outside vetting? (T-11) — FAIL.** Dropping a folder in `.claude/skills/` and letting the agent reconcile it *is* the intake path; `update.sh` syncs skills from upstream. Both bypass any review.

---

## Attack surface — entry points & egress

**1. Every ingress tagged untrusted + routed to triage? (T-09) — FAIL.** Ingresses: Command Centre chat/API, cron markdown, direct CLI, scheduled tasks, skill outputs, and memory/transcripts fed back into context. Cron and task execution **auto-dispatch** to a bypass `claude -p`; nothing tags input untrusted or triages it first.

**2. Network egress — default-deny? (privacy) — FAIL (default-allow).** No network confinement. `WebFetch`/`WebSearch` and many skills (DataForSEO, OpenAI/Gemini, HeyGen, Firecrawl, WordPress publish, Blotato social, Smartlead outreach) send outbound freely. The only curb is `settings.json` deny of `curl`/`wget` — off the bypass path only.

**3. Exposed endpoint authenticated + replay-guarded? (T-18) — FAIL.** The Command Centre API (69 route.ts) has **no auth middleware, no CSRF, no session check** (no `middleware.ts`, no `authorization`/`getServerSession` anywhere). Any local process (or anything reaching the port) can call these routes. A valid request does far more than enqueue an untrusted item (see next section).

**4. Secrets storage — keystore, or agent/audit-readable files? (T-14/privacy) — FAIL.** Secrets live in plaintext `.env` (9+ API keys). Worse, `GET /api/settings/env` **returns the entire `.env` body over unauthenticated HTTP**, and `PUT` rewrites it. `settings.json` deny-reads `.env` — but only off the bypass path, and not for the HTTP route at all.

---

## Second privileged path (UI / IPC)

**1. UI/IPC holds its own fs/git capability bypassing the agent gate? (T-19) — FAIL (severe).** The Next.js API layer performs privileged actions **directly, entirely outside the agent seam**: `settings/scripts/run` spawns scripts; `settings/env` reads/writes `.env`; `settings/claude-settings` and `settings/mcp` rewrite governance config; `files/upload`, `files/reveal`, `gsd/*`, `tasks/*` do direct fs and process spawns. These are not routed through any single enforcement function and are unauthenticated. This is a full second privileged path.

**2. Untrusted content rendered inert (no XSS→IPC)? (T-19) — NOT VERIFIED / likely FAIL.** The UI renders task output, terminal logs, and memory. With an unauthenticated same-origin API that can write `.env` and run scripts, any XSS in rendered untrusted content would reach those endpoints. No sanitization guarantee was found. Treat as a live finding pending review of the render components.

---

## Audit & resource integrity

**1. Decision written + fsynced before the action returns? (T-10) — FAIL.** On bypass there is no decision to write. On the non-bypass path, `approval_requests` rows are written to SQLite (WAL) but there is no log-before-side-effect guarantee for the tool execution itself. A crash can leave executed-but-unlogged actions.

**2. Audit append-only + tamper-evident (hash-chained)? (T-14) — PARTIAL→FAIL.** An `audit_events` table exists (identity store), INSERT-only, "history never deleted" — but it covers **team membership/grant** actions only, **not agent tool calls**, and has **no hash chain**. Plain rows, editable by anyone with DB access. Tool decisions live in mutable cron log files.

**3. Disk full / audit unwritable — deny or run ungoverned? (T-14) — FAIL (ungoverned).** No check couples audit-writability to execution. Logging is best-effort; execution proceeds regardless.

**4. Rate limits / quotas? (T-15) — FAIL (none).** No `rateLimit`/`quota`/`throttle` anywhere in `command-centre/src`. Cron interval jobs, task floods, outbound calls, and worktree growth are unbounded (only per-job timeout + "no duplicate run" exist).

---

## Memory audit

**1. Agent writes "facts" straight to shared memory, or evidence→gate→knowledge? (T-16) — FAIL.** The ingest pipeline (`memory/ingest.ts`) is `sha256 → chunk → embed → upsert`. Scope is validated; **there is no governance gate, no claim/knowledge distinction.** Content becomes recallable memory directly.

**2. Promoted knowledge records provenance + bound to validated task? (T-16) — PARTIAL.** There is capture-block provenance (turn id + transcript path) for chunks — but it's a *source pointer*, not a promotion decision bound to a validated task. Nothing is "promoted"; everything indexed is live.

**3. Promoted entries revocable, source-task-failure flagged? (T-16) — FAIL.** No promotion → no revocation model. Stale chunks are pruned on re-index by hash, not revoked by governance.

**4. Embeddings only from approved knowledge, never raw conversation/agent output? (memory architecture) — FAIL.** Embeddings are built from **raw session transcripts and file contents** (indexer + `memory:import-sessions` summarizes and indexes past Claude Code sessions). This is exactly the poisoning surface Starfish's evidence-first model is meant to prevent.

**5. Claim approval tiered by confidence/stakes? (T-21) — N/A.** No claim-approval layer exists.

---

## Filesystem boundary & OS residual

**1. TOCTOU/symlink-swap between path check and open()? In-boundary symlink components rejected? (T-04) — FAIL/N/A.** Boundary enforcement relies on Claude Code's own path handling; there is no platform-level symlink-component rejection or atomic check-then-open. Off the bypass path the deny globs are string patterns (TOCTOU-prone); on the bypass path there is no check.

**2. Agents OS-confined (user/container/namespace)? (T-25) — FAIL.** Not containerized; agents run as the user, same privileges as the Command Centre. All guarantees rest on the agent honoring hooks/flags — which bypass disables.

---

## Human factor & crown jewels

**1. Human asked too often (fatigue)? allow/deny/ask ratio tracked? prompts decision-ready? (T-21) — FAIL.** The system's answer to fatigue is to default to bypass (no asks at all). No allow/deny/ask health metric. Approval prompts (`summarizeInput`) show tool + truncated input — no who/why/risk/diff.

**2. Who can edit policy/registry/budget — Critical, human-only, audited, always-interrupt? (T-23) — FAIL (severe).** `settings.json`, `.env`, `.mcp.json`, and skill definitions are ordinary files. An agent with Bash/Write (default) can edit them, and the unauthenticated `settings/*` API can too. Editing governance config is **not** a gated, human-only, audited action.

---

## Two meta-questions

**A. Which controls depend on the agent behaving?** Essentially all of them. The permission modes, `settings.json` allow/deny, branch-guard, and prompt-guard are enforced by (or bypassable via) the same CLI process the agent drives, and the default mode disables the seam entirely. Controls that fail the "only holds if the agent cooperates" test: the permission seam, the deny-list, both PreToolUse hooks, the skill-reconciliation intake, memory ingest, and the filesystem boundary. The one control not dependent on agent cooperation is the *human approval gate* — which is off by default.

**B. Where is the TCB, and how small? — Large and entangled (a finding in itself).** The trusted computing base spans: the whole Next.js Command Centre app (69 unauthenticated privileged API routes), the SQLite DB (agent-writable), `permission-mode.ts` + `process-manager.ts` + `cron-runtime.js`, `settings.json`, `.env`, all hooks, every installed skill, and the memory pipeline. There is no minimized, isolated, import-nothing governance core. Everything trusted is also agent-reachable.

---

## Bottom line for Starfish

Against the threat model this platform is **fail-open by default** with a **large, agent-reachable TCB** and a **second, unauthenticated privileged path** (the Command Centre API). It cannot be governed by in-place patching.

The one genuinely useful asset: Claude Code's `--permission-prompt-tool` is a real universal PEP hook, and a `tasks` concept already exists to anchor "no task, no tool." Starfish's path is a **strangler wrap** that:
1. registers the Starfish PEP as `--permission-prompt-tool` on **every** spawn and **removes all bypass defaults**;
2. makes the spawner **fail closed** if the PEP/audit/registry aren't reachable and integrity-hashed;
3. **puts the Command Centre API behind the same seam** (or removes its direct fs/git/spawn powers) and authenticates it;
4. moves governance state (DB, settings, .env, audit) **out of the agent-writable workspace** into a keystore + append-only hash-chained log;
5. replaces silent skill reconciliation with a **hash-pinned, vetted registry**;
6. gates memory so **only governance-approved, provenance-stamped knowledge is embedded** — never raw transcripts.

Until at least (1)–(4) exist, importing Starfish *into* Agentic OS means Starfish must treat the entire existing platform as untrusted and mediate it from outside — not integrate as a peer.
