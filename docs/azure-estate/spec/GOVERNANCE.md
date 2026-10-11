# Starfish governance in the estate spec

Starfish's controls were written for individual agent actions. The gap you
identified in August — that governance is missing at the *orchestration* layer,
not the action layer — is what this spec is for.

The distinction that makes it work:

| | Question it answers | Where it lives | When it fires |
|---|---|---|---|
| **Runtime gate** | May this agent take this action right now? | Tool wrapper | Every call |
| **Change gate** | May this agent be wired this way at all? | Plan diff, before apply | Every deploy |

An agent that asks for confirmation before sending an email is governed at the
action layer. An agent that was *given* an email tool last Tuesday and nobody
reviewed it is ungoverned at the orchestration layer, no matter how good the
runtime prompt is. The change gate is the second one.

**The plan diff is the governance surface.** Everything the estate can do is
declared in YAML, so every change to what it can do is a diff, and a diff can be
gated, approved, and recorded. That is the whole idea.

---

## Control mapping

### 1. Least privilege

| Spec | Compiles to | Layer |
|---|---|---|
| `access.scope: agentApplication` | RBAC assignment at `/…/projects/<p>/agents/<a>` — CLI/REST only, neither portal can express it | Deploy |
| `access.entraGroup` (one per workspace, no user lists) | Group is the sole subject of every grant | Deploy |
| `governance.leastPrivilege.downstreamGrants: explicit` | Every managed-identity role on Search/Storage/Cosmos enumerated in `tools[].downstreamGrants`; nothing implicit | Deploy |
| `localKeysDisabled: true` (const) | `disableLocalAuth` on every Foundry resource | Deploy |
| `separateProjectPerAccessPattern: true` (const) | Validator fails any workspace whose tools need divergent downstream grants | Deploy |

Two Azure facts force this shape rather than merely suggesting it. All
unpublished agents in a Foundry project **share one managed identity** — so
least privilege between two agents is only achievable by putting them in
separate projects. And key-based auth **bypasses RBAC entirely**, so a single
enabled key silently voids everything above it in this table.

### 2. Approval gates with thresholds

`governance.changeGates[]` — deploy-time, evaluated against the plan diff.

Predicates available on the diff:

```
access.groupWidened            access.scopeWidened         access.roleEscalated
tools.added                    tools.effectIncludes(read|write|external)
knowledge.sourceAdded          knowledge.classificationRaised
model.limitsRaised             model.limitsRemoved
feature.usesPreview            governance.controlWeakened
resource.localKeysEnabled
```

Three resolutions: `humanApproval` (named approver signs the plan hash),
`acknowledgement` (operator confirms they read it; recorded), `block` (refused,
no override).

Two gates in the baseline are `block` and should stay that way:
`governance-weakened` and `local-keys-reenabled`. A control you can waive under
deadline pressure is not a control.

Runtime thresholds live in `governance.runtimeGates.highStakes[].threshold` —
`{ recordCount: 1 }` confirms every write, `{ recordCount: 50 }` confirms only
bulk operations. The baseline confirms every write, deliberately.

### 3. Human review for high-stakes actions

`governance.runtimeGates.highStakes[]`.

Azure has **no native per-action approval for agents**. This is the one control
the spec cannot fully compile — it declares the requirement and generates the
wrapper stub, but the enforcement is yours (a Logic App approval step in the
tool path, or a confirm turn in the calling app).

What the spec *can* do, and does: fail the build when a tool declares
`effect: write` or `effect: external` and no matching gate exists. Forgetting
becomes impossible even though enforcing is manual.

`onTimeout: deny` is the default and matters more than it looks. An approval
request that expires must fail closed; an agent that proceeds because nobody
answered in five minutes is worse than one with no gate at all, because the gate
creates false confidence.

### 4. Audit logs

