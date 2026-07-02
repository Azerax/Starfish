# Embedding Starfish - Implementation Plan

Risk-driven build plan for making Starfish embeddable (see docs/EMBED_INTEGRATION_PLAN.md), sequenced
by the heat map (docs/EMBED_RISK_HEATMAP.md) against the 80-risk register (docs/EMBED_RISK_REGISTER.md).
Risk IDs in parentheses map to that register.

## Guiding principle
Build the governance invariants in from the first commit; do not defer security to a final "hardening"
phase. Each wave ends only when the shared cross-mode conformance suite is green for that mode. There is
no P0 (nothing is both near-certain and catastrophic); the P1 Med x High cluster is the build-first set,
and every wave below carries its slice of it.

## Definition of done for every wave
The same scenario pack (deny / ask / approve / fail-closed / proposer!=approver / boundary-escape /
wire-mismatch) runs against whichever modes exist so far and passes identically (72). An invariant proven
in one mode must hold in all modes.

## Wave 0 - Foundations and guardrails (before/with Phase A)
Cross-cutting work that everything else depends on.
- Extract `@starfish/sdk` from `@starfish/desktop` with zero Electron in its dep graph; enforce with the
  dependency-direction lint in CI (19).
- Freeze the public API surface + semver policy; mark everything else internal; typed contracts +
  changelog gate (23).
- Stamp a schema/version on the governed root; refuse a mismatched schema and migrate on load,
  fail-closed (80).
- Make the audit a single-writer: define that exactly one process (in-process engine or the sidecar)
  owns `audit.jsonl`; others write via it (43).
- Guard the governed root against cloud-synced/network filesystems: detect and warn/refuse (46).
- Stand up the cross-mode conformance harness (empty scenario runners for the 3 modes) (72).
Exit: `@starfish/sdk` builds headless; lint + schema-stamp + audit-writer tests pass.

## Wave 1 - Phase A: in-process SDK
- `createGovernance({ root })`, `runGovernedSkill(...)`, `governCall(call)` (fail-closed by construction:
  no decision -> deny) (7).
- Bind each decision to a hash of the exact call + one-shot nonce; the PEP re-checks at execution
  (TOCTOU, replay) (9, 11).
- Skill vetting on load: pin content hash, re-vet on manifest change, integrity gate denies drift (47).
- Wire in egress containment so tool results are framed as data, not instructions (56).
- Ship deny-by-default seed + boundary validation (refuse home/system/drive roots) (12, 15).
- Reference integration: a Node CLI skill that governs its own file writes in-process.
Exit: conformance mode 1 (in-process) green.

## Wave 2 - Phase B: sidecar service + API
- `starfish serve`: loopback-only HTTP + SSE, refuses non-127.0.0.1 binds (1); bearer token in a `0600`
  file, never on argv/env/audit (2); per-decision nonce + session token on approvals (4).
- Server-assigned actor identity per authenticated session; reject client-claimed actors and
  self-approval so proposer!=approver survives the boundary (3, 13).
- Wire-version handshake every session; refuse on mismatch, fail-closed (14).
- Fail-closed client contract: timeout/unreachable -> deny; test kills the sidecar mid-call (7).
- Request schema validation + body-size caps + basic rate limiting (31, 32).
- Audit redaction: secret-scan + hash/ref instead of raw content in reason fields (37).
- Endpoints: /v1/decide, /v1/tasks, /v1/pending, /v1/decisions/{id}, /v1/projections/*, /v1/audit,
  /v1/stream, /v1/skills/vet.
- Reference integration: a non-Node CLI skill gating via /v1/decide, approvals landing in the broker.
Exit: conformance mode 2 (sidecar) green, including the fail-closed and wire-mismatch scenarios.

## Wave 3 - Phase C: embeddable dashboard UI
- Extract `@starfish/ui` (Bridge, Ready Room, approval queue, Token Governor, monitor) that depend only
  on the `GovernanceBridge` contract, never on governance-core, so the engine never enters the browser
  bundle (63).
- Add `httpBridge(baseUrl, token)`; prefer SSE push over polling; reconcile against the server as source
  of truth (60, 61).
- Escape all governance strings by default; no dangerouslySetInnerHTML (62). Theme via props; scoped
  styles to avoid host CSS clashes (59).
- Reference integration: a sample custom React dashboard rendering live projections + driving approvals.
Exit: dashboard drives an approval end to end against the sidecar; XSS + bundle-boundary tests pass.

## Wave 4 - Phase D: generic hook/middleware overlay
- Pluggable `ToolTaxonomy` mapping any host tool vocabulary to the governed vocabulary; unknown tool ->
  default-deny (50). Keep the catastrophic-shell denylist and the wire-name mapping.
- `withGovernance(runner)` middleware for a generic skill runner.
- Boundary edge cases: symlink/junction rejection + realpath + case-normalization, tested per OS
  (49, 77).
- Provider adapter conformance tests (guard against the next tool-name-400-class break) (54).
- Reference integration: a non-Claude skill runner wrapped with the overlay.
Exit: conformance mode 3 (overlay) green; all three modes now pass the identical pack.

## Wave 5 - Phase E: hardening and GA
- Audit tamper detection on read + optional external anchoring of roots; self-integrity drift ->
  safe mode (8).
- Safe-mode recovery path (denies actions but keeps read/attest; documented `starfish attest`;
  audited operator override) and guided root repair that preserves the chain (78, 79).
- Supply chain: publish from CI with npm provenance; SBOM; release.ps1 gates on install+test+build; never
  amend a pushed commit (25, 26).
- Data lifecycle: audit rotation with chained roots, retention, backup secret-scan/encrypt (29, 38, 40).
- `starfish doctor` extended to audit an embedded deployment (loopback-only, token perms, wire version,
  boundary sanity, deny-by-default, chain intact).
- Legal/brand: TRADEMARK usage terms, COMMERCIAL clarity, no-warranty/scope statement (68, 69, 70, 71).
- Full 80-risk sweep sign-off.
Exit: all three modes green; doctor clean on a reference embed; risk register reviewed with residuals
recorded.

## Sequencing at a glance
Wave 0 (guardrails) -> Wave 1 (SDK) -> Wave 2 (sidecar) -> Wave 3 (UI) -> Wave 4 (overlay) -> Wave 5 (GA).
Fastest demoable value is end of Wave 2: host action -> deny-by-default -> human approve -> execute ->
audit, with the host's own front end, proven fail-closed.

## First strategic wave (the 6 to start now)
From P1, the highest-leverage six that unblock everything else: #19 headless SDK, #23 frozen semver API,
#43 single audit writer, #7 fail-closed contract, #14 wire-version handshake, #3/#13 server-assigned
actor identity. Doing these in Wave 0 + early Wave 2 sets the invariants the rest inherit.
