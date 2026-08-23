# Site claims audit — claim → evidence

**Date:** 2026-08-20 · **Code:** `65b3974` · **Scope:** every page under `site/` (5 pages + 11 blog posts),
body text **and** JSON-LD schema.

Prompted by the external adversarial review (`ADVERSARIAL-QA.md`, `PHASE_BUILD_LOG.md`). That review
found three correct-but-unwired modules; this asks the matching marketing question — **does the site
claim anything the shipped code does not do?**

> **STATUS — actioned in v0.27.0 (2026-08-20).**
> - **C-1, C-2** (Arena, non-deviation on `starfish-vs-hermes`) — rewritten as roadmap-labelled,
>   including both `FAQPage` JSON-LD answers.
> - **C-4, C-6, C-8** — fixed in *code* rather than copy, so the original sentences are now true:
>   ring 3 fails closed on audit-write failure (Q8), the shell/network floors moved into the PDP
>   (F-11), and the Evidence Gate is ON by default.
> - **C-7, C-9, C-11** — copy qualified on `index.html` to match shipped defaults (task-binding is
>   opt-in, self-integrity needs a manifest, keychain has a documented fallback).
> - **C-10** — no copy change needed; the code gap behind it (F-9) is fixed.
> - **C-3, C-5** — blog posts left as written; see *Blog policy* below. Both underlying defects
>   (F-8, F-1) are now fixed, so the dated notes should say "fixed in v0.27.0" rather than "tracked".
>
> **C-2 UPDATE — the non-deviation claims can come back.** F-10 was closed later the same day, so the
> capability the `starfish-vs-hermes` copy described is now genuinely enforced (`ScopeMode`
> `'contracted'` by default). The roadmap-labelled wording currently on the page is *understated*
> rather than wrong. Recommended revision, once you're ready to touch the page again:
>
> > An agent may automate work; it may never expand its own authority. Each task carries a scope
> > contract — narrower than the agent's standing grants, sealed at approval, amendable only by
> > governed re-approval — and a call that strays outside its approved tools, paths, commands or
> > budget is refused.
>
> That is now literally true and testable (`scopeissuer.conformance.test.ts`). **C-1 (the Arena) is
> still design-only** and its roadmap label must stay.

## Verdicts

| | Meaning |
|---|---|
| ✅ **SUPPORTED** | Wired, reachable from a shipped entry point, does what the sentence says. |
| 🟡 **QUALIFIED** | True on some paths / when configured, but the sentence reads as unconditional. Needs a scope word. |
| 🟠 **UNWIRED** | Implemented and tested, but no shipped caller invokes it. |
| 🔴 **NOT BUILT** | No implementation exists. |

Blog posts are dated devlog entries and are treated as **true-as-of-publication**; only claims that
are wrong *now* are listed, and the fix is a dated note rather than a rewrite. Landing pages and
`index.html` are present-tense product claims and must be true today.

---

## 🔴 NOT BUILT — must change before this page stays up

### C-1 · The Arena · `starfish-vs-hermes/index.html`

> "a self-authored skill is untrusted until it proves itself in an **isolated Arena**" *(JSON-LD)*
> "a generated skill must pass an **Arena of competence, non-deviation, and injection-resistance
> trials**, judged on recorded evidence, before it is signed and allowed to act" *(JSON-LD + body)*

**Evidence:** no `arena.ts`, no proving-ground module anywhere in `packages/governance-core/src/`.
The Arena exists only as a design document (`Governed Execution — The Arena (Trust Proving Ground).md`).
Capability intake that *does* ship is `vetting.ts` + `intake.ts`: provenance check, risk score,
injection screen, quarantine-pending-consent — real, but not trials and not an isolated environment.

**Proposed wording**

> Starfish keeps that capability but governs it: a self-authored skill is untrusted until it passes
> capability intake — provenance, risk scoring and prompt-injection screening, with anything
> medium-risk or above quarantined until you consent. *An isolated Arena that proves competence and
> non-deviation under trial is designed and on the roadmap; it is not in the current release.*

---

## 🟠 UNWIRED — implemented and tested, no shipped caller

### C-2 · Non-deviation enforcement · `starfish-vs-hermes/index.html` ×3

> "A learned behavior that drifts off scope **trips non-deviation enforcement and is stopped**." *(body)*
> "In Starfish, a learned behavior that drifts off its approved scope trips non-deviation enforcement
> and is stopped, and **trust is revoked instantly on any deviation**." *(JSON-LD)*
> "Trust is earned by a proven history of non-deviation and **revoked instantly on a single deviation**." *(body)*

**Evidence:** F-10. `scope.ts` implements D1–D4, seal verification and budget metering with 7 green
tests, but `boot.ts:61` passes no `scopeGate` to the PDP and `boot.ts:70` hardcodes
`scopeNonDeviation: false`. Probe confirms the shipped posture:
`{integrity:false, taskBinding:false, scopeNonDeviation:false, selfIntegrity:false}`.

