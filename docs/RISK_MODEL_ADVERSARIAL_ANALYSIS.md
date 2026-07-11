# Risk model — adversarial analysis (50 attacks × 3 scored mitigations)

> **Date:** 2026-07-10 · **Scope:** the new risk model — 50-category matrix, 0–100 max-driven composite, category floors, Risk Tolerance (Low/Medium), and the single `assessRisk()`. Companion to `RISK_MATRIX.md`, `RISK_TOLERANCE_PLAN.md`, `RISK_MODEL_MIGRATION_PLAN.md`, and the Governed Execution adversarial doc.

**The adversary's goal:** make a dangerous action **score low enough to auto-run** (or defeat a floor / the tolerance gate) so governance waves it through. Adversaries = a malicious or prompt-injected agent, a malicious skill/tool/MCP author, a malicious external file/source, or a careless/socially-engineered operator.

**Mitigation scoring:** each mitigation is rated **/100** for how much it reduces that attack (higher = stronger); tagged **P**revent / **D**etect / **C**ontain. **Bold** = the primary. Nothing here relaxes the constitutional hard floors.

---

## A. Score suppression — make dangerous look safe

**1. Category dilution** (bury one dangerous category among benign ones to drag a composite down).
- **P — Composite is max-driven, not averaged: one maxed category sets the floor (95).**
- D — audit the top-3 contributing categories every decision; a single 10 is visible (80).
- C — category floors force ≥Ask regardless of composite (90).

