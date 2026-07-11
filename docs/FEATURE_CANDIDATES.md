# Feature candidates

The home for ideas we intend to build **eventually** but haven't committed to a release. This keeps good ideas from either (a) getting lost, or (b) masquerading as planned work. Three tiers:

- **Roadmap / master plan** (`MASTER_COMPLETION_PLAN.md`, `ROADMAP.md`) — *committed*, sequenced, with owners.
- **Hardening backlog** (`HARDENING_BACKLOG.md`) — *committed* security tasks.
- **Feature candidates** (this file) — *not committed*; each has a **promotion criterion** that graduates it to the roadmap.

A candidate is not a promise. It graduates when its criterion is met (a dependency ships, a decision is made, a design cracks a hard problem).

| # | Candidate | What it adds | Trigger / why it's a candidate | Promotes to roadmap when… | Source |
|---|---|---|---|---|---|
| C1 | **Re-Arena after N uses** | Usage-driven re-certification: an agent/skill returns to the Arena after N uses; trust decays with use, not only on deviation | Depends on the Arena + trust ledger being built (designed, not built) | the Arena + trust ledger ship | `design/RE_ARENA_ON_USE.md` |
| C2 | **"Floor" overview mode** | The living-floor / walking-agents spatial view (munder-difflin lineage) as an optional mode for watching many agents at once | North-star; set aside because it didn't scale to a credible control plane | a design cracks the scale + credibility problem | `design/UI_LINEAGE.md` |
| C3 | **Managed / hosted key tier** | A Starfish-run model proxy so users need no API key (removes the office-worker key wall) | Business-model decision; adds infra, billing, and a data-egress path that weakens "no egress by default" | you decide to run a paid/managed tier | `LAUNCH_READINESS_PLAN.md` §4.4, key-flow options |
| C4 | **Agent-authored skills, governed** | Let agents generate their own skills (Hermes-style), but every self-authored skill proves itself in the Arena before it can act | Powerful but only safe with the Arena gating self-authored capability | the Arena ships | `comparisons/STARFISH_VS_HERMES.md` |
| C5 | **Per-agent / per-task Risk Tolerance overrides** | Narrow-only tolerance overrides below the global ceiling (e.g. a stricter agent) | Global Low/Medium ships first; overrides are a refinement | RM-4 is in production and a need appears | `RISK_TOLERANCE_PLAN.md` §9 |
| C6 | **Numeric-IP decode in netguard** | Decode decimal/octal/hex IP encodings (e.g. `2130706433` = 127.0.0.1) so SSRF can't dodge the egress guard via encoding | Known residual SSRF vector; narrower than the shipped host normalization | prioritized against other hardening | `RISK_MODEL_ADVERSARIAL_ANALYSIS.md`, netguard notes |
| C7 | **Canary + external anchor infrastructure** | A tripwire service for the Deception Cell's canary tokens + optional external anchoring of the audit root for auditors | Designed; needs a small always-on service | an institution/auditor needs it, or the Deception Cell ships | `Governed Execution — Deception Cell…`, `anchor.ts` |
| C8 | **CDR fidelity per format (File Arena)** | Choose full reconstruction vs lighter sanitization per document type (e.g. keep live xlsx formulas vs flatten) | A fidelity-vs-safety tradeoff to tune once real files flow | the File Arena ships and users hit the tradeoff | `Governed Execution — The Arena…` §9A |
| C9 | **Auto-revert timer for Medium tolerance** | Medium risk tolerance auto-reverts to Low after N hours (not just on restart) | A nice-to-have on top of the shipped restart-revert | RM-4 is in production and demand appears | `RISK_TOLERANCE_PLAN.md` §7 |

## How to use this list
- Add a candidate here the moment an idea is "yes, someday" rather than "yes, now."
- When a candidate's promotion criterion is met, move it into `MASTER_COMPLETION_PLAN.md` (or `HARDENING_BACKLOG.md` if it's security) with an owner and a phase, and delete its row here.
- Keep this honest: if a candidate has sat with an unmet criterion for a long time and nobody misses it, cut it.
