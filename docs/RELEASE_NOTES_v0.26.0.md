# Project Starfish v0.26.0 — release notes

**Date:** 2026-08-01 · **Theme:** threats stop being handled ad hoc and start being handled
like everything else in Starfish — as governed, auditable, dual-controlled evidence with a lifecycle,
not a flat signature list you either trust or don't.

This release adds the first four increments (of ten planned) of the **Threat Immunity Fabric**: a
governed lifecycle for turning a detection into adopted, auditable threat evidence — observe →
reproduce → corroborate → approve → publish → deploy → retire/revoke. It is deliberately additive: it
supplies *input* to the existing single risk engine, it is never a second one.

---

## Scope — what this adds, and what it deliberately doesn't yet

Full design and fit-assessment against the existing codebase: `docs/design/THREAT_IMMUNITY_FABRIC_PLAN.md`.
The short version: most of a "threat immunity fabric" already existed in `governance-core` — the four
gateways, the hash-chained ledger, dual-control approval. What was actually missing was a **governed
evidence lifecycle** to carry a detection from "something looked wrong" to "adopted rule," with the same
rigor the rest of the codebase already applies to memory writes and tool calls. That's what this release
adds.

**What this does NOT do:** it does not add a second risk-scoring system, a synchronous model call on the
tool-authorization hot path, cross-organization threat sharing, or automated reproduction of a threat in
an isolated sandbox. Those are later increments (TIF-2, TIF-5 through TIF-10) — see "What's next" below.

---

## What this release adds

### A governed lifecycle for threat evidence, not a flat block-list
A detection is no longer "trusted or not" — it moves through an explicit, auditable state machine:
`OBSERVED → REPRODUCED → CORROBORATED → APPROVED → PUBLISHED → DEPLOYED → RETIRED`, with `REVOKED`
reachable from every non-terminal stage (revocation is first-class and must never be slower than the
forward path). Each transition is validated against a fixed table of legal edges — there is no way to,
say, deploy evidence that was never approved. (`packages/governance-core/src/evidencetypes.ts`,
`evidence.ts`)

### Independent corroboration, not self-attestation
Advancing past `REPRODUCED` requires **two distinct validator identities**, not two submissions from
the same one — the same "independence, not volume" principle already enforced for evidence sources
elsewhere in the codebase. And the same operator who published the evidence can never be the one who
corroborates or approves it — proposer and approver are structurally different identities, the same
dual-control pattern already used for memory-wiki approvals and scope-contract amendments.

### Tamper-evident by construction
Every evidence envelope is cryptographically sealed at observation time. If a stored record is edited
outside the lifecycle's own methods — including by something with direct file/database access — the
next legitimate transition detects the seal mismatch and refuses to proceed, rather than silently
operating on tampered data.

### Detector inputs: behavioural and structural
Two of the plan's five detector classes ship as inputs to the existing risk scorer: **behavioural**
(flagging when a request from an external source touches a category it should never legitimately need —
e.g. a webpage asking for credential access) and **structural** (classifying where in a document a
suspicious feature was found — hidden text, PDF footer, embedded metadata — failing closed to
"suspicious-unclassified" for anything unrecognized rather than silently dropping it).
(`packages/governance-core/src/detectors.ts`)

### The ledger already covers this — now it's wired
Every lifecycle transition is written to the existing hash-chained audit log under a new `'threat'`
domain. No new storage or anchoring mechanism was needed — this is pure wiring onto infrastructure that
already existed for every other kind of governed decision in the system.

### Advisory only — the one risk model stays the one risk model
A `fabricAction` recommendation attached to evidence (e.g. "quarantine") is advisory input only. Nothing
in this release calls the policy decision point directly or computes a second composite risk score —
that discipline is enforced structurally, not just by convention, and is checked by a dedicated
conformance test.

---

## Verification

- `tsc --noEmit` clean against the real `tsconfig` chain.
- The 23 tests specific to this work (16 lifecycle conformance, 7 detector conformance) pass in
  isolation, covering every invariant above including the tamper-detection and dual-control cases.
- Whole-repo suite (this TIF work plus everything else on the branch, including the unrelated v0.25.0
  hardening and desktop UI work): **104 test files, 704 passed, 1 skipped.** The earlier number in this
  doc (63 files / 504 passed) was from a narrower scratch run scoped to `governance-core` only, taken
  before the rest of the branch's work — including v0.25.0's desktop IPC-authority tests — was in the
  same tree; it undercounted what's actually on this branch, not a regression.
- Verified twice: once via `tsc --noEmit` + a scratch Linux install in the cloud sandbox (the repo's
  local `node_modules` on Windows carries native bindings that can't run the test runner directly), and
  again natively via `npm run ci` on Windows before the TIF commit landed.

## What's next

- **TIF-2 — reproduction sandbox.** Today, advancing evidence to `REPRODUCED` requires an external
  caller (in practice, a human validator) to supply a `{ok, detail}` result. TIF-2 replaces that with an
  isolated replay: run the candidate threat sample against a disposable, no-egress context and capture
  only its *proposed* effects. This is the next planned increment.
- **TIF-5 onward — Trust Fabric identity, the cross-org broker, progressive deployment, anti-poisoning,
  governed detector learning.** Blocked on two decisions: the key-rotation epoch length for
  publisher/validator/approver identities, and whether the threat-feed manifest lives in the same
  GitHub org as this repo or is fully external. See `docs/design/THREAT_IMMUNITY_FABRIC_PLAN.md` §9.
- **Semantic and canary detectors** (the two remaining detector classes) are not yet built. Semantic
  detection needs a model call and, per the plan, must stay off the synchronous authorization path the
  same way the existing behavioural monitor does. Canary detection depends on the still-design-only
  Deception Cell.

## Sequencing note

This is independent of, and unrelated to, `v0.25.0` (the adversarial self-audit hardening pass, 26
findings closed) — nothing here depends on that release, and nothing in v0.25.0 depends on this one.
v0.25.0 ships first since it's already mid-release; v0.26.0 follows it as its own numbered release.
