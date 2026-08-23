# Starfish on Azure — governing Azure AI Foundry agents via Azure Marketplace

> **Status: proposal; still nothing here is committed to `ROADMAP.md`, but Phase 0's core mechanics are no
> longer theoretical.** Built across a planning session on request, grounded in current (Aug 2026)
> Microsoft documentation — cited inline throughout, not assumed. Written in the same spirit as
> `docs/design/THREAT_IMMUNITY_FABRIC_PLAN.md` and `docs/design/M3_DISPATCH_VERIFICATION_PLAN.md`: state
> what's actually true about the target platform and the target marketplace before proposing what to
> build, and separate what's decided from what's still open.
>
> **Update (2026-08-03):** the sidecar has been containerized and deployed as a real, running Azure
> Container Apps service — in a throwaway test resource group (`starfish-test`), not production, and
> driven partly by unlocking more Founders Hub/Azure for Startups credit tiers through real usage — using
> Azure Key Vault for the bearer-token secret and Azure Files for the governed root, confirmed live via
> the container's own log line `sidecar listening on http://127.0.0.1:8787 (root=/data/governed-root)`.
> That proves out the "container in a real Container Apps environment" and "Key Vault secrets" pieces of
> Phase 0's exit signal (§8). It does **not** yet prove Log Analytics audit export or multi-root
> (multi-tenant) isolation — both still open, both still part of Phase 0. Full account, including every
> bug found getting there, is in `docs/design/AZURE_IMPLEMENTATION_PLAN.md` item 6; the deploy script
> (`Deploy-StarfishTestEnv.ps1`, repo root) reproduces it end to end.

## Contents

