# Phase Build Log

Running record of each phase: what was delivered, test results, gates, and every
gating issue + its resolution (per the build discipline — self-heal, document, continue).

---

## Phase 0 — Foundations ✅
**Delivered:** monorepo (4 packages), TS/vitest tooling, CI workflow (5 layers), dependency-direction lint, IP denylist scan, SBOM+license check, GOVERNANCE.md (framework verbatim), LICENSE (MIT), NOTICE (upstream attribution), salvage + art-provenance ledgers.
**Tests:** TC-0.1 CI green ✅ · TC-0.2 planted bad import fails lint ✅ · TC-0.3 planted IP token fails scan ✅.
**Gates:** L-4 (attribution) ✅, D-1 (SBOM) ✅.
**Issues:** none.

---

## Phase 1 — Governed shell (ring 1) ✅
**Delivered (governance-core):** `types`, hash-chained append-only `AuditLog`, `containCheck` boundary engine (canonicalize → realpath → prefix-check, symlink-component rejection, no path leak in denials), file-based `Registry` with single-source hash integrity, the `PDP` choke point (default-deny gate: registered → allowed-agent → boundary), fail-closed `loadGovernor` boot.
**Delivered (governance-hooks, ring 2):** `handleHook` PreToolUse→PDP seam with agent_id binding; `HookSession` correlating Pre→Post (orphan flagging).
**Tests (all green):**
- TC-1.1 unregistered tool denied ✅
- TC-1.2 agent not allowed denied ✅
- TC-1.3 write-escape suite (.., absolute, symlink, read-area) denied; nothing created ✅
- TC-1.4 read-escape suite denied; denial leaks no name/contents ✅
- TC-1.5 negative control (in-boundary succeeds) ✅
- TC-1.6 fail-closed boot (missing/corrupt registry throws) ✅
- TC-1.7 audit-before-act + orphan PostToolUse flagged ✅
- TC-1.8 agent_id mismatch denied (impersonation blocked) ✅
- TC-1.9 single-source registry integrity (out-of-band edit → fail closed; reload works) ✅
- SC: one governed agent performs a permitted Read end-to-end, audited ✅
- NFR-1: 1000 decisions, p95 < 50ms ✅
**Gates:** S-1 (fail-closed) ✅, S-6 (artifact/agent binding) ✅, S-7 (boundary) ✅, S-9 (fail-closed boot) ✅, S-12 (hash-chain audit) ✅; G-1 (default-deny), G-4 (audit), G-5 (no agent writes governance) testable ✅.
**Gating issues & resolutions:**
1. *Obsolete placeholder test* referenced a removed `defaultDecision` export / `VERSION 0.0.0`. → Rewrote `governance-core/index.test.ts` to the real surface (`VERSION 0.1.0`, RING, a containCheck smoke). Retested green.
2. *Symlinked-tmp false-negative risk* — `canonical()` realpaths the path but boundary roots were only `resolve()`d, which would mismatch on systems where the temp/parent dir is a symlink (e.g. macOS `/tmp`→`/private/tmp`), wrongly denying in-boundary paths. → Hardened `containCheck` to realpath existing roots too, so root and target are compared on the same (resolved) basis. Retested green on Linux; fix also covers macOS.
3. *TC-1.7 needed state* — the stateless `handleHook` couldn't correlate Pre→Post. → Added `HookSession` (per-agent) tracking allowed PreToolUse and flagging orphan PostToolUse as a no-silent-execution violation. Added a conformance test; green.

**Scope note (honest):** Phase 1 proves the *governance logic* end-to-end through the hook seam using a simulated agent driver (hook payloads), not a live `claude` process. The real PTY/`claude` wiring is ring-2 machinery salvaged in a later phase; the governance — which is what Phase 1 must prove — is fully implemented and tested.

---

## Phase 2 — Decisions (policy · risk · safe shell) ✅
**Delivered (governance-core):** `RiskEngine` (deterministic 4-tier classifier), `PolicyEngine` (ordered rules, first-match, default-deny, allow/deny/ask) + `loadPolicies`, command-template tools (`templates.ts`: `git_commit`, `node_test` via `execFile`, typed argv allowlist, scrubbed env, `--no-verify` + `core.hooksPath=/dev/null`, runner-binary-not-npm). PDP rewritten to bracket ingress (gate → risk → policy → combine) and egress (result containment); `Decision` extended with `ask`. Hook seam maps `ask` → `'ask'`.
**Tests (all green):**
- TC-2.1 determinism — 1000 identical calls → identical decision ✅
- TC-2.2 4-tier routing — low→allow, medium→ask (allow w/ policy), high→ask, critical→ask (no auto-allow even with allow-all policy), policy-deny overrides ✅
- TC-2.3 command-template safety — a malicious `.git/hooks/pre-commit` and a malicious `package.json` test script are NOT executed (real git/node runs) ✅
- TC-2.4 argv injection — option-injection / metacharacters / leading-dash rejected ✅
- TC-2.5 raw Bash unreachable (unregistered → deny); escorted shell is Critical → ask (human each time) ✅
- TC-2.6 egress — a result carrying private-key material is blocked ✅
**SC:** determinism green; no template runs repo hooks/scripts; raw Bash unreachable; ingress+egress audited ✅.
**Gates:** S-2 (command-template exec trap) ✅, S-8 (no raw Bash) ✅, G-3 (determinism) ✅, S-10 (egress containment) mitigated ✅.
**Gating issues & resolutions:**
4. *Boundary root `/` edge case (RED test).* The prefix check `canon.startsWith(root + sep)` produced `'//'` when a boundary root was the filesystem root `/`, so no absolute path matched and in-boundary writes/reads were wrongly denied — 3 risk-routing tests failed. → Fixed `containCheck` to use `root.endsWith(sep) ? root : root + sep` before the prefix compare. Real project roots are never `/`, but the logic is now correct generally. Retested: 40/40 green.