| Spec | Compiles to |
|---|---|
| `audit.destination: logAnalytics` + `retentionDays` | Diagnostic settings on every Foundry resource, gateway and Search service |
| `audit.includePromptContent: false` | Forced false at `confidential` and above — otherwise the audit log becomes a copy of everything users typed |
| `audit.specChangeLog: git` | Every apply records commit SHA, plan hash, gates fired, who cleared them |
| `audit.recordGateDecisions: true` | Gate decisions land in the same store as runtime telemetry |

The repo history is the orchestration-layer audit trail. "Who gave this agent
write access to the matter system, and who approved it" is answered by
`git log`, not by reconstructing it from ARM activity logs six months later.

### 5. Data is information, not instructions

| Spec | Compiles to |
|---|---|
| `knowledge[].trust: untrusted` (const) | Retrieved content is framed as data in the agent contract, never as instruction |
| `dataHandling.treatToolOutputAsUntrusted` | Same for tool results |
| `dataHandling.forbidPrivilegeEscalationFromContent: true` (const) | Deny-list assertion in the wrapper: no retrieved document or tool result may invoke a tool outside the declared list, or lower an approval threshold. Generated test suite includes an injection case per tool. |
| `dataHandling.contentSafety: required` | `llm-content-safety` at the gateway — covers prompts, completions and MCP traffic |

`tools[].effect` is the field the whole model hangs on. Understating it — calling
a write tool `read` — is the most consequential lie a spec can tell, because it
silently skips both the change gate and the runtime gate. Worth a review habit:
when reviewing a plan, check the effect declarations first.

---

## What changed because shared libraries are out

Dropping cross-workspace knowledge removed the single largest source of risk in
the design, and it removed it cleanly rather than by mitigation.

Each workspace gets its own index. Isolation becomes structural instead of
enforced at query time, which means:

- No dependency on AI Search permission filters, which are still preview after
  ~15 months and whose fail-open/fail-closed behaviour on a missing token is
  documented inconsistently by Microsoft.
- No on-behalf-of token plumbing through MCP, and no need to avoid the built-in
  AI Search tool (which queries as the project's managed identity and cannot
  carry a user identity at all).
- Better retrieval relevance, since term-frequency statistics are computed per
  index and are no longer contaminated by other workspaces' documents.
- The whole path is GA.

The cost is duplicated storage where two workspaces genuinely need the same
corpus, and one indexer run each. That is a real cost and it is the right trade:
duplicating a corpus is cheaper than being wrong about who can read it.

Where two workspaces need the same documents, the spec expresses that as two
`knowledge` entries pointing at the same `source.uri` with different `index`
names. The generator can share one indexer definition across them.

`store` is a const with one permitted value rather than an enum with one option,
so the decision is recorded in the schema itself and any future attempt to add
sharing has to be a deliberate schema change with a reason attached.

---

## Validation rules the schema cannot express

These belong in the validator, not the schema, and each one exists because
getting it wrong produces a workspace that looks correct and fails in a way
that is hard to diagnose:

1. `access.role: Foundry Agent Consumer` with `access.scope: agentApplication`
   → **error**. Agent Consumer does not grant invoke on a published Agent
   Application; that needs Foundry User. Symptom is a 403 for every user on a
   workspace that looks configured.
2. Distinct model deployments per Foundry resource > 32 → **error**, before apply.
3. Total workspaces with `knowledge` entries > the Search tier's index ceiling
   → **error**. Standard is 50.
4. `model.limits` declared while the resource's `aiGateway.mode: none`
   → **error**. The limit has nowhere to be enforced.
5. Any workspace `governance` value that widens an estate control → **error**.
   Tightening only, always.
6. `publish.asAgentApplication: true` → the plan must re-emit every RBAC grant
   against the new Agent Application. Permissions do **not** transfer on publish.
7. A tool with `effect: write` or `external` and no matching runtime gate
   → **error**.
8. `metadata.tenantId` ≠ the signed-in tenant → **refuse to apply**. The only
   guard against deploying one client's estate into another's tenant, which is
   the failure mode that matters most when the same spec shape ships to several
   clients.