**Proposed wording**

> An agent may automate work; it may never expand its own authority. A per-task scope contract —
> narrower than the agent's standing grants, sealed at approval and amendable only by governed
> re-approval — is implemented and tested; *runtime enforcement of drift against that contract ships
> in the next release.* Today, an agent is held to its **boundary**, and every action stays inside the
> filesystem, secret and policy floors.

### C-3 · "a watcher that cannot lie" · `blog/toby-and-hank.html`

> "his conclusions are **reconciled against deterministic counters**"

**Evidence:** F-8 — `reconcile()` and `sweep()` are never called in production; only `counters()` is,
from the sidecar. F-2 — with the audit file absent, the reconciliation passes `allClear:true`.
The mechanism is real and tested; nothing drives it.

**Fix:** dated correction note (see *Blog policy* below). No rewrite — the post was true as a
description of what had been built on 2026-06-09.

---

## 🟡 QUALIFIED — true on some paths, written as unconditional

### C-4 · "if the log can't be written, nothing runs" · `starfish-vs-openclaw/index.html`, `blog/the-governed-core.html`

**Evidence:** true at ring 1 — `pdp.ts:84-86` returns `audit-write-failed (fail-closed)`. **False at
ring 3** — `peps.ts:34` and `main/index.ts:229` swallow the failure and proceed, including on the
irreversible purge path. And per F-1 a *deleted* audit produces no failure at all.

**Proposed:** "every governance **decision** requires a successful audit write — if the log can't be
written, the decision is denied."

### C-5 · Head anchor catches truncation · `blog/the-1.0-candidate.html`

> "A persisted head anchor catches tail truncation that a hash chain alone can't see"

**Evidence:** F-1. True when the log is present and short; **false when the log is deleted outright**,
because `audit.ts:62` only reads the anchor if the log or segment index exists. Fix #1 in the
tracked list closes this; once shipped the sentence becomes true as written.

**Fix:** dated note now; remove the note when fix #1 lands.

### C-6 · Catastrophic shell + egress guard as universal floors · `starfish-vs-openclaw/index.html`, `index.html`

> "Filesystem boundary, secrets, catastrophic shell, and network exfiltration are **enforced
> independently of any policy or tolerance**."
> "Outbound calls to internal, loopback, or cloud-metadata hosts are denied by default; catastrophic
> shell is blocked outright."

**Evidence:** `isCatastrophicShell` and `isBlockedHost` are invoked **only** in
`governance-hooks/handler.ts` (`:85,:89,:115,:119`). The PDP contains neither. So a consumer using
`@starfish/sdk` (`createGovernance`/`governCall`) or `starfish serve` gets **no** catastrophic-shell
denylist and **no** egress host blocking. Filesystem boundary and secret floors *are* in the PDP and
genuinely are universal.

**Proposed:** name the surface — "on the Claude Code overlay, catastrophic shell and internal/loopback
destinations are blocked outright, independently of policy or tolerance. Filesystem boundary and
secret floors are enforced in the Policy Decision Point itself, on every surface."

*(This is also a code finding, not only a copy one: the two floors should move into the PDP. Logged as
F-11 below.)*

### C-7 · "No task, no tool" · `index.html` (headline)

**Evidence:** `taskBinding` is opt-in via `enforceTaskBinding` and **neither shipped caller passes it**
(`host.ts:14`, `sdk/src/index.ts:51`) — posture probe shows `taskBinding:false`. The mechanism works
(`pdp.ts:100-102`) and `tasks.ts` is fully wired; it is simply not switched on by default.

**Proposed:** either flip the default to on (preferable — it is a one-word change and the machinery is
tested), or mark the tile "available; enable with `enforceTaskBinding`".

### C-8 · Evidence Gate · `index.html` tile 06, `blog/model-agnostic-and-evidence.html`

> "a claim ('tests pass') is **blocked** unless the deed is on the record"

**Evidence:** implemented and tested (`claims.ts`, `agentloop.ts:111-119`), but the shipped SDK passes
`enforceClaims: false` (`sdk/src/index.ts:72`). Off by default.

**Proposed:** flip the default, or "available — enable the Evidence Gate and any claim not backed by a
recorded deed blocks completion."

### C-9 · Self-integrity · `index.html` tile 07 and hero

> "If the manifest doesn't verify, Starfish boots into safe mode and denies everything"

**Evidence:** entirely true **when configured** (`boot.ts:87-97`, `selfintegrity.ts`, and safe mode is
genuine at `pdp.ts:65`). But `selfIntegrity` is an opt-in option neither shipped caller passes.

**Proposed:** "Point Starfish at an operator-signed manifest and any tamper, rollback or audit
truncation boots it into safe mode, where everything is denied until you re-attest."

