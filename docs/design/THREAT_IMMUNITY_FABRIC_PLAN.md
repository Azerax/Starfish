# Threat Immunity Fabric — Implementation Plan

> Companion to `GOVERNANCE.md`, `docs/EXTERNAL_SOURCE_GOVERNANCE.md`, `docs/design/MEMORY_WIKI.md`,
> `docs/design/GOVERNED_LEARNING_LOOP.md`, `docs/RISK_MATRIX.md`, `docs/ROADMAP.md`.
> Status: **TIF-0, TIF-1 (partial), TIF-3, TIF-4 implemented and verified; not yet committed to git.**
> See §11 for the implementation status detail. Grounded against the live repo at `v0.24.0` (656+
> tests, F0–F30 hardening rounds), not the planning docs alone.

## 0. What this actually is

Scott's brief ("Starfish Threat Immunity Fabric") proposes replacing a flat "signature → block"
threat-sharing model with a governed lifecycle: observe → contain → evidence → validate → ledger →
publish → local-evaluate → progressive-deploy → measure → expire/revoke — and four gateways
(context/tool/output/memory) around every agent.

**The headline finding of this plan: most of the architecture already exists in `governance-core`.**
Starfish was built gateway-first and evidence-first from day one (deny-by-default, evidence→claim→gate,
hash-chained audit, dual-control approval). The Threat Immunity Fabric is not a new foundation — it is
(a) a **naming/wiring exercise** over four already-shipped gateways, (b) a **genuinely new subsystem**
for cross-organization threat-evidence sharing that sits *beside* the existing PDP without replacing it,
and (c) a handful of **extensions** to existing modules (signing, source admission, scope sealing).

This matters for sequencing: build the fabric as an **additive layer**, the same way External-Source
Governance and the Scope Contract were added — reuse the existing single-PDP topology and the "ONE
risk model, single source of truth" rule (`score.ts` stays the only place risk is computed; the fabric
*feeds* evidence into decisions, it never becomes a second decision engine).

## 1. Fit assessment — proposal vs. what's already shipped

