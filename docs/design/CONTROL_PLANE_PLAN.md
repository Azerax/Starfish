# Starfish Control Plane — plan for the ten proposed modules

> **Status: plan, not a commitment.** Nothing here is in `ROADMAP.md` yet. Written 2026-10-11 against
> the live repo at `6e9a219` (v0.27.0 tagged, v0.28.0 work present but **uncommitted** — see §0).
> Follows the convention of `THREAT_IMMUNITY_FABRIC_PLAN.md` and `azure.md`: state what is actually
> true about the codebase before proposing what to build, and separate what is decided from what is
> still open.

---

## 0. Two findings that change the shape of the work

### Finding 1 — four of the ten are substantially built, and two are sitting in the working tree

The proposal reads as ten new modules. Against the code it is closer to **wire 2, extend 3, build 4,
and one is a rename of work already committed on the roadmap.**

Most consequentially: **#4 Starfish Decision Engine and #7 Zero-Trust MCP Gateway already exist** as
`packages/governance-core/src/inquiry.ts` and `controlplane.ts`, with conformance and determinism
suites and an ADR. They are **untracked in git** and have **no production callers**. The PRD for #4 is
`docs/adr/0002-semantic-signal-boundary.md`.

### Finding 2 — the tree has not been committed for two weeks

`git log` is still at `6e9a219`. A **cherry-pick is still in progress**, and ~30 modified/untracked
files sit on top of it, including every file named in this plan. `v0.12.0`–`v0.22.0` and `v0.24.0`
have release notes but **no git tags**, so those releases never passed through `release.yml` (which
triggers on `tags: ['v*']`).

**This is the blocking item.** No module below should start before the tree is landed and tagged,
because every one of them builds on files that currently exist only in a working directory.

---

## 1. The ten, against what is actually in the repo

| # | Module | State | What exists | What is genuinely missing |
|---|---|---|---|---|
| 1 | **MCP Sentinel** | **Partial** | `controlplane.ts`: `McpInvocation` correlation record, `forwarded-lost` distinguished from `forwarded-error`, `inputCommitment`, admission before forwarding | Retry policy, idempotency keys, duplicate-execution defence, **outcome verification** |
| 2 | **Agent Observability** | **Partial** | Hash-chained audit with `prevHash`/`hash`, `execProvenance` per-task, `SecurityMonitor` reconciliation, `EnforcementPosture`, SSE decision stream | **Zero OpenTelemetry** — no `traceId`/`spanId` anywhere in `packages` or `azure`. No span model, no exporter |
| 3 | **Governed Semantic MCP** | **Not started** | nothing | All of it. Research, not engineering (§6) |
| 4 | **Decision Engine** | **BUILT, unwired** | `inquiry.ts` — three bounded question kinds, `InquiryProvider` boundary, fixture + rules providers, HTTP builder, **shadow mode**, confidence floor, calibration schema, raise-only monotonicity. ADR 0002 | A production call site; the calibration *statistics* (schema only today) |
| 5 | **Persistent Memory Graph** | **Mostly built** | Memory Wiki Phase 1 (v0.24.0). `LinkKind = 'supports' \| 'contradicts' \| 'depends-on' \| 'supersedes' \| 'part-of'` — verbatim the proposed relationships. Provenance, `confidence.ts` aggregation, quarantine, clearance-aware retrieval, dual-control promotion | Phase 2: analyst mode, local embeddings from approved pages only. Already on `ROADMAP.md` |
| 6 | **Code Memory / Code Graph** | **Not started** | nothing | All of it |
| 7 | **Zero-Trust MCP Gateway** | **BUILT, unwired** | `controlplane.ts` — registry provenance (content hash, owner, approval state, environments, principals, review expiry), credential **references** with secret-shape refusal, prod sandbox refusal, external-opinion composition, `FakeMcpControlPlane`. Plus `azure/tier2-gateway/gateway.ts` for the network shape | A production call site; real credential-broker integration |
| 8 | **Permission-Aware Local AI** | **Partial, stronger than stated** | `retrieval.ts` already enforces need-to-know: confidentiality ranks, per-reader clearance, unknown clearance → cleared for nothing, withheld bodies, quarantine never served. `localAdapter` for on-prem OpenAI-compatible endpoints | Ingesting *real* document ACLs (SharePoint/file-share), embeddings, and the chunk-level permission join |
| 9 | **Shipyard** | **Not started** | nothing | All of it |
| 10 | **Starfish OS** | **Partial / mostly a rename** | `router.ts` model routing with budget states, `localAdapter`, `EnforcementPosture`, fail-closed boot | The OS-level enforcement half **is** H1 + "governance-core in its own process", both already committed on `ROADMAP.md` |

