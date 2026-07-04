# Project Starfish v0.20.0 - Policy authoring + governance UX

## Added
- `starfish policy list|explain|add|simulate`. `explain` returns the human-readable first-match reason (or
  default-deny); `simulate` is a dry-run showing before/after per sample and flags widenings as LOOSENED;
  `add` appends a rule.
- Core: `explainPolicy`, `simulatePolicyChange`, `PolicyEngine.explain`, `savePolicies`.

## Security
- Explanations/simulations always state that the hard floors (boundary, secrets, shell, internal-egress)
  are enforced separately and cannot be overridden by policy — a policy edit can't silently weaken the
  deny-by-default floor.

Verified: typecheck + dep-lint + 411 tests + CLI bundle + live `policy` CLI smoke test green.
