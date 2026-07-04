# Project Starfish v0.17.0 - Supply chain + release automation

## Added
- Internal `@starfish/*` deps declared in every package manifest.
- `scripts/secret-scan.mjs` (`npm run scan:secrets`) — deny-on-match for committed private keys / provider
  tokens; skips test fixtures; inline `secret-scan:allow` pragma.
- CI (`ci.yml`) runs the full gate + secret scan on every push/PR. Release (`release.yml`) publishes the CLI
  with npm provenance (OIDC) + SBOM on a `v*` tag (requires `NPM_TOKEN`).
- Wire-protocol freeze test (`WIRE_VERSION === 1`) as the semver gate.

## Changed
- dep-direction-lint (A19): auto-derived package list + matches side-effect/dynamic/`require` imports across
  `.ts` and `.tsx`.

## Deferred to operator
- First provenance publish runs on tag push once `NPM_TOKEN` is configured (Scott).

Verified: typecheck + broadened dep-lint + secret-scan + tests + CLI bundle green.