---

## Infrastructure note — workspace delivery
The repo lives in a OneDrive-synced folder. `bash` cannot *unlink/overwrite* already-synced
files (tar/rm fail with "Operation not permitted"), though it can create new files and
**truncate-in-place via shell redirect** (`cat src > dest`). Delivery from the sandbox to the
workspace therefore uses in-place redirect-overwrite. A full source tarball
(`../starfish-src-phase2.tgz`) is also produced each phase as a backup snapshot.
**Recommendation (Scott's call):** move the working repo outside OneDrive (e.g.
`C:\Users\swhol\Projects\starfish`) so standard git/npm/file operations work without friction;
keep OneDrive for the planning docs. Not blocking — the in-place sync works.

---

## Phase 3 — Task lifecycle + Token Governor ✅
**Delivered (governance-core):** `TaskLedger` (10-state machine: backlog→analysis→planning→decomposition→execution→validation→completed; failure rework→retry→failed; completed reachable only via validation), proposer≠approver gate, `TokenGovernor` (soft+escalate, USD+token budgets, pause/resume), intake routing `intakeRoute` (PADD skill / COMMS reasoning / new-capability→Toby) + `ingestExternal` (all external input → backlog task tagged external/untrusted), PDP task-bound enforcement ("no task, no tool", opt-in via loadGovernor `enforceTaskBinding`). `docs/PROTOCOL.md` reasoning standard.
**Tests (16 new, all green; 56 total):**
- TC-3.1 illegal lifecycle transition rejected ✅
- TC-3.2 no task, no tool — denied without an active assigned task ✅
- TC-3.3 proposer≠approver — self-authorization blocked; non-approver blocked; approver≠proposer allowed ✅
- TC-3.4 completed reachable only via validation ✅
- TC-3.5 Token Governor soft→warn, hard→pause+escalate, resume (USD & tokens) ✅
- TC-3.6 external input → backlog task, origin external/untrusted ✅
- TC-3.7 intake routing skill/reasoning/new-capability ✅
- TC-3.8 PADD still gated — valid task required AND gate still runs (unauthorized agent still denied) ✅
**Gates:** S-5 (self-authorization) ✅, G-2 (all work is a task) ✅, G-6 (interruptible: pause/resume) ✅.
**Gating issues:** none — clean build. (Note: task-binding enforcement is opt-in via `loadGovernor(...,{enforceTaskBinding:true})` so the simulated Phase 1/2 harness — which doesn't model tasks — stays green; it flips on globally once all dispatch paths create tasks.)

### Note — session/VM reset mid-phase
The build sandbox reset during a desktop-app restart (git MCP setup), discarding the in-progress Phase 3 scratch. Rebuilt cleanly from the committed Phase 0-2 baseline; no loss. Phases 0-2 committed to the repo (`a4c81fa`) before the rebuild.

---

## Phase 4 — Messaging (Option B) + governed memory ✅
**Delivered (governance-core):**
- `MessageRouter` — the message router as a bracketed transport PEP (framework §7 resolution). Ingress: message must be linked to an active assigned task (else held), hop cap, policy check; identity (`from`) stamped by the router, never trusted from the caller (T-08). Egress: secret-material containment. Every outcome audited.
- `GovernedMemory` — evidence→claims→governance→canonical-knowledge pipeline (Scott's model; supersedes wiki/memory.md). Evidence immutable+provenance; claims proposed FROM evidence with confidence; conflicting evidence weakens; deterministic governance gate (low-stakes+high-confidence auto-approves, else queued for an approver; policy can deny); only approved claims promote to entities carrying provenance; Decision Registry. Relationship graph + vector recall DEFERRED; embeddings (later) build from approved knowledge only.
**Tests (11 new, 67 total):**
- TC-4.1 message held without an active task; delivered when task-linked ✅
- TC-4.2 `from` stamped by router (impersonation blocked) ✅
- TC-4.3 ingress policy-deny; egress secret containment ✅
- TC-4.4 memory: high-conf low-stakes auto-approves+promotes w/ provenance; low-conf queued; high-stakes needs approver; conflicting evidence weakens; policy denies; Decision Registry records rationale ✅
**Gates:** S-15 (confused-deputy via router — identity stamped) ✅, S-16 (memory poisoning — nothing becomes knowledge without evidence+governance) ✅, G-7 (messaging conformance to §7) ✅.
**Gating issues:** none — clean build.
**Note:** canonical memory model adopted (evidence→knowledge); wiki is now just a future human-readable view. Graph + vector layers deferred to a later phase; the file-based vs SQLite decision will be revisited there.
