# Pivot: map first, spec second

2026-08-31. Scott asked the right question — "are we actually making anything
different?" — and the honest answer was no. This records the reasoning so it
isn't relitigated.

## The spec on its own isn't novel

`estate.yaml` + generator is Bicep with a YAML face. The change gates are
policy-as-code — OPA, Sentinel and Checkov all gate an IaC plan diff today. The
only original part is the *vocabulary* (predicates about tool effect and
knowledge classification instead of generic resource attributes). That's a
policy library, not a product.

## The map isn't novel either — checked before recommending it

- **Defender for Cloud AI-SPM** reads the Foundry data plane (MCP tool
  allowlists, project→datastore connections and their auth mode, connected-agent
  orchestration) and renders an interactive attack-path graph. GA for discovery;
  agent posture preview, and from July 2026 needs an Agent 365 licence.
- **Defender XDR `AgentsInfo` table** already collects per agent: `SharedWith`
  (users and security groups), `DeclaredTools`, `McpServers`,
  `DeclaredDataSources`, `ConnectedAgents`, `Model`, `Endpoints`. That is every
  node and edge in the proposed diagram, queryable by KQL today. Microsoft
  assembled the graph and renders it as a **table** — no topology view.
- **Wiz AI-SPM** maps agents to identities and data on its Security Graph.
- **Noma Security "Agentic Risk Map"** — commercial agent topology map, names
  Azure AI Foundry as a discovered platform.
- **Foundry Control Plane / Operate** — confirmed lists and metrics only, no
  relationship graph.
- **ARM diagramming tools** (Cloudockit, Hava, draw.io Azure import, Azure
  Resource Visualizer) draw accounts/projects/connections/deployments as generic
  boxes and none of the agent, tool or index edges.

## Why the map is still right — for a different reason

1. **Design view, not risk view.** Everyone renders "here is an exploitable
   path." Nobody renders the intended shape, diffable against reality — the
   artifact for an architecture review or an auditor.
2. **Access tier as the organising spine.** Group → workspace as the primary
   axis is unserved. It was also Scott's original mental model in the project
   description.
3. **Licensing floor.** Everything above needs Defender CSPM + Agent 365 or an
   enterprise CNAPP contract. A read-only tool needing Reader + Graph read works
   on any tenant at any spend.
4. **Read beats write for a consultancy.** The map works on day one against a
   tenant Scott didn't build, so it can *win* work. The spec only pays off after
   the work is won. Sequencing spec-first was my error.

## Decisions taken

- **Own collector**, not Defender-dependent. AgentsInfo stays optional
  enrichment — making it a dependency destroys the licensing-accessibility
  argument.
- **Current vs intended, diffed.** This rescues the spec work: the spec is the
  *intended* side of the diff.

## Artifacts

- `estate-map.html` — working prototype on fixture data. Access spine by
  default, select a node to trace its full reach, drift-only filter, findings
  list. Published as an artifact.
- `GRAPH-MODEL.md` — node/edge types mapped to the four collectors (ARM, Graph,
  Foundry data plane, Search data plane), plus the seven drift classes.

## Drift classes, ordered by client discomfort

1. Undeclared workspace — a project no spec claims
2. Local keys enabled — bypasses RBAC entirely
3. Ungated write/external tool
4. Scope drift — account scope where design says agent scope
5. Orphaned group — members, grants nothing
6. Undeclared index — knowledge added by hand
7. Planned not deployed — the only benign class

## Next

Build collector 1 (ARM, via Resource Graph) — the easy 60%, Reader only. Then
collector 3 (Foundry data plane), which is where undeclared agents live and is
the highest-value piece.

Still worth an hour in a trial tenant: does the Foundry portal render delegated
cross-tenant subscriptions via Lighthouse, and is `AgentsInfo` populated for
Foundry-built agents rather than only Agent 365-registered ones.
