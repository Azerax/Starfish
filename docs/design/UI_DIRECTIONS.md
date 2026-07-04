# Starfish UI - Directions and Best Practices (2026)

You're not liking the current UI. This lays out what the research says, why the current "Fleet" crew
theme works against us for the product we're becoming, and FIVE distinct directions to pick from. Nothing
here touches the governance engine - it's the operator/host surface only.

## What the research says (governance / agent-ops / SOC UX)
- **Hierarchy by urgency, not data availability.** What surfaces first must be what needs action now
  (the pending approval), not whatever data is easiest to render.
- **Don't create rubber-stamps.** If approvals are buried or context-poor, reviewers approve blindly and
  the governance value collapses. Every approval must show a decision summary: who, what, where, why,
  risk tier, and a diff/preview.
- **Role-based views.** An operator triaging needs live detail; a CISO/owner needs a high-level summary.
  Tailor the view to the decision each role must make.
- **Risk-sorted queues + progressive trust.** Sort by risk; approve 100% of high-risk, sample low-risk;
  let confidence grow into "auto with notification" rather than a gate.
- **Trust through polish.** Security/governance UIs fail when they look untrustworthy; restraint,
  consistency, and accessibility read as credibility.
- **Async + calm.** Route non-blocking items to async channels; the UI should be quiet until it needs you.

## Why move off the current "Fleet" theme
- Novelty (Star-Trek crew, portraits, "GCS Starfish") competes with clarity; it reads as a toy, not a
  control plane - a credibility cost for a security product.
- It is not neutral: `@starfish/ui` embeds in OTHER products' dashboards, whose owners will not want a
  themed crew. The embeddable surface must be neutral + themeable by default.
- Density/aesthetic are dated. Recommendation: keep "Fleet" as an optional fun SKIN, make the default a
  calm, professional, token-driven system.

## Two surfaces, different jobs
1. **The Bridge (desktop operator cockpit):** rich, single-operator, can be opinionated.
2. **`@starfish/ui` (embeddable):** neutral, minimal, themeable via design tokens, drops into a host
   dashboard. Most future users meet Starfish here.

## Five directions (pick one, or mix per surface)

### D1 - Approval-Inbox (calm, action-first) [recommended default]
Hero = the pending-approval queue as an "inbox for governance," risk-sorted, each item a rich card
(actor, tool, target, reason, diff/preview, risk chip) with Approve/Deny and "why". Everything else
(audit, budgets, monitor) is one tab away. Aesthetic: Linear/Vercel calm - lots of whitespace, one accent,
quiet until something needs you.
Fits: the human-in-the-loop core; prevents rubber-stamping; great for both desktop and embedded.
Tradeoffs: less "at a glance" system state; power users may want more density.

### D2 - Command Center (dense observability)
Hero = a multi-panel live dashboard (agents, decision stream, budgets, monitor, alerts) like
Grafana/Datadog. A de-themed, professional version of today's Bridge.
Fits: an operator watching many agents; ops-heavy use.
Tradeoffs: risks "data availability over urgency"; heavier to build/maintain; poor as an embedded widget.

### D3 - Timeline / Audit-First (trust & provenance forward)
Hero = the hash-chained audit as a filterable chronological stream (git-log / activity-feed feel),
decisions and approvals inline, with a "verify chain" affordance. Compliance/trust is the selling point.
Fits: auditors, compliance, "prove what happened"; strong for the EU AI Act / SOC 2 story.
Tradeoffs: retrospective, not action-first; approvals feel secondary.

### D4 - Terminal / TUI (developer-native)
Hero = a keyboard-driven, monospace, dense console (think k9s/lazygit). Matches the CLI-run skill
audience and the "developer governance" identity.
Fits: the CLI-native design partners; power users; ships as a TUI alongside the web UI.
Tradeoffs: niche; not for non-technical operators or embedding.

### D5 - Split "Cockpit" (queue + context, IDE-style)
Hero = a two-pane layout: left = risk-sorted queue; right = the selected item's full context (diff,
boundary, audit trail, related decisions). IDE / email-client ergonomics.
Fits: operators who approve a lot and want context without losing the queue.
Tradeoffs: needs more screen; more design work than D1.

## Recommendation
- Default the embeddable `@starfish/ui` to **D1 (Approval-Inbox)** - neutral, token-themeable, action-first.
- Make the desktop Bridge **D5 (Split Cockpit)** for power operators, reusing D1's approval cards.
- Offer **D3 (Audit timeline)** as a first-class tab everywhere (the compliance story).
- Keep **D4 (TUI)** for the CLI audience as a stretch; keep "Fleet" as an optional skin, not the default.
- Adopt design tokens (color/space/type) so all of the above are one theme swap, and the host can restyle.

## Next
Prototype D1 + D5 as static HTML mockups against the real sidecar shapes (pending / audit / monitor),
get your reaction, then wire the winner into `@starfish/ui` (SSE-ready per ROADMAP v0.18).

