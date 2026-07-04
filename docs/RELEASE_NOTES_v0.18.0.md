# Project Starfish v0.18.0 - Live dashboard: SSE streaming

## Added
- Sidecar `GET /v1/stream` (SSE): live hello/audit/pending/budgets/monitor events, redacted (no `detail`)
  and scoped (non-operator sees only its own actor + system events / its own pending).
- `@starfish/ui` `httpBridge.subscribe()` — SSE over fetch (token stays in the Authorization header, never a
  query string), auto-reconnect with backoff. `GovernancePanel` renders live from the stream; poll retained
  only as a fail-soft backstop.

## Changed
- `startSidecar` force-closes live sockets on `close()` so an open stream can't hang shutdown.

Verified: typecheck + dep-lint + 401 tests (incl. SSE push/redaction/scoping) + CLI bundle green.
