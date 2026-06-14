# Skill isolation & integrity — threat model (10 exploits + fixes)

Adversary: a malicious or compromised **skill** running as a governed agent, trying to break out of
its per-skill workspace, tamper with itself/others, or evade detection. Status legend:
**[MITIGATED]** in code · **[PARTIAL]** seam exists, hardening needed · **[GAP]** to implement.

### 1. Symlink escape from the workspace
**Attack:** skill drops a symlink in its workspace pointing at another skill's dir or the governance dir, then reads/writes "within" its boundary through the link.
**Fix / status:** **[MITIGATED]** — `containCheck` canonicalizes (realpath) and `symlinkBelowRoot` rejects any symlink component at/below the matched root; every fs call is re-checked.

### 2. TOCTOU (swap the path between check and use)
**Attack:** pass a valid path; after the PDP allows, replace it with a symlink before the real `readFile`/`writeFile`.
**Fix:** **[PARTIAL]** — check realpaths now; the **fs transport must open with `O_NOFOLLOW` and operate on the fd from the checked path** (atomic check+use), not re-resolve by string. Add to the ring-2/3 fs IPC.

### 3. Integrity bypass — modify source after verify-before-invoke
**Attack:** pass the manifest check, then rewrite the skill's own files before execution.
**Fix:** **[PARTIAL]** — `enforceIntegrity` runs before each invoke; harden by **executing from an immutable in-memory snapshot / OS read-only mount** of the vetted bytes so on-disk edits can't take effect mid-run. Source is already read-only in the per-skill boundary.

### 4. Manifest poisoning (hide a malicious file)
**Attack:** register with a manifest that omits a payload file so it's never checked later.
**Fix:** **[MITIGATED]** — the manifest is **recomputed by us at vet time over the whole tree** (never accepted from the pack); `diffManifest` flags **added** files too, not just edited — any extra file → tamper → quarantine.

### 5. Trusted-publisher spoofing (the big one)
**Attack:** set `provenance.repo = "anthropics/skills"` in a pack's own manifest to get auto-low/enabled.
**Fix:** **[GAP]** — provenance is currently a **self-asserted string**. Trust must be **cryptographically verified**: a publisher **signature over the manifest hash, checked against a pinned public key** (`verifyPublisherSignature` is the stub seam), and/or provenance supplied only by the trusted **registry channel**, never the pack. Until then, treat the allowlist as advisory + require human consent for first-party claims.

### 6. Listing enumeration / path-leak side channel
**Attack:** probe which dirs exist via error messages, or enumerate structure via many `fs.list`s.
**Fix:** **[MITIGATED]** — denials never echo the path (no leak); `fs.list` is boundary-checked + audited; Hank raises **listing-probing** (≥2 denied lists) / **listing-enumeration** (≥8 lists) findings. Add: rate-limit `fs.list` per agent.

### 7. Audit tampering or flooding
**Attack:** edit/delete audit entries to erase tracks, or flood it to bury a finding.
**Fix:** **[MITIGATED]** — audit is append-only + **hash-chained** (`verify()`); the audit path lives in the governance dir, **forbidden to every skill** by boundary; `reconcile()` trips a Critical alarm if a watcher reports all-clear while events exist. Add: size cap + write rate-limit.

### 8. Confused deputy via `capabilityId` spoofing
**Attack:** a skill sends a different `capabilityId` so its calls are integrity-checked against *another* (clean) skill, or actions are misattributed.
**Fix:** **[PARTIAL]** — the `PdpDaemon` already binds `agentId` via the `hello` handshake; **bind `capabilityId` the same way** (stamped by the daemon from the authenticated connection, never trusted from the payload). Mirror the agent-id binding for capabilities.

### 9. Resource exhaustion (DoS) on integrity/list
**Attack:** create millions of files, deep trees, or symlink loops so `readSkillFiles`/`governedList` hang or OOM.
**Fix:** **[GAP]** — add caps: max file count, max bytes, max depth, and a symlink-cycle guard in `readSkillFiles` and `governedList`; per-call timeout; fail-closed (deny) on exceed.

### 10. Workspace cross-contamination via shared temp / env
**Attack:** write to a shared OS temp (`/tmp`, `%TEMP%`) or inherit secrets via env to reach outside the workspace.
**Fix:** **[PARTIAL]** — `WorktreeRunner` already scrubs env (no secret inheritance) and pins cwd; also **set `TMPDIR`/`TEMP` to the skill's own workspace**, and for a hostile process use the **OS sandbox seam (T-25: container/restricted user/namespace)** — path checks confine a cooperating process; the kernel sandbox confines a hostile one.

---

## Bonus — network egress
Path boundaries don't cover sockets/DNS. **[PARTIAL]** — `scanEgress` contains secret material in results; true network confinement needs the OS sandbox (network namespace / no-net) from T-25.

## Priorities
The two real **[GAP]/[PARTIAL]** items that matter most: **#5 publisher signing** (closes provenance spoofing) and **#8 capabilityId binding** (closes confused-deputy). Then **#9 resource caps** and the **#2/#3 atomic-fd + immutable-execution** hardening. #1, #4, #6, #7 are already enforced and tested.

---

## Update — hardening landed (2026-06-14)
- **#1 symlinks → [MITIGATED, total]:** readers never follow symlinks (`lstat`), `scanSymlinks` rejects any skill tree containing one, and `boundaryForSkill`/`containCheck` still block symlink traversal at runtime. **No symlinks allowed, anywhere in a skill.**
- **#3 integrity bypass → [MITIGATED]:** `runWithIntegrity` hashes **before, during (snapshot of the exact bytes), and after** execution; any drift mid-run → auto-quarantine + Critical audit.
- **NEW — prompt-injection = highest tier:** `vet()` screens for instruction-override text ("ignore previous instructions", "disregard the system prompt", "you are now…", etc.). A hit sets the new top tier **`injection`** and is **REJECTED outright** at intake (status `rejected`, can never be approved) — this **overrides trusted-publisher** (a poisoned first-party skill is still rejected).

## Update — #5 + #8 closed (2026-06-14)
- **#5 trusted-publisher spoofing → [MITIGATED]:** real **Ed25519 publisher signing** (`signature.ts`). A skill with a valid signature over its manifest hash from a **pinned publisher key** is cryptographically trusted; `vet(input, { pinned })` uses signature-trust (provenance strings are now the weaker, operator-asserted path). Tampering after signing invalidates it; wrong key fails. Tests: `signature.conformance.test.ts`.
- **#8 capabilityId spoofing → [MITIGATED]:** the `PdpDaemon` now **binds `capabilityId` at the `hello` handshake** (like `agentId`); the `HookSession` stamps it on every call and **rejects any payload-supplied `capability_id` that differs** ("confused-deputy blocked"). Integrity is therefore checked against the bound skill, not a caller-chosen one. Tests: `capability-binding.conformance.test.ts`.
