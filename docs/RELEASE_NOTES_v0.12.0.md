# Project Starfish v0.12.0 - Starfish External (embeddable governance)

This release makes Starfish's governance embeddable: run the same deny-by-default engine inside another
stack (a CLI skill runner or a custom UI) with no change to the host's own logic. One engine, three
integration modes, one conformance pack proving all three.

## Added
- **`@starfish/sdk`** (headless, no Electron): `createGovernance` / `governCall` (fail-closed) /
  `runGovernedSkill`; governed-root schema stamp; cloud-FS and root-safety guards; `verifyAudit()` /
  `safeMode()`; a headless fs PEP; pluggable tool taxonomy + `withGovernance()` middleware.
- **`starfish serve`** - a loopback (127.0.0.1) HTTP governance API: bearer-token auth, wire-version
  handshake, server-assigned actor identity (proposer != approver holds over the network), fail-closed.
  Endpoints: `/v1/decide`, `/v1/decisions` (file + resolve + status), `/v1/pending`, `/v1/audit`,
  `/v1/audit/verify`, `/v1/budgets`, `/v1/monitor`, `/v1/health`.
- **`starfish embed [init|remove]`** - provision Starfish External into a target repo
  (install-from-Starfish, run-in-another-repo).
- **`@starfish/ui`** - `httpBridge` (sidecar client, engine stays out of the browser bundle) + React
  `GovernancePanel` / `PendingList`.
- **Cross-mode conformance harness** - one scenario pack run identically by in-process, sidecar, and
  overlay ModeRunners.
- **`skills/starfish-verify`** - a confined isolated-copy runner (typecheck + dep-lint + tests + bundle);
  `scripts/verify/` gates.
- **`examples/zero-change-demo/`** - runnable proof: embed -> serve -> unmodified skill -> operator
  approval -> written + audited.

## Security / hardening
- Audit hash-chain verified on boot; tamper -> PDP safe mode (deny-all), fail-closed.
- Secret material redacted from audit `reason`/`target` before writing.
- `starfish doctor --embed` audits an embedded deployment (schema, chain, safe mode, token perms,
  no blanket allow).
- Frozen public API surface for `@starfish/sdk` / `@starfish/ui` with a semver guard test.
- `release.ps1 -Provenance` for npm publish provenance.

## Notes
- 362 tests across 73 files; typecheck + dep-lint + CLI bundle all green.
- GA-remaining is process: publish from CI with provenance, freeze/document the wire protocol, audit
  rotation, and legal/brand review (see docs/GA_CHECKLIST.md).
