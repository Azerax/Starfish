# Adversarial Q&A — answered from source

Twelve questions posed publicly about Starfish's governance model by **u/WillowEmberly**, answered
against the code at commit `65b3974`, not against the design docs. Every claim below is either a file:line citation or a
result from a probe executed against the real modules. Where the honest answer is "no control exists",
it says so.

**Method.** Modules were compiled and driven directly (`loadGovernor`, `PDP`, `AuditLog`,
`SecurityMonitor`, `HookSession`) in a scratch harness. Probe transcripts are reproduced inline.

> **STATUS — ALL TEN FINDINGS CLOSED in v0.27.0 (2026-08-20).** Each has a regression test that
> reproduces the original defect. F-10 (scope non-deviation unwired) was closed in a follow-on pass
> the same day: it needed a contract *issuer*, not a flag — `ScopeContractLedger.check()` fails closed
> without a contract, and nothing issued them, so enabling the gate would have denied every call.
> `packages/governance-core/src/scopeissuer.ts` supplies it. F-11 was found later, during the
> site-claims sweep, and is also fixed.
>
> This document is preserved **as written, in the present tense of the review** — the answers below
> describe the code as u/WillowEmberly found it, which is the honest way to publish them. See
> `docs/RELEASE_NOTES_v0.27.0.md` for what changed and `docs/PHASE_BUILD_LOG.md` for the per-finding
> resolution table.
>
> **A second pass also closed the gaps that no finding named** — the ones that were design properties
> rather than bugs: **Q12** (the demonstrated two-hop chain — now gated by *self-authored execution*,
> so a task that wrote code the runner would execute must get a human before running it, and tolerance
> cannot satisfy that), **Q5** (the recovery store now requires an audit to destroy), **Q4**
> (undeclared allowlists audited, optionally denied), **Q9** (two more failure-swallow sites), and
> **Q2** (`resourceOf` no longer steerable by key order).
>
> **What has NOT changed is the answer's conclusion.** Self-authored execution gates a *sequence*; it
> is not a boundary. T-25 — no OS-level isolation — is unchanged, so the final paragraph of Q12 still
> stands exactly as written: Starfish governs a cooperative process; it does not contain a hostile
> one.

---

## Findings this review produced

Nine of these were not previously tracked. Ordered by severity.

| # | Finding | Location | Verified |
|---|---------|----------|----------|
| **F-1** | Deleting `audit.jsonl` entirely is **undetected**. `recover()` is gated on the log or segment index existing, so the head anchor — the one artifact that proves truncation — is never read when the log is simply gone. Integrity reports `ok:true`, `verify()` returns `true`, seq restarts at 0. | `audit.ts:62` | probe |
| **F-2** | With the audit file absent the monitor returns all-zero counters and zero findings, and `reconcile({allClear:true})` returns `ok` — the watcher-discrepancy alarm is disarmed by the same deletion it exists to catch. | `monitor.ts:20,80,95` | probe |
| **F-3** | `writeProfile:'auto'` converts a PDP `ask` into `allow` keyed only on `d.ask && tool==='fs.write'`. It cannot distinguish "routine medium-risk write" from "operator explicitly demanded review" — both are `{allow:false, ask:true}`. An explicit operator `ask` policy is silently overridden. | `handler.ts:129` | probe |
| **F-4** | The pre-image backup that makes that auto-allow "recoverable" is best-effort, its return value is not checked before allowing, and **failure is logged as `new file`** — identical to the not-applicable case. | `handler.ts:65,72,131` | probe |
| **F-5** | `ccToGoverned` discards the Glob/Grep pattern and substitutes `'.'`. `Glob{pattern:'/etc/**'}` is adjudicated as a read of the cwd and **allowed**. What the tool actually reads is never boundary-checked. | `handler.ts:52` | probe |
| **F-6** | `ccToGoverned` drops `content` for writes, so the poisoned-`.env` screening (`screenEnv`) is unreachable on the hook path. (Path-based gatekeeper denial still fires.) | `handler.ts:54` vs `pdp.ts:157` | probe |
| **F-7** | `Registry.verifyIntegrity()` — the out-of-band-edit check — is **never called in production code**, only in a conformance test. The registry cache is read once at construction; editing `tools.json` after boot is not detected at runtime. | `registry.ts:23`; sole caller `boot.conformance.test.ts:41` | grep |
| **F-8** | `monitor.sweep()` is **never called in production**. Only `counters()` is, from the sidecar (`serve.ts:99,136`) — which does not file findings or advance the cursor. Every rule in the monitor (probing, enumeration, boundary-escape, watcher-discrepancy) is dormant in the shipped product. | `monitor.ts:45` | grep |
| **F-9** | `startSidecar` passes `operators: undefined`, so `broker.resolve` skips the operator check. Any authenticated non-proposer identity can approve another's pending decision. `startMultiSidecar` and the desktop IPC path both pass an operator set; the single-root sidecar does not. | `serve.ts:180`, `broker.ts:62` | code |
| **F-10** | **Scope non-deviation is broken — not shipped.** `scope.ts` (D1–D4, seal verification, budget metering, 7 green tests) is never wired: `boot.ts:61` passes no `scopeGate` to the PDP and `boot.ts:70` hardcodes `scopeNonDeviation: false`. The module is correct and inert. **Known; tracked for fix.** | `boot.ts:61,70`; `scope.ts` | probe (posture) |

