# Blockers

Four things stopped work from going further in this session. Each has five
candidate solutions, scored.

**Scoring** — each option gets 1–5 on four axes, total out of 20:

| Axis | 5 means |
|---|---|
| **Speed** | resolvable today |
| **Confidence** | very likely to actually settle the question |
| **Cost** | little or no money, licence, or approval needed |
| **Durability** | fixes it permanently, not once |

Higher is better. A high total is a recommendation, not a verdict — the
one-line note under each option is where the actual judgement is.

---

## Blocker 1 — No Azure tenant, so no live collector has ever run

**What is blocked.** `src/collect/{arm,graph,foundry,search}.ts` are written
against documented API shapes and typecheck cleanly, but not one HTTP call has
been executed. The parsing half is tested (82 tests); the network half is
assumption. Wrong endpoint, wrong api-version, wrong pagination field, or an
auth audience that turns out to be different — any of those breaks the tool on
first contact, and the risk is concentrated in the two data-plane collectors
where the docs were thinnest.

This is the only blocker that stops the project. Everything else is a detail.

| # | Option | Speed | Confidence | Cost | Durability | **Total** |
|---|---|---|---|---|---|---|
| 1 | **Free Azure trial tenant, deploy one Foundry resource by hand, run the scan** | 4 | 5 | 5 | 5 | **19** |
| 2 | Run against your own existing Azure subscription, if one has any Foundry resource | 5 | 4 | 5 | 4 | **18** |
| 3 | Record-and-replay: add a `--record` flag that dumps raw HTTP responses to fixtures the first time it runs anywhere | 4 | 3 | 5 | 5 | **17** |
| 4 | Write a mock HTTP server from the doc samples and test against that | 4 | 1 | 5 | 3 | **13** |
| 5 | Ship it and fix on first client engagement | 5 | 2 | 5 | 1 | **13** |

**Option 1 is the answer.** A free trial gives a real tenant, and one Foundry
resource with two projects, one Search index and one agent is enough to exercise
all four collectors. Half a day, no money, and it converts every assumption into
a fact. Do this before writing another line of collector code.

Option 3 is worth building *alongside* option 1 rather than instead of it: a
`--record` flag turns the first successful live run into a permanent regression
fixture, so the next API change is caught by the test suite rather than by a
client. That is what makes option 1 durable instead of one-off.

Option 4 scores badly on confidence for the reason that matters: a mock built
from my own reading of the docs would assert my assumptions back at me. It
tests the code against the belief, not against Azure. That is worse than no test
because it produces false confidence.

Option 5 is only defensible if the first engagement is with someone forgiving.

---

## Blocker 2 — Cross-tenant behaviour through Azure Lighthouse is unknown

**What is blocked.** Multi-client delivery is the entire reason this tool exists
rather than being a Foundry portal session. ARM operations *should* work through
Lighthouse delegation — that is what Lighthouse is for — but Lighthouse
explicitly does not cover data-plane operations handled by a resource instance,
and two of the four collectors are pure data plane. If the Foundry and Search
data planes do not honour delegated access, then scanning a client tenant means
credentials *in* that tenant, and the operating model changes: no central
scanning identity, per-client onboarding, and a different conversation with
every client's security team.

| # | Option | Speed | Confidence | Cost | Durability | **Total** |
|---|---|---|---|---|---|---|
| 1 | **Two trial tenants, delegate one to the other, run all four collectors** | 3 | 5 | 4 | 5 | **17** |
| 2 | Guest account + direct RBAC in the client tenant instead of Lighthouse | 4 | 4 | 4 | 4 | **16** |
| 3 | Design for both: a `--via` flag that switches token acquisition per collector | 4 | 3 | 5 | 4 | **16** |
| 4 | Ask in the Azure Lighthouse GitHub discussions / Microsoft Q&A | 2 | 3 | 5 | 4 | **14** |
| 5 | Assume it works and find out on a client engagement | 5 | 1 | 5 | 1 | **12** |

**Option 1 settles it, but it needs two tenants, so it costs a day rather than
an hour.** Worth it: this answer determines the shape of the product, and every
hour spent building on the wrong assumption compounds.

Option 2 is the fallback that almost certainly works, and it is worth knowing it
exists — if Lighthouse turns out not to carry the data plane, guest access plus
scoped RBAC per client is unglamorous but sufficient, and it is what most
consultancies already do. It scores nearly as well as option 1 because it
converts the blocker from "unknown" to "known-worse", which is progress.

