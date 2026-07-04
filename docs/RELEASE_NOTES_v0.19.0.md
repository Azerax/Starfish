# Project Starfish v0.19.0 - Multi-root / multi-tenant sidecar

## Added
- `startMultiSidecar({ roots })` — one loopback sidecar, many governed roots, hard per-root isolation
  (token -> root routing; per-root governance/broker/audit/pending/resolved/SSE scope). Duplicate token
  across roots rejected at construction. `RootSpec.operators` sets the per-root approver principal set.

## Security
- `DecisionBroker.resolve(id, verdict, by, operators?)` — with an operator set supplied, only a designated
  operator can approve (blocks agent-vs-agent approval, audit A20). `startSidecar` single-tenant behavior
  unchanged.

Verified: typecheck + dep-lint + 404 tests (incl. cross-root isolation + A20) + CLI bundle green.