---

## 1. Which guarantees depend on application semantics rather than independent isolation?

Most of them. Starfish is an **in-process policy layer**, not a sandbox — there is no OS-level
confinement anywhere in the tree. Every guarantee holds only because the code paths agree to route
through the PDP.

Concretely:

- **Boundary containment depends on the caller passing the real path.** `containCheck` is sound
  (canonicalize → realpath → prefix-compare → reject symlink components, `boundary.ts:61-73`), but it
  only checks strings that a translator hands it. F-5 is this failure in the shipped seam: the PDP
  adjudicates `.` while the tool reads `/etc/**`.
- **Egress containment is not an action control.** In the agent loop, `execute(call)` runs at
  `agentloop.ts:143` and egress scanning happens at `:147` — *after* the side effect. Egress governs
  what returns to the model, not what happens to the host. It is also a two-pattern scan
  (`containment.ts:5-11`), not a general DLP.
- **"Recoverable writes" depend on a backup that is allowed to fail silently** (F-4).
- **The exec hardening protects the entry point, not the payload.** `git_commit` and `node_test` are
  genuinely well-built — fixed binary, `execFile`, no shell, scrubbed env, `core.hooksPath=/dev/null`,
  argv allowlist (`templates.ts:19-25,36-39`). But `node --test` executes whatever test files are in
  the tree, and those are ordinary project files.
- **Risk classification is regex over `JSON.stringify(call.input)`** (`risk.ts:10-11,24`). It reasons
  about the *text of the request*, not about the effect.

What genuinely does not depend on application semantics: the hash-chained audit (`audit.ts:144-153`),
the path canonicalization itself, and the fail-closed registry load (`registry.ts:11-17`).

## 2. Which controls share upstream assumptions?

Three clusters, each with a single point of failure:

**Cluster A — everything downstream of `resourceOf`.** Policy evaluation, risk scoring, and the audit
`target` all take their resource from the same extraction (`pdp.ts:217-224`). F6 hardened this to
prefer declared `pathParams`, but the fallback still returns "first string-valued input in JSON
order". One wrong resource means the rule matched, the score computed, and the audit written are all
wrong together — and they will agree with each other, which is worse than disagreeing.

**Cluster B — everything downstream of the CC→governed translation.** `ccToGoverned` (`handler.ts:49-58`)
is the sole adapter between the model's tool vocabulary and the governed vocabulary. Boundary, secret
screening, risk tier, and audit all consume its output. F-5 and F-6 are both single defects in this
one function that disable multiple nominally independent controls at once.

**Cluster C — everything downstream of the audit file.** The monitor reads it (`monitor.ts:21`),
`selfintegrity` reads it (`selfintegrity.ts:107`), the sidecar streams it (`serve.ts:94`), and the
anchor validates it. F-1 removes the file; F-2 shows the detection layer then agrees everything is
fine.

The bracketed PDP design is real and good — but "two faces of one PDP" is defence in *depth*, not
defence in *independence*. Both faces share the registry, the risk engine, and the audit.

## 3. What happens when telemetry disappears rather than reports failure?