### C-10 · "an agent can never self-authorize" · `index.html`

**Evidence:** proposer≠approver always holds (`broker.ts:61`). But F-9 — `startSidecar` passes
`operators: undefined`, so on that path *another agent* can approve. Self-authorization is blocked;
agent-to-agent authorization is not, on one surface. Desktop IPC and `startMultiSidecar` are correct.

**Proposed:** keep the claim (it is accurate as written), and fix the code — tracked fix #7.

### C-11 · API key sealed in the OS keychain · `index.html`, `blog/model-agnostic-and-evidence.html`

**Evidence:** architecturally sound — the key never enters core, the audit or the request object
(`runner.ts:74` injects into a throwaway header clone; `dispatch.ts:6`). But storage falls back when
OS encryption is unavailable: `main/index.ts:332` sets `stored = 'keychain'` only if
`safeStorage.isEncryptionAvailable()`, else `'fallback'`.

**Proposed:** add "(where your OS provides encrypted storage; Starfish tells you which is in use)".
The isolation claim itself needs no change.

---

## ✅ SUPPORTED — verified, no change

Spot-checked against code, all hold as written:

- Deny-by-default / unregistered tools denied — `pdp.ts:106`.
- Fail-closed boot; missing or corrupt registry halts startup — `registry.ts:11-17`, `boot.ts`.
- Hash-chained append-only audit — `audit.ts:106-122,144-153`.
- Boundary containment, incl. case/Unicode normalization and symlink-component rejection — `boundary.ts:40-73`.
- Governed deletion: impact assessment first, soft delete to recoverable trash, hard rules not
  overridable by approval, no folders, no system trees — `deletion.ts:70-98,130-133`. The
  `blog/governed-deletion.html` claims are accurate line by line.
- Integrity checked **before, during and after** execution with drift → quarantine — `integrity.ts:57-66`.
  The `blog/burning-the-boat.html` claim is exactly right.
- Prompt injection as the highest tier, above critical, rejected — `pdp.ts:191`, `risk.ts:7`.
- Hard floors survive Risk Tolerance; Medium never lifts a floor, an injection reject or a critical —
  `pdp.ts:189-203`. `blog/risk-in-numbers.html` is accurate.
- Token Governor soft-warn / hard-pause — `tokens.ts`, `agentloop.ts:101-104`.
- Toby as sole registry door; quarantined capability cannot run — `vetting.ts`, `intake.ts`.
- Memory/external content is data, never instructions — `pdp.ts:112-117`, `taint.ts`.
- Per-root isolation and per-root operator sets on the multi-root sidecar — `serve.ts:187+`.
- "Governance contains blast radius — it is not a force field", "Not OS-level isolation", "keep
  genuinely hostile code in a container or VM" (`index.html`) — **the most important claims on the
  site, and they are honest.** They pre-empt exactly the Q12 finding.

---

## New code finding

| ID | Finding | Location | Severity |
|---|---|---|---|
| **F-11** | `isCatastrophicShell` and `isBlockedHost` are enforced only in the hooks handler, not in the PDP. SDK and sidecar consumers get no catastrophic-shell denylist and no egress host guard. Both are described site-wide as universal floors. | `handler.ts:85,89,115,119`; absent from `pdp.ts` | **High** |

Recommend moving both into `PDP.ingress` so every surface inherits them, leaving the handler checks as
a fast pre-filter. Add to the tracked fix list as #11.

---

## Blog policy

Devlog posts are dated and should stay as written — rewriting history is worse than a stale claim.
For C-3 and C-5, append an inline note in the existing post style:

> **Update, 2026-08-20:** an external review (`ADVERSARIAL-QA.md`) found this control is implemented
> but not invoked from a shipped path / does not hold when the log is deleted outright. Tracked fix
> [#N]. Noted here rather than edited away.

That is the same move as `mosaic-and-the-unwired-fix.html` — which is the best post on the site
precisely because it documents a fix that had been built and never wired. The pattern repeated; saying
so is more credible than quietly correcting it.

---

## Recommended order

1. **C-1 (Arena) and C-2 (non-deviation)** — `starfish-vs-hermes` is the only page asserting controls
   that do not run. Two of the five are in `FAQPage` JSON-LD, which Google surfaces as rich results,
   on a page naming a competitor. Highest exposure; fix first.
2. **C-6 / F-11** — fix the code (move the floors into the PDP) rather than the copy, then the
   sentence is true everywhere.
3. **C-7, C-8** — flip `enforceTaskBinding` and `enforceClaims` defaults to on. Both are tested; both
   make an existing site claim true rather than needing a caveat.
4. **C-4, C-9, C-11** — copy edits.
5. **C-3, C-5** — dated blog notes.
6. **C-10** — no copy change; code fix #7 already tracked.
