# Fixture tenant plan

Every rule in this tool asserts that a condition exists in a real Azure tenant.
None of those assertions has ever been checked against Azure — only against
handwritten fixtures that encode my *guess* at what Azure returns.

This plan turns Scott's own Azure subscription into a fixture tenant: build
each condition deliberately, confirm the rule fires, remove it, confirm the
rule goes quiet.

That second half is the part a client tenant can never give you. In a client
tenant you only ever learn "it didn't crash and the numbers look plausible."
Here you know ground truth, so you can prove **absence of false positives**,
which is the failure mode that costs you the room.

---

## Cost

Almost all of it is free.

| Thing | Cost at rest |
|---|---|
| Foundry account, projects, agents | $0 — you pay for inference, not definition |
| Model deployments (standard/global) | $0 idle — token-billed only |
| Entra groups, role assignments | $0 |
| Azure AI Search **Free tier** | $0 — 3 indexes / 3 indexers / 3 data sources / 3 skillsets, 50 MB, one per subscription |
| Azure AI Search Basic | ~hourly, only needed for the permission-filter test |

The Free tier is not a compromise here, it is an advantage: **R3-index-ceiling
triggers at 3 indexes instead of 50.** You can hit a tier ceiling in three API
calls instead of fifty.

Only one fixture needs a paid service (F6). Spin Basic up for an hour, run it,
tear it down.

---

## Drift rules — what provokes each

Run order matters only where noted. Everything else is independent.

### F1 · `undeclared-workspace` · high
**Provoke:** create a Foundry project that is not in `estate.yaml`.
**Objects:** 1 project. **Cost:** $0.
**Assert:** fires in diff mode; **suppressed** in discovery mode (it is in `DIFF_ONLY`).
**Teardown:** delete the project.

> Also the fixture for the discovery/diff split. If this fires in discovery
> mode, the mode split is broken.

### F2 · `local-keys-enabled` · high
**Provoke:** set `disableLocalAuth: false` on the Foundry account.
**Objects:** 1 property change. **Cost:** $0.
**Assert:** fires, and names the *resource*, with the workspace count in the detail.
**Teardown:** set it back to `true`. Do this one first and last — it is a
one-line toggle and it is the single highest-severity finding in the tool.

### F3 · `ungated-tools` · high
**Provoke:** an MCP tool binding on an agent with `require_approval: "never"`,
named so `inferEffect()` reads it as write or external.
**Objects:** 1 agent + 1 MCP binding. **Cost:** $0.
**Assert:** `gated === false` (a fact from the tenant, not an inference), and
the `effectInferred` count in the `why` line is accurate.
**Teardown:** delete the agent.

### F4 · `gate-unknown` · medium
**Provoke:** a **non-MCP** tool — an OpenAPI tool — with a write/external
effect. No approval field exists on it, so the gate is unknowable.
**Objects:** 1 agent + 1 OpenAPI tool. **Cost:** $0.
**Assert:** lands in `gate-unknown`, **not** in `ungated-tools`. This is the
confidence split; if a non-MCP tool shows up as "ungated" the split has failed
and the report is accusing a tool that may be perfectly gated in the calling app.
**Teardown:** delete the agent.

### F5 · `mcp-unrestricted` · medium
**Provoke:** an MCP binding with no `allowed_tools` list.
**Objects:** 1 MCP binding. **Cost:** $0.
**Assert:** `allowedToolsUnrestricted === true`.
**Teardown:** add an allowed-tools list, re-scan, confirm it goes quiet.

### F6 · `permission-filtered-index` · high
**Provoke:** an index with `permissionFilter` fields, created at
`2026-05-01-preview`.
**Objects:** Search service (Basic — Free tier support for the preview API is
**unverified, and verifying it is part of the test**) + 1 index.
**Cost:** hourly, ~1 hour.
**Assert:** `permissionFilters === true`; the `why` line includes the
"design forbids shared stores" clause **only** in diff mode.
**Teardown:** delete the index, delete the service.

> This is the highest-information fixture in the set. It is the only one where
> the API may simply not behave as the docs describe, and the whole
> no-shared-store decision rests on the answer.

### F7 · `deprecated-role` · medium
**Provoke:** assign `Cognitive Services OpenAI User` to a test group.
**Objects:** 1 group + 1 role assignment. **Cost:** $0.
**Assert:** matches case-insensitively against `DEPRECATED_ROLES`.
**Teardown:** remove the assignment.

### F8 · `account-scope-grant` · medium
**Provoke:** assign a role to a group at **account** scope while ≥2 projects
exist on that account.
**Objects:** 1 group + 1 assignment + 2 projects. **Cost:** $0.
**Assert:** counted as **one** finding (one group), not N (one per workspace
reached); blast radius appears in the detail; `mark` covers the *group only*,
not every reached workspace.
**Teardown:** re-assign at project scope.