**2. Band-edge hugging** (keep every category at a sub-threshold value so the composite sits just under Medium's 70).
- **P — floors + critical-band still trip independently of where the composite lands (85).**
- D — flag actions clustering just below the ceiling as an anomaly for Hank (70).
- C — earned-trust required before auto-run even inside band (75).

**3. Ceiling-hugging (exactly 70)** (craft an action scored precisely at the Medium ceiling).
- **P — ceiling is inclusive by spec but reversible/irreversible + floors still gate it (80).**
- D — log every auto-run in the 60–70 band with full category vector (75).
- C — irreversibility floor (#6) keeps money/publish/push always-ask even at 70 (90).

**4. Accumulation-cap gaming** (hold the count of ≥7 categories at/under the +20 cap).
- **P — the cap only limits the *bump*; the max term already reflects the worst dimension (85).**
- D — record raw category vector so "many 6s" patterns are reviewable (65).
- C — a second high category (≥7) plus any floor still forces Ask (80).

**5. Unscored-category exploit** (target categories that default to 1 because signals aren't wired yet).
- **P — publish the "scored vs default-1" coverage; gate high-consequence tools behind scored categories (75).**
- **D — audit flags decisions where a *floor* category was default-1 (i.e. unverified) (85).**
- C — default unknown-but-consequential tool categories to a conservative floor, not 1 (80).

**6. Category mislabeling** (get a dangerous action classified under a low-weight category).
- **P — category assignment is deterministic from tool/target signals, not agent-declared (90).**
- D — cross-check declared category vs signal-derived category; mismatch → escalate (80).
- C — floors are signal-derived, so a mislabel can't dodge them (85).

**7. Sub-threshold chunking** (split one large-scope action into many small ones each scoring low on #4 volume).
- **P — per-task cumulative scope meter: N small ops on the same target aggregate into the scope score (80).**
- **D — rate/frequency (#37) + fan-out (#36) categories catch bursty chunking (85).**
- C — budget/quota caps bound total damage even if each is low (75).

**8. Aggregate-blindness** (many independently-low actions that are jointly catastrophic).
- **P — session-level composite: correlate a task's actions, not just each call (80).**
- D — Hank's semantic sweep looks for slow-burn patterns the per-call gate misses (75).
- C — scope contract bounds the whole task; deviation revokes trust (85).

**9. Signal obfuscation** (encode paths/URLs/commands so the category detector misses).
- **P — normalize-before-score (reuse the boundary/secret/netguard normalization hardening) (90).**
- D — an un-normalizable/undecodable input is itself a high-risk signal (75).
- C — deny-by-default on unparseable targets (85).

**10. Reversibility masking** (present an irreversible action as reversible — deferred/async delete, "soft" that isn't).
- **P — reversibility (#6) derived from the actual operation class, not the agent's claim (90).**
- D — verify a claimed rollback path exists before trusting reversibility (75).
- C — treat "unknown reversibility" as irreversible (fail-safe) (85).

## B. Floor evasion

**11. Secret-path evasion** (name a secret file to dodge #11).
- **P — the scorer uses the SAME hardened `isSecretPath` (ADS/trailing-dot/case) as the gate (95).**
- D — near-miss secret names flagged (70).
- C — secret floor forces gatekeeper path regardless of score (90).

**12. Exfil laundering** (split/encode data egress below #12 detection).
- **P — taint tracking: any tainted data reaching egress trips #12 by provenance, not volume (85).**
- D — egress to non-allowlisted destinations is high-signal even when small (80).
- C — egress hard floor blocks foreign destinations outright (90).

**13. System-storage disguise** (reach system paths via symlink/junction to dodge #1).
- **P — canonicalize + no-symlink rule from the boundary engine before scoring #1 (95).**
- D — symlink component near a system root → Critical signal (80).
- C — boundary floor denies system-tree writes regardless of score (90).

**14. Execution-capability hiding** (invoke code-exec through a non-obvious tool so #8 doesn't fire).
- **P — #8 derived from tool *capability* declared at vetting, not from the call shape (85).**
- **D — command-template allowlist: only vetted exec templates run; anything else is unknown→high (90).**
- C — raw shell is never allowlisted (from GOVERNANCE) (95).

**15. Audit-loss concealment** (disable/forge logging so #10 shows full oversight while acting hidden).
- **P — audit is mandatory + fail-closed; #10 can't drop because logging can't be turned off (95).**
- D — hash-chain break / anchor mismatch detected at boot + sweep (90).
- C — audit-integrity failure → PDP safe-mode (deny all) (90).

**16. Self-governance backdoor** (edit policy/score weights framed as benign config to dodge #29).
- **P — score weights / bands / floor set live in the trusted core, edited only via governed re-approval (90).**
- **D — self-integrity manifest covers score.ts + riskmatrix.ts; tamper → safe-mode (90).**
- C — #29 is a hard-deny floor: touching governance always denies (95).

**17. Floor-ordering bug** (exploit a path where the tolerance ceiling is checked before floors).
- **P — `combine()` checks floors + injection BEFORE the tolerance ceiling, by construction (95).**
- **D — conformance test: a floor action under Medium at low composite still Asks (90).**
- C — belt: floors re-checked at the PEP egress bracket too (80).

**18. Floor-set omission** (a category that should be a floor isn't flagged, so a dangerous dimension doesn't force Ask).
- **P — floor set is data in riskmatrix.ts, reviewed + doc-synced (80).**
- **D — conformance test pins the exact floor id set vs RISK_MATRIX.md (90).**
- C — periodic red-team review of the floor set (65).

## C. Composite / formula integrity

**19. Formula tamper** (alter the composite fn max→mean to re-enable dilution).
- **P — score.ts in the TCB, operator-signed self-integrity (90).**
- **D — determinism + golden-vector tests: known inputs → known composites (90).**
- C — tamper → safe-mode (85).

**20. Band tamper** (shift tier bands so critical starts at 95, letting 80–94 auto-run).
- P — bands are core constants, integrity-covered (85).
- **D — conformance test pins band boundaries; golden vectors catch drift (90).**
- C — Medium ceiling (70) still caps auto-run below the tampered critical band (75).

**21. Rounding exploit** (exploit rounding to drop 71→70).
- **P — deterministic integer math, defined rounding (round-half-up), no floats in the gate (90).**
- D — property test: no input near a boundary flips class under rounding (80).
- C — ceiling comparisons use `≤`/`<` consistently, tested (80).

**22. Underflow injection** (feed a category value of 0/negative to underflow the max).
- **P — clamp every category to [1,10] on ingest; reject out-of-range (95).**
- D — out-of-range category value → integrity finding (80).
- C — clamp fails safe to 10, not 1, on a malformed high-consequence category (75).

**23. NaN/undefined category** (a missing category breaks max() → low composite).
- **P — default map initializes all 50 to 1; `assessRisk` validates completeness (90).**
- **D — a NaN/undefined anywhere → treat action as Critical (fail-safe) (90).**
- C — schema-validate the category vector before compositing (85).

## D. Risk Tolerance abuse

**24. Silent Medium enablement** (set tolerance=Medium via poisoned config, skipping the double-confirm).
- **P — tolerance lives in governed config; only the operator UI double-confirm writes it; file edits are ignored/require re-confirm (90).**
- **D — any tolerance change is audited (who/when/from→to); an unattested change → revert + alert (90).**
- C — secret/config write is itself gated (secretGatekeeper) (80).

**25. Fail-open on corrupt config** (corrupt the setting so it reads Medium).
- **P — parse strictly; unknown/corrupt → **Low** (fail-safe to stricter) (95).**
- D — corrupt-config event audited (80).
- C — on repeated corruption, lock to Low + require operator re-set (80).

**26. Double-confirm fatigue / social engineering** (walk the operator through both confirmations).
- **P — step-2 states concrete consequences + "best on a spare machine with backups"; no default-yes button (75).**
- **D — persistent header `Risk: Medium` chip + audit tag on every Medium-only auto-run so it's never invisible (85).**
- C — optional auto-revert to Low on restart / after N hours (80).

**27. Persistent Medium then attack later** (leave Medium on indefinitely).
- **P — recommended auto-revert (restart / time-boxed) (80).**
- D — a "Medium has been on for X days" nudge (70).
- C — earned-trust still required per task even under Medium (75).

**28. Tolerance-scope creep** (a per-agent/per-task override that widens beyond the global setting).
- **P — no override may EXCEED the global ceiling; overrides can only narrow (90).**
- D — audit any per-scope tolerance; review widenings (80).
- C — global Low is a hard cap on all scopes (85).

**29. Timing attack** (schedule the dangerous action for when Medium is active).
- P — auto-revert shrinks the window (75).
- **D — scheduled/persistent actions (#32) re-scored at execution time under the THEN-current tolerance (85).**
- C — high-consequence scheduled actions always re-ask at fire time (80).

**30. Header-indicator suppression** (hide the Medium chip so the operator forgets).
- **P — the indicator is rendered by the trusted host chrome, not agent-controllable content (85).**
- D — doctor/health check asserts the indicator renders when tolerance=Medium (70).
- C — audit tagging means the trail shows Medium even if UI is hidden (80).

## E. Producer inconsistency / unification gaps

**31. Pre-unification divergence** (exploit a producer still on legacy 4-tier mid-migration).
- **P — single-source-of-truth decision: all producers route `assessRisk()`; RM-3 mandatory (90).**
- **D — a lint/test forbids any tier literal returned outside `score.ts` (85).**
- C — legacy shim maps to conservative tier during transition (70).

**32. Producer defaults to 1** (a producer that doesn't emit categories under-scores).
- **P — `assessRisk()` requires explicit evidence for consequential categories; silence ≠ safe for those (85).**
- **D — coverage test: each producer exercises its expected categories (85).**
- C — unknown producer output → Critical (80).

**33. Shim abuse** (the backward-compat `classify()`→tier shim loses category/floor info).
- **P — the shim delegates to `assessRisk()` and preserves floors; it never computes tier itself (85).**
- D — shim usages tracked + slated for removal; count trends to zero (70).
- C — floors evaluated at the PEP independent of the shim (80).

**34. Derived-tier drift** (mis-calibrated derivation maps a high composite to a low tier).
- **P — tier bands fixed + integrity-covered (85).**
- **D — the ENTIRE legacy 4-tier suite must stay green — the migration tripwire (90).**
- C — routing/UI read tier, but the DECISION also reads composite + floors (80).

**35. Bypass the scorer** (a call path reaches execution without `assessRisk()`).
- **P — single PDP choke point; every transport brackets through it (from GOVERNANCE topology) (90).**
- **D — an unscored decision in the audit is itself an alarm (85).**
- C — no-score → fail-closed deny (90).

## F. TOCTOU / evidence integrity

**36. Score-then-swap** (score a benign input, execute a swapped dangerous one).
- **P — score the exact bytes/args that execute; bind score to a hash of the resolved call (90).**
- **D — re-verify hash at execution (before/during/after, like skill integrity) (85).**
- C — mismatch → deny + quarantine (85).

**37. Evidence forgery** (feed fabricated signals that lower category scores).
- **P — signals derived from the real resolved call (path/tool/target), not agent-supplied metadata (90).**
- D — implausible signal combinations flagged (70).
- C — evidence-based principle: unbacked claims blocked; deeds checked vs claims (80).

**38. Cache poisoning** (poison a score cache so a dangerous call reuses a benign score).
- **P — cache key = full canonical call hash + policy/tolerance version; no partial-key hits (90).**
- D — cache-hit rate anomalies monitored (65).
- C — cache is an optimization only; a miss recomputes; TTL short (80).

**39. Replay** (replay an old low score in a now-dangerous context).
- **P — score bound to context (task, tolerance, boundary) at compute time (85).**
- D — stale-context detection (70).
- C — re-score on any context change (80).

**40. Non-determinism** (find inputs where the scorer is order/environment-dependent).
- **P — pure function, sorted inputs, no Map iteration order, no time/locale/random (90).**
- **D — determinism test: 1000× identical input → identical composite (90).**
- C — any nondeterminism detected → treat as high (75).

## G. The scorer as an attack surface

**41. Injection into an LLM-assisted category** (if any category uses model judgment, inject to force a low score).
- **P — the GATE scorer is deterministic; no LLM in the 10ms path. LLM (Hank) is advisory-only, never lowers a deterministic score (95).**
- D — Hank's opinion diffed vs deterministic counters; can only RAISE concern, not lower risk (85).
- C — LLM output can't auto-allow; it can only escalate (90).

**42. Self-reported risk** (agent claims its action is low-risk).
- **P — score never uses agent self-report; deterministic from signals only (95).**
- D — a self-declared risk field, if present, is audit-only and cross-checked (75).
- C — deeds-vs-claims evidence gate blocks unbacked "it's safe" (85).

**43. Oversized input timeout** (huge input to time out the scorer and fail-open).
- **P — input size caps before scoring; over-cap → high-risk, not skip (90).**
- **D — scorer has a hard time budget; exceeding → fail-CLOSED (deny), never open (90).**
- C — 10ms NFR harness includes adversarial large inputs (80).

**44. ReDoS on category detectors** (catastrophic regex backtracking to stall the gate → fail-open).
- **P — linear-time matchers / RE2-style or anchored non-backtracking patterns; audited regexes (85).**
- **D — per-matcher time guard; timeout → deny (90).**
- C — fuzz the detectors with pathological inputs in CI (80).

**45. Unicode/homoglyph evasion** (dodge category text matchers).
- **P — NFC + case-fold normalize before matching (reuse hardening) (90).**
- D — mixed-script/homoglyph inputs flagged (75).
- C — deny on undecodable/normalization-failing input (85).

## H. Governance-process attacks (the slow ones)

**46. Matrix-doc drift** (change `RISK_MATRIX.md` but not `riskmatrix.ts`, or vice versa, to desync floors).
- **P — single source: generate one from the other, or a conformance test asserts exact parity (90).**
- **D — CI fails if the 50 ids / floor set differ between doc and code (90).**
- C — floor set additionally hard-asserted in the gate (80).

**47. Calibration poisoning** (many small "harmless" changes over time that quietly lower a category's weight).
- **P — weight/band changes are governed, reviewed, and diffed with before/after simulation (like policy simulate) (85).**
- **D — `simulateScoreChange` shows any change that LOOSENS (lowers) a score, flagged prominently (90).**
- C — golden-vector tests break if calibration drifts known cases (80).

**48. Category deprecation** (remove/merge a category to drop a floor).
- **P — removing/merging a floor category requires elevated governed approval + rationale (85).**
- **D — floor-set conformance test fails if a floor id disappears (90).**
- C — deprecations logged with provenance (70).

**49. Test-suite gaming** (weaken the regression tests so derived-tier drift passes).
- **P — tests in the TCB, changes reviewed; golden vectors are checksum-pinned (80).**
- **D — coverage + mutation testing on score.ts; a weakened assertion is visible in diff (80).**
- C — external periodic audit of the risk suite (65).

**50. Operator-role confusion** (a non-operator, or an agent, changes the tolerance setting — self-authorization).
- **P — tolerance change requires the operator identity; proposer≠approver applies to the setting itself (90).**
- **D — every change audited with actor identity; agent-initiated attempt → deny + alert (90).**
- C — setting write gated like a secret (gatekeeper) (85).

---

## Cross-cutting principles (each mitigates many of the above)

1. **Deterministic gate scorer, LLM advisory-only** — the 10ms score is pure math over signals; a model can only *raise* concern, never lower risk or auto-allow (kills 41, 42, and the injection class).
2. **Single source of truth** — one `assessRisk()`, one `score.ts`, one floor set; no producer computes its own tier (kills 31–35, 46).
3. **Floors before tolerance, fail-closed everywhere** — floors + injection are checked before the tolerance ceiling; unknown/corrupt/timeout/unscored → the stricter outcome, never the looser (kills the fail-open class: 17, 23, 25, 35, 43, 44).
4. **Score the resolved bytes, bound by hash** — no TOCTOU; re-verify at execute (kills 36–39).
5. **Normalize before match** — reuse the boundary/secret/netguard hardening so obfuscation can't dodge a category (kills 9, 11, 13, 45).
6. **Evidence, not self-report** — signals come from the real call; deeds checked against claims (kills 37, 42).
7. **Change control with loosening-detection** — weights/bands/floors are governed, integrity-covered, golden-vector-pinned, and any change that *lowers* a score is flagged (kills the slow-drift class: 16, 19, 20, 47, 48, 49).
8. **Transparency** — top categories + composite + tolerance state are audited on every decision, so a wrong-but-low score leaves a reviewable trail (detects most residuals).

*Highest-leverage build consequences: put `score.ts`/`riskmatrix.ts` under self-integrity + golden-vector + determinism tests from RM-0; make `combine()` check floors-before-ceiling and fail-closed on any anomaly; reuse the existing normalization hardening in the category detectors; keep every LLM out of the deterministic gate path.*
