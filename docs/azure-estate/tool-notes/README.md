# estate

Design a company's AI estate on Microsoft Foundry, scan a real tenant, and diff
the two.

Node 22, TypeScript, no build step, one runtime dependency (`yaml`). Runs on
Windows/PowerShell.

```
npm install
npx tsx src/cli.ts --help
```

---

## What it does

Two graphs of identical shape:

- **Intended** — built from a spec directory (`estate.yaml` + `workspaces/*.yaml`).
- **Actual** — collected from a live tenant by four read-only collectors.

Diffing them produces one graph where every node and edge is `match`, `planned`
(declared, not deployed) or `undeclared` (in the tenant, nothing claims it), plus
a set of findings and an interactive map.

`undeclared` is the finding that sells an engagement. It is the only thing on the
map that nobody can produce from documentation.

## Commands

```
estate validate  <specDir>
    12 structural rules over the spec. Exit 1 on any error.

estate preflight --tenant <id> --subscription <id> [--search <service>]
    Check every permission a scan needs, before you are on a call.

estate scan      --tenant <id> --subscription <id> [--record <dir>] [-v]
estate scan      --fixture <observations.json>
    Run the collectors, or replay a recorded scan.

estate report    <specDir> [--fixture <f>] [--json] [--out report.json]
estate map       <specDir> [--fixture <f>] [--out map.html]
    Diff, run the drift rules, and render.
```

Try it with no tenant at all:

```
npx tsx src/cli.ts map ../estate-spec --fixture fixtures/contoso/observations.json --out map.html
```

## Architecture

```
spec/*.yaml ──► buildIntended ──┐
                                ├─► diffGraphs ──► runRules ──► report ──► render
collectors  ──► buildActual  ───┘
```

| File | Does |
|---|---|
| `model.ts` | node/edge types, deterministic ids, `canonicalScope` |
| `spec/load.ts` | typed YAML loader |
| `spec/validate.ts` | the 12 rules |
| `spec/intended.ts` | spec → graph |
| `collect/types.ts` | the collector contract — everything normalises to this |
| `collect/{arm,graph,foundry,search}.ts` | the four collectors |
| `collect/replay.ts` | fixture-backed collector, no tenant needed |
| `actual.ts` | observations → graph, effect and gate inference |
| `diff.ts` | the merge, and conflict detection |
| `rules.ts` | 15 drift rules |
| `render.ts` | standalone interactive HTML |

### The collectors, and why there are four

| Collector | Reads | Permission | Why it cannot be skipped |
|---|---|---|---|
| `arm` | accounts, projects, deployments, connections, role assignments | Reader | Everything else keys off its output |
| `graph` | group names and member counts | `Directory.Read.All` | Without it, access is object ids and orphan detection is off |
| `foundry` | agents, tool bindings, knowledge, model bindings | Foundry User | **Not in ARM.** This is where undeclared workspaces live |
| `search` | index definitions | Reader on the service | **Cannot be expressed in ARM at all** |

Half the interesting edges are data-plane. A tool built on Azure Resource Graph
alone draws Foundry accounts and projects as generic boxes and none of the agent,
tool or index edges — which is what every existing Azure diagramming product
does today.

## Decisions worth not relitigating

**Deterministic ids on both sides.** If the intended and actual graphs disagree
about an id, the diff invents a spurious planned+undeclared pair instead of a
match. `canonicalScope()` exists because the spec says `agentApplication` and ARM
says `agent` — comparing raw strings flagged every correctly configured
workspace.

**Tools are keyed per workspace.** `matter-lookup` on legal-research is a
different binding from the same name on hr-assist: different managed identity,
different grants, different blast radius.

**Account-scoped grants are fanned out.** An account-scoped assignment reaches
every project on the resource; drawing only the assignment would understate the
blast radius. The *rules* still count it as one misconfiguration, and the map
draws the fan-out only on selection — the number is the finding, the lines are
its evidence.

**Effect is inferred pessimistically, and always marked as inferred.** A tenant
records what a tool *is*, never what it is *for*.

**Gates are three-valued, not two.** MCP bindings record `require_approval`, so
"ungated" there is a fact and reports as high severity. Every other tool type
records nothing, so the answer is `undefined` — reported separately, one severity
lower, phrased as a question to ask. Accusing a tool that is gated in the calling
app is how a report loses the room.

**Search is read at a preview api-version by default.** `permissionFilter` is
absent — not null, absent — at the stable version, so a stable scan reports every
shared index as dedicated. That is a false negative on the finding the design
most wants to catch.

**A partial scan says so, loudly.** Every collector degrades to a caveat rather
than an empty list, and the `scan-incomplete` finding always sorts first. A scan
that quietly returns less than it should looks exactly like a clean tenant.

## Tests

```
npm test          # 82 tests
npm run typecheck
```

They cover the parsing and the graph logic, which is all of the risk that can be
tested without a tenant. There are deliberately **no HTTP mocks**: a mock built
from my own reading of the docs would assert my assumptions back at me and
produce false confidence. The network half is covered by `BLOCKERS.md` instead.

Three tests are named regressions for bugs found during the build: the scope
vocabulary false positive, the dropped agent-to-agent edges, and the
account-scope fan-out miscount.

## Stress testing

```
npx tsx tools/synth.ts --workspaces 120 --out /tmp/big
npx tsx src/cli.ts map /tmp/big --fixture /tmp/big/observations.json --out /tmp/big/map.html
```

At 120 workspaces the graph is 713 nodes and 1,909 edges and renders in ~730 ms.
The right-hand column rolls up above 46 nodes and expands on selection; fan-out
edges collapse to a count on the group.

## Not done

- No collector has ever run against a live tenant. See `BLOCKERS.md`.
- `aiGatewayApimId` is always `null` — APIM is not queried yet, so the map cannot
  show which workspaces have enforceable token limits.
- One ARM api-version constant covers several resource types that are documented
  at different versions.
