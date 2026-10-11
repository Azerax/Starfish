# Next: the messy-drive problem

Decision 2026-08-31: **the hierarchy restriction stays strict — no override.**
If a folder cannot move, the two agents share one audience, which is a different
design rather than a waived rule. The canvas now says so in the gate.

Which means the canvas will regularly tell a client "your drive is the wrong
shape", and something has to answer that. This is the next tool.

## Why it matters more than it sounds

Scott's own framing was that most companies' knowledge store is one big drive.
Real ones are twenty years of `Shared Documents` with duplicates, dead projects
and no consistent structure. The canvas's rule is correct and will block on
almost every real tenant. **Drive shape is the adoption blocker, not the
architecture.**

## The move-versus-project fork

The obvious answer is "reorganise the drive". It is also the hardest thing to
sell: moving files on a live SharePoint breaks links, muscle memory, saved
searches and often permissions, and it needs sign-off from every team whose
folders move.

The likely better answer is **don't move anything — project instead**. Build a
purpose-shaped blob container whose folder layout matches the containers on the
canvas, and populate it by copying selected documents from the messy source.
Humans keep using the drive they know; the agents read the clean projection.

| | Reorganise in place | Projection container |
|---|---|---|
| Client disruption | High — links and habits break | None |
| Sign-off needed | Every affected team | Storage owner only |
| Storage cost | None | Duplicated for indexed content |
| Freshness | Native | A sync lag, and deletions must propagate |
| Source ACLs | Preserved | **Lost** — the projection needs its own model |
| Reversible | Painful | Delete the container |

The ACL row is the one to think hardest about. In the projection model the
folder layout carries the whole access decision, which is exactly the design the
canvas already enforces — so it fits. But a document that was restricted at
source becomes as readable as its projected folder, and nothing warns you.

**Unverified.** I have not researched the copy mechanics — azcopy, Data Factory,
Logic Apps, SharePoint→blob migration tooling, incremental sync, deletion
propagation. Do that before committing to the projection model.

## What the tool would need to do

1. **Survey** — walk the drive, emit the tree with per-folder counts, sizes,
   last-modified spread and file types. Read-only, safe, cheap. Useful on its
   own as an engagement opener.
2. **Cluster** — group documents by what they actually are rather than where
   they sit. This is the step that needs a model, and it is where the value is:
   it shows the boundaries that *want* to exist.
3. **Propose** — map the clustering onto the containers already drawn on the
   canvas, producing a target layout that satisfies the hierarchy rule by
   construction.
4. **Dry run** — show every document's current and proposed home, flag the
   ambiguous ones, and count what stays unclassified. Nothing executes until
   this is read.
5. **Execute** — copy into the projection container, or move in place. This step
   is destructive in one of the two modes and needs the same change-gate
   treatment as everything else: reviewed, approved, recorded.

Steps 1 and 2 are worth building alone. A survey plus a clustering report is a
paid discovery engagement whether or not anyone ever runs step 5.

## Sequencing

The canvas assumes a clean drive. The remediation tool produces one. So in a
real engagement the order is: survey → cluster → agree the target layout → draw
it on the canvas → deploy. The canvas is currently step four of five and needs
the first three to be useful outside a demo.
