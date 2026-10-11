# The tool: built, tested, unrun

Autonomous session 2026-08-31. Delivered as `estate-tool.tar.gz`.
Node 22 + TypeScript, no build step, one dependency (`yaml`), runs on Windows.
~3,800 lines, **96 tests passing**.

## Commands

```
estate validate  <specDir>                        12 structural rules
estate preflight --tenant --subscription          check permissions before the call
estate scan      --tenant --subscription [--record dir]
estate scan      --fixture <observations.json>    replay, no tenant needed
estate map       [<specDir>] [--no-spec]          interactive HTML
estate summary   [<specDir>] [--no-spec]          markdown for the follow-up email
```

## Two modes, and why it matters

**Discovery** (`--no-spec`) is the first engagement: scan a prospect nobody has
specced. Drift-relative findings are *suppressed*, not reworded — "6 workspaces
exist that no spec claims" is true and useless when there is no spec. What
survives is absolute: key auth bypassing RBAC, ungated write/external tools,
permission-filtered indexes, account-scope grants, agent chains, unresolved
principals.

**Diff** compares spec against tenant. Both render as HTML and markdown.

## Six bugs found and fixed during the build

1. **Scope vocabulary false positive.** Spec says `agentApplication`, ARM says
   `agent`. The differ compared raw strings and flagged 3 of 4 correctly
   configured workspaces. Added `canonicalScope()`. A false positive in a
   client-facing tool costs you the room.
2. **Dropped agent-to-agent edges.** Single pass over agents built edges before
   later peers existed — silently losing the orchestration chains the rules most
   want to see. Two passes now.
3. **Misleading fan-out count.** One account-scoped grant reported as "5
   workspaces granted too widely". Now: "1 group is granted at account scope —
   reaches 5 workspaces."
4. **Effect over-called.** `inferEffect()` matched the whole URL against a
   pattern containing `http`, so every https tool came back "external". Now
   matches name/type plus hostname.
5. **Scaling failure.** At 120 workspaces the map drew 1,319 edges (hairball)
   and marked every workspace. Fan-out edges now collapse to a count on the
   group and draw only on selection. 1,319 → 109 edges. Renders in 730 ms.
6. **Marks outliving their findings.** Rules called `mark()` as a side effect,
   so suppressing a finding left its warning markers behind — discovery mode
   painted 22 of 44 nodes red for drift it had stopped reporting. Marks now
   derive from surviving findings.

## Three things the API research changed

- **Azure Resource Graph cannot see Foundry projects** — only `accounts`. ARG
  does the account sweep; everything below is per-account ARM paging.
- **MCP tools carry `require_approval` (default "always")** — so the tenant CAN
  report a gate. Gating is now three-valued: confirmed-ungated is high severity
  and a fact; unconfirmable is medium and phrased as a question. Non-MCP tools
  record nothing.
- **Draft agents are excluded from `GET /agents` by default.** Collector passes
  `include_drafts=true`; a shadow agent is exactly the thing likeliest to be a
  draft.

Also: Search must be read at `2026-05-01-preview` — `permissionFilter` is
*absent*, not null, at stable, so a stable scan reports every shared index as
dedicated. And Search needs **Reader**, not Search Index Data Reader.

## Blocker: nothing has ever run against a live tenant

Parsing is tested; the network half is assumption. Four blockers with five
scored solutions each are in `BLOCKERS.md`. The answer to all of them is the
same half-day: **a free Azure trial tenant with one Foundry resource**, which
settles blocker 1 (collectors work), blocker 2 (Lighthouse cross-tenant) and
blocker 3 (the `/agents` vs `/applications` join) in one sitting.

Built two mitigations rather than only recommending them: `--record` turns the
first live run into permanent fixtures, and `estate preflight` checks every
permission before you are on a call.

## Still open

- `aiGatewayApimId` is always null — APIM is not queried, so the map cannot show
  which workspaces have enforceable token limits.
- One ARM api-version constant covers resource types documented at different versions.
