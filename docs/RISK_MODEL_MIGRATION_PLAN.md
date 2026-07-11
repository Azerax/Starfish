# Risk model migration — 4-tier → 50-category / 0–100 composite

> **Date:** 2026-07-10 · **Status:** audit + plan for review (no code yet).
> **Why:** the 50-category matrix (`RISK_MATRIX.md`) and 0–100 composite (`RISK_TOLERANCE_PLAN.md`) change the **risk primitive** itself. Risk sits under the entire gate — it drives allow/deny, model routing, model selection, UI, and audit — so this is a foundational change, done additively so nothing regresses.

---

## 1. Audit — how risk works today

Risk today is the 4-tier enum `RiskTier = 'low' | 'medium' | 'high' | 'critical' | 'injection'` (`governance-core/src/types.ts`). A grep of the tree found **312 references across 63 files** — but they split cleanly into a *few producers* and *many consumers*, which is what makes this safe to migrate.

### Producers (assign a tier — these change)
- **`risk.ts` · `RiskEngine.classify(call, tool)`** — the main per-tool-call classifier: base tier from `tool.category` (read/meta→low, write→medium, exec→high), bumped to high on network/spend regex, critical on catastrophic regex, injection off-scale.
- **`vetting.ts`** (17 refs) — Toby's capability intake risk rating (static-signal 4-tier for a skill/tool/MCP).
- **`deletion.ts` · `assessDeletion`** — its own `impact.tier` (low→critical) by files/bytes/protected-path.
- **`secrets.ts` · `secretReadGate` / `secretWriteGate`** — return `tier` (low/high/critical) for secret access.
- **`sources.ts`** (8 refs) — external-source risk.
- **Static / hard-coded:** `ToolDef.riskTier` in `tools.json`, `DispatchTask.riskTier`, and fixed `riskTier: 'critical'` on hard-floor denials in `pdp.ts` (integrity, scope-deviation, secret) and `boot.ts` (integrity-fail).

### Consumers (read a tier — these should NOT need to change)
- **`pdp.ts` · `combine(tier, pol)`** — the decision point (allow / deny / ask). *This one changes to also consume the composite + Risk Tolerance.*
- **`router.ts` / `dispatch.ts`** — model selection by tier (low→haiku, high/critical→opus). Keeps working off the derived tier.
- **`broker.ts`** (pending decision), **`monitor.ts`**, **`projections.ts`**, **`desktop/src/ui-contract.ts`**, **renderer `bridge/types.ts` + `mockBridge.ts`** — carry/display the tier.
- **`audit.ts` · `AuditEvent.riskTier`** — records the tier on every decision.
- **`governance-overlay/src/seed.ts`** — default-skills `expectedRisk`.

### The key insight
`RiskTier` is **produced in ~6 places and consumed in ~dozens**. If we keep `RiskTier` alive as a value **derived from the new 0–100 composite** (a band lookup), every consumer keeps working unchanged. The migration is therefore **additive**, not a rip-and-replace.

## 2. Design principle — additive & backward-compatible

> **Locked (Scott, 2026-07-10): ONE risk model, single source of truth.** *"Two systems for similar tasks is not governance."* Every producer — `RiskEngine`, `vetting`, `deletion`, `secrets`, `sources`, and any future one — routes through a **single `assessRisk()`** in `score.ts` that owns the category scoring, composite, tier derivation, and floor logic. Producers supply category *evidence*; they never each keep their own tier logic. There is exactly one place risk is computed, one place it can be audited, one place it can change.