0. [Executive summary](#0-executive-summary)
1. [The one finding that shapes everything below](#1-the-one-finding-that-shapes-everything-below)
2. [What "full governance" can honestly cover on Foundry — three tiers](#2-what-full-governance-can-honestly-cover-on-foundry--three-tiers-not-one)
3. [Target architecture](#3-target-architecture)
4. [Marketplace offer type — the actual mechanics](#4-marketplace-offer-type--the-actual-mechanics)
5. [Billing — decided: metered, pursuing MACC eligibility](#5-billing--decided-metered-pursuing-macc-eligibility)
6. [What actually has to be built](#6-what-actually-has-to-be-built-not-just-repackaged)
7. [Test apps — proving it governs, not just that it deploys](#7-test-apps--proving-starfish-actually-governs-on-azure-not-just-that-it-deploys)
8. [Phased roadmap](#8-phased-roadmap)
9. [Risks and honest limits](#9-risks-and-honest-limits)
10. [Recommended first step](#10-recommended-first-step--verify-before-building)
11. [Open decisions](#11-open-decisions-yours-to-make-not-assumed-here)
12. [Sources](#12-sources)

---

## 0. Executive summary

**Framing:** this is a second governed target, not a redirection of the product. Starfish already governs
one target — Claude Code, via the overlay + hooks. This adds **Azure AI Foundry Agent Service** as a
second, using the same sidecar the Claude Code integration already proved out. `README.md` already claims
Starfish is "model-agnostic (Claude, OpenAI, Gemini, OpenRouter, local)" — extending that to a second
*platform*, not just a second model, is the same idea one layer up. Whatever comes after Azure (OpenAI's
own agent platforms, others) should slot into this same pattern rather than each needing its own rationale
from scratch — worth keeping that generality in mind as this gets built, so the Foundry-specific pieces
(§4 the adapter SDK) stay cleanly separated from what's actually reusable (the sidecar, the PDP, the audit
model).

Scott wants Starfish deployable on Azure, listed on Azure Marketplace, governing customers' Foundry agents.
The headline finding: this is a smaller lift than a from-scratch product, because Foundry's
custom-function-calling tools already execute in the *customer's own application code* — the exact seam
Starfish already governs for Claude Code. The existing sidecar (`@starfish/sdk`, HTTP, multi-tenant,
shipped v0.18–0.19) is architecturally the right starting shape.

What's decided so far, in this session:

- **Governance scope:** full deny-by-default enforcement, honestly scoped to what's technically possible
  per tool type (three tiers — §2).
- **Distribution:** Azure Marketplace, not a private/custom-contract channel.
- **Target agent surface:** Azure AI Foundry Agent Service, custom function-calling tools first.
- **Offer type:** Container offer, deployed into the customer's own AKS/Container Apps environment — never
  Scott-hosted infrastructure, consistent with what Starfish already claims about itself.
- **Billing:** metered/usage-based, pursuing Azure Consumption Commitment (MACC) eligibility as a
  post-launch milestone, not a v1 feature.

What's still open, deliberately: the metering unit, Tier-2 gateway timing, adapter-SDK language, and
whether a multi-tenant SaaS variant is ever worth building later (§11).

---

## 1. The one finding that shapes everything below

**Foundry Agent Service does not execute your custom tools — your application does.** When an agent
decides to call a function, the service returns a `function_call` item to the caller; *the calling
application* runs the function and submits `function_call_output` back
([Learn: function-calling](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/function-calling)).
There is no Microsoft-provided interception, approval, or policy hook in that loop — human-in-the-loop
approval in the newer Agent Framework is also explicitly an **application-layer** pattern
(`FunctionApprovalRequestContent` / `CreateResponse`), not a service feature
([Learn: tool-approval](https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval)).

That's good news and a real constraint at once:

- **Good news:** this is *exactly* the seam Starfish already governs for Claude Code — "your app executes
  the call, we sit in front of that execution." No new integration paradigm, no waiting on Microsoft to
  ship a governance API.
- **Real constraint:** this only covers tools whose *execution* happens in code Starfish can sit in front
  of. Not every Foundry tool works that way — see §2.

## 2. What "full governance" can honestly cover on Foundry — three tiers, not one

Per [Learn: tool-catalog](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/tool-catalog),
Foundry's tools split by *where they execute*:

| Tier | Tools | Who executes it | Starfish's reach |
|---|---|---|---|
| **1 — full synchronous gate** | Custom **function calling** | The customer's own application code | **Full deny-by-default**, same model as Claude Code today: the PDP sees the proposed call *before* it runs, can allow/ask/deny, audits the outcome. |
| **2 — gateway-fronted gate** | **MCP** tools, **OpenAPI** tools | An external server/endpoint the *service* calls directly (not the customer's app loop) | **Full gate, different wiring.** If the customer points the MCP/OpenAPI tool config at a Starfish-fronted reverse-proxy URL instead of the raw endpoint, Starfish mediates every call the same way the sidecar already mediates HTTP today. Requires the customer to own that backend (most enterprise integrations do). Not built yet — same code path as the sidecar, new deployment shape. |
| **3 — registration-time + audit only** | **Code Interpreter, File Search, Web Search, Azure AI Search, native Azure Functions, Computer Use, Browser Automation** | Inside the Foundry-managed service itself | **No synchronous interception is possible** — the service never asks anyone before running these. Governance here is necessarily coarser: (a) *allowlist which built-in tools an agent may register at all* (still a real, valuable control — e.g. "this agent may never combine Code Interpreter with Web Search"), and (b) *best-effort post-hoc audit* by ingesting Foundry's own run/thread telemetry via Azure Monitor / Application Insights into the existing hash-chained audit log. This is **monitoring, not gating** — label it that way. |

**Recommendation:** ship Tier 1 first — it's the strongest claim ("full governance," true, no caveats) and
maps directly onto code that already exists. Tier 2 is a natural fast-follow. Tier 3 must be marketed
explicitly as monitoring/allowlisting, never folded into a "we govern every Foundry tool" claim — that
would be false, and exactly the kind of overclaim `docs/THREAT_MODEL.md` was written to prevent for the
desktop product.

## 3. Target architecture

```
Customer's Azure subscription
┌─────────────────────────────────────────────────────────────────┐
│  Their app (orchestrates Foundry Agent Service, Python/.NET/TS)  │
│    │                                                             │
│    │  function_call received from Foundry                       │
│    ▼                                                             │
│  Starfish Foundry Adapter (new, thin SDK — swap-in for the       │
│  raw "execute the function" step)                                │
│    │  POST /v1/decide  (existing wire protocol)                  │
│    ▼                                                             │
│  Starfish sidecar container (existing governance-core, packaged  │
│  as a container image — this is the Marketplace artifact)        │
│    - PDP: same deny-by-default decision engine as the desktop app│
│    - Secrets: Azure Key Vault (replaces desktop OS-keychain path)│
│    - Audit: hash-chained log, exported to Log Analytics          │
│    - Multi-root: one root per Foundry project/agent (existing    │
│      v0.19 multi-tenant sidecar model, reused as-is)             │
│    ▼                                                             │
│  allow → adapter executes the function, submits output to Foundry│
│  ask   → pauses; approval surfaces exactly where FunctionApproval│
│           RequestContent already renders in the customer's UI    │
│  deny  → adapter returns a function_call_output explaining the   │
│           refusal; audited either way                            │
└─────────────────────────────────────────────────────────────────┘
```

Everything stays inside the **customer's own tenant** — no agent activity, tool arguments, or secrets
cross to infrastructure Scott operates. This isn't just simpler to build; it's the only version consistent
with what Starfish already claims about itself ("local-first, no data egress by default,"
`README.md`/`SECURITY.md`). A multi-tenant SaaS where other companies' agent traffic flows through infra
Scott runs would be a *different, harder* product — SOC 2 becomes mandatory rather than aspirational,
different liability, a different trust story to sell against Microsoft's own "trust the platform" pitch.
Nothing here rules that out later (§11), but it is not the v1 recommendation.

## 4. Marketplace offer type — the actual mechanics

Three offer types genuinely run in the *customer's* tenant (vs. a SaaS offer, which means *Scott* hosts
it):

| Offer type | Deploys to | Billing | Fit |
|---|---|---|---|
| **VM offer** | Customer's subscription | Usage-based only, **no metered billing** | Wrong shape — Starfish isn't a VM workload. |
| **Managed Application** | Customer's subscription (ARM/Bicep); publisher's identity can retain management access | Monthly flat rate or metered, **but pricing may only cover a management fee — IP/software cost must transact through a separate paid VM/container offer** ([Learn: plan-azure-application-offer](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/plan-azure-application-offer)) | Viable, but the billing constraint means the *software itself* can't be charged for through this offer alone. |
| **Container offer (AKS / Container Apps)** | Customer's own AKS cluster / Container Apps environment | **Usage-based only** — and it transacts the software cost directly | **Best fit.** The governance sidecar is already a Node/TS HTTP service — this is "containerize what exists, publish the image." |

Checking Microsoft's own pricing-model matrix
([Learn: plans-pricing](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/plans-pricing)):
**a Container offer is usage-based/metered only — there is no flat-rate plan for that offer type.** Flat
rate exists only on a Managed Application, capped at a management fee. Since usage-based billing is the
decided direction anyway (§5), this resolves cleanly: **Container offer**, no ambiguity left.

**Recommendation:** publish as a **Container offer** first — the sidecar image, deployable straight into
the customer's AKS or Azure Container Apps environment, billed usage-based via the Marketplace Metering
Service. Revisit a Managed Application *wrapper* later only if enterprise buyers want a one-click
"provision the whole environment" experience (Container Apps env + Key Vault + Log Analytics + the image)
— that would be an ARM/Bicep template around the same container, not a different product.

Listing mechanics to plan for regardless of offer type: a mandatory privacy policy, support + engineering
contacts, description/screenshots, and — because metered billing is involved — a Microsoft Entra app
registration (tenant ID, client ID, auth key) used to call the Marketplace Metering Service API. Apache-2.0
already permits commercial redistribution; `COMMERCIAL.md`/`TRADEMARK.md` already exist for the terms side.

## 5. Billing — decided: metered, pursuing MACC eligibility

**Decision:** metered/usage-based billing, with Azure Consumption Commitment (MACC) eligibility as the
target. This is a natural fit — a Container offer only supports usage-based pricing anyway (§4), so this
decision doubles as the offer-type decision.

**Still open:** the metering *unit* — per-agent/month, per-decision-volume, or per-governed-hour.
Metered-by-decision matches how the audit log already counts things, but needs a metering-events design
before the Marketplace Metering Service API integration is built.

### The MACC/credits mechanism, and why it matters

A purchase made through the **Azure portal** Marketplace (not a credit-card checkout, not an
off-Marketplace private contract) is, once the offer is MACC-enrolled, eligible to count against the
customer's Microsoft Azure Consumption Commitment at **100% of the pretax amount**
([Learn: azure-consumption-commitment-benefit](https://learn.microsoft.com/en-us/marketplace/azure-consumption-commitment-benefit)).
In plain terms: an enterprise that's already committed to (or prepaid) a chunk of Azure spend can pay for
Starfish out of that committed spend instead of it being new, separately-approved vendor budget — a real
procurement accelerant for exactly the security-conscious enterprise buyer this product is aimed at.

### The honest timeline — MACC is not a launch-day feature

MACC enrollment isn't something configured at launch. It's granted automatically (within about a week)
once an offer reaches **Azure IP Co-sell eligible** status
([Learn: co-sell-requirements](https://learn.microsoft.com/en-us/partner-center/referrals/co-sell-requirements)),
and that status requires, among other prerequisites, **USD $100,000 of Azure Consumed Revenue or
Marketplace Billed Sales over the trailing 12 months** — Azure credits/ACO do not count toward that figure.

| Stage | What's required | When |
|---|---|---|
| **Launch** | Ship as a normal transactable, usage-based Container offer. No revenue threshold required to *launch* transactably. | v1 |
| **Co-sell-ready** (cheap, do early) | Active Partner Center ID + Marketplace account, complete business profile, a sales contact per geography, Solutions-page docs (one-pager, pitch deck). | Before or at launch — low cost, no blocker |
| **IP Co-sell eligible → MACC-enrolled** | $100K trailing-12-month Azure Consumed Revenue or Marketplace Billed Sales, technical validation (Azure-native, passes certification), reference architecture diagram. | **Growth milestone**, not v1 — happens once there are paying customers |

Be upfront with early customers that MACC/credit-drawdown is the destination, not available on day one —
matches the project's standing rule against unbacked claims (`GOVERNANCE.md` §3).

## 6. What actually has to be built (not just repackaged)

Ordered by dependency, honest about what's new vs. reused:

1. **Containerize the sidecar** *(mechanical, reuses `@starfish/sdk`)* — Dockerfile around
   `startSidecar`/`startMultiSidecar`; swap the desktop app's OS-keychain key storage for Azure Key Vault
   (new, small); swap/augment local audit-file persistence with a Log Analytics export path (new).
2. **The Foundry Adapter SDK** *(new — doesn't exist today)* — a thin Python/.NET/TS package that wraps
   the "receive `function_call` → execute → submit `function_call_output`" loop most Foundry integrations
   already write, and calls the sidecar's existing `/v1/decide`-shaped endpoint in the middle. This is the
   actual product surface a customer integrates against — the equivalent of the Claude Code hooks shim,
   for Foundry. **This is the single largest net-new engineering item.**
3. **Tier-3 allowlist + audit ingestion** *(new, smaller)* — a config surface for "which built-in tools may
   this agent register," and a Log Analytics/Application Insights reader that folds Foundry's own run
   telemetry into the existing hash-chained audit format. Explicitly scoped as monitoring, per §2.
4. **Multi-tenant validation** *(mostly reuse)* — confirm the existing v0.19 multi-root sidecar's per-root
   isolation (token→root routing, per-root audit/broker) actually holds up as "one root per customer's
   Foundry project," since that's the multi-tenant boundary a Marketplace buyer will ask about directly.
5. **Marketplace packaging** *(new, process-heavy not code-heavy)* — container image publish, Metering
   Service API integration, offer listing content, Microsoft's certification/technical review pass.
6. **Test-app suite for Azure/Foundry** *(new — see §7)* — Starfish doesn't currently have anything that
   tries to break the Azure deployment; the desktop product's `examples/zero-change-demo` is the closest
   existing pattern (adapt, don't rebuild from scratch), but it targets Claude Code, not Foundry.

## 7. Test apps — proving Starfish actually governs on Azure, not just that it deploys

Deploying cleanly and *actually gating a real agent under adversarial pressure* are different claims, and
this project doesn't let the first one stand in for the second — `docs/EVIDENCE_BACKLOG.md`'s E1 entry
exists precisely because a governed-refusal story was told about the desktop product before it was
re-verified against real code, and it turned out to be partly aspirational. The Azure port needs its own
evidence, not an inherited assumption from the desktop line. A small, deliberately adversarial suite of
Foundry test agents is what generates that evidence — and it does triple duty: it's the cheap validation
step in §10, it becomes a standing regression suite once the adapter SDK exists, and Microsoft's own IP
Co-sell process (§5) asks for a reference architecture — a working demo answers that too.

Minimum useful set, roughly in build order:

1. **Benign / happy-path agent (Tier 1).** One Foundry agent, one custom function tool that does something
   real (not the docs' toy "get horoscope" example — closer to "read a file in a scoped workspace" or "call
   an internal API"), gated by the sidecar. Proves the integration works with zero false positives before
   anything adversarial is layered on. This *is* the §10 first-step check, formalized into a reusable app
   instead of a throwaway script.
2. **Deny-path agent — boundary/secret/destructive attempts.** Same agent, prompted (or scripted directly,
   bypassing the model to remove ambiguity about *why* it triggered) to: write outside its declared
   boundary, read a secret-path file, or issue an irreversible/destructive action. Expect: denied, audited,
   nothing executes. This is E1's re-test plan, ported to Foundry's request/response shape instead of
   Claude Code's hook shape.
3. **Self-approval attempt.** An agent (or a scripted call) that tries to have the same principal both
   propose and approve a gated action. Expect: rejected by the proposer≠approver check — the Starfish
   invariant easiest to accidentally violate in a new adapter's plumbing (e.g. if the adapter defaults the
   "approver" identity to whatever principal is easiest to read off the request), so it deserves its own
   explicit test rather than folding into #2.
4. **Ask-path agent.** A medium-risk action that should pause rather than auto-allow or auto-deny, to
   confirm the pause surfaces correctly through Foundry's `FunctionApprovalRequestContent` pattern (§1) and
   that approving it from that UI actually resumes the run rather than stalling — the exact class of gap
   the M3 plan found and fixed on the desktop side (a broker that persists but nothing ever unblocks it).
5. **Tier-3 registration probe** *(later, once §6 item 3 exists)*. An agent that registers a disallowed
   built-in-tool combination (e.g. Code Interpreter + Web Search together, per §2's example) to confirm the
   allowlist actually blocks registration, not just logs it after the fact.
6. **Tier-2 gateway probe** *(later, once the MCP/OpenAPI reverse proxy exists)*. An agent whose MCP or
   OpenAPI tool is routed through the Starfish-fronted URL instead of the raw endpoint, with the same
   deny/allow/ask cases as #1–#4 replayed against it, to confirm the gateway wiring enforces identically to
   the in-process adapter rather than being a second, weaker code path — exactly the "second privileged
   path" failure class `docs/RELEASE_NOTES_v0.25.0.md`'s adversarial self-audit found and closed elsewhere
   in the codebase.

None of #1–#4 require the adapter SDK to exist first — they can run against the raw sidecar with a thin
throwaway harness, which is the point: cheap evidence before expensive engineering.

## 8. Phased roadmap

A sequencing view over everything above. **Reordered on Scott's instruction: construction phases first,
testing consolidated into one phase near the end, rather than a test gate after every build step.** The
tradeoff that framing accepts, stated plainly: building several phases deep before the first real
verification means a foundational mistake (e.g. in the adapter's protocol handling) could get repeated
across Tier-3, Tier-2, and the Marketplace packaging before anything catches it. That's a real cost, not
a free reordering — worth knowing about even though it's the ordering that was asked for.

| Phase | Contents | Depends on | Exit signal |
|---|---|---|---|
| **Phase 0 — Containerize + Azure-native plumbing** | §6 items 1 and 4: Dockerfile, Key Vault secrets, Log Analytics audit export, multi-root isolation. **Partially done** (2026-08-03): Dockerfile + real Container Apps deployment + Key Vault secrets confirmed live in a throwaway test env (`starfish-test`) — see `AZURE_IMPLEMENTATION_PLAN.md` item 6. Log Analytics audit export and multi-root isolation testing not started. | Nothing — can start immediately with the existing sidecar. | Sidecar runs as a container in a real AKS/Container Apps environment ✅; multi-root isolation (two fake "customers," no cross-talk) built — still open. |
| **Phase 1 — Adapter SDKs** | §6 item 2: the Python (and/or .NET) adapter — the actual customer-facing integration surface. | Phase 0's container running (or at least the sidecar's HTTP surface available). | A customer-shaped integration exists for allow/ask/deny, not just scaffolding. |
| **Phase 2 — Tier-3 + Tier-2 extensions** | The built-in-tool allowlist + audit ingestion (§2 Tier 3), and the MCP/OpenAPI gateway (§2 Tier 2). | Phase 1's adapter pattern established (Tier-2 reuses its wire-protocol client shape). | Governance coverage extends past pure function-calling agents without weakening the Tier-1 claim. |
| **Phase 3 — Comprehensive testing** | All of test apps #1–#6 (§7), run against everything built in Phases 0–2 together — protocol-level first, then against a real Foundry agent once credentials exist. | Phases 0–2 built. | A deny actually blocks a call and gets audited; a self-approval attempt is rejected; the ask path resumes; Tier-3 registration and Tier-2 gateway probes pass. Real evidence, not design confidence, gathered once rather than piecemeal. |
| **Phase 4 — Marketplace packaging + listing** | §6 item 5: container publish, Metering Service API integration, offer listing content, certification/technical review, co-sell-ready prerequisites (§5). | Phase 3 passing — nothing ships to Marketplace on unverified assumptions. | Offer live and transactable on Azure Marketplace; first real customer can install and pay. |
| **Phase 5 — MACC growth milestone** | Nothing new to build — this is a revenue outcome, not an engineering phase. Track trailing-12-month Azure Consumed Revenue toward $100K (§5). | $100K trailing revenue through the offer. | IP Co-sell eligible status granted; MACC enrollment follows automatically within about a week. |

## 9. Risks and honest limits

Named plainly rather than discovered late, matching how `docs/THREAT_MODEL.md` and `SECURITY.md` handle
the desktop product's own limits:

- **Tier 3 is not a gate, and marketing it as one would be a real overclaim.** Built-in Foundry tools
  (Code Interpreter, File Search, Web Search, etc.) execute inside Microsoft's own service; no amount of
  Starfish engineering changes that. The honest claim is allowlisting-at-registration plus audit, never
  "governs every Foundry tool."
- **The adapter SDK is the actual product surface, and it's unbuilt.** Everything else (sidecar,
  multi-root, audit) is repackaging of existing `governance-core`. The SDK is genuinely new code in a
  language (Python/.NET) `governance-core` doesn't currently ship in — budget for this honestly rather
  than treating it as "just wiring."
- **Foundry's 10-minute run-expiry window** constrains how slow the sidecar's decision latency can be —
  a synchronous ask that waits on a human for longer than that window will blow past Foundry's own
  timeout, independent of anything Starfish does. **Confirmed against Microsoft's current docs, not just
  cited from memory** ([Learn: function-calling](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/function-calling),
  checked 2026-08-03): the 10-minute budget is *total elapsed time since the run was CREATED*, not
  per-function-call ("applies to total elapsed time, not individual function execution") — so a fixed
  per-call wait ceiling alone can't know how much of that budget is already spent by the time a mid-run
  tool call needs approval. The adapter SDK (§6 item 2) needs to accept the run's own creation timestamp
  and budget its wait against the REMAINING time, not just a fixed ceiling under 10 minutes — implemented
  as an optional `run_created_at`/`runCreatedAtUtc` parameter once the adapter SDKs existed (see the
  implementation plan's §6s for the full account, including why it's optional rather than required: not
  every caller may have easy access to the run's `created_at` at the point it's constructing the executor).
- **Multi-tenant isolation claims need re-verification in this new context**, not inherited from the
  existing v0.19 conformance tests, which were written against a different threat model (multiple roots on
  one operator's machine, not multiple paying enterprise customers on shared-by-image-but-separate
  deployments). Phase 1's exit signal above exists specifically to catch this.
- **MACC eligibility is a revenue-gated milestone, not a technical one** — no amount of engineering
  accelerates it. Don't let it anchor the Phase 3 launch plan; it belongs entirely in Phase 5.
- **Compliance posture rises with the stakes.** Governing a customer's production Azure AI agents is a
  materially bigger trust claim than a solo desktop tool governing one operator's own Claude Code sessions.
  The existing "Toward 1.0" items in `ROADMAP.md` (governance-core process isolation, OpenSSF Scorecard
  remediation, external security review) stop being optional hardening and start being what an enterprise
  security team will actually ask for during procurement — worth resequencing those against this plan
  rather than treating them as unrelated backlog.

## 10. Recommended first step — superseded by the §8 reorder, kept for the record

This section originally recommended verifying Tier 1 against a real Foundry agent *before* any of §6
became a build task. Scott explicitly asked for the opposite ordering (build first, test once at the
end — §8's revised phase table and its stated tradeoff). This section is kept rather than deleted so
that tradeoff has a name and a paper trail — deleting the dissenting option after being overruled would
quietly erase the record of why the change matters, and this project doesn't do that to itself in any
other doc. The original reasoning, for whenever the tradeoff gets revisited: test app #1 from §7, plus
the deny-path and self-approval cases (#2–#3), run against the *existing, already-shipped* sidecar's
decide endpoint (no new code beyond a `startSidecar()` call and a fetch), would have surfaced a real gap
latency inside Foundry's 10-minute run-expiry window, whatever), that's cheap to find here and expensive to
find after building the SDK, the full test-app suite, and the Marketplace listing around it. This is
Phase 0 in §8.

## 11. Open decisions (yours to make, not assumed here)

- **Metering unit** — per-agent/month, per-decision-volume, or per-governed-hour. Metered-by-decision
  matches how the audit log already counts things, but needs a metering-events design before the Metering
  Service API integration is built (§5, §6 item 5).
- **Tier-2 (MCP/OpenAPI gateway) timing** — fast-follow immediately after Phase 3, or wait for a customer
  who actually needs it? It reuses the sidecar's existing HTTP-mediation code path in a new (reverse-proxy)
  shape, so the marginal cost is lower than it looks, but it's still new deployment surface, not just a
  decision API.
- **Multi-tenant SaaS as a *later* second offer** — not recommended for v1 (§3), but if enough buyers want
  "don't make us run infrastructure," it's a legitimate v2 path once the container offer has real customers
  and the compliance posture (SOC 2 track already flagged in `ROADMAP.md`'s "Toward 1.0") is closer.
- **Language of the adapter SDK** — Foundry customers skew Python/.NET; `governance-core` is TypeScript.
  The adapter almost certainly needs to be a thin native-language client calling the sidecar over HTTP
  (which the wire protocol already supports) rather than a port of `governance-core` itself — worth
  confirming that's the intended shape before anyone starts writing it.
- **Where this plan lives once approved — resolved by the "second target, not a pivot" framing above.**
  It belongs in `docs/design/` alongside `THREAT_IMMUNITY_FABRIC_PLAN.md` and
  `M3_DISPATCH_VERIFICATION_PLAN.md`, following the existing convention, likely as
  `docs/design/AZURE_FOUNDRY_INTEGRATION_PLAN.md` — a target-platform integration plan, structurally the
  same kind of doc as those two, not a special business-strategy exception. `ROADMAP.md` would then get a
  short pointer to it once work actually starts, the same way it points to the M3 plan today, rather than
  a standalone section implying a change in product direction. Still not committed yet — say the word and
  I'll write it in.

## 12. Sources

- [Function calling — Foundry Agent Service](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/function-calling)
- [Tool catalog — Foundry Agent Service](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/tool-catalog)
- [Tool approval — Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval)
- [Plan an Azure Application offer](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/plan-azure-application-offer)
- [Plans and pricing for Microsoft Marketplace offers](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/plans-pricing)
- [Azure Consumption Commitment benefit](https://learn.microsoft.com/en-us/marketplace/azure-consumption-commitment-benefit)
- [Azure Consumption Commitment enrollment (publisher)](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/azure-consumption-commitment-enrollment)
- [MACC frequently asked questions](https://learn.microsoft.com/en-us/marketplace/macc-frequently-asked-questions)
- [Co-sell requirements — Partner Center](https://learn.microsoft.com/en-us/partner-center/referrals/co-sell-requirements)
