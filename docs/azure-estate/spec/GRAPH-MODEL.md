# Estate graph model

The map is a diff between two graphs of identical shape:

- **Intended** — built from the spec (`estate.yaml` + `workspaces/*.yaml`). Free.
- **Actual** — collected from a live tenant. This document is that collector's
  work breakdown.

Every node and edge carries a `state`: `match` (both graphs), `planned`
(intended only — declared, not deployed), `undeclared` (actual only — exists in
the tenant, absent from the design).

`undeclared` is the finding that sells the engagement. It is the only thing on
the map that nobody can produce from documentation.

---

## Node types

| Node | Key | Source | Plane |
|---|---|---|---|
| Access group | Entra object ID | Microsoft Graph `/groups` | Graph |
| Workspace | `accounts/{a}/projects/{p}` | ARM `Microsoft.CognitiveServices/accounts/projects` | ARM |
| Model deployment | deployment name on the account | ARM, under the account | ARM |
| Knowledge index | index name on the Search service | **AI Search data plane** `GET /indexes` | Data |
| Tool | agent tool binding | **Foundry data plane** — agent definition | Data |
| Agent | agent id within a project | **Foundry data plane** | Data |
| Agent Application | `…/projects/{p}/agents/{name}` | ARM (published agents only) | ARM |

## Edge types

| Edge | Meaning | Source | Plane |
|---|---|---|---|
| group → workspace | who can use it | ARM role assignments at project / agent scope, subject = group object ID | ARM |
| user → group | membership | Graph `/groups/{id}/members` | Graph |
| workspace → model | which model it calls | Foundry project connection + agent model binding | ARM + Data |
| workspace → index | what it reads | ARM connection gives the *service*; the *index* needs the data plane | ARM + Data |
| workspace → tool | what it can do | **Foundry data plane** — agent tool list | Data |
| tool → downstream | blast radius | role assignments held by the project managed identity | ARM |
| agent → agent | orchestration | Foundry data plane — connected agents | Data |

## The four collectors

**1. ARM** — `Microsoft.CognitiveServices/accounts`, `/projects`,
`/projects/connections`, `/projects/agents`, model deployments, and all role
assignments at every scope. Reader is enough. Azure Resource Graph makes the
sweep cheap. This is the easy 60%.

**2. Microsoft Graph** — groups, memberships, and agent identities. Needs
`Group.Read.All` and `Directory.Read.All`. Resolve group object IDs from the
role assignments back to names; a role assignment naming a group nobody can
resolve is itself a finding.

**3. Foundry data plane** — agents, their tool bindings, model bindings and
connected agents. Not in ARM, therefore invisible to every generic Azure
diagramming tool. This is where undeclared agents live and it is the single
highest-value collector.

**4. AI Search data plane** — index definitions and their fields. Index
definitions **cannot** be expressed in ARM at all, so no ARM-based tool draws
them. Everyone else's graph stops at the Search *service*; stopping at the index
is the difference between "this workspace can reach Search" and "this workspace
can read the contract corpus."

## Drift classes worth detecting

Ordered by how uncomfortable they make a client:

1. **Undeclared workspace** — a project in the tenant that no spec claims. Who
   owns it, what does it read, what can it do.
2. **Local keys enabled** — key auth bypasses RBAC entirely, so every other
   control on that resource is decorative.
3. **Ungated write or external tool** — a tool that mutates or reaches outside
   the tenant with no approval gate.
4. **Scope drift** — a grant assigned at account scope where the design says
   agent scope. Works fine, quietly over-privileged.
5. **Orphaned group** — a group with members that grants access to nothing.
   Harmless, but it means the access model is not being maintained.
6. **Undeclared index** — knowledge added by hand that nobody reviewed.
7. **Planned, not deployed** — declared in the spec, absent from the tenant.
   The only class that is not a problem.

## Why an ARM-only collector is not enough

Half the interesting edges are data-plane. A tool built on Azure Resource Graph
alone will draw Foundry accounts, projects, connections and model deployments as
generic boxes and **none** of the agent, tool, or index edges — which is exactly
what every existing Azure diagramming product does today.

## Where this overlaps existing products, honestly

Defender for Cloud AI-SPM reads the Foundry data plane and renders an
interactive attack-path graph. Defender XDR's `AgentsInfo` table already
collects `SharedWith`, `DeclaredTools`, `McpServers`, `DeclaredDataSources`,
`ConnectedAgents`, `Model` and `Endpoints` per agent. Wiz and Noma ship
commercial agent topology maps.

Three things they do not do, which are the whole reason to build this:

- They render a **risk** view — "here is an exploitable path." Nobody renders
  the **design** view: the intended shape, diffable against reality.
- Nobody makes **access tier the organising spine**. Group → workspace as the
  primary axis is unserved.
- All of them sit behind Defender CSPM, Agent 365, or an enterprise CNAPP
  contract. A read-only tool needing Reader plus Graph read works on any tenant
  at any spend level.

Worth an hour in a trial tenant before committing: check whether `AgentsInfo` is
populated for Foundry-built agents rather than only Agent 365-registered ones.
If it is, collector 3 gets much cheaper wherever the client already has Defender
— but it should stay optional enrichment, never a dependency, or the licensing
accessibility argument disappears.