---

# Ten more directions (D6-D15)

Five conventional-adjacent (D6-D10) and five from unrelated domains that map surprisingly well
(D11-D15). The through-line for the "unrelated" set: every one is a real-world system for a human
authorizing an autonomous/semi-autonomous actor, under risk, with a record - which IS governance.

## Conventional-adjacent

### D6 - Kanban board
Decisions as cards flowing across columns: Proposed -> Awaiting you -> Approved/Denied -> Executed. Drag a
card to approve. Why it works: makes the governance pipeline and where each action is stuck visible at a
glance; universally understood. Tradeoff: horizontal space; less calm than an inbox.

### D7 - Email triage (three-pane)
Folders (by risk / agent / project) + list + reading pane, Gmail-style; approve = archive, deny = trash,
"snooze" = defer. Why it works: everyone already does inbox triage; "inbox zero for approvals" is an
intuitive goal and supports bulk actions on low-risk. Tradeoff: can feel heavy for a few items.

### D8 - Conversational (chat thread)
The agent "asks permission" as a message in a thread; you reply Approve/Deny inline; reads like Slack/iMessage.
Why it works: matches how people already relate to agents; approval happens in the context of the ask, with
the reason right there. Tradeoff: hard to see aggregate state; scrolling for history.

### D9 - Notification control center
macOS/iOS-style stacked notification cards with inline actions, plus a "control center" of confidence-level
toggles per project/session. Why it works: nails "quiet until needed" + fast actions; the toggles expose the
writes=ask/auto model cleanly. Tradeoff: notification fatigue if over-used.

### D10 - Data grid / SIEM table
A dense, sortable, filterable table of decisions (columns: time, actor, tool, target, risk, verdict) with
saved filters and bulk-approve. Why it works: SOC analysts live in grids; risk-sort + filter + bulk is the
fastest path at volume. Tradeoff: intimidating for non-technical operators; low emotional warmth.

## Completely unrelated - yet they map exactly

### D11 - Air traffic control (radar + clearances)
Agents are blips on a scope; a pending action is an aircraft "requesting clearance"; you issue "cleared" or
"go around"; risk = proximity/altitude; anomalies = conflict alerts. Why it works: ATC is literally
real-time human authorization of autonomous actors under risk and time pressure - approve == grant
clearance. Distinctive dark scope with a sweep. Tradeoff: spatial metaphor needs care to stay legible, not
decorative.

### D12 - Hospital triage / patient monitor
Each agent is a "patient" with vitals: token budget = heart rate, risk tier = temperature, boundary health =
BP; pending actions are "orders awaiting the attending's sign-off"; anomalies raise a calm-but-firm alarm.
Why it works: clinical triage + physician sign-off is human-in-the-loop authorization, and "first, do no
harm" is deny-by-default in spirit. Calm, high-trust aesthetic. Tradeoff: medical framing may feel odd for
some hosts.

### D13 - Customs / border checkpoint
Every action is a "traveler" presenting a "passport" (its capability); you stamp APPROVED or DENIED;
secrets/contraband are flagged at inspection; there's a declaration form (the reason). Why it works: border
control IS deny-by-default admission with inspection and stamping - a near-1:1 map to the PDP + boundary +
secret screening. Playful but precise. Tradeoff: heavy iconography risks kitsch if overdone.

### D14 - Bank vault / dual-control (two-key)
The signature move: high-risk actions require TWO keys turned together - the agent proposes (key 1), the
operator approves (key 2), and the vault opens only with both. A ledger tape prints every action. Why it
works: this is proposer != approver made literal (real vaults/wire transfers use dual control), and the
printing ledger is the hash-chained audit. Strongest conceptual fit of the set. Tradeoff: the two-key
animation must not add friction to routine low-risk items.

### D15 - Courtroom docket
Pending actions are "cases on the docket"; you rule (grant/deny) with a one-line opinion; policies are
"precedent"; the audit is "the record"; deny-by-default is the presumption until authorized. Why it works:
a judge authorizing under a rulebook, on the record, is exactly the governance loop; lends gravitas and a
clear "why" for every decision. Tradeoff: formal tone; risk of feeling ponderous for quick approvals.

## Honorable mentions (same "unrelated but apt" vein)
- Mission control GO / NO-GO poll (each risky action = a per-station go/no-go before commit) - apt, but
  overlaps the existing Bridge/Fleet concept.
- Kitchen expediter at the pass (chef fires, expediter approves on a ticket rail) - fast QC metaphor.

## How to choose among 15
Pick by primary JOB, then dress it:
- Fewest-items, prevent rubber-stamping -> D1 / D8 / D14.
- High volume, power operators -> D10 / D7 / D5.
- Trust / compliance story -> D3 / D15 / D13.
- "Wow" demo that still works -> D11 / D14.
All 15 are one design-token theme over the same data (pending / audit / monitor); the metaphor is skin, the
IA underneath (risk-sorted queue + context + record + two-party approval) stays constant.