**Net:** two to wire, three to extend, four to build, one already committed under a different name.

---

## 2. The observation is right, and the substrate already exists

The proposal's own conclusion — *don't build five independent governance systems, build one control
plane with shared identities, policy decisions, execution receipts, audit evidence and failure
semantics* — is correct, and it is the same conclusion the Threat Immunity Fabric plan reached about
itself: *"most of the architecture already exists."*

Each of the five shared things it asks for has a concrete owner today:

| Shared concern | Already owned by |
|---|---|
| Agent and task identity | `ToolCall.taskId` + `TaskBoundToolCall`, and the `off → observe → required` migration ladder in `taskmigration.ts` |
| Deterministic policy decision | `PDP.decide()` → `score.ts`'s single scorer → `verdictFor`. **One scorer, one reducer** — the rule that keeps new signals from becoming a second engine |
| Execution receipt | `McpInvocation` (controlplane), `DecisionReceipt` (evidence), `ScopeContract.planHash` |
| Tamper-evident evidence | `audit.ts` hash chain + head anchor, `anchor.ts` Merkle notarization |
| Failure and recovery semantics | fail-closed throughout, safe mode on integrity failure, `forwarded-lost` ≠ `forwarded-error` |

So "build one control plane" is **a naming and wiring exercise over existing primitives**, not new
foundations. The discipline that makes it hold is already written down in ADR 0002: a module may
contribute *evidence* to the one scorer; it may never produce a verdict.

---

## 3. The one primitive that is actually missing

Modules 1, 2 and 4 are not three problems. They are three views on a record that does not exist yet.

Today the system can prove **an agent said it finished**. `claims.ts` grades an agent's own claims
against the ledger and refuses unbacked ones. What nothing can prove is **that the effect happened in
the world.**

> A control plane's activity log records that a call was made. It does not establish that the claimed
> real-world outcome occurred — and `GOVERNANCE.md` principle 6 requires the second thing.

### `CompletionReceipt` — the proposed record

One append-only record correlating the whole chain, with a **status that distinguishes the cases that
currently collapse together**:

```
taskId · decisionId · approvalId · invocationId · remoteInvocationId · externalAuditId
requestedEffect · toolResponse · observedFinalState
verificationMethod · verifierIdentity · evidenceHashes[]
status · discrepancy · auditSeq
```

```
status:
  not-executed            the call never left
  started                 dispatched, no response yet
  returned-success        the tool said it worked        <- today's ceiling
  response-lost           dispatched, outcome UNKNOWN    <- not a failure
  verified                observed state confirms the intended effect
  contradicted            observed state refutes it
  unverifiable            no verification method exists for this effect
  claimed-unverified      the agent asserted completion with insufficient evidence
```

The three middle values are the point. `returned-success` is where the industry stops.
`response-lost` is not `not-executed`. And `claimed-unverified` is the one that makes an agent's word
non-spendable for consequential work.

**Build this first.** Then:

- **MCP Sentinel** is the logic that *populates* it — retry, idempotency, verification probes.
- **Observability** is the trace that *reads* it — spans keyed on the same ids.
- **Decision Engine** is the thing whose decision it *cites* — `decisionId`.

One record, three modules, no duplicated governance logic. Build the three separately and each invents
its own correlation scheme.

---

## 4. Milestone 1 — "prove it ran correctly, don't report that it finished"

The proposed thesis, which is the right one. Five increments, each independently shippable.

### M1.0 — Land the tree *(blocking, hours)*
Finish the cherry-pick, commit v0.28.0, tag it. Tag the untagged historical releases or record
deliberately why not. Commit `wrangler.toml`.

