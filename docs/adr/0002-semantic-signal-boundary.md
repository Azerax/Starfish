# ADR 0002 — The boundary between Starfish authority, semantic signals, and external control planes

Status: accepted
Date: 2026-09-26
Supersedes: none
Related: `GOVERNANCE.md` principles 1, 3, 5, 6; `docs/RISK_MODEL_ADVERSARIAL_ANALYSIS.md`; `packages/governance-core/src/inquiry.ts`

## Context

Starfish is asked to admit two kinds of outside help:

1. **Semantic assessment** — a model that can classify, score or estimate something a deterministic rule cannot, such as "does this tool call look like exfiltration".
2. **External MCP control planes** — Obot or equivalent, providing routing, registries, credential isolation, workload hosting and their own activity logs.

Both are useful. Both are also the most direct route to destroying the property that makes Starfish worth anything: that the default is DENY and that nothing probabilistic can talk its way past it.

Three facts about the existing codebase constrain any design here, and were verified against the code rather than assumed:

- **`PDP.decide()` is synchronous and pure.** `pdp.determinism.test.ts` pins 1000 identical calls to byte-identical JSON. A model call on that path breaks the test and the invariant behind it.
- **governance-core is network-free by design.** `detectors.ts:1-8` says so explicitly, and names the reason: a semantic classifier "would need a model call, and governance-core stays network-free and off the PDP's synchronous hot path by design."
- **There is exactly one scorer.** `detectors.ts:2-5` states that detectors are "INPUTS to the one risk scorer (score.ts), never a second scoring path." `score.ts` owns the 50-category matrix, the floors, and `verdictFor`.

## Decision

### 1. A semantic signal is evidence, and enters through `CategoryScores`

Inquiry does not sit on the PDP path and does not produce a decision. It produces an `InquirySignal`, and `foldInquiry()` converts that signal into a `CategoryScores` contribution to **exactly one** of the 50 risk categories, which the caller hands to the existing `assessRisk()`.

This is the seam `detectors.ts` already sanctioned. It means the entire semantic layer's blast radius is one dimension of a fifty-dimensional deterministic scorer, and that dimension is still subject to the same floors, the same hard-deny set and the same `verdictFor` reducer as any other evidence.

### 2. Raise-only monotonicity

`foldInquiry()` can only ever **raise** a category score. Every path returns a value in `INQUIRY_MIN_SCORE..INQUIRY_FAILSAFE_SCORE`, and every failure path returns the question's declared `failsafeScore`, which sits at the high (dangerous) end.

This is the load-bearing property of the whole design. **The worst a compromised, miscalibrated, hallucinating or actively hostile provider can do is make Starfish more cautious.** It can cost availability. It can never buy authority.

It also makes principle 7 — probabilistic models may classify but may not authorize — structural rather than advisory. `InquirySignal` has no `allow`, `deny`, `ask`, `approve` or `verdict` field anywhere on it, so there is no field for a caller to misread as a decision, and a conformance test asserts their absence.

### 3. Fail-closed follows `score.ts`, not `confidence.ts`

The two existing modules fail in opposite directions on purpose: `score.ts` clamps unknown input to `FAILSAFE = 10` because high risk is the safe assumption; `confidence.ts` fails to **zero** because there high confidence is the dangerous direction.

Inquiry follows `score.ts`. Absent, late, malformed, abstained and low-confidence signals all contribute the failsafe score. **Silence is treated as danger, not as permission.**

### 4. Thresholds are owned by deterministic code and must be complete

A threshold set that does not cover every option, every level, or the full 0..1 probability range is rejected outright rather than defaulted. A silently-defaulted threshold is indistinguishable from a configured one in an audit record, which makes it worse than a missing one.

A model never selects the threshold it is judged against.

### 5. Questions are versioned instruments, not editable prompts

`InquiryQuestion.version` is inside the provenance hash. Rewording a question changes `inquiryHash()`, which invalidates every signal and every calibration bound to the previous wording. A signal whose `contentHash` does not bind to the current request is refused as a replay.

### 6. Network stays out of Ring 1

Providers that reach the network do **not** implement `InquiryProvider`. They use `buildInquiryHttpRequest()` / `parseInquirySignal()` — a builder and a parser, with the send performed by a higher ring. This mirrors `provider.ts`'s `AgentRuntimeAdapter.buildRequest()`, which has always built requests it never sends.

`buildInquiryHttpRequest()` bakes in **no default endpoint**. A default endpoint is a silent cloud fallback, and those are forbidden.

### 7. An external control plane's "allowed" is not authorization

When an MCP control plane is integrated, its verdict is an input, never a grant. The order is fixed: Starfish decides, **then** the request is forwarded. A gateway that says "allowed" for a request Starfish denied changes nothing; a gateway that says "denied" for a request Starfish allowed stops it, because denials compose.

External audit identifiers (Obot request ids, control-plane audit ids) are **correlated into** the Starfish record. They do not substitute for it. An external activity log records that a call was made; it does not prove the claimed real-world effect occurred, and `GOVERNANCE.md` principle 6 requires evidence of the latter.

## Consequences

**Good.** The semantic layer is bounded, testable offline, and cannot reduce caution. Ring 1 stays pure and network-free, so `pdp.determinism.test.ts` and the dependency-direction lint both continue to hold. Calibration has a durable, versioned schema from the first commit. Adding a provider is additive and touches no existing decision code.

**Costs, stated plainly.** Raise-only means a semantic signal can never *reduce* friction, so inquiry cannot be used to auto-approve anything — by design, but it does mean the layer only ever adds asks. Questions must be maintained as versioned artefacts, which is more process than editing a prompt. And an inquiry needs a task id where `ToolCall.taskId` is still optional, so the new surface is stricter than the old one.

**Explicitly not implemented.** The calibration *schema* exists; the *statistics* do not. Nothing in `inquiry.ts` computes accuracy, calibration error, coverage or drift. `treatCalibrationAsValid()` checks only that a human approved a threshold set and that the approval has not expired. **No statistical guarantee should be claimed from a hand-filled calibration record.** Remaining work: labelled case storage, held-out partitioning, the metric computations, drift detection against a held-out set, and a reporting surface.

Also not implemented: wiring `foldInquiry()` into any live governance path. The module is exported and tested but no caller folds a signal into a real decision yet. That is deliberate — the next slice should wire exactly one call site, in shadow mode, and compare against the production path before anything folds for real.

## Alternatives rejected

**Call a model inside `PDP.decide()`.** Breaks determinism, breaks the network-free invariant, and puts a remote dependency on the synchronous hot path of a deny-by-default gate. Rejected on all three counts.

**Let a signal return `allow | ask | deny`.** This is the obvious design and it is the dangerous one. It creates a second reducer, and the moment two things can emit a verdict, the question "which one wins" has to be answered in code that is easy to get subtly wrong. One scorer, one reducer.

**Let a high-confidence benign signal lower a risk score.** Symmetrical and tempting. Rejected: it converts a model's confidence into permission, which is exactly principle 7's prohibition, and it makes provider compromise a privilege-escalation path rather than an availability problem.

**Depend on Obot for policy.** Rejected by constitutional principle 12 — Starfish must remain usable without any particular external product. Obot may route; Starfish decides.
