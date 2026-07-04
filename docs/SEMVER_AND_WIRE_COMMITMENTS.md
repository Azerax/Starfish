# Starfish 1.0 — Semver & Wire-Protocol Commitments

Status: **1.0 candidate.** These commitments take effect at the first `1.0.0` publish.

## Public API (semver)
The frozen public surface of `@starfish/sdk` and `@starfish/ui` is enforced by the
`api-surface.conformance.test.ts` suites — they are the semver gate, not just documentation.

- **Patch (`1.0.x`)** — bug fixes, no surface change.
- **Minor (`1.x.0`)** — additive only (new exports/params with safe defaults). Existing exports keep their
  names and call signatures.
- **Major (`x.0.0`)** — the only release allowed to remove/rename a frozen export or change a signature.
  Removing an entry from `FROZEN` (or changing the wire version) requires editing the freeze test, which is
  the deliberate, reviewed signal of a breaking change.

Frozen `@starfish/sdk` exports include: `createGovernance`, `startSidecar`, `startMultiSidecar`,
`WIRE_VERSION`, `makeSidecarRunner`, `makeInProcessRunner`, `runScenarioPack`, `makeOverlayRunner`,
`withGovernance`, `makeFsExecutor`, `makeTaxonomy`, `DEFAULT_TAXONOMY`, root-schema + root-safety helpers.

## Wire protocol
- Current version: **`WIRE_VERSION = 1`** (asserted by `wire-freeze.conformance.test.ts`).
- Every request carries `x-starfish-wire`; a mismatch is refused with HTTP 426 (no silent downgrade).
- **Bump policy:** the wire version increments only on an incompatible change to the sidecar request/response
  contract, in lockstep with a minor/major package bump, and both freeze tests are updated in the same
  change. Clients handshake on `/v1/health` and must refuse to proceed on mismatch (fail-closed).

## Deprecation policy
- A public export slated for removal is marked deprecated in the changelog and JSDoc for at least one minor
  release before a major removes it.
- The deny-by-default / fail-closed floor is **not** subject to deprecation and cannot be weakened by any
  release (see the policy-explain floor note and the hardening suites).