Option 3 is cheap insurance regardless of the answer, and should be built either
way: the collectors already take an audience per call, so making the tenant a
per-collector parameter is a small change now and a rewrite later.

---

## Blocker 3 — Two different views of "agents" that may not join

**What is blocked.** There is a data-plane list (`GET /agents`, keyed by
`name`/`version`/`agent_guid`) and an ARM view of published agent applications
(`POST .../applications/{n}/listAgents`, keyed by `agentId`/`agentName`). The
research could not confirm how to reliably join them. This matters because
agent-scope role assignments use a `/agents/{name}` scope path while the ARM
resource is called `applications` — so "who can invoke this published agent"
depends on a join that is currently a guess.

Getting it wrong means the access column of the map is wrong for exactly the
workspaces that were configured most carefully.

| # | Option | Speed | Confidence | Cost | Durability | **Total** |
|---|---|---|---|---|---|---|
| 1 | **Publish one agent in a trial tenant and read both views side by side** | 4 | 5 | 5 | 5 | **19** |
| 2 | Join on `instance_identity.principal_id` and verify against role assignments | 4 | 3 | 5 | 4 | **16** |
| 3 | Do not join: show published-agent access from ARM only, and say so on the map | 5 | 4 | 5 | 2 | **16** |
| 4 | Read the Azure SDK source to see how it correlates them | 3 | 3 | 5 | 3 | **14** |
| 5 | Join on name and hope the names are stable | 5 | 2 | 5 | 1 | **13** |

**Option 1, and it is the same trial tenant as blocker 1** — publishing one
agent costs ten minutes once the tenant exists, which is why blocker 1 should be
resolved first and these two answered in the same sitting.

Option 3 is the honest interim: the map already distinguishes "gate unknown"
from "ungated", and the same treatment works here — show what ARM knows, mark
the rest as unresolved, and never present a guessed join as a fact. Low
durability because it leaves a permanent gap, but it ships correctly today.

Option 5 is what the code currently does by default and is the reason this is
listed as a blocker rather than a nicety.

---

## Blocker 4 — Two permissions a client may simply refuse

**What is blocked.** `Directory.Read.All` is required for
`directoryObjects/getByIds`, which has no lower-privileged alternative. And AI
Search rejects *every* Entra-authenticated request when a service still has
`authOptions` set to keys only — which is the default — so the index collector
can return an empty list from a perfectly healthy service.

Neither stops development. Both stop a scan on the day, in front of the client,
which is worse.

| # | Option | Speed | Confidence | Cost | Durability | **Total** |
|---|---|---|---|---|---|---|
| 1 | **Pre-flight check that verifies every permission before scanning and prints what is missing** | 4 | 5 | 5 | 5 | **19** |
| 2 | Degrade gracefully per collector with a caveat on the report (already built) | 5 | 4 | 5 | 4 | **18** |
| 3 | A one-page "what this scan needs and why" to send ahead of the engagement | 5 | 4 | 5 | 4 | **18** |
| 4 | Fall back to token group claims when Graph is refused | 3 | 2 | 5 | 2 | **12** |
| 5 | Require the client to run the scan themselves and send the JSON | 4 | 3 | 4 | 2 | **13** |

**Options 1, 2 and 3 are complements, not alternatives** — build all three.
Option 2 is done: every collector already downgrades to a caveat and the
`scan-incomplete` finding sorts first, because a partial scan that looks
complete is worse than no scan. Option 1 is the missing half: finding out about
a permission gap *before* you are on a call is worth more than handling it
gracefully during one.

Option 4 is a trap. Token group claims are capped and overflow into a
`_claim_names` reference above ~200 groups, so on exactly the large tenants
where the map is most valuable, the fallback would silently return partial
access data and the report would understate who can reach what.

---

## Not blockers, but next in line

- **`--record` mode.** Turn the first live run into permanent fixtures. Cheap,
  and it is what stops blocker 1 from recurring at every API version bump.
- **Pin the ARM api-version per resource type.** Currently one constant;
  accounts and applications are documented at different versions.
- **Gateway detection.** `aiGatewayApimId` is always `null` — the link is not on
  the account object and APIM is not yet queried, so the map cannot show which
  workspaces have enforceable token limits.
