# Governed Learning Loop — task-aware, evidence-based validation that improves itself

> **Companion to** `docs/design/MEMORY_WIKI.md`, `MEMORY_WIKI_THREATS.md`, and the Evidence Gate
> (`governance-core/src/claims.ts`). Design, for review before code (2026-07-15).
>
> **Goal:** the validation layer learns *what errors a given task type tends to produce* and gets better
> at catching them over time — **without** an LLM silently rewriting its own rules. It is a **governed,
> evidence-based, tighten-only** loop, not autonomous self-modification. It upholds *bounded autonomy*
> (agents automate work, never expand their own authority) and *no unbacked word*.

## The core idea

Every run already emits exactly the signal you'd learn from — and it's already immutable, provenance-
stamped evidence (the audit ledger). So learning needs no new capture surface; it needs a **governed
retrospective** that turns that evidence into knowledge, and a **fail-closed way to apply it.**

## The loop

**1. Observe (free — reuse the audit ♻).** The raw signal is already recorded per run: Evidence-Gate
findings (unbacked / contradicted claims), stop reasons (`claim-unbacked`, `no-progress`, `budget-hard`,
`max-steps`), non-deviation denials, monitor anomalies, tool failures. The append-only audit *is* the
training data.

**2. Distill into governed knowledge (Thucydides proposes → Herodotus records → the gate approves).**
A **failure-pattern claim** is proposed — e.g. *"`refactor` tasks tend to claim 'tests pass' before a
suite run is recorded green"* — `supportedBy` the N runs where it actually happened. It flows through the
**same evidence→claim→gate pipeline**: confidence comes from **independent recurrences** (diversity-
weighted, per-source-capped — the Sybil defense), low-stakes + high-confidence auto-approves (audited),
else a human approves. An approved pattern becomes a **canonical "failure-mode" page** in the wiki, linked
`task-type → common-failure` (a typed, gated link), carrying its recurrence count + provenance to the runs.

**3. Apply — two governed uses.**
- **Anticipate (prime):** when a new task of that type is admitted, Thucydides retrieves that type's top
  failure-mode pages (bounded → token-cheap) and the validation layer / agent is primed: *"for this
  task-type, common failures are X/Y/Z; verify accordingly."* Delivered as **data, not instructions**
  (per the memory threat model), in a non-authoritative channel, never able to authorize a tool call.
- **Sharpen (add checks):** the Evidence Gate / a validation agent registers **targeted checks** for that
  task type — e.g. for `refactor`, refuse a `completion`/`tests-green` claim until a recorded suite-green
  deed exists. Checks remain **deterministic code**; only the *proposal* of which check to add used
  judgment, and that proposal was gated.

Roles map onto the pieces we already defined: **Thucydides** (analytical mode) is the retrospective
historian — fitting, since his method was rigorous cause-analysis of *why things went wrong*; **Herodotus**
is the sole writer; the **governance gate** + human decide promotion.

## The non-negotiable guardrail: TIGHTEN-ONLY

Learned changes may only move validation in the **fail-closed direction**:

- **Auto-applicable (audited):** add a check, raise scrutiny, require more evidence, lower an auto-approve
  threshold for a task type. Anything that makes the agent *more* accountable.
- **Human-approval required, always:** removing/relaxing a check, raising an auto-approve threshold,
  widening scope, or anything that makes validation *more permissive*.
- **Never, by any path:** weaken a **hard floor** (fs boundary, secrets, shell denylist, egress,
  deletion rules), auto-approve future *work*, or expand an agent's authority.

So the loop can only ever make the agent harder to fool, never easier. That is what keeps a *learning*
system compatible with *bounded autonomy*.

## Why it can't be gamed (reuses the threat model ♻)

- **Evidence-based, not vibes:** a pattern needs **N independent recurrences**; one flaky run can't mint a
  rule. Confidence is diversity-weighted and per-source-capped (same Sybil defense as memory).
- **Decay + re-confirmation:** patterns **age out** and must be re-earned from fresh runs (this is the
  `Re-Arena-after-N-uses` candidate applied to validation knowledge — trust decays with use, not only on
  deviation). Stops the loop calcifying on stale or one-off noise.
- **Poisoning-resistant:** it learns only from the **immutable audit** and promotes through the **gate**,
  so an attacker can't inject a fake "this always succeeds" pattern to relax checks — and relaxing is
  human-only anyway.
- **Provenance + reversible:** every learned check traces to the exact runs that justified it and can be
  **superseded / rolled back** (versioned pages).
- **Determinism preserved:** enforcement stays deterministic code; the LLM's role is confined to
  *proposing* patterns/checks, and every proposal is gated. Enforcement never moves into an LLM.
- **Injection-safe priming:** the "likely errors" handed to the agent are bounded, data-not-instructions,
  and screened — they can inform attention, never hijack behavior.

## Composition with what exists
- **Evidence Gate** produces the failure signal *and* is the primary place sharpened checks land.
- **Immutable task contract** gives a stable `task-type` / goal to attribute patterns to (and patterns
  never mutate a running task — they only shape *future* task admission + validation).
- **Memory Wiki** is the store (failure-mode pages + `task-type → common-failure` links); **Herodotus /
  Thucydides** are the write/read governance; the **gate** is the promotion control.
- **Runtime monitor (Hank)** anomalies feed the observe step.

## Open decisions (Scott's call)
1. **Auto-tighten aggressiveness** — a floor/ceiling on how many auto-checks a pattern can add before a
   human must confirm, so the loop doesn't become its own escalation-fatigue source.
2. **Task-type taxonomy** — how tasks are typed for attribution (declared at intake? clustered?). Patterns
   are only as good as the grouping.
3. **Recurrence + decay thresholds** — N for promotion, half-life for decay, min independent sources.
4. **Who runs the retrospective** — Thucydides analytical mode on a schedule / on task-close, vs. an
   explicit "postmortem" pass. (Recommend: on task-close, cheap deterministic tally; LLM proposal only when
   the tally crosses a threshold.)

## Staged build
- **P1:** deterministic **retrospective tally** at task-close (count stop-reasons / gate-findings by
  task-type from the audit) → failure-pattern **claims** through the existing gate → **failure-mode pages**
  + links in the wiki. Tighten-only application: prime new tasks (bounded read) + a registry of
  task-type-scoped Evidence-Gate checks. All reuse ♻ except the tally + the check-registry (✚).
- **P2:** Thucydides analytical proposals for subtler patterns; decay/re-confirmation; per-task-type
  auto-approve tuning.
- **P3 (deferred):** embedding-assisted pattern clustering (only over approved knowledge), tied to the
  memory-wiki vector phase.
