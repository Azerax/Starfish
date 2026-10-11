# Release notes — v0.28.0 (unreleased)

**The bounded-semantics release.** Two new boundaries and one deprecation, all shaped by the same
question: *how do you let something probabilistic, or something you do not control, near a
deny-by-default gate without it becoming a way past the gate?*

The answer both boundaries land on is **monotonicity**. A semantic signal can raise risk and never
lower it. An external control plane can subtract authority and never add it. Denials compose; grants
do not. That is what makes an untrusted input safe to admit: the worst case is lost availability, not
lost authority.

---

## The constraint that shaped the design

The obvious build was a `DecisionProvider` that the PDP consults — ask a model, get `allow`/`deny`,
combine. Three facts in the existing code ruled that out, and finding them was most of the work:

- **`PDP.decide()` is synchronous and pure.** `pdp.determinism.test.ts` pins 1000 identical calls to
  byte-identical JSON. A network call on that path breaks the test and the invariant behind it.
- **`detectors.ts:1-8` already said no.** Verbatim: a constrained semantic classifier "is deliberately
  not implemented here — it would need a model call, and governance-core stays network-free and off
  the PDP's synchronous hot path by design."
- **`detectors.ts:2-5` already said where instead.** New signals are "INPUTS to the one risk scorer
  (score.ts), never a second scoring path."

So the design was already specified by the codebase; it just had not been built. `foldInquiry()`
returns `CategoryScores` for the existing 50-category scorer. **There is still exactly one scorer and
one reducer.** Rationale and the rejected alternatives are in
`docs/adr/0002-semantic-signal-boundary.md`.

---

## Security — H5 input re-provenance, and the blind spot that hid it

`reachability.conformance.test.ts` was the most valuable thing in v0.27.0. It still is. It is also a
**hand-written enumeration**, and a test built from a remembered list can only find what is on the
list. Pointing its own question at the modules it did not cover found a live instance of exactly the
defect class it exists to prevent.

**`attest.ts` was implemented, correct, audited when called, and called by nothing.** It closes a
time-of-check-to-time-of-use gap — stamp a file's content hash when a task picks it, re-verify at use,
treat a changed hash as a deviation rather than trusted input. Neither half had a production caller:
not the PDP, not the agent loop, not the SDK, not a test. The same shape as F-7, F-8 and F-10, one
layer below the suite written to catch them.

### Where it belongs, and why it was never there

The same reason non-deviation sat dark: the enabling half didn't exist. Nothing in the call flow said
*these are this task's input files*, and a verify with nothing stamping it always passes.

But the seam was already in `pdp.ts`, with a precedent twenty lines away. `execProvenance` already
records, per task and only on allow, which files a write produced. So:

| Moment | Call | Action |
|---|---|---|
| the **pick** | allowed `read` with a taskId | `stampInputs(taskId, paths)` |
| the **use** | `exec` with a taskId | `verifyInputs(taskId)` → deny on change |

Stamped only on allow, for the same reason a denied write never taints a task. Verified in the exec
floor block beside the secret-read and self-authored checks — and it **denies rather than escalating**,
a deliberate departure from both. Those escalate because reading a `.env` or running a test you just
wrote are things a human might legitimately approve. There is no legitimate reading of *"these are not
the bytes I approved."*

Reachability now asserts **both halves and the PDP as the enforcement point**. Either alone would be
theatre.

### The regression our own suite caught

Recorded because it is the most useful part. The first version gated the verify on the *method
existing* rather than on `scopeGate.enforce`. `verifyInputs` fails closed when a task has no contract —
correct for the ledger, wrong as a PDP precondition — so **with non-deviation off, every exec carrying
a taskId was denied.**

Three tests failed immediately: the Q12 targeting tests from v0.27.0, written to prove self-authored
execution is *narrow*. Four months later they caught an unrelated control being over-broad, in a
different mechanism, from a different change. A test that pins what a control must **not** do outlives
the reason you wrote it.

Fixed by gating on `enforce` — H5 is part of non-deviation and follows its mode; and when the gate is
on, `check()` has already refused a missing contract upstream, so a failure can only mean the bytes
changed. Regression test added for mode `off`.

### Three documentation defects found the same way

In a governance product a comment that overstates a guarantee is a defect, because the comment is what
the next person builds on.

- **`allowCommandsByDefault` never did anything** — both branches normalised to `[]`, so `true` and
  `false` were identical. D3 has no wildcard and no per-agent command grant to mirror, so the option is
  inexpressible; implementing it would undo the one place derivation deliberately tightens. Deprecated,
  with a test pinning the no-op.
- **`ScopeContract.frozen` is never read as a condition.** The immutability is enforced by the seal and
  by `amend()` being the only mutation path, not by the boolean. Now documented as informational.
