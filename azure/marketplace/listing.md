# Azure Marketplace listing draft — Starfish governance for Azure AI Foundry Agent Service

Status: first-draft copy, written for Partner Center's Container offer listing fields. Not submitted
anywhere. Everything in this file is copy Scott can paste, trim, or rewrite — nothing here is wired to an
actual Partner Center offer, and several fields are placeholders that need a real decision (marked
`[MANUAL]`) before submission. Written to be accurate to what the product actually does tonight (three
governance tiers, not "full governance of every Foundry tool") rather than optimized to sound bigger than
it is — see docs/design/azure.md Sec 2 for the tier breakdown this copy is grounded in.

---

## 1. Offer identity

**Offer name (candidate):** Starfish Governance for Azure AI Foundry

**Alternative candidates**, in case the first is taken or trademark-conflicts on search:
- Starfish Agent Governance
- Starfish for Foundry Agents

`[MANUAL]` — confirm no existing Marketplace offer or trademark collision before locking this in
(Partner Center will also reject on exact-name collision at publish time, but a search collision that
just looks confusingly similar won't be caught automatically).

**Offer type:** Azure Container Apps-based Container offer (see docs/design/azure.md Sec 4 for why —
Managed Application and VM offer types don't support metered/usage-based billing for the software's own
IP cost, only Container offers do).

## 2. Search results summary (Partner Center limit: 100 characters)

> Gate, log, and audit what your Azure AI Foundry agents are actually allowed to do — before they do it.

(96 characters)

## 3. Short description (Partner Center limit: 256 characters)

> Starfish adds a governance layer in front of your Foundry agents' tool calls: allow, ask-for-approval,
> or deny each one, with a tamper-evident audit trail. Full synchronous gating for custom functions;
> honest, scoped controls for MCP/OpenAPI and built-in tools.

(255 characters)

## 4. Long description (Partner Center limit: 3,000 characters; basic HTML allowed)

> **What Starfish does for your Foundry agents**
>
> Azure AI Foundry Agent Service gives your agents access to powerful tools — custom functions, MCP and
> OpenAPI-connected services, and Microsoft's own built-in tools like Code Interpreter and Web Search.
> Foundry executes those tools; by default, nothing stands between "the agent decided to call this tool"
> and "the tool ran."
>
> Starfish sits in that gap. It's a governance sidecar you deploy alongside your own agent-orchestration
> code, and it makes an explicit allow / ask-for-approval / deny decision on every tool call your policy
> covers — before that call executes. Every decision is written to a tamper-evident, hash-chained audit
> log, so you have a real record of what your agents did and why, not just what they were configured to
> be allowed to do.
>
> **We're upfront about what "governance" means for each kind of Foundry tool, because it's not the same
> guarantee everywhere:**
>
> - **Custom functions** (your own function-calling tools): full synchronous gating. Starfish sees every
>   proposed call before it runs, can hold it for human approval, and can deny it outright.
> - **MCP and OpenAPI-connected tools**: gated via a reverse-proxy in front of your tool backend. Allow
>   and deny are synchronous and enforced before the backend ever sees the call. Approval-required calls
>   are logged for review rather than held open — Foundry's own timeout behavior for these tool types
>   isn't documented, so we don't pretend to hold a connection open indefinitely.
> - **Microsoft's built-in tools** (Code Interpreter, File Search, Web Search, and others): these run
>   inside the Foundry service itself, with no interception point Microsoft exposes. Starfish governs
>   these at registration time — which tools an agent is allowed to have at all, and which combinations
>   are blocked by default (e.g. code execution plus live web content) — and ingests Foundry's own
>   telemetry after the fact for audit. This is real control and a real audit trail; it is not a runtime
>   gate, and we say so rather than implying otherwise.
>
> **Why this matters:** agent autonomy without a record of what happened is a liability, not a feature.
> Starfish doesn't ask you to trust your agents less — it gives you the evidence to trust them accurately,
> and a lever to stop something before it happens when your policy says a human should look first.
>
> **Getting started:** deploy the Starfish sidecar container alongside your existing Foundry
> orchestration app (Python or .NET adapters provided), point it at your governance policy, and start
> seeing decisions in the audit log immediately — most integrations take under a day.

(Length: written to fit comfortably under the 3,000-character cap once HTML tags are added; recount after
final HTML formatting.)

## 5. Search keywords (Partner Center limit: 3)

1. AI agent governance
2. Azure AI Foundry
3. AI audit trail

`[MANUAL]` — Partner Center keyword effectiveness drifts with what people actually search; worth
revisiting after the offer has been live a few weeks rather than treating this as final.

## 6. Categories

Primary: **AI + Machine Learning**
Secondary: **Security** (if Partner Center's taxonomy allows a second category for Container offers —
`[MANUAL]` confirm at listing-creation time, this wasn't verified against a live Partner Center session).

## 7. Plans and metering dimensions

Maps directly to `azure/metering/schema.ts`'s `METERING_DIMENSIONS`. Recommend launching with a single
plan on the `governed_decision` dimension — it's the most legible unit ("you're billed for governance
actually applied") and doesn't require deciding an hourly/monthly accounting policy before launch.

| Dimension ID | Display name | Unit | Suggested launch price | Notes |
|---|---|---|---|---|
| `governed_decision` | Governed decision | decision | `[MANUAL — pricing decision]` | Recommended v1 dimension |
| `governed_agent_hour` | Governed agent-hour | hour | `[MANUAL]` | Candidate for a v2 plan once decision-volume pricing data exists |
| `active_agent_month` | Active governed agent (monthly) | agent-month | `[MANUAL]` | Simplest to explain to a buyer, coarsest signal |

`[MANUAL]` — actual per-unit pricing is a business decision this document doesn't make. Once set, it also
needs to be internally consistent with the MACC framing in docs/design/azure.md Sec 5 (metered spend
through the Marketplace is what counts toward a customer's MACC once IP Co-sell eligible — see that
section for the $100K trailing-12-month threshold and why MACC isn't a v1 claim to make in this listing).

## 8. Support and legal — all `[MANUAL]`, none of these exist yet

- Support contact email/URL
- Engineering contact for Microsoft's certification process
- Privacy policy URL
- Terms of use / EULA (Marketplace has a Standard Contract option — worth using instead of drafting a
  custom EULA, unless there's a reason not to)
- Refund policy text

## 9. Assets Partner Center requires that don't exist yet — all `[MANUAL]`

- Offer logo (multiple sizes per Partner Center's spec)
- At least one, ideally 3-5, screenshots of the product actually running (the audit log view, a
  governance decision in progress, etc. — none of tonight's work produced a UI to screenshot; this needs
  real product surface, not a mockup)
- A demo video (optional but improves conversion, per Microsoft's own Marketplace guidance)

## 10. Co-sell readiness copy (Solutions page) — for the pre-launch prep that IS cheap

Per docs/design/azure.md Sec 5, Co-sell-*ready* status (distinct from the revenue-gated IP Co-sell
*eligible* status that unlocks MACC) mainly needs a Partner Center business profile and a couple of
short docs. Draft solution-page summary, reusable for that purpose:

> **Solution:** Starfish Governance for Azure AI Foundry
> **Category:** AI agent governance and audit
> **What it solves:** organizations deploying Azure AI Foundry agents need a way to constrain and audit
> agent tool use without building custom interception logic per tool type. Starfish provides that layer,
> with an explicit, honest boundary between tools it can synchronously gate and tools it can only
> allowlist-and-audit.
> **Target customer:** teams running Foundry agents with real-world side effects (file access, external
> API calls, code execution) who need evidence of what the agent did, not just what it was configured to
> be allowed to do.

---

## What this draft deliberately does NOT do

- Does not claim MACC eligibility or "buy with your Azure credits" anywhere — per docs/design/azure.md
  Sec 5, that's gated on $100K trailing-12-month revenue and isn't true at launch. Claiming it in listing
  copy before it's true would be exactly the kind of unbacked claim this whole project's governance
  philosophy (GOVERNANCE.md Sec 3 Principle 6) argues against, applied to our own marketing.
- Does not claim uniform "full governance" across every Foundry tool type — the long description's tier
  breakdown exists specifically so a buyer can't reasonably come away thinking Code Interpreter calls get
  the same synchronous gate as their own custom functions.
- Does not include pricing numbers — that's a business decision for Scott, not something to fabricate a
  plausible-sounding placeholder for.
