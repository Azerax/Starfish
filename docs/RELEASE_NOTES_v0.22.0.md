# Project Starfish v0.22.0 - 1.0 candidate: freeze, docs, compliance

## Added
- `docs/SEMVER_AND_WIRE_COMMITMENTS.md` — 1.0 public-API + wire-protocol freeze/deprecation policy; the
  api-surface + wire-freeze suites are the semver gate.
- `docs/COMPLIANCE_CONTROL_MAP.md` — Starfish controls mapped to SOC 2 / ISO 27001 / EU AI Act.
- `docs/legal/TRADEMARK.md`, `docs/legal/COMMERCIAL.md` — DRAFT mark + no-warranty/commercial terms.
- `startMultiSidecar` frozen into the 1.0 public surface.

## Changed
- GA checklist: built items checked off.

## Deferred to owner (requires auth / external parties)
- Independent external security review.
- Counsel review + finalization of TRADEMARK.md / COMMERCIAL.md (currently DRAFT).
- First provenance publish to npm on a `v*` tag (needs `NPM_TOKEN`).

Verified: typecheck + dep-lint + full test suite + CLI bundle green.