- **`boot.ts` overclaimed the seal's reach** — true for the seven sealed fields, false for `used`,
  `inputs` and `frozen`. Those are unsealed deliberately: sealing an observation would make a no-actor
  method a mutation path for a sealed object, routing around proposer ≠ approver. A hand-edited state
  file can reset the call meter; it cannot widen authority. Both halves now stated.
- **A divergent re-issue is audited** rather than silently returning the original.

### What this does not fix

The suite's coverage is still a hand-maintained enumeration. It now covers one more module. The next
unwired module will be found the same way this one was — by someone asking what the list is missing.

**The v0.27.0 lesson needs one more clause:** green tests are not evidence of an enforced control, and
a reachability test is only evidence for the controls it was told about.

---

## Added — bounded semantic inquiry

`packages/governance-core/src/inquiry.ts`. Typed questions in, advisory signals out.

Three **closed** question kinds and no free-text kind, which is the point: an unbounded answer cannot
be validated, cannot be calibrated, and cannot be folded into a number without an interpretation step
that would itself need governing.

| Kind | Shape |
|---|---|
| `choice` | exactly one member of a closed set (≥2, distinct) |
| `level` | one position on an ordered scale 1..n |
| `likelihood` | probability 0..1 that one declared statement is true |

**Raise-only monotonicity is the load-bearing property.** A fold contributes to exactly one of the 50
risk categories and can only ever raise it. A compromised, miscalibrated, hallucinating or hostile
provider can make Starfish *more* cautious and nothing else. `InquirySignal` has **no `allow`,
`deny`, `ask` or `approve` field anywhere on it**, so constitutional principle 7 — probabilistic
models may classify but may not authorize — is structural rather than advisory. A conformance test
asserts those fields are absent.

**Fail-closed direction follows `score.ts`, not `confidence.ts`.** The two existing modules fail in
opposite directions on purpose: the scorer clamps unknown input to 10 because high risk is the safe
assumption; `confidence.ts` fails to zero because there high confidence is the dangerous direction.
Inquiry follows the scorer. Absent, late, malformed, abstained and low-confidence signals all
contribute the question's failsafe score. **Silence is treated as danger, not as permission.**

Other properties worth knowing:

- **Thresholds must be complete or the fold refuses.** A threshold set that misses an option, has the
  wrong number of levels, or does not cover probability up to 1 is rejected rather than defaulted — a
  silently-defaulted threshold is indistinguishable from a configured one in an audit record.
- **Questions are versioned instruments, not editable prompts.** `version` is inside the provenance
  hash, so rewording invalidates every signal and calibration bound to the old wording. A signal whose
  `contentHash` does not bind to the current request is refused as a replay.
- **A fixture keyed by `questionId:version` will not answer a different version.** It reports
  `unavailable`. That is what makes offline conformance meaningful rather than self-confirming.
- **Classified state cannot reach an uncleared provider.** Admission is checked *before* the provider
  is handed anything, so "we asked and it said yes" cannot be manufactured.
- **Network stays out of ring 1.** The HTTP path is a request *builder* plus a parser; a higher ring
  sends, mirroring `provider.ts`'s `AgentRuntimeAdapter.buildRequest()`. There is **no default
  endpoint** — a default endpoint is a silent cloud fallback.

## Added — vendor-neutral MCP control-plane boundary

`controlplane.ts`. The order is fixed: **Starfish decides, then the call is forwarded.**

- An external plane's `allowed` **never** overrides a Starfish deny.
- Its `denied` **does** stop an otherwise-allowed call.
- A refused admission never reaches the plane at all.
- `docker-sibling` and `in-process` sandboxes are **refused in prod** regardless of what a registry
  entry claims about itself. The Obot Docker quick start mounts the host socket; a sibling container
  sharing the host daemon is not an isolation boundary.
- A thrown forward yields `forwarded-lost`, not `forwarded-error` — **"we do not know" is not "it did
  not happen"**, and completion logic must treat them apart.
- External audit ids are *correlated into* the Starfish record, never substituted for it. An activity
  log records that a call was made; it does not establish the claimed real-world effect, which is what
  principle 6 requires.

Includes `FakeMcpControlPlane`. **No Obot dependency, and none is planned** — principle 12.

## Deprecated — `ToolCall.taskId` is becoming required

A three-rung ladder, deliberately the same shape as the existing `ScopeMode`, so an operator who
understands one understands the other.

| Rung | Call with no taskId | Call that claims a taskId |
|---|---|---|
| `off` | allowed, unrecorded | not checked |
| `observe` | **allowed, attributed** | **still checked** |
| `required` | denied | checked |