> This is the fixture for the miscount bug fixed earlier. Add a third project
> and confirm the count stays at 1 while the detail moves to 3.

### F9 · `scope-conflict` · medium
**Provoke:** F8's condition, plus a spec entry declaring project scope.
**Objects:** none beyond F8. **Cost:** $0.
**Assert:** and this is the important one — **`canonicalScope()` does its job.**
Declare `agentApplication` in the spec, let ARM classify the same assignment
as `agent`, confirm **no** finding. This is the false positive that flagged
three correctly-configured workspaces.
**Teardown:** align the spec.

### F10 · `orphan-group` · info
**Provoke:** an Entra group with ≥1 member and no role assignment anywhere.
**Objects:** 1 group + 1 member. **Cost:** $0.
**Assert:** fires **only** when the `graph` collector ran. Run the scan with
graph disabled and confirm silence — absence of an edge is not evidence of
absence of a grant.
**Teardown:** delete the group.

### F11 · `undeclared-index` · medium
**Provoke:** create a Search index by hand that no spec declares.
**Objects:** 1 index on the Free service. **Cost:** $0.
**Assert:** fires in diff mode, suppressed in discovery.
**Teardown:** delete the index.

### F12 · `planned-not-deployed` · info
**Provoke:** declare a workspace in `estate.yaml` and build nothing.
**Objects:** **none**. **Cost:** $0.
**Assert:** the count agrees with the "Declared, not built" stat — it counts
every planned node, not just workspaces. A mismatch here means two numbers on
the same page disagree, which is worse than either being wrong.
**Teardown:** remove the spec entry.

### F13 · `unresolved-principal` · medium
**Provoke:** assign a role to a group, **then delete the group.** The
assignment survives with a principal id that no longer resolves.
**Objects:** 1 group (deleted) + 1 orphaned assignment. **Cost:** $0.
**Assert:** `resolved === false`, detail shows a truncated object id.
**Teardown:** remove the orphaned assignment.

> Do this one deliberately and early. It is the finding most likely to exist
> in a real client estate and the hardest to construct by accident.

### F14 · `direct-user-grant` · medium
**Provoke:** assign a role directly to your own user principal rather than a group.
**Objects:** 1 assignment. **Cost:** $0.
**Assert:** `principalType === "User"` and `scopeKind !== "other"`. Assign one
at subscription scope too and confirm it is **excluded** by the scope filter.
**Teardown:** remove the assignment.

### F15 · `agent-chain` · medium
**Provoke:** agent A with a connected-agent tool pointing at agent B.
**Objects:** 2 agents + 1 connection. **Cost:** $0.
**Assert:** the edge exists — this is the **two-pass** fixture. Create B
*after* A in the same scan and confirm the edge still builds. A single-pass
builder drops it.
**Teardown:** delete both agents.

### F16 · `unowned-workspace` · medium
**Provoke:** a project with no owner in the spec and no owner tag.
**Objects:** 1 project. **Cost:** $0.
**Teardown:** set an owner.

### F17 · `scan-incomplete` · high
**Provoke:** run the scan **without** granting the Search data-plane role.
**Objects:** one role assignment withheld. **Cost:** $0.
**Assert:** the undercount banner appears **first**, the caveats split
correctly on `<code>` boundaries in `renderSummary()`, and every count below
is labelled a floor.
**Teardown:** grant the role.

> Run this before anything else. A partial scan that looks complete is worse
> than no scan, and this is the only rule whose job is to say so.

---

## Validator rules — no Azure needed

R1, R2, R4, R5, R6, R7, R9, R10, R11, R12 are spec-only; they already have unit
coverage and need no tenant. Two are worth checking against reality:

- **R2-deployment-ceiling (32)** — confirm the real ceiling on the account
  matches. Deploy a cheap model repeatedly and find the actual wall.
- **R3-index-ceiling** — the Free tier caps at 3. Create 4. Confirm both that
  Azure refuses and that the validator predicted it.

---

## What this still will not prove

Two things, and it is fine that it doesn't:

1. **Shape at scale.** 120 workspaces produced a 1,319-edge hairball. Your
   tenant will have six. The fan-out suppression is proven by generated data,
   not by a real estate.
2. **How the report reads to someone who didn't build it.** That needs a
   client and a room.

Everything else on the blocker list is answerable in an afternoon.

---

## Suggested order

1. F17 (scan incomplete) — before granting anything
2. F2 (local keys) — one toggle, highest severity
3. F13 (unresolved principal) — needs a group created then deleted
4. F1, F8, F9, F16 — projects and scopes together
5. F3, F4, F5, F15 — agents and tools together
6. F7, F10, F14 — groups and roles together
7. F11, F12 — indexes on the Free service
8. F6 — spin up Basic, run, tear down
9. Re-run everything with all fixtures removed. **Expect zero findings.**

Step 9 is the one that matters. A tool that finds problems is easy. A tool
that finds nothing when there is nothing is the one you can put in front of a
client.
