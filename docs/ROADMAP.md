# Project Starfish - Roadmap (next 10 releases)

Directional plan from the current `v0.12.0` (Starfish External shipped) to a `1.0` candidate. Sequenced
by dependency, not date. Each release is grounded in existing analysis (docs/CODE_AUDIT.md,
docs/THREAT_CLASSES_AND_MITIGATIONS.md, docs/GA_CHECKLIST.md, docs/EMBED_IMPLEMENTATION_PLAN.md) plus
natural product growth. Every release ships only when `skills/starfish-verify` is green (typecheck +
dep-lint + tests + bundle) and its exit criteria pass. Semver: security-hardening that changes behavior
on the unexpected path is treated as minor until the wire/API freeze at 0.17/1.0.

## v0.13.0 - Hardening I: normalization + defense-in-depth
Threat classes 1 and 6; audit A1, A4, A10, A2.
- One `canonicalize(path)` (case-fold on win32/darwin, NFC, symlink-resolve, strip trailing sep) used by
  boundary, deletion, secrets, and the executors; security decision and IO act on the same value.
- PEPs re-apply the full check set (boundary + secret-path + canonical) at execution; open the validated
  fd (no re-resolve) to close the TOCTOU window.
- Rotate the working-tree `.env` key; add a pre-commit/CI secret scan.
Exit: a cross-platform boundary conformance suite (mixed case / Unicode / trailing slash / `..`) passes;
executor denies symlink-escape and secret-path writes even when handed the raw call.

## v0.14.0 - Hardening II: sidecar input validation + local trust
Threat classes 2, 4, 5; audit A6, A11, A12, A13.
- Schema-allowlist validation on every sidecar POST (reject unknown fields, enum-check `riskTier`);
  construct pending records field-by-field with server-owned values; reject/namespace client `refId`.
- Request body caps + connection timeouts; per-source auth throttling; `Host`-header validation.
- Token files created `0600` + Windows ACL; `doctor --embed` escalates perms to FAIL; unguessable ids.
Exit: sidecar security suite (oversized body -> 413, foreign Host rejected, worker cannot spoof risk,
world-readable token -> doctor FAIL) green.

## v0.15.0 - Egress + shell containment
Threat class 3; audit A5, A7, A8.
- `net` becomes a governed resource: default-deny RFC1918/loopback/`169.254.169.254`/`.internal`,
  operator destination allowlist; policy resource + audit target derived from declared `pathParams`.
- Harden the catastrophic-shell denylist (any flag order/long-form, broader pipe-to-interpreter,
  `chmod 777` on system paths) with a fixed bypass-corpus test.
Exit: bypass-corpus + net-containment tests green across all three modes.

## v0.16.0 - Audit durability + truthful facts
Threat classes 4, 8; audit A15, A16, A17, A18.
- Torn audit tail -> deliberate safe-mode (no uncaught throw); a persisted head anchor `{seq,hash}` on by
  default so truncation is detected without full self-integrity.
- Audit rotation + retention with chained segment roots; conservative cost accounting when usage is
  unparseable; failures audited truthfully (not `allow`).
Exit: truncation -> safe-mode test; rotation preserves chain verification; budget advances on unparseable
usage.

## v0.17.0 - Supply chain + release automation + npm publish
Threat class 7; docs/GA_CHECKLIST.md.
- Every package declares its `@starfish/*` deps; dep-lint auto-derived from the workspace list and
  matches dynamic/side-effect/`require` imports across `.ts` + `.tsx`.
- GitHub Actions: `starfish-verify` + secret-scan on every push; on a tag, publish `@starfish/sdk` +
  `@starfish/ui` (+ CLI) with npm provenance + SBOM.
- Freeze + document the wire protocol version and the public API surface (the surface-lock tests become
  the semver gate).
Exit: CI green on push; first provenance publish; `npx project-starfish embed` works from npm.

## v0.18.0 - Live dashboard: SSE streaming
docs/EMBED_INTEGRATION_PLAN.md (dashboard surface).
- `GET /v1/stream` (SSE): live decisions, asks, and budget events; `@starfish/ui` subscribes (push, not
  poll) with reconnect/backoff.
- Richer embeddable panels: crew/agent detail, decision log, budget + monitor; themable, engine still out
  of the browser bundle.
Exit: a host dashboard reflects a governed run live with no polling; SSE payloads are redacted + scoped.

## v0.19.0 - Multi-root / multi-tenant sidecar
docs/EMBED_RISK_REGISTER.md #22, #39.
- One sidecar governs multiple governed roots with hard per-root isolation (routing by token->root),
  per-root audit + broker; org-level operator model (operator principal sets, class 5 / A20).
- `starfish serve --roots` and a root registry.
Exit: cross-root isolation tests (one root's tokens/pending/audit never leak into another).

## v0.20.0 - Policy authoring + governance UX
- `starfish policy` (list/add/explain/simulate) and an in-dashboard editor; human-readable "why denied"
  explanations from the PDP; per-project/session confidence levels wired through the sidecar.
- Risk-tier tuning + dry-run ("what would this policy change allow?").
Exit: policy explain + edit round-trip + simulate tests; no change can silently weaken the deny-by-default
floor.

## v0.21.0 - Provider/model expansion + cost governance
audit A14; docs/EMBED_RISK_REGISTER.md model-runtime class.
- More provider adapters + adapter conformance tests (guard the next tool-name-400-class break);
  capability-aware routing that fails closed for high/critical instead of downshifting.
- Robust usage/cost accounting, per-agent budgets, budget dashboards, hosted-router egress opt-in UX.
Exit: routing + budget conformance; a high-risk task never silently downshifts provider.

## v0.22.0 - 1.0 candidate: freeze, docs, compliance
docs/GA_CHECKLIST.md (legal/brand); external review.
- Full docs site; compliance control mappings (SOC 2 / ISO 27001 / EU AI Act) to Starfish controls;
  "Governed by Starfish" mark + no-warranty/commercial terms (counsel-reviewed).
- External security review; freeze wire protocol + public API as a 1.0 commitment.
Exit: independent review closed; 1.0 semver commitments documented; GA checklist complete.

## How this maps back
- 0.13-0.16 clear the audit's threat classes 1-6 and 8 (the hardening core).
- 0.17 closes class 7 and turns the manual release into automated, provenanced publishing.
- 0.18-0.21 are product growth (dashboard, multi-tenant, policy UX, providers) on the hardened base.
- 0.22 is the 1.0 gate: external review + freeze + compliance/legal.

Roadmap is directional; reorder if a design partner (see docs/go-to-market/) needs a specific capability
sooner. Nothing here lowers the deny-by-default / fail-closed floor.