### M1.1 — `CompletionReceipt` + the status machine — **DONE (2026-10-11)**
`packages/governance-core/src/completion.ts`, ADR 0003, 37 conformance + 8 determinism tests.
Deterministic (1000 identical ladders byte-identical, and a frozen global `Date` provably changes
nothing). New `completion` audit domain. **No verifier** — statuses past `returned-success` are
reachable, tested and produced by nothing.

Two things came out differently from the plan above, both worth recording:

**The status enum needed a ninth value.** `controlplane.ts`'s `McpInvocation.outcome` has had four
states for months — `not-forwarded | forwarded-ok | forwarded-error | forwarded-lost` — and
`forwarded-error` had nowhere to land in an eight-value enum that jumps from `returned-success` to
`response-lost`. A caller mapping an invocation into a receipt would have had to label a reported
failure `not-executed` (false; it executed) or `returned-success` (false). `returned-failure` is now
first-class, with outbound verification edges, because a tool can report failure *after* a partial
write. `statusFromInvocationOutcome()` makes the mapping total so no call site guesses.

**`consequential` had to be inside the seal.** It was not obvious in advance. `canCompleteTask` refuses
to complete a consequential effect on `returned-success`, so if the flag were observable-after-the-fact
the cheapest way around the predicate would be to flip it afterwards and the whole module would be
decorative. It is sealed, and there is a test that forges the flag, confirms the naive predicate would
pass, and confirms the seal catches it.

### M1.2 — Wire the three built modules *(small — and now the only thing blocking the inventory)*
`inquiry.ts`, `controlplane.ts` and now `completion.ts` have no production callers. Wire **one** call
site each, in **shadow mode**, comparing against the production path before anything folds for real —
the sequence ADR 0002 already specifies.

M1.1 did **not** fake its way to reachability, and the reason is worth stating because the tempting
shortcut was available: `completion.ts` could have been wired into `forwardGoverned`, which already
knows every id a receipt needs. But `forwardGoverned` is itself unreached, so that would have produced
a *chain* of unreached code with a green reachability test at the end of it — the F-7/F-8/F-10 defect
class with extra steps.

Instead `reachability.conformance.test.ts` gained an **`AWAITING_WIRING` inventory**, tested in both
directions:

* every listed module must still be unreached — **the test fails the moment one acquires a caller**,
  and tells you to delete the entry. This is the half that stops the F-10 shape: a prose "not wired
  yet" rots into a lie silently, and this cannot.
* every entry must name a milestone that appears in this document, so nothing parks here forever.
* every entry's file and ADR must exist, so a deleted module leaves no ghost claim.

It also excludes `index.ts` from counting as a caller. A barrel re-export is not a call site — and it
is exactly what made these modules *look* reachable to the original check.

Verified by deliberate falsification: a throwaway file importing `CompletionLedger` was added, the
inventory test failed with the right message, and the file was removed.

### M1.3 — MCP Sentinel: reliability *(medium)*
Idempotency keys derived from `inputCommitment`; a retry policy that **refuses to retry a
non-idempotent effect**; dispatch-before-send recording so a lost response is attributable;
duplicate-execution detection. The honest hard part: **retrying an unverified write is how you cause
the double-charge you were trying to prevent**, so the default must be *do not retry without an
idempotency key or a verifier*.

### M1.4 — Outcome verification *(medium, the genuinely novel part)*
A `Verifier` boundary: given a requested effect, independently observe whether it happened. Per-effect
adapters (re-read the record, check the file hash, query the API), **never the tool's own response**.
Returns `verified | contradicted | unverifiable` — and `unverifiable` must be a first-class answer, or
every unverifiable effect gets quietly recorded as fine.

### M1.5 — Observability: OpenTelemetry *(medium, mostly mechanical)*
Spans over the existing chain, keyed on the receipt's ids. Metadata and sensitive-content visibility
**separable by default** — `redactDeep` already exists for the audit; the same discipline applies to
spans, and the span exporter leaves the machine where the audit does not.

**Exit criterion for M1, stated so it can fail:** a consequential task cannot reach `completed` on the
agent's word alone; a lost response is recorded as *unknown* rather than as failure or success; and a
tool reporting success while the world disagrees produces a `contradicted` receipt with evidence.

---

## 5. Sequencing the rest