The second column is what makes `observe` safe. A call that *claims* a taskId must have a valid active
one in every rung above `off` — only a **missing** taskId is a legacy caller. A bad taskId is a
violation, not a migration case. Same semantics as `scopeMode: 'contracted'`.

So `observe` admits **precisely** the calls `off` admits and records more. It cannot weaken the
fail-closed floor, which the deprecation policy says is never subject to deprecation. A conformance
test asserts the two rungs return identical decisions.

**This release changes no behaviour.** The default stays `off`; the deprecated `enforceTaskBinding`
still maps to `required`. Agreed sequence:

- **0.28** — `taskBindingMode: 'observe'` available, opt-in.
- **0.29** — default becomes `observe`. Still admits untasked calls; now everyone sees who they are.
- **0.30** — default becomes `required`, `taskId` becomes non-optional, and `TaskBoundToolCall`
  becomes a plain alias of `ToolCall` so every call site written against it needs no edit.

### Promotion is evidenced, not scheduled

`pdp.taskBindingMigration()` reports readiness derived from what was observed, and **names the
offending agent+tool pairs** — a bare count tells you legacy callers exist; attribution tells you
whom to go and fix, which is what actually finishes a migration.

The guard that matters: **in `off` mode readiness is always `false`**, with the reason *"not observing
— absence of recorded untasked calls is not evidence that none occur."* That exists because of F-10
(`boot.ts:30-35`), where a hardcoded `false` "read as an honest disclosure while being
unfalsifiable." A readiness flag reporting clean because nothing was watching is the same bug wearing
a different hat.

The deprecation notice is audited **once per agent+tool pair**, mirroring the once-per-agent
discipline already used for the `agent-unrestricted` grant, so a chatty legacy agent cannot flood the
ledger while every call is still counted.

Two fail-safes: an unrecognised mode string resolves to `required`, never `off`, so a typo cannot
silently disable a gate; and the audit write is wrapped, because telemetry must never fail a call.

`EnforcementPosture.taskBindingMode` is derived from the live binding, never a literal. The default
rung is **frozen by a conformance test** — promoting it at 0.29 requires a hand edit there, in the
same spirit as the wire and API freeze suites.

---

## What this release does NOT change

Stated plainly, because the v0.27.0 lesson was that a green module is not an enforced control.

- **Nothing calls `foldInquiry()` yet.** The module is exported, tested and reachable, but no
  production path folds a signal into a real decision. Deliberate: the next slice should wire exactly
  one call site in shadow mode and compare against the production path first. Until then, Starfish's
  decisions are exactly what they were in 0.27.0.
- **The calibration statistics do not exist.** The record schema and the expiry check are real. Nothing
  computes accuracy, calibration error, coverage or drift. `treatCalibrationAsValid()` checks only that
  a human approved a threshold set and that the approval has not expired. **No statistical guarantee
  should be claimed from a hand-filled calibration record.**
- **"No task, no tool" is still opt-in.** The ladder gives the migration a path; it does not flip the
  default. The C-7 qualification made to `index.html`, `README.md` and `SECURITY.md` in v0.27.0
  **remains correct and must stay** until 0.30. The boot posture is still the source of truth for
  which gates are live.
- **No Obot integration exists.** A vendor-neutral interface and a fake. No adapter, no dependency.
- **T-25 is unchanged.** No OS-level isolation. Neither boundary here moves that line.

---

## Verification

`npm run ci` green on Windows — all ten steps: `typecheck`, `typecheck:azure`, `test`,
`test:conformance`, `test:determinism`, `lint:deps`, `smoke:azure` (5/5), `scan:secrets` (519 files),
`scan:ip`, `sbom` (76 packages, no incompatible copyleft).

New tests, 117 across four files:

| Suite | Tests |
|---|---|
| `inquiry.conformance.test.ts` | 41 |
| `taskmigration.conformance.test.ts` | 36 |
| `controlplane.conformance.test.ts` | 33 |
| `inquiry.determinism.test.ts` | 6 |

`pdp.determinism.test.ts` still passes — the untasked tracker mutates a counter, not a return value,
consistent with the `audit.append` and `execProvenance.note` side effects already on that path.
`reachability.conformance.test.ts` passes, which matters given its rule that a control referenced only
by its own tests is not an enforced control.

## Files

**New:** `packages/governance-core/src/inquiry.ts`, `controlplane.ts`, `taskmigration.ts`, their four
test files, and `docs/adr/0002-semantic-signal-boundary.md`.

**Modified:** `pdp.ts` (three-rung task binding, `resolveTaskBindingMode`, `getTaskBindingMode`,
`taskBindingMigration`), `boot.ts` (`taskBindingMode` option, derived posture field), `types.ts`
(`TaskBoundToolCall`, `asTaskBound`, JSDoc deprecation), `index.ts` (exports), `CHANGELOG.md`.
