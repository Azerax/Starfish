# Simon.md — Case Study: Importing Starfish into Agentic OS Without Breaking It

**Subject:** `C:\Users\swhol\Documents\Github\Simon\agentic-os` (Simon Scrapes' "Agentic OS" — a Claude Code wrapper: Next.js Command Centre + cron runtime spawning `claude -p`; SQLite tasks/approvals; PGLite/Postgres+pgvector memory).
**Importing:** Starfish governance (fork of Munder Difflin) — PDP/PEP, provenance-first audit, governed memory (evidence→claims→governance→knowledge), strangler architecture. Starfish External is built (Waves 0–5, 359 tests) and v0.11.1 is shipped, so every component named below already exists on the Starfish side.
**Sources:** `agentic-os-security-hardening-review.md` (SR-x.x), `agentic-os-threat-model-audit.md` (T-xx), `agentic-os-starfish-import-assessment.md` (IA).
**Status:** PLAN ONLY — no changes made. Date: 2026-07-04.

---

# Part 1 — The Challenge

The audits found a system that is **fail-open by default**: every resolver falls back to `bypassPermissions`, cron hard-codes `--dangerously-skip-permissions`, an unauthenticated 69-route API forms a second privileged path (it serves `.env` over HTTP), governance state is agent-writable, and memory embeds raw transcripts ungated. Nearly every threat-model question came back FAIL.

The trap is that the obvious fix — turn every gate on — **destroys the product**. Agentic OS's value *is* unattended operation: cron jobs publishing at 3am, headless tasks, zero-friction skills, an upstream `update.sh` that re-syncs system files. The maintainers defaulted to bypass precisely because approval fatigue killed the seam. So the challenge has hard constraints:

- **C1 — No fork.** `update.sh` re-syncs upstream system files; anything Starfish places inside them gets clobbered. Starfish must live *outside* the synced tree (IA Option E rejected, 45/100).
- **C2 — Unattended must stay unattended.** Cron jobs must still run headlessly. A seam that stalls a 3am job waiting for a human is a seam that gets turned off (IA §6).
- **C3 — We don't own the CLI.** Enforcement primitives are limited to what Claude Code exposes: `--permission-prompt-tool`, hooks, settings. The one universal hook is the permission-prompt MCP (IA verdict).
- **C4 — Fatigue is a threat, not an inconvenience.** T-21: if the human is asked too often, the human disables governance. Risk-tiering is a correctness requirement.
- **C5 — Local Windows, per-user, uncontainerized.** OS confinement is a later hardening layer, not a prerequisite (SR-8.2).
- **C6 — The UI must keep working.** Closing the unauthenticated API (SR-6.1) can't break the Command Centre's own pages calling it.
- **C7 — Wire constraint.** Provider tool names can't contain dots — Starfish already maps `fs.read` ↔ `fs__read`; the PEP registered as a permission-prompt MCP must use underscore wire names.

**One-line statement of the challenge:** insert a mandatory, fail-closed enforcement seam and a governed memory boundary into a system whose entire design philosophy is "never ask," without the user noticing anything except new approval prompts on genuinely dangerous actions.

**Strategy spine (from IA scoring):** Option A — Starfish PEP as `--permission-prompt-tool` (92/100) — reinforced with Option B's launcher chokepoint (88/100) for the spawn sites and Option C's egress broker (80/100) for spend/publish/outreach only.

---

# Part 2 — The Steps

Twelve steps, ordered so each one is independently shippable and reversible. Per the working rule, every step lists 5 options scored /100; the winner is marked ✅.

### Step 0 — Baseline capture & no-break harness

*Fixes nothing directly; makes every later step provable.* Record what "working" means before touching anything: inventory every spawn site (`process-manager.ts` ~L1338, `cron-runtime.js` `buildCronClaudeArgs` ~L2445, `run-claude-text-prompt`, `capture.ts`), every cron job, every skill, every API route the UI actually calls; capture golden-path transcripts of representative runs.

| # | Option | Score |
|---|---|---|
| 1 | ✅ Shadow-mode harness: replay recorded cron/task runs against each change; PEP in log-only mode first | **90** |
| 2 | Manual smoke-test checklist per change | 55 |
| 3 | Full E2E test suite written up front for their app | 70 (right idea, weeks of cost on code we don't own) |
| 4 | Rely on their existing tests | 30 (they don't cover governance paths) |
| 5 | No baseline, fix-forward | 15 |

**No-break note:** shadow mode means every step below first runs in "observe and log, allow everything" — behavioral diffs are detected before enforcement begins.

### Step 1 — Single governed launcher (the chokepoint)

*Fixes SR-1.5, T-26 (alternate entry points).* Create `starfish-launch` — a wrapper that is the only way `claude` starts. It injects the PEP flag, audit context, identity tag (origin: chat|cron|api|cli), and integrity checks. Patch the 4 spawn sites to call it; shim the raw `claude` CLI on PATH.

| # | Option | Score |
|---|---|---|
| 1 | ✅ Node launcher module + PATH shim for raw CLI; spawn sites call it via one-line patch each | **88** |
| 2 | Monkey-patch `child_process.spawn` globally in the Next.js app | 60 (catches everything but fragile, invisible, breaks on Node upgrades) |
| 3 | OS-level: rename real `claude` binary, replace with wrapper | 72 (survives update.sh but breaks Claude Code self-updates) |
| 4 | Ask maintainers to upstream a launcher hook | 40 (right long-term, no control over timeline) |
| 5 | Document "always use the launcher" as convention | 20 (conventions aren't enforcement) |

**No-break note:** the launcher passes through all existing flags unchanged in shadow mode; the only observable difference is a log line.

### Step 2 — PEP on every spawn, fail-closed, default-ask

*Fixes SR-1.1, 1.2, 1.4 (Critical); T-01, T-03, T-10.* Starfish PDP/PEP registers as `--permission-prompt-tool` unconditionally. Remove `--dangerously-skip-permissions` and every `bypassPermissions` fallback; unknown/missing mode = hard error. Launcher refuses to spawn if the PEP MCP, audit sink, or settings hash is unreachable (governance-loads-first). Advisory hooks (`gsd-prompt-guard`, `branch-guard`) fold into the PDP as blocking rules. PEP wire names use underscores (C7).

| # | Option | Score |
|---|---|---|
| 1 | ✅ Starfish PEP as permission-prompt MCP on every spawn; fail-closed pre-spawn assertion | **92** (IA Option A — the one universal hook the CLI offers) |
| 2 | Keep their SQLite prompt tool, harden it in place | 55 (in-place patch; entangled, clobbered by update.sh — IA Option D) |
| 3 | PreToolUse hooks made blocking as the primary gate | 50 (hooks are per-config files inside the synced tree; weaker coverage than the MCP seam) |
| 4 | Proxy the Anthropic API layer and gate there | 65 (catches everything incl. CLI misbehavior, but brittle against protocol changes and sees intents, not tool semantics) |
| 5 | Trust settings.json allow/deny as the gate | 25 (ignored under bypass; agent-writable) |

**No-break note:** ships in shadow mode (PEP answers "allow" to everything, logs all). Enforcement flips per-origin in Step 3, only after the risk-tier policy exists.

### Step 3 — Risk-tiered policy engine (the anti-fatigue contract)

*Fixes SR-9.1, T-21 — and makes C2 survivable.* This ships **with** Step 2's enforcement flip, never after. PDP policy: **Tier 0** auto-allow (read, list, in-workspace edits on task branches); **Tier 1** auto-allow + audit (git commit, npm run of pinned scripts); **Tier 2** ask-human (spend, publish, outreach, `.env`/settings access, out-of-workspace writes, new egress domains); **Tier 3** always-deny (governance-file edits by agents, raw curl/wget, secrets read). Track allow/deny/ask ratio as a health metric; prompts show who/why/risk/diff.

| # | Option | Score |
|---|---|---|
| 1 | ✅ Static tier policy keyed on tool+argv+origin+task-type, human gate only Tier 2 | **90** |
| 2 | Ask on everything, tune down from observed fatigue | 45 (guarantees the seam gets disabled week one — repeats their failure) |
| 3 | LLM-judged risk per call | 55 (adaptive but non-deterministic; an unauditable gate is a bad gate; ok later as advisor) |
| 4 | Per-cron-job standing pre-approvals ("this job may publish to WordPress") | 78 (strong for C2; fold into Option 1 as scoped grants rather than standalone) |
| 5 | Time-boxed session approvals ("allow publishes for 1h") | 60 (fatigue-friendly but scope-creeps; acceptable as a Tier-2 convenience) |

**No-break note:** cron keeps running because its known actions are Tier 0/1 or covered by scoped standing grants (Option 4 folded in); only *new* dangerous behavior interrupts.

### Step 4 — Governance state and secrets out of agent reach

*Fixes SR-1.3, 9.2, 5.3 (Critical); T-02, T-14, T-23.* Move the approvals/tasks DB, Starfish policy, registry, and audit log to a directory outside every `--add-dir` (e.g. `%LOCALAPPDATA%\Starfish\gov\`). Hash-check `settings.json`, hooks, and `.mcp.json` at spawn; refuse to launch on mismatch. Secrets leave plaintext `.env` for Windows Credential Manager (DPAPI), injected as env vars at spawn by the launcher — never readable as a file.

| # | Option | Score |
|---|---|---|
| 1 | ✅ Out-of-workspace gov dir + spawn-time hash check + DPAPI/Credential Manager secrets | **88** |
| 2 | Keep files in place, add file-ACL denies for the agent user | 50 (agents run as the same user — ACLs can't distinguish; only works after Step 11's OS confinement) |
| 3 | Small local gov service (localhost daemon) owning all governance state | 80 (cleanest trust boundary; more moving parts on a per-user Windows box — good v2) |
| 4 | Encrypt .env in place, key in the launcher | 55 (key reachable by the agent that can read the launcher) |
| 5 | Read-only bind of governance dir into workspace | 40 (Windows support poor; agent still reads policy it shouldn't need) |

**No-break note:** the app reads tasks/approvals through a thin adapter pointing at the new location; `.env`-consuming code sees identical env vars — it never knows the file is gone.

### Step 5 — Close the second privileged path (Command Centre API)

*Fixes SR-6.1 (Critical), 6.2; T-18, T-19.* Bind dev server to `127.0.0.1`. Add auth middleware: a session token minted at Command Centre startup, held by the UI, required on every `/api/*` call; CSRF protection. Delete `GET /api/settings/env` returning the raw `.env` body (UI gets masked keys; reveal = authenticated, audited, Tier-2 action). Every privileged route (fs, git, spawn, settings) calls the same PDP decision function the agent seam uses, tagged `origin=api`. Render task output/logs/memory/commit messages inert (escape/sanitize) so XSS can't reach the API.

| # | Option | Score |
|---|---|---|
| 1 | ✅ Next.js middleware.ts (token + CSRF) + PDP call inside a shared `authorize()` helper used by privileged routes + output sanitization | **87** |
| 2 | Reverse proxy in front of :3000 doing auth | 68 (no app changes, but same-origin XSS still bypasses it; pair-with, not instead-of) |
| 3 | Rip out privileged routes, force everything through agent tasks | 58 (purest single-seam, but breaks the UI's direct file/settings features — violates C6) |
| 4 | Localhost binding only, no auth | 35 (any local process and any XSS still drives it) |
| 5 | Per-route bespoke auth checks | 45 (69 routes; guaranteed drift; middleware or nothing) |

**No-break note:** the UI is the only client; it gets the token automatically at boot. update.sh may clobber `middleware.ts` — Step 12's sentinel detects and restores it.

### Step 6 — Authorization: proposer ≠ approver, scope from policy

*Fixes SR-3.1 (Critical), 3.2; T-07.* `permissionMode` and scope become host-set only: the PDP derives a task's authority from **task type + origin + policy**, never from the row the agent wrote or the free-text body. Task creation by agents lands in `proposed` state; promotion to runnable is a host/human action (auto for Tier-0 task types). Cron file changes are treated as proposals too: the launcher runs a cron job only if its content hash matches the registered, approved hash.

| # | Option | Score |
|---|---|---|
| 1 | ✅ Policy-derived scope + proposed→approved task lifecycle + hash-registered cron jobs | **89** |
| 2 | Make the tasks DB unwritable by agents, keep modes on rows | 62 (stops direct writes but not API-mediated ones; scope still data not policy) |
| 3 | Sign task rows (HMAC by host key) | 74 (good integrity primitive; fold into Option 1 for the DB adapter rather than standalone) |
| 4 | Human approves every task creation | 40 (fatigue; breaks C2) |
| 5 | Drop agent task-creation entirely | 30 (breaks orchestration functionality) |

**No-break note:** existing cron jobs get their current hashes registered as approved at migration time — day-one behavior identical; only *edits* to them now require re-approval.

### Step 7 — Egress broker: default-deny network, human-gated spend/publish/outreach

*Fixes SR-5.2; T-09 egress half; IA "no consent gate."* All outbound goes through a Starfish broker with a per-skill endpoint allowlist (DataForSEO, OpenAI, WordPress host, etc. — enumerated from the skills that exist). Three action classes always Tier-2 (ask or scoped standing grant): **spend** above a per-run budget, **publish** (WordPress live, Blotato social), **outreach** (Smartlead). WebFetch/WebSearch stay open for reads but are logged with domains.

| # | Option | Score |
|---|---|---|
| 1 | ✅ PDP-level egress policy (gate WebFetch/MCP/skill calls at the seam) + per-skill domain allowlist + Tier-2 broker for spend/publish/outreach | **84** |
| 2 | OS firewall rules per agent process | 58 (agents run as the user — per-process rules on Windows are weak until Step 11) |
| 3 | HTTP(S) proxy env-forced on spawned processes, allowlist at proxy | 76 (strong; some SDKs ignore proxy vars — pair with Option 1 in v2) |
| 4 | Trust skill authors' declared endpoints | 35 (unverified declarations) |
| 5 | Block all egress, whitelist per human request | 48 (safe but breaks half the skills on day one — C2 violation) |

**No-break note:** the allowlist is seeded from 30 days of shadow-mode egress logs (Step 0), so every domain the system legitimately uses is pre-approved before enforcement.

### Step 8 — Shell surface hardening

*Fixes SR-2.2, 2.3; T-05, T-06.* Now that the seam sees every Bash call: deny `npx` and bare `npm install` from agent context; `npm run` allowed only for scripts hash-pinned at task start; agent-initiated git runs with `-c core.hooksPath=NUL`; replace glob-prefix matching with a typed argv allowlist per binary (parse argv; reject `--upload-pack=`, `-o ProxyCommand=`, leading-dash filenames, redirection into governance paths).

| # | Option | Score |
|---|---|---|
| 1 | ✅ Typed argv allowlist in the PDP for git/npm/node + git-hook neutralization + npx/npm-install deny (Tier-2 override available) | **86** |
| 2 | Keep glob prefixes, add a blocklist of known-bad flags | 52 (enumerate-badness always loses) |
| 3 | Replace Bash with a curated command palette (no raw shell) | 60 (strongest, but breaks legitimate dev workflows — C2/C6) |
| 4 | Sandbox each Bash call in a container | 66 (right end-state, blocked by C5 until Step 11) |
| 5 | LLM review of each command string | 45 (non-deterministic gate) |

**No-break note:** shadow logs from Step 0 enumerate every command pattern actually used; the allowlist is generated from observed-legitimate usage, so existing workflows pass on day one.

### Step 9 — Provenance-first audit: hash-chained, log-before-action, fail-closed, quota'd

*Fixes SR-7.1–7.4; T-10, T-14, T-15.* One append-only, hash-chained audit log (in the Step-4 gov dir) covering every PDP decision — agent tool calls **and** privileged API actions — with true origin. Decision is written and fsynced *before* the PEP releases the action. Audit unwritable ⇒ PEP answers deny. Per-actor quotas (tasks/hr, asks/min, outbound calls, spend/day, worktree GB) with a circuit breaker that flips the actor to ask-only.

| # | Option | Score |
|---|---|---|
| 1 | ✅ Starfish provenance log (already built) as the sink: hash chain, fsync-before-release, deny-on-unwritable, quotas in PDP | **91** |
| 2 | Extend their `audit_events` table | 50 (membership-only schema, mutable rows, no chain, agent-reachable DB) |
| 3 | Windows Event Log as sink | 55 (tamper-resistant-ish but hard to chain/query; fine as a mirror) |
| 4 | Remote/cloud append-only log | 70 (best tamper-evidence; violates local-first ethos, adds network dependency to the hot path) |
| 5 | Best-effort async logging | 25 (recreates the exact T-10 failure) |

**No-break note:** fsync adds single-digit ms per decision; only Tier-2 asks involve a human wait, which was already the design.

### Step 10 — Supply chain: hash-pinned skill registry with vetting

*Fixes SR-4.1–4.3; T-11, T-12, T-13.* The Starfish registry becomes the source of truth for skills: each skill pinned to a content hash, verified at load; unregistered folders in `.claude/skills/` are ignored, not adopted. Intake pipeline: static scan (eval, encoded payloads, runtime fetch, obfuscation ⇒ automatically not-low-risk), human approve, hash-pin, register. `update.sh` skill syncs land in a staging area and re-enter through intake. The agent's "silent reconciliation" of AGENTS.md is retired.

| # | Option | Score |
|---|---|---|
| 1 | ✅ Hash-pinned registry (Starfish-side) + static-analysis intake gate + staging for upstream syncs | **88** |
| 2 | Signature-based (skills signed by trusted authors) | 62 (no signing ecosystem exists upstream to lean on) |
| 3 | Read-only skills directory, human copies files in | 58 (blocks the drop-a-folder path but no vetting, and update.sh fights it) |
| 4 | Full dynamic sandbox-execution vetting of each skill | 72 (best detection; heavy — good v2 addition for Tier-2 skills) |
| 5 | Trust upstream, scan quarterly | 35 (window of exposure between scans) |

**No-break note:** all currently installed skills are scanned, then grandfathered in with their current hashes — nothing stops working; only future changes go through the gate.

### Step 11 — Memory governance: evidence → claims → knowledge

*Fixes SR-10 entire section; T-16, T-21 memory half.* Keep their storage/recall engine (scope isolation, hybrid search, RRF, reranking — it's good). In front of it, the Starfish knowledge layer (already the Starfish memory architecture): raw files/transcripts indexed as **evidence** (retrievable, labeled untrusted, never fact); canonical **knowledge** entries per topic with provenance, confidence/stakes tier, full revision history; a **promotion gate** (auto for low-stakes, human for high-stakes, bound to a validated task, audited); embeddings for *belief-forming* retrieval come only from the knowledge layer; **revocation** flags and pulls knowledge whose source task later fails; conflicts reconciled at promotion time (supersede + history), not at query time by rank.

| # | Option | Score |
|---|---|---|
| 1 | ✅ Hybrid per SR-10.4: evidence tier + curated knowledge store + promotion gate + knowledge-only embeddings + revocation | **93** |
| 2 | Pure wiki: curation-only, drop auto-indexing | 55 (loses semantic recall; human labor doesn't scale — SR-10.3's own critique) |
| 3 | Keep capture-first, add trust-score weighting to ranking | 48 (still lets ranking pick truth; poisoning surface remains) |
| 4 | Stop indexing transcripts entirely, files only | 60 (removes the worst surface but no integrity layer; loses legitimate session recall) |
| 5 | Quarantine tier: new chunks unsearchable until human bulk-review | 65 (a decent interim; becomes a rubber-stamp queue at scale) |

**No-break note:** recall quality is preserved because evidence remains retrievable for *context* — only "what the system believes" narrows to promoted knowledge. Existing indexed corpus is grandfathered as evidence, not deleted.

### Step 12 — OS confinement, update.sh resilience, cutover

*Fixes SR-8.1, 8.2; T-04, T-25, T-26 residue.* (a) Run agent processes as a separate restricted Windows user (or sandbox/container where available) so the kernel — not agent goodwill — enforces the Step-4 boundary; reject symlink components in agent-writable paths. (b) A **sentinel**: on every launch and after every `update.sh`, hash-verify the touched integration points (spawn-site patches, middleware.ts, settings) and restore/alert on drift — this is what makes the whole import survive upstream syncs. (c) Cutover: flip enforcement per-origin (chat → api → cron), one week soak each, shadow-diff clean before the next.

| # | Option | Score |
|---|---|---|
| 1 | ✅ Restricted-user agents + sentinel hash-restore for update.sh + staged per-origin cutover | **85** |
| 2 | WSL2/container confinement for agents | 74 (stronger isolation; Windows filesystem interop pain for their workflow — v2) |
| 3 | Skip confinement, rely on Steps 2–9 | 58 (acceptable interim; leaves T-25 open — the audits' through-line says don't stop here) |
| 4 | Big-bang cutover, all origins at once | 40 (any regression takes down everything simultaneously) |
| 5 | Windows AppContainer/job objects per spawn | 68 (elegant, poorly documented territory, high implementation risk) |

---

# Part 3 — Trial and Error

No changes have been made; this section pre-registers the failures the shadow/pilot phases are *expected* to surface, from the audits and from constraints C1–C7 — each with the planned adjustment. These are the places a naive import breaks the product.

**T&E-1. Cron stalls at 3am.** First enforcement flip on cron: a job hits a Tier-2 ask with nobody awake; the job times out; the user's instinct is to disable the seam (exactly how bypass became the default upstream). → *Adjustment already in plan:* Step 3 Option-4 scoped standing grants ("this job may publish to WordPress ≤ N posts/run"); asks queue with a deadline-degrade rule — expire to **deny + notify**, never allow.

**T&E-2. update.sh clobbers the integration.** Upstream sync overwrites a patched spawn site or middleware.ts; system silently reverts to ungoverned. → Step 12 sentinel: fail-closed check at launcher level — if integration hashes don't verify, spawns refuse until restored (auto-restore from Starfish-held copies). The launcher itself lives outside the synced tree (C1), so the chokepoint survives even when its patches don't.

**T&E-3. Fail-closed turns into can't-work.** PEP MCP crashes or gov dir is locked (OneDrive sync, antivirus) ⇒ nothing spawns ⇒ user rage. → Health-check + auto-restart on the PEP; a **read-only degraded mode** (Tier-0 reads allowed, all writes/egress denied) instead of total halt; explicit alert with one-click restore.

**T&E-4. Approval fatigue anyway.** Shadow logs show the tier policy would ask 40×/day — too many. → The allow/deny/ask ratio metric (Step 3) is a launch gate, not a dashboard: enforcement doesn't flip until the projected ask-rate is under ~5/day, achieved by widening Tier-1 auto-allow+audit rather than weakening Tier-2.

**T&E-5. Argv allowlist false-positives.** Typed allowlist rejects a legitimate exotic git/npm invocation used by a skill. → Deny-with-reason includes a one-click "propose rule" flow; shadow phase (Step 8) generates the initial allowlist from observed usage precisely to shrink this class.

**T&E-6. Latency at the seam.** 500ms polling in the existing prompt bridge and fsync-before-release add per-call latency; heavy Bash-looping tasks slow visibly. → Replace polling with event/long-poll in the Starfish PEP; batch Tier-0 decisions with a per-task decision cache (same tool+argv-class ⇒ cached allow, still audit-logged).

**T&E-7. Secrets migration breaks a skill.** A skill reads `.env` directly from disk rather than from env vars. → Shadow phase flags every `.env` file-read; those skills get a shim (launcher-injected env) and the file-read becomes Tier-3 deny only after the flagged list is empty.

**T&E-8. Knowledge-only embeddings feel dumber.** Users notice recall misses because "the thing I said last week" is evidence, not knowledge. → Retrieval interface presents two labeled lanes (knowledge = believed; evidence = context, untrusted). Low-stakes auto-promotion is tuned up until perceived recall matches baseline; the gate's *point* is that high-stakes beliefs are curated, not that recall shrinks.

**T&E-9. Windows Credential Manager friction.** DPAPI works per-user; cron running as the Step-12 restricted user can't read the owner's credentials. → Secrets are read by the **launcher** (owner context) and injected into the child env — the restricted agent user never touches the store. Ordering note discovered here: Step 4 must be designed with Step 12's user split in mind from day one.

**T&E-10. API auth breaks the UI in odd corners.** Some Command Centre pages call routes from web workers/SSE where the token header wasn't attached. → Shadow phase runs auth in log-only mode (log missing-token calls, allow) until the log is silent; only then flip middleware to enforce. Same pattern as the PEP: observe → close.

**T&E-11. Proposer/approver deadlock.** Orchestrator legitimately creates subtasks mid-run; if promotion requires a human, multi-agent flows stall. → Tier-0/1 task *types* auto-approve on creation (policy, not human); only task types carrying Tier-2 capabilities queue for approval. "No task, no tool" holds; "no human, no task" was never the rule.

**T&E-12. XSS sanitization mangles output.** Escaping breaks legitimate rich rendering (ANSI logs, markdown task output). → Sanitize with an allowlist renderer (markdown-it + DOMPurify-class) rather than blanket-escaping; snapshot-test the render corpus captured in Step 0.

---

# Part 4 — End Results

**Functionality preserved (the C-constraints, verified by the Step-0 harness):**

- Cron jobs run unattended, same schedules, same outputs; dangerous *new* behavior interrupts, known-good behavior doesn't (C2, T&E-1).
- All grandfathered skills work; `update.sh` still syncs upstream — through staging + sentinel instead of silently (C1).
- Command Centre UI unchanged for the user except: masked keys in settings, approval prompts that now show who/why/risk/diff, and a new approvals/audit view.
- Memory recall preserved via the two-lane interface; the corpus is migrated, not discarded.

**Audit scorecard — target state after Step 12** (was: FAIL on nearly all; SR severities in brackets):

| Area | Finding | Was | Becomes | Via step |
|---|---|---|---|---|
| Gate integrity | Un-gated side-effect paths (T-01) [Crit] | FAIL | PASS | 1, 2 |
| Gate integrity | Missing decision ⇒ silent allow (T-01/T-10) [Crit] | FAIL | PASS | 2 |
| Gate integrity | Enforcement artifacts agent-writable (T-02) [High] | FAIL | PASS | 4 |
| Gate integrity | Fail-open on error (T-03) [High] | FAIL | PASS | 2 |
| Gate integrity | Alternate entry points (T-26) [High] | FAIL | PASS | 1, 12 |
| Gate integrity | Registry not source of truth (T-13) [Med] | PARTIAL | PASS | 10 |
| Shell | Raw shell unbounded (T-05) [High] | FAIL | PASS (tiered) | 2, 3, 8 |
| Shell | npm/npx/git-hook vectors (T-05) [High] | FAIL | PASS | 8 |
| Shell | Argument smuggling (T-06) [Med] | FAIL | PASS | 8 |
| Authorization | Self-authorization (T-07) [Crit] | FAIL | PASS | 6 |
| Authorization | Scope from task body (T-07) [High] | FAIL | PASS | 6 |
| Authorization | Confused deputy (T-08) [High] | FAIL | PASS | 2, 3, 6 |
| Supply chain | No hash pin (T-11) [High] | FAIL | PASS | 10 |
| Supply chain | No vetting (T-12) [Med] | FAIL | PASS | 10 |
| Supply chain | Intake skippable (T-11) [Med] | FAIL | PASS | 10 |
| Surface | Ingress auto-dispatch (T-09) [High] | FAIL | PASS | 6 (proposals) |
| Surface | Egress default-allow [High] | FAIL | PASS | 7 |
| Surface | API unauthenticated (T-18) [Crit] | FAIL | PASS | 5 |
| Surface | Secrets plaintext + over HTTP (T-14) [Crit] | FAIL | PASS | 4, 5 |
| Second path | API bypasses seam (T-19) [Crit] | FAIL | PASS | 5 |
| Second path | XSS→IPC (T-19) [High] | UNVERIFIED | PASS | 5 |
| Audit | No log-before-action (T-10) [High] | FAIL | PASS | 9 |
| Audit | Not tamper-evident (T-14) [High] | FAIL | PASS | 9 |
| Audit | Ungoverned when unwritable (T-14) [Med] | FAIL | PASS | 9 |
| Audit | No quotas (T-15) [Med] | FAIL | PASS | 9 |
| Memory | Ungated ingest (T-16) [Med-plan/High-impact] | FAIL | PASS | 11 |
| Memory | No promotion provenance (T-16) | PARTIAL | PASS | 11 |
| Memory | No revocation (T-16) | FAIL | PASS | 11 |
| Memory | Raw-transcript embeddings | FAIL | PASS | 11 |
| Memory | No stakes tiering (T-21) | N/A | PASS | 11 |
| FS/OS | TOCTOU/symlink (T-04) [Med] | FAIL | PASS | 12 |
| FS/OS | No OS confinement (T-25) [High] | FAIL | PASS | 12 |
| Human | Fatigue by design (T-21) [High] | FAIL | PASS | 3 |
| Human | Governance files agent-editable (T-23) [Crit] | FAIL | PASS | 4, 5 |

**The two meta-questions, re-answered.** *Which controls depend on the agent behaving?* After Step 12: none of the primary ones. The seam is attached by a launcher the agent can't skip, governance state lives where the agent (a restricted OS user) can't write, the audit chain detects tampering, and fail-closed means non-cooperation stops work instead of ungoverning it. *How big is the TCB?* Shrunk from "the entire app + DB + settings + every skill" to: the launcher, the Starfish PDP/PEP + audit (already built and tested — 359 tests, verified via `skills/starfish-verify`), the gov dir, and the auth middleware. Small, isolated, import-nothing — the audits' through-line, satisfied.

**Residual risks (stated, not hidden):** the CLI honoring `--permission-prompt-tool` is trusted (IA Option A's known weakness — mitigated by launcher + restricted user, eliminated only by full sandboxing, Step 12 Option 2 in v2); Tier-0 auto-allows are a bounded but real surface; upstream could change spawn architecture faster than the sentinel adapts (monitored, fail-closed).

**Bottom line.** The import succeeds not by patching Agentic OS into something else, but by wrapping it: one launcher, one seam, one audit log, one registry, one memory gate — all living outside the tree upstream controls. Agentic OS keeps doing everything it did on day one; it just can no longer do it *silently, ungoverned, or when compromised*. That is the difference — per the hardening review's own closing line — between a capable assistant and a defensible one.
