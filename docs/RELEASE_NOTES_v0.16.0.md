# Project Starfish v0.16.0 - Audit durability + truthful facts

## Security
- Torn audit tail is healed on recover (no uncaught throw); torn/corrupt/truncated audit -> deliberate
  boot safe-mode (A16).
- Head anchor `{seq,headHash}` persisted every append, on by default -> tail truncation/rollback detected
  at boot (A17).
- Size-based rotation into chained segment files; `verify()` links segments + live tail across reboots.
- Conservative cost: unparseable provider usage -> char/4 estimate (marked `(estimated)`), budget still
  advances (A15).
- `run_tests` allow-lists selection args (no flag injection) and audits failures truthfully (A18).

Verified: typecheck + dep-lint + tests + CLI bundle green.
