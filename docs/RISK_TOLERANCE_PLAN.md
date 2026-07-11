# Risk Tolerance setting — plan

> **Date:** 2026-07-10 · **Owner:** Scott · **Status:** plan for review (no code yet).
> **Request:** a UI setting **Risk Tolerance = Low or Medium**. Default **Low**. On **Medium**, any tool or task that scores **7 or below** runs without asking. Switching to Medium needs a **double confirmation**.
> **Audience:** many users run this on spare machines, keep backups, or are just experimenting — they want to trade some human-in-the-loop friction for autonomy, deliberately.

---

## 1. The core idea (and the line it must never cross)

Risk Tolerance widens the band of actions that **auto-run** versus **ask you first**. It only ever turns an `ask` into an `auto-allow` for mid-risk, non-critical actions. It can **never** relax the constitutional **hard floors** — those stay enforced no matter the setting. This keeps the setting safe to ship even to someone experimenting on a throwaway box.

Default is Low (today's behaviour). Medium is opt-in, loud, and instantly reversible.

## 2. A numeric risk score (0–100) from a 50-category matrix — the missing piece

Today the engine is **4-tier** (`low, medium, high, critical`, plus `injection`). Your "7 or below" implies a numeric score, which doesn't exist yet. Step one is a deterministic **0–100 composite** built from the **50-category risk matrix** (`RISK_MATRIX.md`): every action is scored **1–10 on each applicable category** (1 safest, 10 max), and the composite is **max-driven, not averaged**, so one dangerous dimension is never diluted by dozens of benign ones:

```
composite = min(100, highest_category × 10  +  2 × (count of other categories ≥ 7, capped +20))
```

Tier bands (decade-aligned): **0–30 low · 31–50 medium · 51–70 high · 71–100 critical**, with 10 finer descriptors (Clear→Forbidden) in `RISK_MATRIX.md`. Your "7 of 10" ceiling becomes **70 of 100.** The score and its top contributing categories are audited on every decision, so "why did this run?" is answerable by evidence — not a bare number.

The initial engine scores only a handful of categories deterministically from real signals (path/tool/target/tier), defaulting the rest to 1; resolution grows as real signals are wired. Granularity must be earned by evidence, never faked.

## 3. What each setting auto-runs

| Setting | Auto-runs (no prompt) | Always asks you | Always denied |
|---|---|---|---|
| **Low** (default) | composite ≤ 30 | 31–100 | category floors + injection |
| **Medium** | composite ≤ 70 | 71–100 (critical) | category floors + injection |

So Medium adds the **31–70 band** (workspace writes + the lower end of external/high actions) to what runs unattended. **Critical (71–100) always requires you**, on either setting — matching your "7 or below" ceiling. And regardless of the composite, any **category floor** (#1 system storage, #11 secrets, #8 arbitrary exec, #12 exfiltration, #6 irreversibility, #29 self-governance, #10 loss of audit) forces at least an Ask — a low composite can never sneak a dangerous single dimension past you.

## 4. Non-negotiable guardrails (the setting cannot defeat these)

These are enforced *before and independent of* the tolerance check, so no value of the setting lets them auto-run:

1. **Hard floors** — filesystem boundary escape, secret-file read/write, catastrophic shell, egress to a blocked/internal host, symlink, and the deletion hard-rules (no system files, no skills, no folders). Policy already can't override these; neither can tolerance.
2. **Prompt-injection** — always hard-reject, regardless of score or setting.
3. **Critical tier (8–10)** — always human. The Medium ceiling is 7 by design, so Critical is never in the auto-run band.
4. **Proposer ≠ approver** — an agent can never "self-approve" under any tolerance.
5. **Recommended: an irreversibility floor.** Even inside the ≤7 band, actions that move money, publish, push to a remote, or otherwise can't be undone (`spend/transfer/payment`, `git push`, `npm publish`) should still **ask**, because backups don't undo a wire transfer or a public release. This protects exactly the "spare machine / has backups" user, for whom *local* mistakes are cheap but *external* ones aren't. (Decision for you — see §9.)

Net: Medium relaxes **local, reversible, mid-risk** work. It does not open the dangerous doors.

## 5. Where it plugs in

- **Config:** a governed setting `riskTolerance: 'low' | 'medium'` (default `low`), stored with the other operator settings. Missing/corrupt → treated as **Low** (fail-safe to the stricter value).
- **PDP `combine()`:** for a non-floor, non-injection action with score `s` and no explicit policy-deny: `allow` if `s ≤ ceiling(tolerance)` (Low→3, Medium→7), else `ask`. Critical still `ask`. One-line change at the single choke point, so tool calls *and* task-approval both honour it.
- **Task lifecycle:** the same score gates `backlog → analysis` auto-approval, so a whole *task* scored ≤7 can proceed under Medium without a prompt — matching "any tool **or task**."

## 6. UX — the setting + the double confirmation

Lives in **Settings → Safety**, as a segmented control `Low | Medium` with a plain-language description.

**Switching Low → Medium requires two explicit confirmations:**
1. **Step 1 — explain + acknowledge.** A dialog states exactly what changes: *"Tools and tasks scored up to 7 of 10 will run without asking you. Safety floors — file boundaries, secrets, destructive shell, network exfiltration, and deletions — still always require you. Best on a spare machine, with backups, or when experimenting."* Requires ticking **"I understand"** to enable Continue.
2. **Step 2 — final confirm.** *"Turn on Medium risk tolerance? You can switch back to Low anytime."* → Confirm.

Only after both does it apply. **Switching back to Low is a single click** (safe direction = no friction).

**Always-on indicator:** while Medium is active, a persistent `Risk: Medium` chip shows in the header (warning colour) so you never forget you're in the looser mode. Clicking it jumps to the setting.

## 7. Audit, reversibility, transparency

- Changing the setting is itself a **governed, audited** event (`system` domain: who, when, `low→medium`), append-only.
- Every action that auto-ran **only because tolerance was Medium** (i.e. score 4–7) is tagged in the audit: `auto-allowed under Medium (score 6)`. So the backup-minded user can review exactly what the relaxed setting permitted, and nothing is silent.
- **Optional auto-revert (recommended):** Medium reverts to Low on app restart (or after N hours), so a machine left running doesn't stay permissive forever. Decision for you (§9).

## 8. Build increments (each gated green before the next)

| # | Adds | Tests |
|---|---|---|
| RT-1 | `RiskEngine` emits a 0–100 `composite` + per-category scores from the 50-category matrix; audited | composite = max×10 + bump; category floors respected; tier↔band monotonic |
| RT-2 | `riskTolerance` setting + governed persistence + fail-safe-to-Low | missing/corrupt → Low; change is audited |
| RT-3 | PDP `combine()` honours the ceiling; **floors + critical + injection unaffected** | Medium runs a score-6 write; Medium still **asks** a critical + **denies** a boundary escape / secret / injection |
| RT-4 | Task-approval gate honours the ceiling | a score-7 task auto-advances under Medium; score-8 still asks |
| RT-5 | Settings UI + double-confirm + header indicator + audit tag | two-step confirm required for Medium; one-click revert; indicator visible |
| RT-6 | (if chosen) irreversibility floor + auto-revert | `git push`/spend still ask under Medium; Medium reverts on restart |

## 9. Decisions for you

1. **Score mapping.** Is the 0–10 banding in §2 right (Medium ceiling 7 pulls in the low end of "high" like a network fetch)? Or should Medium cap at 6 (local writes only) and treat all external/high as always-ask?
2. **Irreversibility floor (§4.5).** Keep money/publish/push always-ask even under Medium (recommended), or let them run if scored ≤7?
3. **Auto-revert (§7).** Should Medium expire on restart / after N hours, or stay until manually changed?
4. **Scope.** One global setting, or per-agent / per-task-type tolerance later?

---

*Cross-references: `packages/governance-core/src/risk.ts` (4-tier engine to extend with a score), `pdp.ts` `combine()` (the single choke point), `GOVERNANCE.md` (hard floors), the non-deviation Scope Contract (task-level scoring). Nothing here weakens deny-by-default or the hard floors — it only widens the auto-run band for local, reversible, mid-risk work, with a loud, reversible, audited opt-in.*
