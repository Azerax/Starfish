# LLM Workspace Control Plane — reference architecture (draft v0.1)

Full illustrated version published as an artifact:
https://claude.ai/code/artifact/31a25acd-1579-4415-ace2-7ad0d1e665dc

Drafted 2026-08-31 against Microsoft Learn docs current at that date.

## Decisions settled

- **"Container" = logical AI workspace**, not a compute container. One workspace
  compiles to one Foundry project + one Entra group + bindings.
- **Platform owns spec → plan → generated IaC. Never the runtime.** Output is
  ordinary Foundry projects that survive the platform being switched off.
- **Emit Bicep/Terraform, do not call ARM live.** Auditability is the sale.

## Naming — anything older than mid-2026 is stale

- "Azure AI Foundry" → **Microsoft Foundry**; hub-based model is now "classic".
- Roles renamed: Azure AI User → **Foundry User**, Azure AI Project Manager →
  **Foundry Project Manager**, Azure AI Account Owner → **Foundry Account Owner**.
- `Cognitive Services *` roles and `Azure AI Developer` are explicitly NOT
  recommended for Foundry.

## Resource model

- Foundry resource = `Microsoft.CognitiveServices/accounts` (kind: AIServices)
- Project = `.../accounts/projects`; published agent = Agent Application with its
  own ARM resource + Entra agent identity.

## The three constraints that shape the design

| Constraint | Limit | Consequence |
|---|---|---|
| Projects per Foundry resource | 250 | Workspaces are free — one per access pattern |
| Model deployments per resource | 32 | Deployments are a SHARED pool workspaces reference |
| Managed identities per project | 1 | Two agents needing different downstream access must be two projects (Microsoft's own guidance) |

Quota is pooled at **subscription** level since May 2026, not partitioned per
project — gateway token limits are the only noisy-neighbour control.

## Access model

One Entra security group per workspace = the subject. Azure RBAC at narrowest
scope = the enforcement. UI never offers a user picker, only a group picker.

Three traps:
1. **Publishing an agent does not carry permissions** — must re-emit grants.
2. **Foundry Agent Consumer does NOT grant invoke on a published Agent
   Application** — that needs Foundry User. Looks configured, returns 403.
3. **Key-based auth bypasses RBAC entirely** — disable local keys always.

Portal can only assign at *account* scope; project/agent scope needs ARM/CLI —
which is itself the evidence that the deployment layer is a real gap.

## Knowledge layer — the hard part

- `visibility: private` → dedicated AI Search index. **GA**, better relevance,
  no token plumbing. This is the default and the launch position.
- `visibility: shared` → permission filters (`permissionFilter` fields for
  userIds/groupIds/rbacScope). **Preview only**, API `2026-05-01-preview`, and
  has sat in preview ~15 months. GA fallback is `group_ids` + `search.in()`.

**Critical**: the built-in AI Search tool on a Foundry agent queries with the
*project's managed identity* — no user identity, so no trimming is possible.
Must use Foundry IQ over MCP with the user's on-behalf-of token forwarded as
`x-ms-query-source-authorization`. Generator should refuse to emit the built-in
tool binding whenever `visibility: shared` appears.

**Revocation**: no background ACL sync; index serves last-ingested ACLs
indefinitely. BUT group membership resolves live via Graph — so removing a user
from a group revokes fast with no reindex. Express permissions as group
membership wherever possible; use `POST /indexers/{name}/resync` with
`{"options":["permissions"]}` on a schedule for document ACL changes.

## Gateway / cost

APIM policies are now LLM-generic and GA: `llm-token-limit`,
`llm-emit-token-metric`, `llm-semantic-cache-lookup`/`-store`,
`llm-content-safety`. Load balancing is a backend-pool property, not a policy.

Chargeback mapping: APIM **Product** = capability bundle, APIM **Subscription** =
consuming workspace, `counter-key="@(context.Subscription.Id)"`. See the AI Hub
Gateway solution accelerator (Azure-Samples) — it already implements this.

PTU spillover is GA natively via `spilloverDeploymentName`.

Gotcha: Foundry's built-in AI Gateway is enabled at **resource** level, not per
project — isolating workspaces onto separate gateways needs separate resources.

## Build sequence

1. Spec + generator, no UI. Deploy a 3-workspace estate by hand.
2. Access model end to end (groups, agent-scope RBAC, keys off, publish reissue).
3. Gateway, quota, chargeback.
4. The UI and the plan/diff screen — only now.
5. Shared knowledge with trimming — last, behind a flag.

## Open questions to settle by test, not by reading

- **Fail-open or fail-closed on a missing query token?** Microsoft's two docs
  contradict each other. Blast radius = full corpus disclosure. First integration
  test the platform ships with.
- Graph group-membership cache TTL (undocumented) — determines real revocation speed.
- Do published Agent Applications appear in the Entra agent registry? Docs conflict.
- Max agents per project — undocumented.
- Foundry Project Manager's exact permissions — RBAC page and auth page disagree.
- Streaming support on the Agent Service BYOM gateway path — docs silent.

## Non-technical risk

Buyer is enterprise IT / cloud platform team, 6–12 month cycle, competing with
Microsoft partners selling the same thing as services. Different motion from the
trades/home-services agency base. Decide up front: product to sell, or internal
accelerator that makes delivery cheaper. Same architecture, order-of-magnitude
difference in polish and support surface.