This is the sharpest question asked, and the answer is a defect.

The design intends: hash chain catches edits, head anchor catches truncation. The anchor is on by
default (`audit.ts:60`). But `recover()` — the only function that reads the anchor — runs only if the
log or the segment index exists:

```ts
// audit.ts:62
if (existsSync(path) || existsSync(this.segIndexPath())) this.recover();
```

Delete `audit.jsonl` and leave `audit.jsonl.anchor` on disk, and recovery never runs:

```
PROBE A anchor on disk = {"seq":1,"headHash":"9d127e14b4a3..."}
PROBE A integrity after log deletion = {"ok":true,"reason":"clean"}
PROBE A verify()  = true
PROBE A seq restarts at = 0
```

The anchor proving one event existed is sitting in the same directory, unread. The monitor then
concurs:

```
PROBE B counters with missing audit = {"denials":0,...,"concerning":0}
PROBE B findings = 0
PROBE B reconcile(allClear=true) ok = true
```

So: **absence reads as health, at both layers.** Partial corruption is handled well —
mid-file corruption and torn tails both enter safe mode (`audit.ts:95-99`), and truncation *with* the
log present is caught (`:102`). It is total absence that is indistinguishable from a fresh install.

The fix is one line — read the anchor unconditionally in the constructor. Note also that the anchor
write is itself best-effort and swallows its own failure (`audit.ts:78`), so a persistently unwritable
anchor degrades silently.

**Where absence is handled well:** the state-restore path deliberately distinguishes absent from
corrupt via an `UNREADABLE` sentinel rather than a shared empty-array fallback, precisely because
`loadJson` conflated them (`boot.ts:101-133`, and the F11 comment). That reasoning was correct and
was simply not applied to the audit log itself.

## 4. What authority increases when configuration is absent?

Mostly none — absent config is genuinely fail-closed at the top. Missing or corrupt `tools.json` /
`agents.json` throws at construction (`registry.ts:11-17`); an unknown tool is
`tool-not-registered (default-deny)` (`pdp.ts:106`); an unknown tool *category* now defaults to
`critical` rather than low (`risk.ts:18-23`); an unset secret gatekeeper denies rather than permits
(probe: `secret-file changes go through the gatekeeper (unset) — a denied`).

Three real exceptions:

**An agent that declares no `allowedTools` is unrestricted.**

```ts
// pdp.ts:128
if (agentDef?.allowedTools && agentDef.allowedTools.length > 0 && !...)
```

```
PROBE E agent w/ no allowlist = {"allow":true,"reason":"low-risk auto-allow"}
```

Deliberate backward compatibility, and documented as such — but it means *adding* an allowlist
restricts an agent and *omitting* one grants everything. Absence of configuration grants authority.

**Absent optional gates are simply off, and the default boot turns none of them on.** `boot.ts:45`
takes `selfIntegrity`, `enforceTaskBinding`, `anchor`, `secretGatekeeper` as options. The two shipped
callers — `desktop/src/host.ts:14` and `sdk/src/index.ts:51` — pass only `stateDir` and `skillsRoot`.
Actual posture:

```
POSTURE = {"integrity":false,"taskBinding":false,"scopeNonDeviation":false,
           "selfIntegrity":false,"secretGatekeeper":"toby"}
```

So "no task, no tool" is off, self-integrity attestation is off, anchoring is off. To the project's
credit this is *recorded and audited* rather than hidden (`boot.ts:66-74`) — that design decision is
what let me answer this question honestly at all, and it is the right pattern.

**Scope non-deviation is broken.** `scopeNonDeviation` is hardcoded `false` (`boot.ts:70`) and no
`scopeGate` is passed to the PDP constructor (`boot.ts:61`). The whole of `scope.ts` — D1–D4, seal
verification, budget metering, 7 green tests — is unreachable in the shipped product. The code is
correct and inert. This is a real gap, not a design choice: without it, a task's approved scope does
not narrow the agent's general grants at runtime, so an agent stays inside its *general* boundary but
is not held to its *mission*. **Known, and tracked for fix** (F-10) — the honest current statement is
"non-deviation is implemented and tested but not yet enforced," not "Starfish enforces non-deviation."

