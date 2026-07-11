# UI lineage — an honest record

Starfish's first interface was inspired by [munder-difflin](https://github.com/)'s **living-floor** concept: a pixel-art office where autonomous agents walk around, sit at desks, and visibly do work. We loved that agent activity was *legible at a glance* — you could look at the floor and see who was busy, who was idle, who was stuck.

We re-themed that idea as a **space / Star Trek "Fleet" bridge** — a crew (Captain, Intake, Monitor, Planner) at their stations, "every task is a mission," redshirts for failures. It was charming, distinctive, and it made the governance model feel alive.

**As Starfish grew, that approach stopped scaling — so we removed it as the default.** The reasons were honest and product-driven, not aesthetic snobbery:

- **Credibility.** Starfish became a governance and *security* product. A themed office/bridge reads as a toy to a CISO evaluating a control plane — a real cost when trust is the thing you're selling.
- **Density & operator focus.** As the number of agents, decisions, budgets, and audit events grew, "characters on a floor" couldn't surface *what needs your attention now*. The hero had to become the risk-sorted approval queue, not the scenery.
- **Embeddability & neutrality.** `@starfish/ui` embeds inside *other* products' dashboards; their owners don't want a themed crew. The default surface had to be neutral and token-themeable.

So in mid-2026 the default UI became the **calm D5 "Split Cockpit"** — a risk-sorted approval queue plus full decision context — with a professional, light/dark, token-driven design system. **The Fleet theme wasn't deleted; it was demoted to an optional, off-by-default skin**, and the living-floor idea may yet return as an optional **"Floor / overview" mode** for operators watching many agents at once.

**On provenance:** the inspiration was *conceptual only*. No munder-difflin code or assets were ever used — Starfish is an original, clean-room project (see `NOTICE`). munder-difflin is MIT-licensed; we're grateful for the idea that made agent work feel visible, and we simply outgrew that particular expression of it.

---

## Someday — inspirational, explicitly NOT roadmapped

A standing wish (not a commitment, not on any roadmap, no timeline): find a way to bring the **living floor** back and make it work *with* Starfish at scale — a spatial view where you can watch a whole crew of governed agents move and work, activity legible at a glance, without sacrificing the credibility, density, or embeddability that made us set it aside. If a design cracks that, it graduates from this note to the roadmap. Until then it lives here as a north star, not a plan.
