# Starfish Memory — the Linked Evidence Wiki (revised model)

> **Status:** design, for Scott's review before code (2026-07-15). Supersedes the "canonical knowledge =
> flat entity map, wiki = optional view, relationship graph deferred" shape in
> `starfish-memory-architecture` — the linked wiki is now the **primary** structure, and reads/writes are
> gated by two dedicated agents.
>
> **Principle (unchanged):** *nothing is remembered because an LLM said it.* Everything traces to evidence,
> passes governance, and exists as a versioned object with provenance. Default-deny for knowledge.

## Why the change

The old canonical layer was a `Map` of entities with no edges and the relationship graph deferred — a
provenance-stamped **junk drawer**. A *fully linked* evidence wiki fixes two things at once:

- **Correctness:** one **canonical page per entity** (dedup), contradictions surface *on the page*
  (conflicting evidence weakens the claim), provenance is one hop away. The model reasons over reconciled,
  sourced facts instead of scattered stale copies.
- **Tokens:** links enable **precise subgraph retrieval** — load the relevant page plus its directly-linked
  neighbours, not a blob or a fuzzy vector top-k full of redundancy. (This is the GraphRAG / entity-centric
  memory pattern.) Savings only hold with **bounded, ranked traversal** — unbounded "follow every edge"
  re-bloats context, so traversal is depth-capped and relevance-ranked, always.

## The three tiers (unchanged scope, sharper long-term)

1. **Short-term / working memory** — the current task's in-context set (brief + tool calls + *bounded* tool
   results) carried by the `AgentLoop`, capped by the `TokenGovernor`; plus `TaskLedger` ("Mission Memory")
   and the `DecisionBroker` pending state. Ephemeral. The model is a **proposer, not a store**.
2. **Evidence substrate** — the hash-chained, append-only **audit log**: immutable, provenance-stamped. This
   is Layer-1 Evidence and the durable spine the wiki is built from.
3. **Long-term knowledge = the Linked Evidence Wiki** (below). The source of truth — not markdown, not a
   flat map.

## The Linked Evidence Wiki

- **Pages = canonical Entities.** One page per real thing (person, project, decision, fact), deduplicated,
  each carrying provenance (which claim, which evidence).
- **Typed, governed links = first-class edges** between pages: `supports`, `contradicts`, `depends-on`,
  `supersedes`, `part-of` (extensible). **A link is itself an evidence-backed claim** — it goes through the
  same gate, so the graph can't be poisoned by an LLM asserting an edge.
- **Evidence + audit stay the substrate + provenance.** The wiki is *derived and governed*, never
  hand-asserted.
- **Pipeline (unchanged, now producing a graph):** Evidence → Claim (proposed, confidence, `supportedBy`;
  conflicting evidence weakens) → **governance gate** (low-stakes + high-confidence auto-approves, audited;
  else queued for an approver; policy may deny) → **promote to a Page** and/or **a typed Link** → **Decision
  Registry** for "why X?".

### Retrieval (cheap by default — this is where the token win lives)

1. **Entry-point find:** a light **keyword/title index** now; **local embeddings built only from *approved*
   pages** later (never raw chat) when scale demands.
2. **Bounded traversal:** from the entry page, walk typed links **depth-capped + relevance-ranked**.
3. **Govern the read:** redaction + **need-to-know scoping** (which requester may see which knowledge) +
   confidentiality/taint checks.
4. **Token cap:** hand back only the ranked subgraph, within a budget. No blob, no full-store dump.

## The two dedicated agents

### Herodotus — the Recorder (SOLE WRITER)
The **only** capability permitted to write memory. He can: add evidence, propose claims, create/modify
typed links, request promotion. He is a **governed scribe, not an oracle** — he *proposes*; the
deterministic gate + policy + human approver decide what is promoted. Enforcements:
- **Least privilege:** Herodotus holds `memory:write` and nothing else — no fs, shell, or net.
- **Proposer ≠ approver holds:** worker agents never write memory; they submit evidence to Herodotus;
  Herodotus proposes; the gate/human approves promotion.
- **Fully audited:** every write is `actor=herodotus`, on the hash-chained log, with provenance.
- **Single choke point:** one auditable hand touches the store → "nothing remembered because an LLM said it"
  is enforced at the *agent* level, not just the data level.

### Thucydides — the Critical Reader (READ PATH)
Reads become a governed capability for the first time — symmetric with writes — **without** putting an LLM
on the hot path. Two layers:
- **Default: a deterministic retrieval *gate* (no LLM).** Every read goes through the retrieval steps above
  (entry-point → bounded ranked traversal → redaction/need-to-know → token cap). Fast and cheap.
- **On demand: Thucydides-the-*agent* (analytical mode).** Invoked only when a caller wants *interpretation*
  — weigh source credibility, surface contested / low-confidence claims, synthesise across pages. He never
  runs on a plain lookup, so ordinary reads cost no model tokens.
- **Audited:** reads recorded under the requester + `served-by=thucydides`, so access is traceable.

**Why split him:** a mandatory LLM reader on every access would re-add the latency + token bloat we're
trying to remove. The deterministic gate delivers the read-governance (scope, redaction, bounded retrieval)
cheaply; the agent adds judgement only when asked.

## How this serves the goals
- **Tokens:** precise subgraph retrieval + bounded traversal + a cheap deterministic read path + canonical
  dedup = the minimum correct context, not a blob.
- **Correctness:** canonical pages, surfaced contradictions, mandatory provenance, governed links.
- **Governance:** writes and reads are both least-privilege, single-choke-point, fully audited; proposer ≠
  approver preserved; default-deny for knowledge.

## Open decisions (Scott's call)
1. **Thucydides shape** — deterministic gate + optional analyst agent (**recommended**) vs. a full agent on
   every read (rejected: re-adds tokens/latency).
2. **Store** — file-based linked wiki now (**recommended**) → local embeddings for entry-point when scale
   demands → **defer SQLite/graph store** until files strain (the existing "revisit when we get there" note).
3. **Link taxonomy** — confirm the starter set (`supports`, `contradicts`, `depends-on`, `supersedes`,
   `part-of`) and whether links carry their own confidence.

## Staged build
- **Phase 1:** file-based linked wiki (pages + typed governed links over the existing evidence→claim→gate
  pipeline); **Herodotus** write path (sole `memory:write`); **deterministic Thucydides read-gate** (entry
  index + bounded ranked traversal + redaction + token cap). Wiki becomes the primary structure.
- **Phase 2:** optional **Thucydides analyst** mode; **local embeddings** on approved pages for entry-point.
- **Phase 3 (deferred):** SQLite/graph store when the file-based graph strains; vector recall at scale
  (embeddings only from approved knowledge).
