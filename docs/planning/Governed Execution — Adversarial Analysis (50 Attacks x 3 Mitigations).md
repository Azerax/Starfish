# Governed Execution — Adversarial Analysis (50 Attacks × 3 Mitigations)

> **Version:** 1.0 · **Date:** 2026-07-04 · **Project:** Project Starfish (Scott's governance system — not a fork).
> **Scope:** ways to compromise, breach, invalidate, exploit, or escape the Governed Execution + Non-Deviation layer so it does something *against* governance — each with three layered mitigations (**prevent · detect · contain/recover**).
> **Assumption (the whole point):** the agent is *adversarial*. No mitigation may depend on the agent's cooperation. Defense-in-depth: no single failure should defeat governance.
> Companion to `Governed Execution — Runtime Safety Layer Plan.md`, `…Non-Deviation…`, `Project Starfish THREAT MODEL.md`.

---

## A. Enforcement-seam bypass (get an action to execute without a gate decision)

### 1. Spawn an un-hooked child process / subagent
**Attack:** agent invokes `Task`/a subagent/a raw child process not wired to the PreToolUse hook → its tool calls never reach the PDP.
- **Prevent:** subagents/child spawns are themselves gated tools; a spawn inherits a *subset* of the parent's allowlist + boundary and its own hook settings — no un-hooked spawn is allowed.
- **Detect:** PostToolUse-without-Pre correlation flags any result with no preceding allowed decision (`HookSession`).
- **Contain:** OS sandbox (restricted user/container) so even an un-hooked process is confined by the kernel to the worktree with default-deny network (T-25).

### 2. Neuter the hook shim / settings before acting
**Attack:** agent rewrites its `--settings` or the `cth-hook` shim to a no-op.
- **Prevent:** shim, settings, socket path all live *outside every boundary set* (unwritable by any agent); conformance tests assert this.
- **Detect:** hash-check the shim + settings at each spawn; mismatch → refuse to spawn + audit.
- **Contain:** if integrity fails, host enters locked safe-mode (human-approve-every-action), never open gate.

### 3. Kill / DoS the PDP daemon (hope for fail-open)
**Attack:** crash or flood the daemon so the hook can't get a decision.
- **Prevent:** the hook treats "no decision / connection refused / timeout" as **deny**, never allow (fail-closed).
- **Detect:** daemon heartbeat in the Service Registry; missed heartbeats raise a Critical finding.
- **Contain:** watchdog restarts the daemon; while down, all agents are paused (no action proceeds ungoverned).

### 4. Impersonate another agent over the socket
**Attack:** connect to the PDP socket declaring a different `agentId` to inherit its scope.
- **Prevent:** each connection is bound to its expected `agentId` at the `hello` handshake; payloads claiming a different id are rejected.
- **Detect:** an agent_id mismatch is audited as an impersonation attempt + finding.
- **Contain:** per-agent socket/credential so a connection *is* the identity (no self-declaration to spoof).

### 5. Win the TOCTOU race on the action itself
**Attack:** perform the side effect between the `allow` verdict and the actual execution (or in PostToolUse).
- **Prevent:** audit-before-act — the decision is written before `allow` returns; the executable window is minimized; for filesystem, prefer fd-based operations that re-check at open.
- **Detect:** PostToolUse correlation catches an effect with no matching allow; boundary re-check on the resolved path at execution.
- **Contain:** OS sandbox enforces the same boundary at `open()`, so the race can't cross the kernel-enforced limit.

### 6. Call a tool the host doesn't route through the hook (e.g., an MCP server)
**Attack:** use a capability surface the interception adapter doesn't cover.
- **Prevent:** the tool registry is the allowlist; a surface not registered + routed is denied by default; MCP servers are explicitly registered and proxied through the gate.
- **Detect:** any observed effect from an unregistered surface is a violation (no allowed Pre).
- **Contain:** network/OS egress controls block an un-proxied MCP's traffic at a coarser boundary.

### 7. Replay a prior "allow" to authorize a different action
**Attack:** reuse a captured allow decision for a new call.
- **Prevent:** decisions are per-call, not tokens the agent holds; the PDP re-evaluates every action from scratch (stateless verdict).
- **Detect:** decisions bind to the exact action hash; a mismatched action → re-evaluate (not replay).
- **Contain:** nonce/sequence per connection so a replayed frame is rejected.

---

## B. Boundary / filesystem escape

### 8. Symlink swap (TOCTOU) between canonicalize and open
**Attack:** swap a checked dir component for a symlink pointing outside after the check.
- **Prevent:** **symlinks are categorically denied (Scott directive)** — any agent action that creates a symlink or whose path contains a symlink component is blocked outright, so there is no symlink to swap in the first place; the swap primitive is removed, not merely resolved.
- **Detect:** the **pre/post-task file compare** catches any file that changed outside the declared write scope even if a swap slipped the live check; Hank flags symlink presence/churn as a violation.
- **Contain:** OS sandbox: the kernel filesystem view *is* the boundary; and the pre-snapshot enables rollback of any out-of-scope change (T-04/T-25).

### 9. Encoded / unicode / 8.3 / UNC path to dodge the prefix check
**Attack:** obfuscate the path so the glob/prefix comparison misses the escape.
- **Prevent:** canonicalize fully (realpath, `..` collapse, unicode NFC, Windows 8.3 + UNC normalization) *before* the prefix check.
- **Detect:** compare the *resolved absolute* path to roots; log any path that normalizes to a different tree.
- **Contain:** deny on canonicalization failure (fail-closed), never pass-through.

### 10. Write through a hardlink whose target is outside the boundary
**Attack:** create/point a hardlink whose inode lives outside the workspace.
- **Prevent:** on write, resolve to the real inode and re-check; deny cross-device/cross-boundary links.
- **Detect:** inode/device of the target logged and compared to the boundary device.
- **Contain:** OS sandbox mounts the worktree such that out-of-tree inodes aren't reachable.

### 11. Escape via bind-mount / junction / mounted volume
**Attack:** a mount inside the worktree points elsewhere.
- **Prevent:** derive the boundary from realpath'd roots; treat mount points inside the worktree as boundaries (deny traversal across).
- **Detect:** enumerate mounts under the worktree at spawn; alert on unexpected ones.
- **Contain:** sandbox with a minimal, explicit mount set (only the worktree).

### 12. Feed the gate a widened boundary set (caller-supplied boundary)
**Attack:** exploit that `containCheck` takes a `BoundarySet` param — supply a bigger one.
- **Prevent:** boundary sets are *derived by the trusted core* (`boundaryForAgent`) from config, never supplied by the agent/transport; the transport can't pass its own.
- **Detect:** the derived set is hashed into the agent's session; a mismatch is a violation.
- **Contain:** the derivation structurally excludes governance/audit/state (forbid list), so even a wrong set can't include them.

---

## C. Command / tool execution

### 13. Argv injection into a "safe" command template
**Attack:** `--upload-pack=evil`, a leading-dash filename, `-o ProxyCommand=`.
- **Prevent:** per-template typed argv allowlist; no arg may start with `-` unless a named flag; path args are `--`-terminated and boundary-checked; `execFile` (no shell).
- **Detect:** reject + audit the rejected argv; Hank flags repeated argv-rejections as probing.
- **Contain:** templates run one fixed binary — no alternate program can be reached even if an arg slips.

### 14. Trigger a repo hook / package script via a template (arbitrary code)
**Attack:** `git commit` runs `.git/hooks/pre-commit`; `npm test` runs `package.json` scripts; or a task runs a command it was never meant to.
- **Prevent:** `git` runs with `--no-verify` + `core.hooksPath=/dev/null` + scrubbed `GIT_CONFIG_*`; `npm` with `--ignore-scripts` or the runner binary invoked directly; **and command-templates are task-scoped (Scott directive) — no task can trigger `npm`/`git`/deploy unless that exact command is in *its* scope contract**, so an off-task command is blocked before neutralization even matters.
- **Detect:** Toby's vetting flags any capability whose worktree can inject hooks/scripts (tier by "what code can run here"); the **pre/post-task file compare** catches any side effect the command produced outside the declared write scope.
- **Contain:** the template runs in the OS sandbox (worktree-confined + network-denied); the pre-snapshot enables rollback of any unexpected change.

### 15. Abuse the escorted-Bash exception (or socially engineer its approval)
**Attack:** repeatedly invoke the Critical escorted-shell path, or craft a command that looks benign to the approver.
- **Prevent:** escorted Bash is Critical (per-invocation human approval, no auto-allow); metacharacters/out-of-worktree paths pre-rejected before it reaches the human.
- **Detect:** repeated escorted-exception use raises "vet a template instead" + a probing finding.
- **Contain:** the human prompt shows the exact resolved argv + risk; rate-limit escorted requests so it can't be spammed into fatigue.

### 16. Register a capability that fetches-and-executes at runtime
**Attack:** a skill that passes static vetting but downloads a payload when run.
- **Prevent:** Toby auto-flags runtime fetch+exec / obfuscation as **not-Low** (forced human review); such code can't be Low/auto-registered.
- **Detect:** egress + network destination allowlist catches the runtime fetch; Hank flags fetch-then-exec sequences.
- **Contain:** hash-on-vet + no-network-by-default for the capability's process; sandbox blocks the fetch.

### 17. Malformed / oversized tool input to break the validator
**Attack:** a giant or pathological input to crash/slow schema/egress validation (hope for fail-open).
- **Prevent:** size caps on inputs/results; bounded regex (no catastrophic backtracking); validator time budget.
- **Detect:** oversized/timeout inputs audited; latency-distribution monitoring in the benchmark.
- **Contain:** on any validator error/timeout → **deny** (fail-closed), never allow.

---

## D. Registry / policy / capability integrity

### 18. Directly edit `tools.json` / `policies.json` on disk
**Attack:** the agent writes the governance files to grant itself a capability.
- **Prevent:** `hive/governance/` is outside every agent boundary set (unwritable by any agent); only the trusted core writes registries, only via Toby's pipeline.
- **Detect:** hash-chain / integrity check on governance files; out-of-band edit → fail-closed.
- **Contain:** governance files are file-system-permissioned to the host user, not the agent user (OS sandbox).

### 19. Registry cache poisoning (cache diverges from file)
**Attack:** make the in-memory cache say "allowed" while the file doesn't (or vice-versa).
- **Prevent:** single source of truth = the file; cache is derived, hash-checked, atomically swapped after the write.
- **Detect:** periodic + per-write reconciliation of cache hash vs file hash.
- **Contain:** any divergence → fail-closed + reload from file.

### 20. Policy-order abuse (shadow denies with a broad allow)
**Attack:** insert a `*` allow rule that matches before the deny.
- **Prevent:** agents can't write policy at all; policy edits are Critical, human-only, audited.
- **Detect:** a policy linter flags over-broad `*` allow rules and shadowed denies at load; Hank reviews policy diffs.
- **Contain:** default-deny remains the backstop — a mis-ordered allow can't authorize an *unregistered* tool or a boundary escape.

### 21. Downgrade a capability's risk tier to dodge escalation
**Attack:** edit the registry so a High capability reads Low.
- **Prevent:** risk tier is *computed* by the Risk Engine at decision time from signals, not merely trusted from the registry field; the field can't lower the computed tier below the signal floor.
- **Detect:** registry tier vs computed tier mismatch → finding.
- **Contain:** Critical patterns (destructive/spend) always escalate regardless of any registry value.

### 22. TOCTOU on hash-on-vet (swap capability bytes after verify)
**Attack:** change the capability's files between the hash check and execution.
- **Prevent:** verify the hash *at load into the execution context* and pin/lock the bytes; run from the verified copy, not a mutable path.
- **Detect:** re-hash on execute; drift → deny + re-vet.
- **Contain:** capability files are read-only to the agent user; the sandbox runs a snapshot.

---

## E. Audit integrity & evasion

### 23. Truncate / delete / rotate away the audit log
**Attack:** erase the evidence trail.
- **Prevent:** `audit.jsonl` outside every boundary set; agent user has no write/delete on it.
- **Detect:** hash-chain — any deletion/truncation breaks the chain and is detectable on verify.
- **Contain:** append to write-once/rotated storage; optional ship to an external append-only sink the agent can't reach.

### 24. Forge a hash-chained entry / recompute the chain after tampering
**Attack:** rewrite the log and recompute all hashes to hide a change.
- **Prevent:** periodically anchor the chain head (sign it / write the tip to an external store) so the agent can't silently re-root it.
- **Detect:** the anchored tip won't match a re-rooted chain; the monitor compares.
- **Contain:** the host user owns the log key/anchor; the agent user can't sign.

### 25. Flood the audit to bury an entry / exhaust disk
**Attack:** generate noise to hide one malicious line or fill the disk (hoping for fail-open).
- **Prevent:** per-agent audit rate accounting; monthly rotation; disk-full → **deny** (fail-closed).
- **Detect:** audit volume anomaly per agent → finding; Hank reconciles against action counters.
- **Contain:** structured queryable audit (find the needle regardless of volume); reserved disk headroom for governance.

### 26. Act, then crash before the audit line is written
**Attack:** race the audit so the action isn't logged.
- **Prevent:** audit-before-act — the decision is fsynced *before* `allow` returns; worst case is a logged-but-unexecuted action (safe).
- **Detect:** PostToolUse with no matching logged Pre → violation.
- **Contain:** on restart, an incomplete/uncorrelated action is treated as suspicious and surfaced.

---

## F. Task lifecycle / scope contract / non-deviation

### 27. Self-authorize (propose + approve your own task)
**Attack:** create a task, assign to self, move it out of backlog yourself.
- **Prevent:** proposer≠approver — the proposer can't transition their own task out of backlog; only a non-proposer approver can.
- **Detect:** a backlog transition where actor==proposer is denied + audited.
- **Contain:** even an approved task runs under the derived contract + gate, so self-approval alone grants nothing beyond the contract.

### 28. Over-broad task body → huge scope contract
**Attack:** write an ambitious task description hoping the contract inherits it.
- **Prevent:** the contract is *derived* (type ∩ registry ∩ policy ∩ plan), not from free-text the agent wrote — an ambitious body doesn't widen it.
- **Detect:** a contract wider than the agent's general grants is impossible (contract ⊆ grants) and flagged if attempted.
- **Contain:** approver reviews the *derived* contract, not the prose, at approval.

### 29. In-scope tool used for an out-of-scope purpose
**Attack:** use an allowed tool/path to accomplish something off-mission.
- **Prevent:** deterministic scope catches the action *surface*; narrow contracts reduce the surface.
- **Detect:** D7 (objective drift, Hank semantic) flags in-scope-but-off-objective actions as findings.
- **Contain:** honest limit — purpose-evasion within scope is *bounded* (blast radius = the narrow contract), not eliminated; keep contracts tight + validation gate on completion.

### 30. Manipulate the plan DAG to unlock an out-of-order step
**Attack:** mark dependencies "done" to run a later/unplanned step.
- **Prevent:** step/dep state transitions are governed lifecycle actions (proposer≠approver / validated), not agent-writable flags.
- **Detect:** a step executed with unmet deps → D4 deviation, blocked/flagged.
- **Contain:** re-planning is itself a governed amendment; the plan is hash-bound to the contract.

### 31. Illegal lifecycle transition (jump to completed without validation)
**Attack:** move a task straight to `completed`, skipping `validation`.
- **Prevent:** the state machine allows `completed` only from `validation`; illegal transitions are rejected in the core (not agent-writable).
- **Detect:** a rejected transition is audited; a "completed" without linked validation evidence is blocked (F9).
- **Contain:** validation is performed/attested by a different actor (evaluator/human), not the executing agent.

### 32. Swap the scope contract mid-execution
**Attack:** replace the task's contract with a wider one after approval.
- **Prevent:** the contract is immutable + hash-bound after approval; only a governed amendment (new hash, approver≠agent) supersedes it.
- **Detect:** contract hash mismatch at any check → fail-closed.
- **Contain:** the boundary/allowlist the gate uses come from the *approved* contract, not a re-suppliable field.

---

## G. Earned-trust / auto-approval abuse

### 33. Farm clean runs, then pivot to abuse under auto-approval
**Attack:** behave on a trivial variant to earn eligibility, then exploit the auto-approve on a malicious amendment.
- **Prevent:** earned trust only auto-approves *low-risk* amendments (narrowings + in-boundary sibling widenings, same tier) — never expansions/new-capabilities/Critical; the abusive amendment still needs a human.
- **Detect:** the amendment's risk tier is re-evaluated each time; a tier jump under auto-approve → escalate + finding.
- **Contain:** one deviation instantly revokes eligibility + resets the counter (safe asymmetry).

### 34. Broaden the task signature so trust transfers to unrelated work
**Attack:** make the "task signature" so generic that trust earned on X applies to Y.
- **Prevent:** signature granularity is a governed config; default is specific (task-type/template + agent + contract shape), not "any task."
- **Detect:** monitor for eligibility applied to a materially different contract shape → finding.
- **Contain:** revocation is per-instance; a deviation on any instance under a template revokes the template's eligibility.

### 35. Forge / replay the "N clean runs" evidence
**Attack:** fabricate the run history that grants eligibility.
- **Prevent:** eligibility evidence is the deterministic deviation counters from the *audit chain*, not agent-writable; the claim is promoted through governed memory, not self-asserted.
- **Detect:** Hank reconciles "eligible" against the raw deviation counters — a spurious eligibility trips a discrepancy alarm.
- **Contain:** eligibility is revocable and re-derivable from the audit; a forged claim is invalidated on recompute.

### 36. Exploit the revocation gap (deviate without registering as a deviation)
**Attack:** do something off-mission that the deterministic D-checks don't classify as a deviation.
- **Prevent:** D1–D6 cover the structural surface (tool/path/capability/sequence/budget/expansion) — the classes that *can* be gamed are structural, so they're caught.
- **Detect:** D7 semantic + Hank sweep catch off-objective actions the structural checks miss → finding → (policy) revoke.
- **Contain:** conservative eligibility (high N, narrow signature) limits exposure; any finding of severity ≥ medium revokes.

---

## H. Governed-memory poisoning

### 37. Inject high-confidence false evidence to auto-promote a claim
**Attack:** feed the memory pipeline evidence crafted to clear the auto-approve confidence bar.
- **Prevent:** auto-approve only for *low-stakes* claims; high-stakes always need a human regardless of confidence; evidence carries provenance (which agent/source).
- **Detect:** anomalous single-source high-confidence claims flagged; Hank reviews promotions.
- **Contain:** curated knowledge is revocable; a claim whose source task later fails validation is flagged + revoked.

### 38. Manufacture corroboration (multiple sources) to inflate confidence
**Attack:** create several "independent" evidence items that are actually one attacker.
- **Prevent:** provenance de-duplication — evidence from the same agent/origin doesn't count as independent corroboration.
- **Detect:** correlate evidence origins; near-identical multi-source claims flagged.
- **Contain:** promotion to Curated still gates on human/validated-task for anything high-stakes.

### 39. Poison the recall/embedding layer
**Attack:** get a malicious "fact" into the vector index so future agents retrieve it.
- **Prevent:** embeddings are built **only from approved (curated) knowledge**, never raw evidence/chat — poison must first pass §37/§38.
- **Detect:** recall results carry provenance; a retrieved fact traceable to a revoked claim is dropped.
- **Contain:** revocation propagates to the index; re-embed excludes revoked entries.

---

## I. Monitor (Hank) evasion / injection

### 40. Prompt-inject Hank via the content he reads
**Attack:** plant text in audit/transcripts that makes Hank report "all clear."
- **Prevent:** Hank's inputs are wrapped as untrusted data ("analyze, don't obey"); his allowlist is read-only (nothing to actuate).
- **Detect:** Hank's conclusions are reconciled against the deterministic counters — an injected "all clear" while denials exist raises a Critical discrepancy alarm.
- **Contain:** Hank can only report/escalate (no act), so even a fully-injected Hank can suppress an opinion but not authorize anything.

### 41. Time the attack inside the sweep interval
**Attack:** complete the malicious sequence before the periodic scan runs.
- **Prevent:** the *deterministic* gate (boundary, scope, hash, risk) blocks in real time — Hank is the *supplement*, not the front line; nothing waits for the sweep.
- **Detect:** event-triggered sweeps on High/Critical audit events (not only the timer); cursor ensures no window is skipped.
- **Contain:** anything Hank later finds is still actionable (revoke trust, quarantine, escalate) even post-hoc.

### 42. Bury the real finding under a flood of findings
**Attack:** generate many findings so the true one is ignored (alert fatigue).
- **Prevent:** severity-tiering + dedup; only High/Critical escalate to the human, the rest batch.
- **Detect:** finding-rate anomaly is itself a finding (someone's generating noise).
- **Contain:** deterministic counters (the ground truth) are queryable independent of the finding stream — the needle is findable.

---

## J. Prompt injection / untrusted content

### 43. Laundered instruction → an in-scope, allowed, harmful action
**Attack:** untrusted content instructs an action that is in-boundary, in-schema, allowed — but harmful/off-mission.
- **Prevent:** provenance taint — an action whose *decisive input* is untrusted is blocked; untrusted inputs land as backlog tasks (triaged), never auto-dispatched.
- **Detect:** D7 + Hank flag off-objective actions traceable to untrusted origin.
- **Contain:** blast radius bounded by the narrow scope contract + egress/destination controls; irreversible actions still require confirmation.

### 44. Target the operator's confirmation prompt (social)
**Attack:** craft content so the human's approval dialog looks safe/benign.
- **Prevent:** confirmation prompts show the *resolved* action (exact argv/path/recipient/amount) + risk tier + provenance (incl. "originated from untrusted content"), not the agent's framing.
- **Detect:** actions originating from untrusted content are labeled as such in the prompt.
- **Contain:** Critical/irreversible have no auto-allow; batching + decision-ready prompts reduce fatigue that leads to mis-approval.

### 45. Split a malicious instruction across multiple untrusted inputs
**Attack:** evade per-item detection by fragmenting the payload.
- **Prevent:** the gate governs *actions*, not instructions — however assembled, the resulting *action* still faces boundary/scope/risk/egress checks.
- **Detect:** egress scans normalized+decoded+reassembled forms; correlate multi-input provenance.
- **Contain:** taint accumulates across inputs; the assembled action inherits untrusted taint → blocked.

---

## K. Resource / DoS / availability

### 46. Force the gate to fail, hoping for fail-open
**Attack:** pathological inputs/timeouts to make the PDP error.
- **Prevent:** every error/timeout/exception path → **deny** (unit-tested fail-closed).
- **Detect:** validator error-rate spike → finding.
- **Contain:** systemic failure → locked safe-mode (human-approve-all), not open gate.

### 47. Resource exhaustion / fork-bomb via an approved command
**Attack:** starve the host/gate so governance can't function.
- **Prevent:** command templates run under OS resource limits (cgroups/ulimit, CPU/mem/pids caps); no raw shell.
- **Detect:** host health in the Service Registry; resource anomaly → finding.
- **Contain:** the sandboxed agent process is killable without affecting the (separate-process) PDP; PDP has reserved resources.

### 48. Slow-drip spend under every soft threshold
**Attack:** stay just below each budget trip to accumulate cost/actions.
- **Prevent:** cumulative (not just per-window) budgets; hard caps on totals, not only rates.
- **Detect:** trend detection on cumulative spend/actions per agent+task.
- **Contain:** per-task budget slice (from the contract) caps the total a single task can consume.

---

## L. Concurrency / shared state

### 49. Race two agents on a shared resource (lost update / lock corruption)
**Attack:** concurrent writes to the board / tasks.json / a target file.
- **Prevent:** single-writer-per-file + the shared board/ledger written only by the trusted core (single committer); agents write only their own outbox/dir.
- **Detect:** version/lease conflict detection; a second concurrent writer is rejected + audited.
- **Contain:** lease TTL + queue serialize legitimate contention; corrupted-lock recovery is core-owned, not agent-owned.

---

## M. Human factor

### 50. Escalation fatigue → the human rubber-stamps the malicious one
**Attack:** flood the operator with confirmations so they approve without reading.
- **Prevent:** tune policies so routine work auto-allows (with audit); reserve prompts for genuinely High/Critical; rate-limit confirm requests per agent.
- **Detect:** track the allow/deny/ask ratio + confirm volume as a health metric; a spike is itself a finding (probing for fatigue).
- **Contain:** the highest-stakes actions (money, prod, policy edits, account deletion) get *extra* friction (typed confirmation / second approver), never batch — so the one that matters can't ride the flood.

---

## Cross-cutting principles (why 50 holes don't sink the ship)
1. **Defense-in-depth:** every attack meets a *prevent* (structural), a *detect* (audit/monitor), and a *contain/recover* (fail-closed / revoke / OS-sandbox) — no single control is load-bearing alone.
2. **Fail-closed everywhere:** every ambiguous or failed check denies; the system degrades toward *more* human oversight, never toward an open gate.
3. **No trust in the agent:** every mitigation holds against a fully adversarial agent; nothing relies on the agent behaving.
4. **The deterministic core is the floor; the semantic layer (Hank/D7) is the supplement** — and the supplement is reconciled against the deterministic counters so it can flag but never silen