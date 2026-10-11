# AI Estate Spec

Declarative definition of a company's LLM estate on Microsoft Foundry, with
Starfish governance as first-class fields. One repo per client tenant.

```
estate.schema.json          JSON Schema (draft 2020-12) for both document kinds
estate.yaml                 Estate baseline — platform + governance, inherited by all
workspaces/*.yaml           One document per logical AI workspace
GOVERNANCE.md               Starfish control → spec field → Azure implementation
```

## Why this exists

Microsoft Foundry already does more than it gets credit for: per-project token
limits (AI Gateway), model allowlisting (Azure Policy), cross-project agent
inventory and cost (Control Plane), and project-scoped role assignment in its
own portal. None of that needs rebuilding.

What it does **not** do:

- Stamp a standard project shape repeatedly. There is no clone, no project
  template. The full shape below is ~20–30 interactions across two portals,
  every time.
- Reach outside its own portal for the things a governed workspace needs:
  Entra group creation, AI Search index and managed-identity grants,
  agent-scope RBAC (CLI-only), budgets.
- Anything at all for deploying the same shape into a **different client
  tenant**.

That last one is the point. This is not a platform — it is a parameterised repo
plus a thin CLI.

## What one workspace compiles to

- One Foundry project (`Microsoft.CognitiveServices/accounts/projects`), which
  carries its own managed identity
- One Entra security group, plus an access review on it
- One dedicated AI Search index per knowledge entry
- RBAC assignments at the narrowest available scope — agent scope where
  possible, which neither portal can assign
- An AI Gateway token limit scoped to that project and deployment
- Runtime gate wrappers on every `write` and `external` tool
- Diagnostic settings routing to the estate's Log Analytics workspace

Model deployments are **not** per workspace. A Foundry resource allows 250
projects but only 32 deployments, and quota is pooled at subscription level, so
workspaces reference a shared pool declared once in `estate.yaml`.

## Pipeline

```
  author        edit YAML
     ↓
  validate      schema + the eight rules in GOVERNANCE.md
     ↓
  plan          diff against observed Azure state → human-readable change list
     ↓
  gate          evaluate governance.changeGates against the diff
     ↓            humanApproval → sign the plan hash
     ↓            acknowledgement → confirm and record
     ↓            block → stop
  apply         emit Bicep/Terraform, deploy, record SHA + hash + decisions
```

`plan` is the screen the whole thing is worth building for. `apply` without a
reviewed plan is just clicking faster.

## Design decisions worth not relitigating

**No shared knowledge stores.** Every workspace gets its own index. Cross-workspace
sharing would need document-level permission filters (preview for ~15 months,
with contradictory documentation on whether a missing token fails open or
closed), and the built-in AI Search agent tool queries as the project's managed
identity and cannot carry a user identity at all. Duplicating a corpus is
cheaper than being wrong about who can read it. `store` is a schema const, not
an enum, so reversing this has to be deliberate.

**One group per workspace, no user lists.** "Who can use this" must have exactly
one answer. Group membership also revokes fast — it resolves live through Graph
rather than waiting on a reindex.

**Emit IaC, don't call ARM live.** The generated Bicep or Terraform is a
deliverable the client owns, reviewable before it lands, and it survives the
tooling being unavailable.

**Governance controls tighten, never loosen.** A workspace may add gates or
narrow scope. Any override that widens an estate control is a validation error,
not a warning.

## Still to build

1. `validate` — schema plus the eight rules in GOVERNANCE.md
2. `plan` — state read + diff + change-list rendering
3. Gate evaluator — the predicate language over the diff
4. Generator — Bicep for the ARM surface, Graph calls for Entra, CLI for
   agent-scope RBAC, data-plane calls for Search indexes
5. Runtime gate wrapper — the one control that cannot be fully compiled

Phase 1 is 1–2 and a hand-deployed three-workspace estate. Everything else
depends on that working.

## Open question to settle by test

Whether the Foundry portal renders delegated cross-tenant subscriptions through
Azure Lighthouse. ARM operations should work — Bicep, RBAC, Policy — but the
portal is heavily data-plane and Lighthouse does not cover data-plane operations
handled by a resource instance. If it does not work, multi-client delivery is
CLI-only, which changes the shape of the tool. Worth an hour with a test tenant
before building anything else.
