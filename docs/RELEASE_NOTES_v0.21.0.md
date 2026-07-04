# Project Starfish v0.21.0 - Provider/model expansion + cost governance

## Security
- Routing fails closed for high/critical tasks when the routed provider is unregistered (no silent
  substitution/downshift) — audit A14. Low/medium still substitute (audited).

## Added
- Adapter conformance suite across all runtime adapters: POST shape + wire-safe tool names only
  (guards the tool-name-400 class).
- Per-agent budget isolation test.

Verified: typecheck + dep-lint + 420 tests + CLI bundle green.
