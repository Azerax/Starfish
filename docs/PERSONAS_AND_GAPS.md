# Two users, and what blocks them today

> **Date:** 2026-07-10 · Purpose: ground the 10 launch skills (and the surrounding UX) in two concrete people, and name the gaps that stop each from *exploring* or *being productive*. Written before building the skills so the skills fix the right things.

---

## User 1 — Priya, platform / security engineer (exploring "what can this do?")

Evaluating Starfish after the OpenClaw breaches; wants to prove the governance is real. Comfortable with npm/CLI, has her own API keys, will try to break it. Her win = *"I ran an agent, watched it get denied when it tried something dangerous, and read the audit."*

**Her path:** install → launch → connect a model → run something → probe governance → inspect audit → verdict.

**Gaps that stop her exploring:**
1. **Empty harness.** After onboarding there are 0 user skills — nothing to *run*. She has to author a skill or `govern` an external pack just to see the product do anything. First impression = "now what?" ← the 10 skills fix this.
2. **No "watch it get denied" moment.** The wow vs OpenClaw is seeing an exfiltration / `rm -rf` *blocked live with an audit entry*. The `zero-change-demo` exists but is a separate CLI artifact, not a one-click in-app "try an attack" path.
3. **No seeded sample task.** Nothing to press "run" on; she must construct a scenario herself.
4. **CLI/TUI story is thin.** A technical evaluator wants a scriptable/terminal path and readable audit (`starfish audit`, JSON out), not only the GUI.
5. **Discoverability.** No in-app answer to "what skills/tools exist, what can each agent touch, what's the boundary?" without digging.
6. **Model/key setup friction** is tolerable for her but every extra step before first value loses evaluators.

## User 2 — Marcus, operations coordinator (trying to be productive)

Non-technical, Windows, no API key and doesn't know what one is. Heard AI can "help with the busywork." His win = *"it cleaned up my spreadsheet and drafted the email, and I found the file."* He thinks in tasks, not in "governed skill packs."

**His path:** install → launch → ??? → do real work on his files.

**Gaps that stop him being productive:**
1. **The API-key wall.** Bring-your-own-key is a hard stop — he has no key and won't create one. Needs a managed/platform option or a dead-simple guided key flow, or he never reaches value. ← biggest non-skill blocker.
2. **Empty product.** No "help me with this document/spreadsheet" — nothing maps to his actual job. ← the 10 skills fix this.
3. **No natural way to ask.** He'd type "clean up this spreadsheet," but the entry points are `PADD` / `COMM` / "Bridge" — alien vocabulary and a technical model. Needs a plain chat-first "What do you need?" surface.
4. **Approval confusion.** Deny-by-default + "approve this?" prompts read as errors to a novice. Routine, safe office tasks (format a doc, read a file *he* picked) must not nag — needs sensible Risk-Tolerance defaults + friendly, plain-language approval copy.
5. **Pointing at his files.** He needs to aim it at "that spreadsheet in Downloads" in two clicks; boundary/working-folder setup must be trivial and forgiving.
6. **Where's my stuff?** The finished document has to land somewhere obvious, with a "show me the file" affordance.
7. **Trust in plain words.** "Is it safe to give it my files?" needs a one-sentence, non-jargon answer up front.

---

## The gaps, consolidated

| Gap | Blocks | Fixed by |
|---|---|---|
| **No packaged skills (empty product)** | both | **the 10 skills (this build)** |
| Model access / API-key wall for non-technical | Marcus | a managed-key or one-tap key flow (launch blocker; not a skill) |
| No chat-first "what do you need?" entry | Marcus (+Priya) | elevate COMM to a plain chat surface |
| No in-app "watch it get denied" demo | Priya | a seeded "try an attack" sample + the Bridge showing the deny |
| No seeded first task / guided first run | both | onboarding → 1 successful governed task in <5 min |
| Approval nags on routine safe work | Marcus | Risk-Tolerance defaults + friendly approval copy (RM-4/RM-5) |
| Output delivery ("where's my file?") | Marcus | skills write to an obvious folder + "reveal file" action |
| Alien vocabulary (PADD/COMM/beam) | Marcus | neutral labels by default (Fleet off — done); rename PADD/COMM |
| Discoverability of skills/tools/boundary | Priya | a Skill Library + agent-capability view |

**What this means for the 10 skills:** every skill must (a) be reachable from a plain "what do you need?" ask, not jargon; (b) run governed but *quiet* on routine safe steps; (c) write outputs to an obvious place with provenance; (d) for Priya, expose what tools/boundary it uses so governance is legible. The skills below are designed to those constraints; the non-skill blockers (key flow, chat entry, friendly approvals) are tracked in `LAUNCH_READINESS_PLAN.md`.