1. Introduce a richer **`RiskAssessment`**: `{ score: 0–100, categories: Record<CatId, 1–10>, tier: RiskTier, floors: CatId[], injection: boolean }`.
2. **`tier` is derived** from `score` by fixed decade-aligned bands (0–30 low · 31–50 medium · 51–70 high · 71–100 critical) plus 10 finer descriptors (Clear→Forbidden, see `RISK_MATRIX.md`); `injection` stays a sentinel outside 0–100 (hard reject).
3. Producers emit **category scores → composite → derived tier**. The derivation is calibrated so **today's tiers are reproduced** (existing 4-tier tests stay green).
4. Consumers keep reading `tier`; new surfaces (UI, audit, decision) additionally read `score` + top `categories`. No consumer is forced to change.
5. **Category floors** (matrix #1/#6/#8/#10/#11/#12/#29) and injection are enforced independent of the composite — the hard floors, expressed in matrix terms.

## 3. New components

- **`riskmatrix.ts`** (data) — the 50 categories as data: `{ id, name, floor?: boolean, hardDeny?: boolean }` + the anchor text for docs/UI. Single source of truth mirroring `RISK_MATRIX.md`.
- **`score.ts`** (logic) — pure, deterministic:
  - `composite(categories) → 0–100` = `min(100, max×10 + 2×min(10, count(others ≥7)))`.
  - `tierOf(score) → RiskTier` band lookup.
  - `floorsHit(categories) → CatId[]`.
  - all pure functions (fast, testable, cache-friendly for the 10 ms budget).
- **Extend `types.ts`** — add optional `score?: number` and `categories?` to `Decision` and `AuditEvent`; keep `riskTier` required/derived (no breaking change).

## 4. Producer migration (each reproduces its current tier via derivation)

| Producer | Change | Keeps green by |
|---|---|---|
| `RiskEngine.classify` | Return a `RiskAssessment`: score the applicable categories from the same signals it already matches (category #8 exec, #2 network, #6 reversibility, #11 secrets, #1 storage…), default the rest to 1, composite → tier | Calibrate bands so read=low, write=medium, exec/network=high, catastrophic=critical as today |
| `vetting.ts` | Map static signals (network/code-exec/fs-write/credential/obfuscation) onto categories → composite; keep the same auto-register-Low / quarantine-Medium+ cutoffs | Cutoffs expressed as score bands equal to current tiers |
| `deletion.ts` | Map files/bytes/protected-path/reversibility onto #6/#13/#4/#1 → composite; hard rules stay hard | Impact tier derived to match current thresholds |
| `secrets.ts` | Secret gates emit #11/#3 at floor band → still critical/high | Floor forces same deny/ask |
| `sources.ts` | External-source risk → #17/#2/#12 categories | Same admit/deny |

Backward-compat shim: a thin `classify()` that returns just `tier` (delegating to the new assessment) so any caller not yet updated still compiles.

## 5. Decision point — `pdp.ts combine()` + Risk Tolerance

`combine()` becomes `combine(assessment, pol, tolerance)`:
1. `injection` → deny (unchanged).
2. any **category floor hit** → deny if hard-deny floor, else ask (regardless of composite/tolerance).
3. explicit **policy deny** → deny.
4. **Risk Tolerance ceiling:** if `score ≤ ceiling(tolerance)` (Low 30 / Medium 70) and no floor → allow; else ask.
5. critical band (≥80) → always ask.

This folds the existing tier logic AND the new tolerance into one deterministic function at the single choke point — covering tool calls and (via the task-approval gate) tasks. Hard floors are checked *before* the tolerance ceiling, so tolerance can never lift them.

## 6. Surface changes (additive)

- **Audit:** decisions record `score` + top-3 contributing categories in `detail` (so "why did this run?" is answerable by evidence). `riskTier` unchanged.
- **Wire / `ui-contract` / renderer:** `DecisionLogEntry` gains optional `score?`, `categories?`; the D5 Bridge context pane shows the composite + its top categories + any floor flags (great fit for the redesign already underway).
- **`broker.ts`:** pending decision carries `score` for risk-sorted queues.
- **Risk Tolerance setting** (per `RISK_TOLERANCE_PLAN.md`) reads the composite.

## 7. Test strategy

- **Regression:** every existing 4-tier test (`pdp.risk`, `router`, `dispatch`, `deletion`, `secrets`, `vetting`, `broker`, `projections`, `ui-contract`, …) must stay green **unchanged**, proving the derived tier reproduces today's behaviour. This is the migration's safety net.
- **New:** `score.conformance` (composite math, tier bands, floor detection, monotonicity), `riskmatrix.conformance` (50 ids, floor set correct, mirrors the doc), `combine` with tolerance (Low/Medium ceilings; floor overrides; critical always asks), and a determinism test (same input → same score, 1000×).
- **Performance:** score() must stay within the 10 ms p95 gate — it's pure arithmetic over ≤50 small ints; verify in the existing NFR-1 harness.

## 8. Phased increments (each gated green before the next)

| # | Adds | Depends on |
|---|---|---|
| **RM-0** | `riskmatrix.ts` (data) + `score.ts` (pure fns) + tests — no wiring yet | — |
| **RM-1** | `RiskEngine.classify` returns `RiskAssessment`; `tier` derived; **all existing tests green** | RM-0 |
| **RM-2** | `combine()` consumes the assessment (tier semantics identical); audit records score + top categories | RM-1 |
| **RM-3** | Migrate `vetting` / `deletion` / `secrets` / `sources` producers to categories | RM-1 |
| **RM-4** | Risk Tolerance setting + ceiling wired into `combine()` (RT-1..RT-4 from the tolerance plan) | RM-2 |
| **RM-5** | Surface: wire/ui-contract/renderer show composite + categories; D5 Bridge context pane | RM-2 |
| **RM-6** | Calibration pass + expand category signals as evidence allows; docs sync | RM-3..5 |

## 9. Risks & mitigations (honest)

- **Silent behaviour drift** — deriving the tier wrong would change allow/deny. *Mitigation:* the untouched 4-tier test suite is the tripwire; RM-1 isn't done until it's 100% green.
- **False precision** — 50 categories imply detail the engine can't yet justify. *Mitigation:* score only a few categories from real signals at first, default the rest to 1; grow resolution as signals are wired (stated in the docs).
- **Latency** — more computation per call. *Mitigation:* pure integer math, no I/O; validate against the 10 ms NFR harness.
- **Calibration bikeshedding** — arguing over weights. *Mitigation:* fix the bands to reproduce current tiers first (objective target), tune later.
- **Two sources of truth** (`RISK_MATRIX.md` vs `riskmatrix.ts`) — *Mitigation:* a conformance test asserts the code matches the doc's 50 ids + floor set.

## 10. Needs Scott
- ✅ **Unification — DECIDED (2026-07-10):** all producers unify on the one `assessRisk()`; no parallel risk systems (§2). RM-3 is mandatory, not optional.
- Confirm the **tier bands** (decade-aligned 0–30 / 31–50 / 51–70 / 71–100) and the **floor set** (#1, #6, #8, #10, #11, #12, #29).
- The three Risk-Tolerance decisions still open (Medium ceiling 70, irreversibility always-ask, auto-revert) — they gate RM-4.

---

*Cross-references: `RISK_MATRIX.md` (the 50 categories), `RISK_TOLERANCE_PLAN.md` (the Low/Medium setting), `governance-core/src/{risk,types,pdp,vetting,deletion,secrets,sources,router,dispatch,broker,audit}.ts`. Nothing here weakens deny-by-default or the hard floors — it replaces a coarse 4-tier label with a granular, auditable, evidence-scored composite while keeping the tier as a derived, backward-compatible view.*