**M2 — extend what exists.** Memory Wiki Phase 2 (#5) is already committed on the roadmap: analyst
mode, local embeddings built only from approved pages. Permission-aware RAG (#8) is the same work plus
real ACL ingestion — and the clearance enforcement it needs is already in `retrieval.ts`, so the new
part is the *join between a document's real ACL and a chunk*, not the governance.

**M3 — the load-bearing one.** Governance-core in its own process, then H1. That *is* #10's
OS-enforcement half; keeping the name "Starfish OS" for a roadmap item already committed under another
name would double-count it.

**M4 — new surface.** Code Graph (#6) and Shipyard (#9) are genuinely new and genuinely large. Neither
should start before M1 proves the receipt model, because both would otherwise invent their own.

**Research track, parallel and unblocking.** Semantic MCP (#3) is a research question, not an
increment. It belongs in `docs/FEATURE_CANDIDATES.md` with an explicit promotion criterion, per the
roadmap's own "a candidate is not a promise" rule.

---

## 6. SR&ED — where the uncertainty is real, and where it is not

The proposal's framing is correct: strong claims need **documented technological uncertainty,
controlled experiments and measurable results**, not routine integration. Applying that honestly cuts
the list roughly in half.

**Genuine technological uncertainty — defensible:**

- **Outcome verification (M1.4).** *Can an authorized effect be independently confirmed without
  trusting the executing tool's own report, across heterogeneous effect types?* No standard answer
  exists. Hypothesis, experiment and a measurable verified/contradicted/unverifiable distribution are
  all available.
- **Distributed execution recovery (M1.3).** Retry-safety for effects of unknown idempotency, where a
  wrong retry causes the harm. Measurable: duplicate-execution rate, lost-response attribution rate.
- **Semantic compression (#3).** The 50% token / 99% fidelity figures are **hypotheses, not results** —
  correctly labelled as such in the proposal. Needs a held-out corpus, a fidelity metric defined
  *before* measurement, and a published negative result if it fails.
- **Confidence calibration (#4).** The schema exists; the statistics do not. Calibration error against
  a held-out set is exactly a controlled experiment.

**Routine integration — weak basis, claim cautiously or not at all:** OpenTelemetry wiring, registry
schema fields, Marketplace packaging, CI hardening, wiring existing modules to call sites.

**One honesty constraint that is also the strongest asset:** the repo's culture of documenting
negative results and residuals (`ADVERSARIAL-QA.md`, `HARDENING_BACKLOG.md`, the published
correct-but-unwired findings) is precisely the contemporaneous evidence an SR&ED claim needs. Keep
writing those regardless of the claim.

---

## 7. What would make this fail

- **Building the three "reliability" modules separately.** Each invents a correlation scheme, and the
  control plane becomes five governance systems with shared branding. The receipt is the antidote.
- **A second decision engine.** The Decision Engine is called a decision engine and is not one: it
  produces evidence for the single scorer. ADR 0002 exists to keep that true; the moment two things
  emit a verdict, "which wins" becomes code that is easy to get subtly wrong.
- **Shipping modules that nothing calls.** Three of v0.27.0's ten findings were correct, fully-tested
  modules with no production caller, and v0.28.0 found a fourth. Two of the modules in this plan are
  currently in that state. **Every increment here must land with a reachability assertion.**
- **Claiming verification before a verifier exists.** `returned-success` is not `verified`. If the
  receipt ships before M1.4, the status enum must not be described as outcome verification.
- **Not landing the tree.** Everything above is built on uncommitted files.

---

## 8. Immediate next actions

1. **Land and tag the tree** (§M1.0). Blocking.
2. **Decide the receipt's name and home** — `completion.ts` in `governance-core`, new audit domain.
   One ADR before code, per the one-ADR-per-material-boundary convention.
3. **Wire `inquiry.ts` and `controlplane.ts` in shadow mode** (§M1.2) — smallest change that removes
   two correct-but-unwired modules from the tree.
4. **Move Semantic MCP to `FEATURE_CANDIDATES.md`** with a promotion criterion, so it stops competing
   with engineering increments for sequencing attention.
5. **Add M1 to `ROADMAP.md`** only once M1.1 has a shape worth committing to publicly.