## 5. Which recovery paths bypass forward-path governance?

The forward delete path is the strongest thing in the codebase: hard rules that approval cannot
override, blast-radius assessment before anything is touched, soft delete to a recoverable trash,
never `unlink` (`deletion.ts:70-98,130-133`).

The recovery store itself is governed at the IPC layer, correctly: `privilegedPurge` requires a
capability token, a verified renderer bundle, and a native OS confirmation dialog the renderer cannot
synthesize (`privilegedipc.ts:88-100`). That is a well-reasoned answer to the renderer-RCE residual.

Two gaps:

- **`TrashStore.purge`/`purgeAll` take no PDP and no audit** (`fsdelete.ts:76-82`) — they are raw
  `rmSync(recursive, force)`. The guarantee lives entirely in the caller. `privilegedPurge` is a
  correct caller; the class does not enforce that all callers are.
- **`purgeAll` is not exposed through the privileged IPC path at all** (only `doPurge(id)`,
  `main/index.ts:240`), so today nothing reaches it — but it is a wipe-the-recovery-store primitive
  sitting one call site away from being reachable.
- **The purge audit is written after the irreversible act, through a swallowing wrapper**
  (`main/index.ts:229`: `try { ... } catch { /* noop */ }`). If the audit write fails, the purge has
  already happened and no record exists.

## 6. Who verifies the verifier?

Partially answered, with two holes.

Answered: self-integrity verifies the governance config, state, and audit against an operator-signed
manifest and drops the PDP into deny-everything safe mode on failure (`boot.ts:87-97`,
`selfintegrity.ts`). Safe mode is genuine — `decide()` returns deny before any other logic
(`pdp.ts:65-69`). The monitor's `reconcile()` exists specifically so a compromised semantic watcher
reporting "all clear" trips a critical alarm against deterministic counters (`monitor.ts:78-86`).
That is the right instinct.

Holes:

- **Self-integrity is off unless the caller opts in, and neither shipped caller does** (§4). The
  verifier of the verifier is not running.
- **`reconcile()` is never called in production** (F-8), and in any case reads the same audit file
  whose absence it cannot see (F-2). The watchdog's ground truth is the thing the attacker deletes.
- **`Registry.verifyIntegrity()` is never called in production** (F-7). Nothing re-checks
  `tools.json` after boot.
- **`broker.resolve`'s operator-set argument is optional**, and `startSidecar` omits it
  (`serve.ts:180`). Proposer≠approver is always enforced (`broker.ts:61`); "approver must be a human
  operator" is enforced only when a caller passes the set. Agent-vs-agent approval is possible on
  that path.

## 7. Which components can still become indispensable chokepoints?

- **`AuditLog`** — the PDP fails closed if it cannot write (`pdp.ts:84-86`), which is correct and
  means a wedged audit is a total denial of service. That is the right trade, and it should be stated
  as an availability property rather than discovered in production.
- **`PDP.decide`** is a synchronous single choke point on every call, doing regex scans over
  `JSON.stringify(input)` (`risk.ts:24`) plus filesystem `existsSync`/`realpathSync` walks per path
  (`boundary.ts:10-22`). The 10ms budget is a design target; nothing in the code enforces or measures
  it.
- **`DecisionBroker`** holds waiter promises in memory (`broker.ts:29,48`). Pending records persist,
  but the awaiting caller does not — a restart leaves the decision re-offered while whatever was
  blocked on it is gone.
- **`ScopeContractLedger`** would become one if wired: it is a single `Map` (`scope.ts:67`) that
  meters every admitted call, and `check()` mutates budget state (`:139`) inside what the PDP treats
  as a pure decision.

## 8. What happens if the audit subsystem itself becomes unavailable?

**It depends on the ring, and the rings disagree.**

Ring 1 (PDP) fails closed. Verified:

```ts
// pdp.ts:74-86
try { this.audit.append({...}); }
catch { return { allow: false, reason: 'audit-write-failed (fail-closed)' }; }
```

Ring 3 (PEP) fails **open**. The executor's audit helper swallows the failure and execution proceeds:

```ts
// peps.ts:34
{ try { opts.audit?.append({...}); } catch { /* noop */ } };
```

