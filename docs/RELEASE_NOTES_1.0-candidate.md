# Project Starfish — 1.0 Candidate Release Notes (v0.13.0 → v0.22.0)

Project Starfish is a fork of Munder Difflin. This milestone is a hardening + productization run that takes
the code audit's findings to closure and freezes the public surface for a 1.0 commitment. Every release was
gated green (typecheck + full test suite + dependency-direction lint + CLI bundle; secret-scan from v0.17)
before commit. Final suite: **420 tests across 83 files**. Nothing lowers the deny-by-default / fail-closed
floor.

## Security hardening (audit findings closed)
- **v0.13.0 — Hardening I.** Case/Unicode boundary fold so a case-varied path or denied subtree still
  matches on Windows/macOS (A1); PEP executors re-check secret paths at execution time (A4).
- **v0.14.0 — Sidecar input validation + local trust.** `/v1/decisions` strict allowlist with
  server-owned actor/kind/per-actor refId (A6); 256 KB body cap → 413 (A11); Host-header check → 421 (A12);
  `sidecar-tokens.json` written 0600, doctor FAILs on loose perms (A13).
- **v0.15.0 — Egress + shell containment.** Internal/loopback/link-local/metadata egress denied by default
  with allowlist opt-in (A8); hardened catastrophic-shell denylist with a bypass corpus (A7).
- **v0.16.0 — Audit durability + truthful facts.** Torn-tail heal on recover + deliberate safe-mode; head
  anchor on by default catches truncation/rollback; size-based rotation with chained segment roots (A16/A17);
  conservative cost when provider usage is unparseable (A15); `run_tests` arg allowlist + failures audited
  truthfully (A18).
- **v0.19.0 — Multi-tenant approvals.** Operator principal sets close the agent-vs-agent approval gap (A20).
- **v0.21.0 — Capability-aware routing.** High/critical tasks fail closed rather than silently substituting
  an unregistered provider (A14).

## Supply chain & release engineering (v0.17.0)
- Every package declares its `@starfish/*` dependencies.
- `npm run scan:secrets` blocks committed private keys / provider tokens.
- Dependency-direction lint auto-derives the package list and matches side-effect / dynamic / `require`
  imports across `.ts` and `.tsx` (A19).
- GitHub Actions: full verify gate + secret scan on every push/PR; provenance publish (OIDC) + SBOM on a
  `v*` tag.

## Product growth
- **v0.18.0 — Live dashboard.** Sidecar `GET /v1/stream` (SSE), redacted + scoped; `@starfish/ui`
  `httpBridge.subscribe()` (token in the Authorization header, auto-reconnect); the panel renders live.
- **v0.19.0 — Multi-root sidecar.** `startMultiSidecar({ roots })` governs several roots with hard per-root
  isolation (token → root routing; per-root governance/broker/audit/pending/SSE scope).
- **v0.20.0 — Policy authoring UX.** `starfish policy list|explain|add|simulate` with human-readable "why"
  and a dry-run that flags any widening — while always stating the hard floors are not policy-overridable.
- **v0.21.0 — Providers & cost.** Adapter conformance across all runtime adapters (guards the
  tool-name-400 class); per-agent budget isolation.

## 1.0 freeze & compliance (v0.22.0)
- `docs/SEMVER_AND_WIRE_COMMITMENTS.md` — public-API + wire-protocol freeze/deprecation policy (the
  api-surface + wire-freeze suites are the semver gate).
- `docs/COMPLIANCE_CONTROL_MAP.md` — Starfish controls mapped to SOC 2 / ISO 27001 / EU AI Act.
- `docs/legal/TRADEMARK.md` + `COMMERCIAL.md` — DRAFT mark + no-warranty/commercial terms (pending counsel).

## Still owner tasks
- First provenance publish to npm (push a `v0.22.0` tag once `NPM_TOKEN` is set).
- Independent external security review; counsel review of the DRAFT legal terms.
