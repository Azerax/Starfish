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
