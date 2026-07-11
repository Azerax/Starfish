# Agentic OS — Security & Memory Hardening Review

*A private review for the maintainers. The goal is to tighten the system, not to alarm — most findings are natural consequences of a fast-moving, single-user-first design, and each has a concrete fix.*

Scope of what was read: the Command Centre app (`command-centre/src`), the cron runtime, the `.claude/` hooks and settings, and the memory subsystem (`command-centre/src/lib/memory`). The system is a Claude Code wrapper: a Next.js "Command Centre" and a cron daemon spawn `claude -p` subprocesses; SQLite holds tasks and approvals; PGLite/Postgres+pgvector holds memory. It runs locally, per-user, un-containerized.

Severity: **Critical** (fix before shipping to anyone but yourself) / **High** / **Medium** / **Note**.

---

## Executive summary

There is a real permission seam available — Claude Code's `--permission-prompt-tool` MCP bridge (`command-centre/scripts/permission-prompt-mcp.cjs`), which blocks a tool call until a human decides. The problem is that **it is off on the default path**. Every resolver in `permission-mode.ts` falls back to `bypassPermissions`, cron hard-codes `--dangerously-skip-permissions`, and the permission MCP is only attached when the mode is *not* bypass. So the everyday paths — cron jobs and queued tasks — run with no gate at all.

Two structural issues compound this:

1. **A second, unauthenticated privileged path.** The Command Centre exposes ~69 API routes that perform filesystem, git, `.env`, and process-spawn actions directly, outside the agent seam, with no authentication. One route returns the entire `.env` (all API keys) over plain HTTP.
2. **The trusted computing base is large and agent-writable.** Settings, the approvals DB, `.env`, hooks, and skills all live inside the workspace the agent can write to. Almost every control depends on the agent choosing to cooperate.

The memory subsystem is well-engineered at the storage layer (clean scope isolation, hybrid search, sensible reranking) but has **no curation gate**: raw files, transcripts, and imported past sessions are embedded directly, with no claim/knowledge distinction, no conflict resolution, and no revision history. A dedicated section below compares it to a wiki-style model and proposes a hybrid.

The single highest-leverage change: **make the permission seam mandatory and fail-closed, and put the Command Centre API behind it.** Everything else is downstream of that.

---

## 1. Gate & enforcement integrity

**1.1 Un-gated side-effect paths — Critical.** On the default `bypassPermissions` path, no tool call is checked — Bash, Write, `Task` subagents, and MCP tools all execute unmediated. The permission MCP is attached only when `mode !== "plan" && mode !== "bypassPermissions"` (`process-manager.ts` ~L1338), i.e. never on the default. Subagents inherit the parent's bypass.
*Fix:* attach the permission-prompt tool on **every** spawn; delete the `--dangerously-skip-permissions` branches in `process-manager.ts` and `cron-runtime.js`; make "no explicit mode" resolve to *ask*, not *allow*.

**1.2 Missing decision = silent allow — Critical.** `permission-mode.ts` hardcodes `fallback = "bypassPermissions"` in every resolver and remaps `"auto" → bypassPermissions`. An unknown/missing mode grants everything, with no alarm.
*Fix:* invert the default to the most restrictive mode; treat an unrecognized mode as a hard error, not a permissive fallback.

