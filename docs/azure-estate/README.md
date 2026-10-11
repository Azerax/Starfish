# Azure AI estate — design docs, spec and tool notes

Exported 2026-09-01 from the "AzureUi" Claude project. Everything here was
produced 2026-08-31 to 2026-09-01.

## What this is

A design-time system for laying out a company's LLM architecture on Azure
(Microsoft Foundry) and proving it was built the way it was drawn:

- **Canvas** — draw containers, agents, folder slices and access groups
- **Spec** (`spec/`) — the estate as YAML, schema-validated
- **Validator** — 13 rules the schema cannot express
- **Collector + differ** — scan a live tenant, diff intended against actual
- **Starfish change gates** — the plan diff is the governance surface

## Layout

```
project-docs/    the decision record, in reading order
spec/            estate.schema.json, estate.yaml, workspaces/*.yaml
tool-notes/      README, BLOCKERS, FIXTURES, WORKLOG for the scanner
*.html           canvas and pre-implementation checklist prototypes
```

## Reading order

Start at `project-docs/05-course-correction-canvas.md` if you want the
shortest path to what the thing actually is. Start at `01` if you want the
Azure research behind it.

| # | Doc | What it settles |
|---|---|---|
| 01 | reference-architecture | Foundry resource model, access traps, knowledge layer |
| 02 | pivot-to-estate-map | Competitive check — what Defender/Wiz already do |
| 03 | estate-spec-v1 | What Foundry does in the box; what's left to build |
| 04 | estate-tool-build | The scanner: six bugs found, what the APIs actually return |
| 05 | course-correction-canvas | The canvas is the product, not the scanner |
| 06 | knowledge-slices | One drive, N containers, each indexing its own folder |
| 07 | agents-and-slices | Focus vs leak — nesting inside vs across containers |
| 08 | hierarchy-rule | Why a new container is only half the fix |
| 09 | preflight-and-signoff | Drive tree map, customer sign-off as a change gate |
| 10 | next-drive-remediation | The messy-drive problem, unbuilt |
| 11 | commercial-model | Tenant access, CSP, Managed Apps, PTU pooling, pricing |

## The three decisions that constrain everything else

1. **No shared knowledge stores.** Every workspace gets its own index.
   `store` is a schema `const`, not an enum — reversing this requires a
   deliberate schema change, not a config toggle.
2. **Paths in the same directory hierarchy require a new container** — and
   the folder must also move on the drive, because Azure prefix scoping has
   no exclusion. Strict, no override.
3. **The plan diff is the governance surface.** Everything the estate can do
   is in YAML, so every change is diffable, gateable and recordable.

## Status

The scanner is built and tested (~3,800 lines, 96 tests) but **has never run
against a live Azure tenant**. `tool-notes/FIXTURES.md` is the plan for
fixing that — 17 rules mapped to the minimum Azure objects that provoke each,
with teardown. Nearly all of it is free.

The tool source itself is not in this folder; it was delivered separately as
`estate-tool.tar.gz`.
