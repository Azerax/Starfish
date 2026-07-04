# Project Starfish v0.14.0 - Hardening II (sidecar)

Audit-driven hardening of the loopback sidecar's trust boundary.

## Security
- Strict input allowlist on `POST /v1/decisions`: server assigns actor, kind, and a per-actor-namespaced
  refId; riskTier is enum-clamped; unknown fields are dropped - a worker can no longer pre-seed a
  benign-looking record under an operator's refId (A6).
- 256 KB request-body cap (413) to prevent local memory-exhaustion (A11).
- Host-header validation: only loopback hostnames accepted (421), hardening against browser-origin /
  DNS-rebind requests (A12).
- Token file created 0600; `doctor --embed` FAILs on group/world-readable tokens (A13).

Verified: typecheck + dep-lint + tests + CLI bundle green.