| Proposal section | Existing Starfish module | Status |
|---|---|---|
| §2 Context Intake Gateway | `gateway.ts` (`governedIngress`) + `taint.ts` (`screenIngress`, tainted `Signal`) + `sources.ts` (admission) | **Built.** Provenance object shape differs from the proposal's JSON (`trust_level`, `prohibited_effects`) — extension, not new build. |
| §2 Tool Authorization Gateway | `pdp.ts` (`PDP.decide`, single choke point, deterministic gate order) | **Built.** This *is* the reference monitor the proposal describes — "the model does not execute tools directly, it proposes." |
| §2 Output / DLP Gateway | `containment.ts` (`scanEgress`), `secrets.ts` (`redactSecrets`), `netguard.ts`, `taint.ts` (`egressTaintGate`) | **Built.** |
| §2 Memory Write Gateway | `wikigate.ts` (`WikiGate.evaluate` — stakes classification, proposer≠approver, content-hash-bound approval, dual control) + `confidence.ts` (source/evidence/confidence aggregation) | **Built, and more rigorous than the proposal** — already ports the exact "source/evidence/confidence/expiry/sensitivity/approving-policy" checklist from §2, plus Sybil/score-gaming resistance the proposal doesn't mention. |
| §3 Deterministic detectors | `vetting.ts` (`SIGNALS`, `INJECTION`), `taint.ts` (`INGRESS_EXTRA`) | **Built.** |
| §3 Structural detectors | `taint.ts` (role-tag/prefix patterns) | **Partial.** No document-location awareness (PDF footer, image metadata) yet. |
| §3 Semantic detectors | — | **Not built.** Needs a constrained, structured-category-only classifier — see §4 below on why this must stay off the hot path. |
| §3 Behavioural detectors | `monitor.ts` (Hank — read-only sweep, reconciled against deterministic audit counters) | **Partial.** No "expected relationship" matrix (source-type → allowed effect) yet. |
| §3 Canary detectors | — (Deception Cell is *designed*, in `Governed Execution — Deception Cell.md`, but **not coded**) | **Not built.** Real dependency gap — see §5. |
| §4 Deterministic risk decision + receipt | `riskmatrix.ts` + `score.ts` (50-category, max-driven composite, floors-before-tolerance) | **Built**, but decision taxonomy is binary (`allow/ask/deny` in `types.ts` `Decision`) — no `QUARANTINE`/`ALLOW_WITH_RESTRICTIONS`/`TERMINATE_SESSION`. Extension needed. |
| §5 Contain locally first | `containment.ts`, `deletion.ts` (soft-quarantine pattern), `tolerance.ts` | **Partial.** No "isolate + continue safely" session-level containment yet (that's Sandboxed Execution, still design-only per `starfish-governed-execution` memory). |
| §6 Threat Evidence Envelope | — | **Not built.** Net-new schema; but it composes entirely from existing primitives (§ below). |
| §7 Multiple indicator types | Exact = `hash.ts`/vetting hash-on-vet. Structural/deterministic = above. Fuzzy/semantic/behavioural = gaps. | **Partial.** |
| §8 Independent validation lifecycle | `wikigate.ts` dual control (N-of-M distinct approvers, `DUAL_CONTROL_N`) covers CORROBORATED/APPROVED almost exactly. REPRODUCED needs an isolated replay sandbox that doesn't exist yet. | **Partial**, one real blocker. |
| §9 Confidence ≠ authority | `wikigate.ts` stakes classification (a proposer can't declare its own claim low-stakes) + PDP's floors-before-tolerance ordering already enforce this exact separation for memory and for risk. | **Built as a principle**; needs to be explicitly extended to the fabric's "recommended_action ≠ local action". |
| §10 Immutable ledger | `audit.ts` (hash-chained, durable, head-anchor) + `anchor.ts` (Merkle root + optional external notarization) | **Built.** This literally is the "Sacrosanct ledger + CT-031-style checkpoints" the source doc gestures at — just needs new `AuditDomain` vocabulary for lifecycle events. |
| §11 Governed threat broker | `broker.ts` (local pending-decision broker only — not cross-org) | **Not built** for the cross-tenant case. Real net-new subsystem — see §6. |
| §12 Local evaluation / adoption engine | `sources.ts` admission state machine (`unknown/pending/admitted-verified/admitted-override/quarantined/revoked`) is the direct pattern to reuse | **Partial**, pattern exists, needs a `RuleAdoption` variant. |
| §13 Progressive deployment | `tolerance.ts` (Risk Tolerance Low/Medium dial) is the existing "how aggressively do we auto-act" control | **Partial.** No staged canary-% rollout yet. |
| §14 Revalidate before every side effect | `scope.ts` (`ScopeContract`, hash-sealed, D1–D4 deterministic re-check per call) | **Built as the pattern.** Needs extension: bind policy_version + threat_feed_checkpoint into the seal. |
| §15 Revocation | `sources.ts` `revoked` status; `vetting.ts` quarantine | **Partial.** No fast-path/priority propagation yet. |
| §16 Anti-poisoning | `wikigate.ts` dual control + stakes; `sources.ts` risk-tiered admission | **Partial.** No publisher reputation/rate-limit/blast-radius module yet. |
| §17 Offline governed learning | `docs/design/GOVERNED_LEARNING_LOOP.md` — **already designed**, tighten-only, evidence→claim→gate reuse | **Designed, not coded.** Directly reusable for "detector version" promotion. |
| §18 Measurement | Activity tab tiles (calm UI, `starfish-crew-and-theme` memory) | **Partial.** Needs fabric-specific tiles. |

Bottom line: of the proposal's 18 sections, **7 need no new architecture** (just wiring/naming), **7 are
extensions** of existing modules, and **4 are genuinely new** (Threat Evidence Envelope, cross-org
Threat Broker, semantic/canary detectors, reproduction sandbox). That is a much smaller build than the
proposal reads as in isolation.

## 2. The one non-negotiable this plan inherits

Per `starfish-governance-decisions`: **governance precedes execution, floors are never
policy-overridable, and there is ONE risk model.** The fabric must not become a second gate. Concretely:
a Threat Evidence Envelope's `recommended_action` is **advisory input** the local `assessRisk()` /
`PDP.decide()` consumes — exactly like an external source's admission doesn't itself authorize a tool
call (§9 of the proposal is, word for word, Starfish's existing "admission is not trust" principle from
`EXTERNAL_SOURCE_GOVERNANCE.md`). No envelope, however high its confidence or however many validators
signed it, calls `pdp.decide()` — it can only add weight to a risk category the existing scorer already
reads.

## 3. Net-new schema (additive, no wiring yet) — increment TIF-0

Add `packages/governance-core/src/evidence.ts`:
- `ThreatEvidenceEnvelope` type — the proposal's §6 schema, trimmed to what Starfish's own primitives
  already produce: `content_commitment` = `sha256()` (existing `hash.ts`), `decision_receipt` = a new
  `DecisionReceipt` struct wrapping `RiskAssessment` (already returned by `score.ts`) + the detector
  list, `runtime_snapshot` = an existing audit-segment reference, not a new capture mechanism.
- `DecisionAction` — extend the binary `Decision` in `types.ts` **additively** (new field, existing
  `allow/ask` untouched, same discipline `RM-3` used for the risk-tier migration): a
  `fabricAction?: 'observe'|'warn'|'restrict'|'quarantine'|'block-local'|'block-tenant'|'block-domain'`
  that only the fabric layer reads; the PDP's own `allow/ask/deny` remains authoritative for the tool
  call itself.
- Pure types + one conformance test (schema round-trips, no I/O) — matches how `riskmatrix.ts` shipped
  as RM-0: additive, not yet wired into `pdp.combine()`.

**Exit:** typecheck clean, one conformance test, zero behavior change to any existing consumer.

## 4. Detector classes — increment TIF-1

- **Deterministic / structural**: extend `taint.ts`'s `INGRESS_EXTRA` with location-aware structural
  features (PDF-footer / image-metadata / hidden-text flags — passed in by the caller, since
  `governance-core` stays parser-free by design; the parsing itself belongs in File Arena, still
  design-only). Reuses the existing regex-array pattern exactly.
- **Behavioural**: extend `monitor.ts` with a small "expected relationship" table (source-type →
  allowed effect categories), scored through the existing `riskmatrix.ts` categories rather than a new
  scoring axis — a webpage requesting `credentials.write` is just category #11 (secrets) at max
  severity, already a hard floor. No new scoring math needed, only a new *input* to the existing one.
- **Semantic**: this is the one detector class that needs a model call. **Constraint that must be
  stated up front:** the PDP's 10ms p95 gate target (`starfish-governed-execution`) means this cannot
  sit in the synchronous `ingress()` path. It runs the same way Hank's monitor does — async, read-only,
  reconciled against deterministic counters — and returns **structured categories only** (the proposal
  is explicit about this too: "not free-form prose"). It never blocks by itself; it adds a detector
  finding that the deterministic risk scorer then weighs.
- **Canary**: real dependency — see §5.

**Exit:** structural + behavioural detectors wired as inputs to `assessRisk()`; semantic detector runs
async off the Hank seam with a conformance test asserting it cannot appear on the synchronous ingress
path.

## 5. Fork: how to handle §8's REPRODUCED stage before Sandboxed Execution / Arena exists

The proposal's validation lifecycle needs to replay a suspected attack in isolation. Starfish's
answer to "isolated execution" is the **Arena / Sandboxed Execution for Untrusted Tasks** design
(`Governed Execution — The Arena.md`, `— Sandboxed Execution for Untrusted Tasks.md`) — already flagged
as the top post-v1 hardening item, and **not yet code** (no `arena.ts` / `sandbox.ts` in
`governance-core/src`). Canary detectors have the same dependency (the Deception Cell design is the
natural home for planted canary tokens). Five options, scored:

1. **Build the full Arena/Sandboxed-Execution suite first, as a prerequisite** — 90/100. Highest
   structural payoff; it's already the acknowledged top hardening item independent of this plan. But it
   is large (SX-1..SX-5 per the GX docs) and blocks every other TIF increment on it.
2. **Build a narrow reproduction-only sandbox now — a strict subset of the eventual Arena** — 82/100.
   Reuses `netguard.ts` (deny all egress), `boundary.ts` (scratch-dir-only fs), `containment.ts`
   (capture-not-apply) for exactly one purpose: replay a candidate threat sample against a disposable
   context with no persisted state, capture *proposed* effects only. Ships TIF now; the code is not
   thrown away — it becomes the first real slice of the Arena when that's built.
3. **Skip REPRODUCED for trust-domain-scoped evidence; require it only for global-scope evidence** —
   60/100. Matches the proposal's own "global rules need more corroboration than tenant rules" idea, but
   quietly weakens the domain-scoped path's rigor.
4. **Human operator manually replays flagged candidates** — 40/100. Doesn't scale past a handful of
   events/week; defeats the automation goal.
5. **Drop REPRODUCED, let CORROBORATED (independent-source agreement) stand in for it** — 20/100.
   Violates the project's own "no unbacked word" principle — corroboration isn't reproduction.

**Recommendation: option 2.** It unblocks the fabric without waiting on the full Arena, and the
narrow sandbox becomes reusable scaffolding for SX-1 later rather than throwaway work — same "additive,
never a second system" discipline used everywhere else in this codebase. Flag to Scott: this makes a
lightweight Sandboxed-Execution slice a **hard prerequisite** for TIF-3 (Validation Lab), not optional.

## 6. Fork: how to build the cross-organization Threat Broker

This is the one piece of the proposal with no existing analog at all — `broker.ts` today is a
single-machine pending-decision queue, not a federation service. Five options, scored:

1. **Local-only: Starfish curates and ships its own signed threat feed; customers subscribe, nobody
   else publishes** — 85/100. Matches "everyone ships skills, nobody ships governance" positioning —
   Starfish becomes the CVE-database equivalent for agent threats. No multi-tenant identity/reputation
   system to build. Realistic for a solo builder with one product, pre-1.0.
2. **Full peer-to-peer org federation (anyone publishes, anyone subscribes to anyone)** — 55/100.
   The proposal's full ambition, but it's its own product (multi-tenant PKI + reputation + quorum
   across organizations Starfish doesn't control) — premature before `v0.19.0`'s multi-tenant sidecar
   ships and before there's more than one customer to federate with.
3. **Git-repo-as-broker: signed evidence envelopes as JSON files in a repo; "subscribing" = pull +
   `verifyPublisherSignature` on an interval** — 78/100. Reuses `signature.ts` almost unchanged, zero
   new server infrastructure, fits the "prefers double-click, no CLI" Windows-solo profile. No
   realtime push, no built-in reputation/rate-limiting — bolt-on later.
4. **Hosted SaaS relay Scott operates and pays for** — 50/100. Real ops/liability burden before
   there's revenue to justify it.
5. **Defer the broker entirely; ship only the local engine + ledger** — 65/100. Safest, but leaves the
   proposal's central thesis ("share evidence, not decisions") unrealized — the differentiator is in
   the sharing.

**Recommendation: blend of 1 + 3.** A `SourceRegistry`-style admission for feed URLs
(`packages/governance-core/src/broker-fabric.ts`), pulling signed envelope batches from a static
manifest (git repo or plain HTTPS endpoint) on an interval, verifying every envelope against
`verifyAgainstPinned` before it ever reaches the local adoption engine. This is "governed pull, not
indiscriminate push" (§11's own requirement) at near-zero new infrastructure cost, and it composes
cleanly with `v0.19.0`'s planned multi-tenant/multi-root work if org-to-org federation is ever built
later — it wouldn't be a rewrite, just more publishers on the same pull path.

## 7. Build sequence

Sequenced so nothing is built before its prerequisite, and every increment ships independently
testable and green, matching the project's own increment discipline (RM-0..6, BS-1..5, H4/H5).

| # | Deliverable | Depends on | New files (additive) |
|---|---|---|---|
| **TIF-0** | Envelope + `DecisionReceipt` schema, `fabricAction` field | none | `evidence.ts` |
| **TIF-1** | Structural + behavioural detector inputs; async semantic detector off the Hank seam | TIF-0 | extends `taint.ts`, `monitor.ts`; `semantic-detector.ts` |
| **TIF-2** | Reproduction sandbox (§5 option 2) | none (parallel to TIF-0/1) | `reproduce.ts` (netguard+boundary+containment composition) |
| **TIF-3** | Validation Lab lifecycle state machine (OBSERVED→…→RETIRED), reusing `wikigate.ts` dual control for CORROBORATED/APPROVED | TIF-0, TIF-2 | `evidence-lifecycle.ts`; new `AuditDomain` entries in `types.ts` |
| **TIF-4** | Ledger wiring — every lifecycle transition → `audit.append()`; Merkle-checkpoint the evidence stream via existing `anchor.ts` | TIF-3 | none (pure wiring) |
| **TIF-5** | Trust Fabric identity — role-scoped keys (Publisher/Validator/Approver/Runtime/Audit) extending `signature.ts`'s `PinnedPublisher`; scoped fingerprint derivation (org+domain+family+epoch) | TIF-0 | `keys.ts` (role registry, rotation, revocation — mirrors `sources.ts` state machine) |
| **TIF-6** | Threat Broker (§6 recommendation) | TIF-4, TIF-5 | `broker-fabric.ts` |
| **TIF-7** | Local adoption engine — evaluate incoming envelopes against publisher trust/quorum/false-positive history; produces a `fabricAction`, never calls `pdp.decide()` directly | TIF-5, TIF-6 | `adoption.ts` |
| **TIF-8** | Progressive deployment stages (Stage 0–6) reusing the `SourceStatus`-style state machine; revalidation token extending `ScopeContract`'s seal with `policy_version`+`threat_feed_checkpoint` | TIF-7 | extends `scope.ts` (additive field, existing D1–D4 untouched); `rollout.ts` |
| **TIF-9** | Anti-poisoning (publisher reputation, rate limits, blast-radius caps) + fast-path revocation + Activity-tab metrics tiles | TIF-6, TIF-7 | extends `monitor.ts`; UI tiles per `starfish-crew-and-theme`'s one-screen rule |
| **TIF-10** | Governed detector-learning loop — wire `docs/design/GOVERNED_LEARNING_LOOP.md`'s tighten-only pipeline to promote detector *candidates* (never live detectors) the same way failure-mode pages are promoted | TIF-9 | reuses `claims.ts`/`wiki.ts`, no new core module |

Everything through TIF-4 can run **fully local**, with zero cross-org sharing, and is independently
valuable (better-structured local threat handling + a proper evidence ledger). TIF-5 onward is what
turns it into the "fabric." That's a natural place to pause and re-scope if priorities shift — TIF-0
through TIF-4 alone already deliver the observe→contain→evidence→validate→ledger half of the lifecycle
described in Scott's brief.

## 8. Explicit non-goals for this pass

- **No second risk engine.** `score.ts` stays the only place a composite risk number is computed;
  the fabric only ever supplies category evidence into it, per the project's `RM-3` "ONE risk model"
  rule.
- **No synchronous model call in the PDP hot path.** The semantic detector, like Hank, is async and
  advisory — the 10ms p95 gate target is a floor, not a target to negotiate away.
- **No full peer-to-peer federation in this pass** (§6) — deferred until there's a second organization
  to federate with.
- **No hardware-backed signing keys in this pass.** Software Ed25519 (already in `signature.ts`) for
  v1; hardware-backed (TPM/HSM) is a later hardening item, same tier as OS-level sandboxing (T-25).
- **No new deletion or filesystem primitives.** Quarantine reuses `deletion.ts`'s soft, recoverable
  pattern; nothing in this plan needs a new destructive-action path.

## 9. Open decisions for Scott (beyond the two forks scored above)

- **Rotation cadence and epoch length** for the org+domain+threat-family+rotation-epoch fingerprint
  keys (§1 of the proposal) — needs a concrete number (e.g., 30-day epochs) before `keys.ts` can ship
  a default.
- **Whether TIF-6's feed manifest lives in the same GitHub org** (`Azerax/Starfish` or a sibling repo)
  or is fully external — affects whether `verifyAgainstPinned`'s pinned-key bootstrap is trivial
  (same-org) or needs its own out-of-band trust-establishment step.
- **Emergency/global rule fast-path** (§13: "high-severity emergency rules can move faster but must
  auto-expire unless formally validated") — needs an explicit default TTL before TIF-8 ships a default.

## 10. Success measurement (§18, mapped to what's measurable day one)

Reuse the Activity tab's existing allowed/asks/denied tiles as the model; add, once TIF-4+ ships:
mean time to containment (audit timestamp delta, already computable from the hash chain), evidence
without quorum (count of envelopes stuck below `DUAL_CONTROL_N`), rules revoked-but-still-adopted
(state-machine query over TIF-8's rollout registry), false-positive rate per publisher (feeds TIF-9's
reputation module). All of these are queries over data the ledger already durably records — no new
telemetry capture surface needed, same "the audit *is* the training data" principle
`GOVERNED_LEARNING_LOOP.md` already established.

## 11. Implementation status (2026-08-01)

**Shipped this pass: TIF-0, TIF-1 (structural + behavioural only), TIF-3, TIF-4.**

- **TIF-0 (schema)** — `packages/governance-core/src/evidencetypes.ts` (pure data leaf: threat
  taxonomy, detector classes, `FabricAction`, `EvidenceStage`, `ALLOWED_TRANSITIONS`, structural
  feature vocabulary, behavioural expected-relationship table) and `evidence.ts` (`ThreatEvidenceEnvelope`,
  `DecisionReceipt`, `contentCommitment`, `sealEnvelope`/`verifyEnvelopeSeal`). Additive only —
  `fabricAction` is advisory input; nothing here calls `pdp.decide()` or touches `score.ts`'s `combine()`.
- **TIF-1, partial** — `detectors.ts` ships `classifyBehaviour` (source-kind → unexpected-category check
  against `UNEXPECTED_CATEGORIES_FOR_SOURCE`) and `classifyStructuralFeature(s)` (fail-closed to
  `suspicious-unclassified` on an unrecognised value). The semantic detector (§4, the one class that
  needs a model call, kept off the synchronous PDP path) is **not built** in this pass.
- **TIF-3 (validation lifecycle)** — `evidence.ts`'s `EvidenceLifecycle` class: `observe → reproduce →
  corroborate → approve → publish → deploy → retire`, plus `revoke` (reachable from every non-terminal
  stage, per §15) and `expire` (TTL-driven). Enforces `CORROBORATION_MIN_VALIDATORS = 2` distinct
  validators and the proposer≠approver invariant (publisher can corroborate/approve nothing of its own),
  the same dual-control pattern `wikigate.ts`/`scope.ts` already use elsewhere in the codebase.
  **Deviation from the build sequence in §7**: this shipped without TIF-2 (the reproduction sandbox)
  being built first. That was a deliberate scope call, not an oversight — `reproduce()` is a pure state
  transition that accepts a `{ok, detail}` result from whoever calls it; today that caller has to be a
  human validator or an external process, since there is no isolated sandbox yet to produce that result
  automatically. TIF-2 remains the real prerequisite for *automating* reproduction; it is not a
  prerequisite for the lifecycle gate itself, which is why TIF-3 could ship ahead of it.
- **TIF-4 (ledger wiring)** — every lifecycle transition calls `audit.append()` under a new `'threat'`
  `AuditDomain` (added to `AUDIT_DOMAINS` in `types.ts`). Pure wiring, as scoped; no new anchoring
  behavior beyond what `anchor.ts` already provides for any other audit domain.
- **Not built**: TIF-2 (reproduction sandbox), TIF-5 through TIF-10 (Trust Fabric identity/PKI,
  cross-org broker, local adoption engine, progressive deployment, anti-poisoning, governed detector
  learning). The two forks in §5 and §6 are unresolved — see §9's open decisions, which still need
  Scott's input before TIF-5+ can start.

**Verification.** The device's local `node_modules` has Windows-only native bindings and cannot run
`vitest`, so verification ran in two passes: `tsc --noEmit` directly on the device (clean, zero errors
against the real `tsconfig` chain), and the full test suite in a scratch Linux install (source +
configs copied out, fresh `npm install`, matching dependency versions) — 63 test files, 504 passed / 1
pre-existing unrelated skip, including 23 new tests (16 lifecycle conformance + 7 detector conformance)
covering every invariant called out above. That Linux run is a stand-in for, not a replacement of, a
real `npm run ci` on Scott's machine — `starfish-tif-followup.ps1` (repo root) runs that natively and
offers to stage + commit the files listed below.

**Not yet committed.** As of this status update, `git status` on the working tree shows all of the
above still sitting uncommitted:
```
 M .gitignore
 M packages/governance-core/src/index.ts
 M packages/governance-core/src/types.ts
?? docs/design/THREAT_IMMUNITY_FABRIC_PLAN.md
?? packages/governance-core/src/detectors.conformance.test.ts
?? packages/governance-core/src/detectors.ts
?? packages/governance-core/src/evidence.conformance.test.ts
?? packages/governance-core/src/evidence.ts
?? packages/governance-core/src/evidencetypes.ts
?? starfish-tif-followup.ps1
```
Nothing in this pass is real from git's perspective until `starfish-tif-followup.ps1` (or an equivalent
manual `git add`/`commit`) runs on Scott's machine.