**1.3 Enforcement artifacts are agent-writable — High.** The SQLite DB (`approval_requests`, `tasks`), `.command-centre/`, `settings.json`, the hooks, and `.env` sit in the workspace, which runs with `--add-dir <workspace>` and `Write(*)`. Nothing is integrity-checked at spawn. An agent can edit its own approvals table or its own settings.
*Fix:* move governance state out of the agent-writable tree (separate dir the `--add-dir` doesn't cover, or a small local service); hash-check the settings/hooks at spawn and refuse to launch on mismatch.

**1.4 Fail-open on error/missing config — High.** There is no "governance loads first or we don't run" check. The spawner builds argv and launches regardless of whether the permission MCP, hooks, or audit exist.
*Fix:* a pre-spawn assertion that the permission tool, audit sink, and settings hash are all present and valid; otherwise abort with a logged Critical.

**1.5 Alternate entry points — High.** Agents can be launched by the raw `claude` CLI, the cron daemon, and directly by API routes that spawn processes. These do not share one governed launcher, so hardening one path doesn't cover the others.
*Fix:* funnel all spawns through a single launcher module that is the only place `claude`/scripts are started, and that always injects the seam + audit.

**1.6 Skill "registry" is disk, reconciled by the agent — Medium.** Skills are discovered from `.claude/skills/` frontmatter and reconciled into `AGENTS.md` by the agent "silently" (AGENTS.md, "Skill & MCP Reconciliation"). There is no hash reconciliation, so what is enforced and what is documented can drift.
*Fix:* a signed/hashed registry as the source of truth; the on-disk folder is validated against it, not the other way around.

---

## 2. Code-execution & shell surface

**2.1 Raw shell is first-class — High (by design, but unbounded under bypass).** The `Bash` tool is a core capability and is unrestricted on the default path.

**2.2 "Safe" templates are arbitrary-code vectors — High.** `settings.json` allows `Bash(npm run *)`, `Bash(npm install *)`, `Bash(npx *)`. These run `package.json` scripts and fetch-and-run arbitrary npx packages; `git` hooks (`pre-commit`) inside a worktree are not neutralized. And the allow-list is only consulted off the bypass path.
*Fix:* disallow `npx` and bare `npm install` from agent context; run git with `core.hooksPath=/dev/null` (or `-c` overrides) for agent-initiated commands; pin/whitelist scripts.

**2.3 No typed argv allowlist — Medium.** Command matching is glob-prefix (`Bash(git add:*)`), which does not stop argument smuggling (`--upload-pack=`, `-o ProxyCommand=`, leading-dash filenames).
*Fix:* parse argv and validate against a typed allowlist per binary rather than prefix-matching a string.

---

## 3. Authorization logic

**3.1 Agents can self-authorize — Critical.** An agent with Bash/Write (the default) can insert a `tasks` row — including its `permissionMode` — or drop a `cron/jobs/*.md` file that runs with bypass. Proposer and approver are the same actor.
*Fix:* the `permissionMode` and any scope column must be set only by the trusted host, never derivable from agent-writable input; separate "propose a task" from "approve/authorize a task."

**3.2 Scope comes from the task body, not policy — High.** A task's authority is just the `permissionMode` on its own row; there is no policy deriving allowed actions from task *type*. A more ambitious task body simply runs with whatever mode is set.
*Fix:* derive allowed scope from a policy keyed on task type + caller, independent of the free-text body.

**3.3 Confused-deputy exposure — High.** The orchestrator/cron path is privileged *in mechanism* (it holds bypass), so injected content in a transcript, a memory entry, or a cron file can steer a privileged run. The `gsd-prompt-guard` hook only scans `.planning/` writes and is **advisory — it does not block**.
*Fix:* the privileged actor should be privileged in role only; every actual side effect still goes through the seam with its true origin recorded.

---

## 4. Supply chain & capability intake

**4.1 No run-time pin on vetted skills — High.** Skills are plain folders synced by `update.sh`; there is no content-hash pin verified at run time, so a skill can be edited, dependency-bumped, or made to fetch-and-execute after the fact.
*Fix:* pin each skill to a content hash recorded in the registry; verify at load.

**4.2 No adversarial vetting — Medium.** Intake is "read frontmatter, register, tell the user." There is no scan for `eval`, encoded payloads, or runtime fetch, and no rule that these are automatically not-low-risk.
*Fix:* a static-analysis gate at intake that flags obfuscation/eval/fetch and blocks auto-registration.

**4.3 Intake can be skipped — Medium.** Dropping a folder in `.claude/skills/` and letting the agent reconcile it is itself the intake path; `update.sh` also syncs skills. Both bypass any review.
*Fix:* the only way into the registry is the vetting pipeline; unregistered folders are ignored, not auto-adopted.

---

## 5. Attack surface — ingress, egress, secrets

**5.1 Ingress auto-dispatches without triage — High.** Ingresses include the Command Centre chat/API, cron markdown, the direct CLI, scheduled tasks, skill outputs, and memory/transcripts fed back into context. Cron and task execution auto-dispatch straight to a bypass `claude -p`; nothing marks input untrusted or triages it first.
*Fix:* treat every ingress as untrusted; route to a backlog/triage step rather than auto-executing.

**5.2 Egress is default-allow — High.** No network confinement. `WebFetch`/`WebSearch` and many skills (DataForSEO, OpenAI/Gemini, HeyGen, Firecrawl, WordPress publishing, Blotato social posting, Smartlead outreach) send outbound freely. The only curb is a `curl`/`wget` deny that applies off the bypass path only.
*Fix:* default-deny egress with an allowlist of approved endpoints; route "spend money / publish / send outreach" actions through an explicit broker with a human gate.

**5.3 Secrets in plaintext, and exposed over HTTP — Critical.** Secrets live in a plaintext `.env` (9+ keys). `GET /api/settings/env` returns the **entire `.env` body over unauthenticated HTTP**, and `PUT` rewrites it. The `settings.json` deny-read of `.env` applies only off the bypass path and not to the HTTP route at all.
*Fix:* move secrets to an OS keystore or at minimum never serve them over HTTP; if the settings UI must show keys, mask them and require an authenticated, audited action to reveal.

---

## 6. Second privileged path (the Command Centre API)

**6.1 The API holds its own fs/git/spawn powers, unauthenticated — Critical.** The Next.js API layer performs privileged actions directly, entirely outside the agent seam and with **no auth, no CSRF, no session** (there is no `middleware.ts`, and no `authorization`/`getServerSession` anywhere under `app/api`). Examples: `settings/scripts/run` (spawns scripts), `settings/env` (reads/writes `.env`), `settings/mcp` and `settings/claude-settings` (rewrite governance config), `files/upload`, `files/reveal`, `gsd/*`, `tasks/*` (direct fs + spawns). Anything that can reach the port — including a malicious page via the browser, or any local process — can drive these.
*Fix:* put the whole API behind authentication and CSRF protection; route every privileged action through the same single enforcement + audit function the agent seam uses, tagged with its true origin; bind the dev server to `127.0.0.1` only.

**6.2 Untrusted content → XSS → privileged IPC — High (verify).** The UI renders task output, terminal logs, memory, and commit messages. Combined with a same-origin, unauthenticated API that can write `.env` and run scripts, any XSS in rendered untrusted content reaches those endpoints. No sanitization guarantee was found in the render path.
*Fix:* render all untrusted content inert (escape/sanitize); add auth so a forged same-origin request can't act; audit the render components specifically.

---

## 7. Audit & resource integrity

**7.1 No log-before-action guarantee — High.** On bypass there is no decision to log. On the gated path, `approval_requests` rows are written to SQLite (WAL) but there is no guarantee the decision is durably written *before* the side effect returns, so a crash can leave executed-but-unlogged actions.
*Fix:* write-and-fsync the decision before releasing the action.

**7.2 Audit is neither comprehensive nor tamper-evident — High.** An `audit_events` table exists (identity store), INSERT-only and "never deleted" — but it covers **team membership/grant** actions only, **not agent tool calls**, and has **no hash chain**. It is plain rows, editable by anyone with DB access. Tool decisions otherwise live in mutable cron log files.
*Fix:* one append-only, hash-chained audit log covering every tool decision and every privileged API action; detect edits/deletions of past lines.

**7.3 Audit-unwritable ⇒ runs ungoverned — Medium.** Nothing couples audit writability to execution; if the disk fills or the log can't be written, execution proceeds.
*Fix:* deny execution when the audit cannot be written.

**7.4 No rate limits or quotas — Medium.** No `rateLimit`/`quota`/`throttle` anywhere in `command-centre/src`. Cron intervals, task volume, outbound calls, and worktree growth are unbounded (only a per-job timeout and "no duplicate run" exist).
*Fix:* per-actor quotas (tasks/hr, messages/min, outbound count, worktree size) with a circuit breaker.

---

## 8. Filesystem boundary & OS confinement

**8.1 TOCTOU / symlink exposure — Medium.** Boundary enforcement relies on Claude Code's path handling; there is no platform-level rejection of in-boundary symlink components or atomic check-then-open. Off the bypass path the deny globs are string patterns (TOCTOU-prone); on it there is no check.
*Fix:* reject symlink components in agent-writable paths; use `openat`-style atomic checks where feasible.

**8.2 No OS confinement — High.** Agents run as the user with the same privileges as the Command Centre; nothing is containerized. Every guarantee rests on the agent honoring hooks/flags, which bypass disables.
*Fix:* run agents as a restricted user or in a container/namespace so the kernel enforces the boundary regardless of agent behavior.

---

## 9. Human factor

**9.1 Fatigue "solved" by defaulting to no asks — High.** The current answer to approval fatigue is bypass — the human is never asked. There is no allow/deny/ask health metric, and the approval prompt (`summarizeInput`) shows tool + truncated input, not who/why/risk/diff.
*Fix:* keep the seam on but tier it — auto-allow low-risk, ask only on spend/irreversible/egress; make prompts decision-ready; track the allow/deny/ask ratio.

**9.2 Governance files are agent-editable — Critical.** `settings.json`, `.env`, `.mcp.json`, and skill definitions are ordinary files an agent with Bash/Write (default) can change, and the unauthenticated `settings/*` API can too. Editing governance config should be the most protected action in the system; today it is one of the least.
*Fix:* make policy/registry/secret edits human-only, authenticated, audited, always-interrupt actions that no agent can perform.

---

## 10. Deep dive: the shared memory system, and a wiki-style comparison

### 10.1 What is actually built

The storage layer is genuinely good and worth keeping. Per source, the pipeline is:

`sha256 → skip-if-unchanged → upsert source → chunk → embed (BGE-M3, 1024-dim) → upsert chunks → prune stale chunks → record an index_jobs row`.

Retrieval is a scoped hybrid search: vector + keyword, fused with Reciprocal Rank Fusion, then a three-stage rerank (`reranker.ts`): **authority** (a per-path-prefix weight snapshotted at index time), **recency** (exponential decay, 14-day half-life, floor 0.7; undated chunks don't decay), and the fused similarity. Scope isolation is strong: a `visibility` of `private | client | team | system` with DB CHECK constraints, scope columns denormalized onto every chunk so the leak-proof WHERE never has to JOIN, and a dedicated no-leak test suite over the real filter. Team sharing is the `team` visibility on hosted Postgres.

That is a solid *recall* engine. The gap is that it is **only** a recall engine — there is no knowledge-integrity layer above it.

### 10.2 The integrity gaps

- **No claim/knowledge distinction.** `ingest.ts` embeds content directly. `SourceType` includes `transcript` and `session`, and `memory:import-sessions` summarizes and indexes past Claude Code sessions. So **raw conversation and agent output become recallable "memory" with no gate.** Anything that lands in an indexed file or a transcript is, in effect, an assertion the system will later retrieve and act on. This is the primary poisoning surface.
- **No conflict resolution.** Dedup is by `source_path + content_sha256` — i.e. *the same file*. Two different files (or two sessions) asserting contradictory facts both get embedded and both are recallable; which one surfaces is decided by the **ranking heuristic (recency × authority), not by truth.** The newer or higher-weighted contradiction wins retrieval, silently.
- **No revision history.** Re-indexing a source prunes its old chunks (`ingest.ts` L245) and replaces them. There is no diff, no prior-version retention, no rollback — the previous state is simply gone.
- **Provenance is a pointer, not a warrant.** Chunks carry a capture-block provenance (turn id + transcript path). That tells you *where text came from*, but it is not a record that a human or a validated process *approved* the claim, and there is no way to revoke a claim whose source later proves wrong.
- **No curation surface.** There is no notion of a canonical entry per topic, no human edit/merge, no "this supersedes that." Everything indexed is live and equal.

### 10.3 How a wiki-style memory differs

A wiki is the opposite design philosophy — curation-first instead of capture-first:

| Dimension | Agentic OS memory (capture-first) | Wiki-style memory (curation-first) |
|---|---|---|
| Unit of memory | Opaque embedded chunk of whatever file/transcript | Canonical page per topic, human-readable |
| How something enters | Automatic: index every file/session | Deliberate edit, attributable to an author |
| Contradictions | Coexist; ranking picks a winner at query time | Reconciled by an editor into one coherent statement |
| Dedup basis | Same file path + hash | Same *topic* (semantic merge into one page) |
| History | Overwrite on re-index; prior state lost | Full immutable revision history + diff + rollback |
| Provenance | Source path + capture turn | Author + edit summary per revision |
| Bad/false entry | Stays until the source file changes | Reverted; vandalism visible and traceable in history |
| Retrieval | Semantic/vector recall over everything | Title/link/search over curated canonical text |
| Trust model | Trust the ranking to surface the right thing | Trust the curation; retrieval is transparent |

The wiki model's strengths are exactly the current gaps: contradictions are resolved not deferred, every change is attributable and reversible, and a false "fact" is a revertible edit rather than a permanently embedded chunk. Its weaknesses are exactly where the current system is strong: wikis need human labor, scale poorly, go stale, and have no semantic recall or automatic recency weighting.

### 10.4 The synthesis worth building

Neither pure model is right; the fix is to put a thin wiki-like **knowledge layer** in front of the existing embedding engine, so the two halves play to their strengths:

1. **Evidence vs. knowledge.** Keep indexing raw files/transcripts, but tag them `evidence` — retrievable for context, but never treated as settled fact.
2. **A curated knowledge store** of canonical entries (one per topic), each with: the statement, its provenance (which task/evidence/agent), a confidence/stakes tier, and a full revision history.
3. **A promotion gate.** A claim becomes knowledge only by passing a gate — auto-approve low-stakes, human-approve high-stakes — bound to a validated task, and recorded in the audit log. This is where the wiki's "deliberate edit" discipline lives.
4. **Embed only the knowledge layer.** Vector search runs over approved, canonical entries — never raw conversation — which removes the poisoning surface while keeping semantic recall.
5. **Revocation.** If a source task later fails validation, its promoted knowledge is flagged and pulled, with the revocation audited — the wiki "revert," made programmatic.
6. **Conflict handling at promotion time**, not query time: a new claim that contradicts an existing canonical entry forces a reconcile (supersede + keep history), rather than silently out-ranking it later.

This keeps everything good about the current engine (scope isolation, hybrid search, reranking) and adds the one thing it lacks: a trustworthy boundary between "something was said" and "the system believes this."

---

## 11. Prioritized remediation

**Do first (Critical):**
1. Make the permission seam mandatory on every spawn; remove all bypass defaults; default to *ask*.
2. Authenticate the Command Centre API, bind it to localhost, and stop serving `.env` over HTTP.
3. Make governance files (settings, `.env`, registry) human-only and non-agent-writable.
4. Separate proposer from approver so an agent cannot set its own permission mode.

**Do next (High):**
5. Route every privileged action — agent *and* API — through one enforcement + audit function; make the audit append-only and hash-chained.
6. Fail closed: refuse to launch if the seam/audit/settings-hash aren't valid.
7. Default-deny egress; broker spend/publish/outreach behind a human gate.
8. Neutralize npm/npx/git-hook vectors; move to a typed argv allowlist.
9. Confine agents at the OS level (restricted user/container).

**Then (Medium):**
10. Add a knowledge-integrity layer over memory (section 10.4): evidence vs. knowledge, promotion gate, embed only approved knowledge, revocation.
11. Add rate limits/quotas and a circuit breaker.
12. Hash-pin and adversarially vet skills at intake; close the "drop a folder" path.
13. Reject symlink components in agent paths; tighten TOCTOU windows.

The through-line: today most controls hold only while the agent cooperates, and the trusted computing base is large and agent-reachable. Shrinking that base — one mandatory seam, one audit log, governance state the agent can't touch, and a curated memory boundary — is what turns this from a capable assistant into a defensible one.