Same pattern at `main/index.ts:229` (privileged IPC, including purge) and at `handler.ts:86,116` —
though in the hook cases the function denies immediately afterward regardless, so those are benign.

So: an unwritable audit denies all *decisions* but does not stop *execution* that was already
authorized, and does not stop privileged operator actions. And per F-1, a *deleted* audit produces no
failure at all — it produces a clean-looking fresh log.

## 9. Can an operator distinguish control absent, disabled, failed, and not applicable?

**Absent vs disabled: yes** — this is done unusually well. `EnforcementPosture` is computed from the
actual wiring and written to the audit at boot (`boot.ts:66-74`), explicitly so that "off" is a
visible fact rather than an invisible absence. That is better than most systems manage.

**Failed vs not-applicable: no.** F-4 is the clean example. `snapshotBackup` returns `false` for both
"file did not exist, nothing to back up" (`handler.ts:65`) and "backup threw" (`:72`). The caller
renders that single boolean as:

```ts
// handler.ts:131
(backed ? '; backed up' : '; new file')
```

Probe, overwriting an existing file with an unwritable backup directory:

```
auto w/ UNWRITABLE backup dir -> {"permissionDecision":"allow", ...}
audit line = ..."reason":"[Starfish] in-boundary write auto-allowed (writes=auto; new file)"
```

The file existed and was overwritten with no recoverable copy. The audit says `new file`. An operator
reading the log cannot tell a safe creation from a destroyed original.

Same conflation elsewhere: `writeAnchor` swallows failure (`audit.ts:78`), `broker.save` swallows
failure (`broker.ts:76`), `snapshot` in the PEP returns bare `false` (`peps.ts:28`).

**Control failed vs control denied is also blurred at the top:** `decide()` audits a deny with a
`reason` string, so `evaluator-error (fail-closed)` (`pdp.ts:177`) and a legitimate policy denial are
the same `decision:'deny'` shape, distinguished only by prose an operator has to read.

## 10. How much of the security model survives if the model learns the policy implementation?

The deterministic core survives; the heuristic layer does not.

**Survives** — knowing the rule does not help you break it: path canonicalization and prefix
containment (`boundary.ts`), default-deny on unregistered tools, the hash chain, proposer≠approver,
the deletion hard rules, the exec templates' fixed argv, and the sanctity invariant that
memory-derived input can never authorize a non-read tool (`pdp.ts:112-117`) — which is the single
best control in the codebase, because it is structural rather than detective.

**Does not survive** — these are string matches an adversary who has read them can walk around:

- `CRITICAL`/`HIGH` regexes over the serialized input (`risk.ts:10-11`). The tier is decided by
  whether the request *text* matches, so semantically-equivalent phrasing lands in a different tier.
- `isCatastrophicShell`'s 11 patterns (`handler.ts:28-45`). Genuinely well-iterated — long-form flags,
  NVMe devices, `find -exec rm`, `$PWD` — but it is a denylist, and a denylist you have read is a
  puzzle, not a wall.
- `scanEgress` — two patterns (`containment.ts:5-11`).
- `commandReadsSecret`, `screenEnv` — same class.

The honest framing: Starfish's deterministic layer is policy-complete against a model that knows it;
its heuristic layer is speed-bump-grade against the same model. The architecture separates these
cleanly, which is good, but the marketing should not average them.

## 11. Which controls reduce probability of harm versus actually reduce available authority?

**Genuinely reduce authority** (the action becomes impossible, not unlikely):

- Boundary containment — the path is outside the root; there is no phrasing that fixes that.
- Default-deny on unregistered tools (`pdp.ts:106`).
- Memory-derived inputs cannot authorize write/exec/meta (`pdp.ts:112`).
- Deletion hard rules — not overridable by approval (`deletion.ts:70-78`).
- Exec templates — fixed binary, no shell, argv allowlist (`templates.ts`).
- Safe mode — deny everything (`pdp.ts:65`).
- Trusted OS confirmation for irreversible IPC ops (`privilegedipc.ts:93`).

**Only reduce probability:**

- Every regex tier/denylist in §10.
- The monitor in its entirety — read-only by design, "surfaces findings and escalates, but never acts"
  (`monitor.ts:1-2`) — and currently not called at all (F-8).
