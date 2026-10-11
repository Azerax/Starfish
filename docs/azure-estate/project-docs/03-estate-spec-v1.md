# Estate spec v1 — decisions and files

Delivered 2026-08-31. Files sent to Scott in-chat: `estate.schema.json`,
`estate.yaml`, `workspaces/legal-research.yaml`, `GOVERNANCE.md`, `README.md`.
Both YAML documents validate against the schema (Draft 2020-12).

## Scope correction — what Foundry already does

Cut from scope, because it ships in the box today:

- **Per-project TPM + token quota** — Foundry portal → Manage → AI Gateway →
  Token management (preview). Configurable without touching APIM. This was the
  biggest custom-build justification and it's gone.
- **Model allowlisting** — Azure Policy built-ins, GA, deny-with-reason UX.
- **Cross-project agent inventory / health / token / cost** — Operate,
  Control Plane (preview). Auto-discovers agents subscription-wide.
- **Project-scoped role assignment** — Foundry portal → Project details → Users.
  GA. (An earlier draft wrongly said the portal couldn't do this. Only
  *agent*-scope is CLI-only.)
- **Quota reallocation across deployments** — Manage → Quota. GA.

What's genuinely left:

1. No project template / clone anywhere. The governed shape is ~20–30
   interactions across two portals, every time.
2. Six steps leave the Foundry portal: Entra group creation, Search index
   definition, managed-identity grants on Search, agent-scope RBAC, budgets,
   networking.
3. **Nothing for deploying the same shape into a different client tenant.**
   Since Scott is the customer and delivers to multiple clients, this is the
   whole job.

Conclusion: not a platform. A parameterised repo + thin CLI. Weeks, not quarters.

## Shared libraries — CUT

Every workspace gets its own dedicated AI Search index. `store` is a schema
`const`, not an enum, so reversing needs a deliberate schema change.

Four reasons: the built-in AI Search agent tool queries as the project managed
identity and can't carry user identity (open Azure SDK issue #44454);
`permissionFilter` is preview-only after ~15 months; Microsoft's docs contradict
each other on fail-open vs fail-closed when the user token is missing; and
document ACLs go stale indefinitely with no sync SLA. Dedicated indexes also
give better relevance (per-index term-frequency statistics) and the path is GA.

Cost: duplicated storage for genuinely shared corpora. Right trade.

## Starfish governance — the orchestration layer

The distinction that makes it work:

| | Question | Where | When |
|---|---|---|---|
| Runtime gate | May this agent take this action now? | Tool wrapper | Every call |
| Change gate | May this agent be wired this way at all? | Plan diff | Every deploy |

**The plan diff is the governance surface.** Everything the estate can do is in
YAML, so every change is a diff, and a diff can be gated, approved and recorded.
This closes the orchestration-layer gap Scott flagged in Aug 2026.

Change gate predicates: `access.groupWidened`, `access.scopeWidened`,
`access.roleEscalated`, `tools.added`, `tools.effectIncludes(read|write|external)`,
`knowledge.sourceAdded`, `knowledge.classificationRaised`, `model.limitsRaised`,
`model.limitsRemoved`, `feature.usesPreview`, `governance.controlWeakened`,
`resource.localKeysEnabled`.

Resolutions: `humanApproval` (signs the plan hash), `acknowledgement` (recorded),
`block` (no override). Two baseline gates are `block` and stay that way:
`governance-weakened` and `local-keys-reenabled`.

`tools[].effect` (read|write|external) is the field everything hangs on —
understating it silently skips both the deploy and runtime gate.

The one control that can't be compiled: Azure has no native per-action approval
for agents. Spec declares it and fails the build when a write/external tool has
no gate; enforcement is a Logic App step or app-tier confirm turn. Default
`onTimeout: deny`.

## Eight validator rules the schema can't express

1. `Foundry Agent Consumer` + `scope: agentApplication` → error (needs Foundry User)
2. Distinct deployments per Foundry resource > 32 → error
3. Declared indexes > Search tier ceiling (Standard = 50) → error
4. `model.limits` with `aiGateway.mode: none` → error
5. Workspace governance override that widens an estate control → error
6. `publish.asAgentApplication: true` → plan must re-emit every RBAC grant
7. Tool with `effect: write|external` and no runtime gate → error
8. `metadata.tenantId` ≠ signed-in tenant → refuse to apply

## Build order

P1 validate + plan · P2 generator + real 3-workspace estate · P3 change gates on
the diff · P4 runtime gate wrappers · P5 UI, if it still earns its place.

## Blocking unknown — test first

Does the Foundry portal render delegated cross-tenant subscriptions via Azure
Lighthouse? ARM ops (Bicep, RBAC, Policy) should work through delegation, but
the portal is heavily data-plane and Lighthouse doesn't cover data-plane
operations handled by a resource instance. A negative answer makes multi-client
delivery CLI-only and changes the tool's shape. One hour with a test tenant.
