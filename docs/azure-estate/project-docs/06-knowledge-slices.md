# Knowledge slices — the model that resolves the shared-store problem

2026-08-31. Scott's framing: *"for most companies their knowledge store right
now is the same large drive somewhere, but the container db would only contain
what is relevant there."* Then: *"each container, even shared, should have a
specific use case… I want to enforce it, this way you don't get your marketing
LLM talking about payroll."*

Both are right, and together they replace the design I had been defending.

## The model

**One drive. N containers. Each indexes only its own folder slice.**

- The **source** is shared — the existing SharePoint site or ADLS/Blob container.
- The **scope** lives on the *edge* between a drive and a container. "Which part
  of the drive" is a property of the relationship, not of the drive or the
  container.
- Each slice becomes that container's **own index**, holding only that folder.

## Why this is better than what I proposed before

Earlier I distinguished "private index" (safe, GA) from "shared index with
permission filters" (preview, dangerous) and recommended never sharing. This
model makes the second option unnecessary rather than forbidden:

Documents outside the slice are **physically absent** from the index. There is
nothing to leak and no runtime filter to get wrong. A bug in the query layer
exposes only in-slice content. That is strictly stronger than filter-based
trimming, which is a runtime correctness dependency.

**The folder boundary IS the access boundary.** Pair it with Search Index Data
Reader per container identity and the index boundary is also the authz boundary.
All GA.

## Enforcement: prefix overlap

Two slices collide when one folder contains the other. That is a string
comparison on path segments, done at design time — before deploy, not at query
time. Implemented in the canvas as a gate that blocks.

- `hr` vs `hr/payroll` → **collision**. HR assistant can read Payroll's docs.
- `hr` vs `hr-archive` → no collision (segment-aware, not naive `startsWith`).
- `""` (empty) → the root, contains everything. Always blocks.
- Same container, two folders → fine, not a collision.

Each container also carries a **purpose**, so the block message reads
"HR assistant (Policy and handbook questions) can read Payroll support's
documents" rather than naming two paths.

## Where the reasoning breaks — say it out loud

When two users **inside the same slice** need to see different documents. The
folder boundary is then coarser than the access boundary, and you are back to
document-level permission filters, which are preview. Two sub-cases:

1. A slice holds mixed-sensitivity content (`hr/` with both handbook and comp).
2. Permissions change but the index does not — no automatic ACL sync; needs
   `POST /indexers/{name}/resync` with `{"options":["permissions"]}`.

The fix for case 1 is usually to slice finer — which is another container.

## Corrections to earlier advice in this project

- **"One data source, many indexers" was wrong.** The scope prefix
  (`container.query`) is a property of the **data source**, not the indexer. N
  different slices = N data sources + N indexers + N indexes.
- **"Workspaces are cheap" was wrong.** Each slice consumes one index, one
  indexer, one data source and one skillset, and all four share the same per-tier
  ceiling: **S1 = 50, S2/S3 = 200**. S3 HD gives more indexes but its indexer
  support is preview and is documented as unsuitable for real skillsets. Tier
  choice caps workspace count.

## What to actually generate

**Blob knowledge source (GA, `2026-04-01`)** with `folderPath` — one object that
auto-provisions `{name}-datasource`, `{name}-indexer`, `{name}-skillset` and
`{name}-index`, with chunking and vectorisation already configured. Collapses
four API calls and a hand-rolled skillset into one declaration.

```yaml
- kind: azureBlob
  name: ks-hr-assistant
  containerName: company-drive
  folderPath: hr/policies
```

SharePoint indexing is **preview**, needs a sign-up form, and Microsoft's own
docs steer to the remote SharePoint knowledge source or Copilot Studio for
production. Build on Blob/ADLS for anything GA-grade.

## Operational gotchas that must reach the UI

- **Narrowing a folder path does not remove already-indexed documents.** A scope
  change must trigger a rebuild + indexer reset, never an in-place edit. Front
  each index with an alias so agents do not break during the rebuild.
- **Deletion detection does not work with chunked indexes / index projections.**
  Any modern RAG index is chunked, so deletions need explicit handling via the
  Documents REST API.
- The `container.query` prefix is the **only** trustworthy isolation lever.
  Extension filters and skillsets are cosmetic from a security standpoint.
- Index projections (GA) enrich once and fan out to many indexes — but there is
  no documented per-selector routing, so they do *not* solve one-drive-many-
  slices. Do not design around them.
- Min indexer schedule 5 min; max 1440. Stagger `startTime` across indexers.

## Sharing, disambiguated

Three things get called "sharing" and only one is risky:

| | What it is | Verdict |
|---|---|---|
| Shared **LLM** | One model deployment several containers call | Fine. Carries no data between them. |
| Shared **source** | One drive, N separate slice-indexes | **Best.** Structural isolation. |
| Shared **index** | One index, N callers, runtime trimming | Preview API, needs user-token passthrough. Avoid. |

The canvas allows the first two and makes the third impossible to express.