- The `ask` tier, when a downstream profile can convert it to `allow` (F-3).
- Pre-image backups (F-4).
- Egress scanning, which runs after the effect (`agentloop.ts:143,147`).

**Actively grants authority**, and belongs in neither column: `writeProfile:'auto'`. Its own comment
claims "the PDP has already DENIED anything that risks the system... this only ever relaxes safe,
in-project, recoverable writes." Two of those three assumptions are false: it cannot tell an operator's
explicit `ask` from a routine one, and recoverability is not verified. Probe, same policy both times:

```
writes=ask  -> {"permissionDecision":"ask",   "reason":"policy requires human review (ask)"}
writes=auto -> {"permissionDecision":"allow", "reason":"[Starfish] in-boundary write auto-allowed (backed up)"}
```

An operator wrote a rule demanding review. A friction setting elsewhere in the config silently voided it.

## 12. What is the smallest exploit chain from model output to irreversible host effect?

**Two hops, no human, at Medium risk tolerance — arbitrary code execution as the user.**

Preconditions, all default or operator-selectable, none exotic: risk tolerance Medium (an offered
setting, `pdp.ts:59-62`), an `exec`-category test tool registered, project-root write boundary.

```
tolerance=medium
   step1 fs.write evil.test.js = {"allow":true,"reason":"medium-risk auto-allowed ... (score 40)"}
   step2 run_tests             = {"allow":true,"reason":"high-risk auto-allowed ... (score 60)"}
```

1. Model emits `fs.write` for `<project>/evil.test.js` containing `require('child_process')...`.
   In-boundary, not a secret path, tier medium, score 40 ≤ ceiling 70 → **auto-allowed**.
2. Model emits `run_tests`. Category exec, tier high, score 60 ≤ 70 → **auto-allowed**.
   The PEP runs `node --test` (`peps.ts:72`), which executes every test file in the tree — including
   the one just written.

The template hardening does not help here. It was built to stop `package.json` being the entry point
(T-05), and it does that correctly — but the payload is an ordinary project file, and running project
test files is the tool's purpose. `filterTestArgs` rejects flags, not files.

At Low tolerance (the default) both hops return `ask` and a human sees them. So the chain is
**gated entirely by one operator setting**, with no second independent control behind it.

**A shorter chain — one hop — exists for destruction rather than execution:** with
`writeProfile:'auto'`, a single `Write` to any existing in-boundary file is auto-allowed regardless of
operator policy (F-3), and the pre-image backup may silently fail (F-4). Model output to unrecoverable
overwrite, no human, one step.

**What stops the chain going further:** it does not escape the project root (boundary holds), does not
reach secrets (gatekeeper holds), and cannot delete folders or system paths (hard rules hold). The
compromise is arbitrary code execution as the user with the user's own privileges — which of course
then makes every in-process control moot, since there is no OS sandbox underneath. That is the T-25
gap, and it remains the honest headline: **Starfish governs a cooperative process; it does not contain
a hostile one.**

---

## Recommended fixes, in order

1. `audit.ts:62` — read the anchor unconditionally; absent log + present anchor ⇒ safe mode. *(F-1, one line)*
2. `monitor.ts:20,95` — treat a missing audit path as a critical finding, not an empty window. *(F-2)*
3. `handler.ts:129` — carry the *reason* for `ask` in the `Decision` and refuse to auto-allow when it
   came from an explicit operator policy; require `backed === true` before allowing an overwrite. *(F-3, F-4)*
4. `handler.ts:65,72` — return a tri-state (`'backed' | 'not-applicable' | 'failed'`) and audit it. *(F-4, and §9 generally)*
5. `handler.ts:52` — carry the Glob/Grep pattern into the governed call and boundary-check it. *(F-5)*
6. Call `monitor.sweep()` and `registry.verifyIntegrity()` from a production path. *(F-7, F-8)*
7. `serve.ts:180` — require an operator set on `startSidecar`. *(F-9)*
8. `peps.ts:34`, `main/index.ts:229` — fail closed on audit-write failure, matching ring 1. *(§8)*
9. Wire `scopeGate` into `boot.ts`, or mark `scope.ts` as not-yet-shipped in the docs. *(§4)*
10. Add a conformance test asserting the §12 two-hop chain is denied at Medium tolerance.
