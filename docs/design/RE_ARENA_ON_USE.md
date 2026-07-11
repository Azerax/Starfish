# Re-Arena after N uses — usage-driven re-certification

> **Decision (Scott, 2026-07-10):** there must be a **setting for the number of times an agent or skill can be used before its current (trusted) state is returned to the Arena** for re-certification. Design captured here; buildable once the Arena + trust ledger are built (currently designed, not built — see the Governed Execution suite).

## Why (the gap it closes)

Trust today is **event-driven**: earned-auto-approval is granted by a proven history of non-deviation and **revoked instantly on any single deviation**. That catches a *caught* mistake, but not slow drift — a skill or agent vetted once can, over hundreds of quiet uses, accumulate subtle changes, be gradually exploited, or simply operate in conditions its original Arena run never covered. **Usage-driven re-certification** adds the missing axis: trust *decays with use* and must be re-earned. It's the "your certification expires; re-prove it" pattern.

The two are complementary:
- **Deviation-triggered** (exists): any deviation → revoke → back to Arena. *Immediate, event-driven.*
- **Usage-triggered** (this): after N uses → demote → back to Arena. *Periodic, usage-driven.*

## The setting

A governed operator setting, `reArenaAfterUses: N` (like Risk Tolerance):
- **Global default** (e.g. a conservative N), with **per-capability / per-agent overrides that may only *narrow*** (a lower N — more frequent re-proving — never a higher one that weakens the global).
- `0` / unset = never auto-re-arena (only deviation revokes) — an explicit, audited opt-out.
- Persisted, audited on change, operator-only, fail-safe (missing/corrupt → the conservative default), exactly like `RiskToleranceStore`.

## Mechanism (in the trust ledger)

The trust ledger (which already tracks certification + consecutive-clean-runs for earned-auto-approval) gains:
- `usesSinceCertified` per agent/skill — incremented on each *use* (a governed invocation), audited.
- On `usesSinceCertified >= reArenaAfterUses(capability)`: the capability's **certified claim is demoted** → status returns to "needs Arena" → it drops from trusted/direct mode back to **sandboxed** and cannot auto-run until it **re-passes the Arena battery**. Reset `usesSinceCertified = 0` on re-certification.
- Both gates must hold for auto-run: **certified AND under-use-threshold AND (earned-auto-approval, if applicable)**. Any one failing → re-prove or ask.

## Guardrails (consistent with the model)
- Re-certification runs in the **no-OS Arena cage** on **evidence only** — same as first certification; time is not a factor.
- Demotion + re-cert are **audited** with provenance; a capability can't quietly stay trusted past its use budget.
- The counter is on the **trusted core's** ledger, not agent-reported (an agent can't under-count its own uses).
- Interacts cleanly with `File Arena` (files are per-artifact, not counted) and the deception cell (a *detected attack* still revokes immediately regardless of count).

## Status
Design decision recorded. Implementation depends on the **Arena** and **trust ledger** being built (both designed in `docs/planning/Governed Execution — The Arena (Trust Proving Ground).md` and the non-deviation plan). Added to the roadmap as a concrete item; the *setting* half can be built like `RiskToleranceStore` ahead of the Arena, but it only does something once the ledger enforces it.
