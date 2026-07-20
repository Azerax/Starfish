// Thucydides — the deterministic read gate over the Linked Evidence Wiki.
//
// Reads are a governed capability, symmetric with writes, WITHOUT putting an LLM on the hot path.
// A mandatory model reader on every access would re-add the latency and token bloat the wiki exists
// to remove, so the default path is this deterministic gate: entry index -> bounded ranked traversal
// -> need-to-know redaction -> token cap. The analytical Thucydides agent is Phase 2 and is invoked
// only when a caller explicitly wants interpretation.
//
// This module is typed against the read-only `WikiView`, never against `EvidenceWiki`. That is
// deliberate: the type system, not a convention, prevents the read path from ever mutating the
// store. "Thucydides reads, Herodotus writes" is structural here.
//
// What it refuses:
//   T2  — every body is injection-screened on the way OUT and returned inside a non-authoritative
//         delimiter. Memory is a durable injection channel; screening only on write is not enough,
//         because content written before a screening rule existed is still there.
//   T15 — hard depth / node / edge / token budgets with cycle detection. Retrieval is O(bounded) by
//         construction, so a dense or cyclic graph cannot become a cost-DoS.
//   T16 — need-to-know. A page above the requester's clearance is withheld, and an egress-capable
//         requester cannot read sensitive pages at all.
//   T17 — entry ranking is driven by provenance and confidence, NOT by how many times a term appears.
//         Keyword-stuffing a title cannot make a poisoned page the entry point for every query.
//   T12 — `contradicts` edges get a RESERVED node budget and are exempt from ranked truncation.
//         Without this carve-out the cheapest implementation of T15's pruning silently becomes
//         T12's attack: the low-confidence contradiction is always the first thing dropped.
import type { AuditLog } from './audit';
import { screenIngress } from './taint';
import {
  CONFIDENTIALITY_RANK, DEFAULT_RETRIEVAL_BUDGET, MAX_RETRIEVAL_BUDGET, MEMORY_DATA_CLOSE,
  MEMORY_DATA_OPEN, REDACTION_MARK, UNKNOWN_CLEARANCE_RANK, UNKNOWN_PAGE_RANK,
  type Confidentiality, type Link, type Page, type PageVersion, type RetrievalBudget,
  type RetrievalRequest, type RetrievalResult, type RetrievedPage, type TruncationReason,
  type WikiView,
} from './wikitypes';

/** Deterministic, locale-independent token estimate. Deliberately crude and stable: the budget must
 *  be a pure function of the text, not of a tokenizer version. */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function rankOfPage(c: unknown): number {
  return (typeof c === 'string' && c in CONFIDENTIALITY_RANK)
    ? CONFIDENTIALITY_RANK[c as Confidentiality]
    : UNKNOWN_PAGE_RANK;                       // unknown label -> maximally restricted
}

function rankOfClearance(c: unknown): number {
  return (typeof c === 'string' && c in CONFIDENTIALITY_RANK)
    ? CONFIDENTIALITY_RANK[c as Confidentiality]
    : UNKNOWN_CLEARANCE_RANK;                  // unknown clearance -> cleared for nothing
}

/** Clamp a caller-supplied budget into the absolute ceilings. A hostile or careless caller cannot
 *  widen its own traversal (T15). */
export function resolveBudget(partial?: Partial<RetrievalBudget>): RetrievalBudget {
  const pick = (k: keyof RetrievalBudget): number => {
    const v = partial?.[k];
    const fallback = DEFAULT_RETRIEVAL_BUDGET[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return fallback;
    return Math.min(Math.floor(v), MAX_RETRIEVAL_BUDGET[k]);
  };
  return {
    maxDepth: pick('maxDepth'), maxNodes: pick('maxNodes'), maxEdges: pick('maxEdges'),
    maxTokens: pick('maxTokens'), reservedContradictionNodes: pick('reservedContradictionNodes'),
  };
}

function terms(query: string): string[] {
  return String(query ?? '').toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t.length > 2);
}

function currentOf(p: Page): PageVersion | undefined {
  return p.versions?.[p.current - 1];
}

/** A page is servable only if it is live, not merged away, and its current revision is clean. */
function servable(p: Page): { ok: boolean; why?: TruncationReason } {
  if (p.retired) return { ok: false, why: 'retired' };
  if (p.mergedInto) return { ok: false, why: 'retired' };
  const v = currentOf(p);
  if (!v) return { ok: false, why: 'retired' };
  if (v.quarantined) return { ok: false, why: 'quarantined' };   // screened-positive, never served
  return { ok: true };
}

/**
 * T17 — entry ranking. A page must MATCH to be a candidate at all, but match strength does not
 * contribute to its score: the ordering is provenance and confidence. Repeating a keyword thirty
 * times in a title therefore buys an attacker candidacy, never rank.
 */
function entryScore(p: Page, v: PageVersion): number {
  const conf = Math.round(Math.max(0, Math.min(1, v.confidence)) * 100);
  const provenance = Math.min(20, (v.evidence?.length ?? 0) * 5);
  return conf + provenance;
}

function matches(p: Page, v: PageVersion, q: string[]): boolean {
  if (q.length === 0) return true;
  const hay = `${p.name} ${v.title}`.toLowerCase();
  return q.some((t) => hay.includes(t));
}

/** Apply need-to-know (T16) and injection screening (T2) to one revision's body. */
function serve(
  p: Page, v: PageVersion, req: RetrievalRequest,
): { withheld: boolean; body: string; redacted: boolean; reasons: string[] } {
  const pageRank = rankOfPage(v.confidentiality);
  const readerRank = rankOfClearance(req.clearance);

  if (pageRank > readerRank) {
    return { withheld: true, body: '', redacted: true, reasons: ['above requester clearance'] };
  }
  // An egress-capable requester could forward whatever it reads off-box, so sensitive knowledge is
  // withheld from it outright rather than merely redacted.
  if (req.egressCapable && pageRank >= CONFIDENTIALITY_RANK.sensitive) {
    return { withheld: true, body: '', redacted: true, reasons: ['egress-capable requester may not read sensitive knowledge'] };
  }

  const screen = screenIngress(v.body, {});
  const reasons: string[] = [];
  let body = v.body;
  if (!screen.ok) {
    // Strip the offending lines rather than the whole page: the benign remainder is still useful,
    // and returning nothing would let an attacker censor a page by injecting into it.
    body = v.body.split('\n')
      .map((line) => (screenIngress(line, {}).ok ? line : REDACTION_MARK))
      .join('\n');
    reasons.push(...screen.reasons);
  }
  return {
    withheld: false,
    body: `${MEMORY_DATA_OPEN}\n${body}\n${MEMORY_DATA_CLOSE}`,
    redacted: !screen.ok,
    reasons,
  };
}

export interface ThucydidesOptions {
  audit?: AuditLog;
}

/**
 * The deterministic retrieval gate. Every read in the system goes through here — there is no
 * ungoverned read path (invariant 6).
 */
export function retrieve(view: WikiView, req: RetrievalRequest, opts: ThucydidesOptions = {}): RetrievalResult {
  const budget = resolveBudget(req.budget);
  const q = terms(req.query);
  const truncated = new Set<TruncationReason>();

  let edgesWalked = 0;
  let cyclesAvoided = 0;
  let tokensReturned = 0;
  let maxDepthReached = 0;
  let withheld = 0;

  const visited = new Set<string>();
  const out: RetrievedPage[] = [];
  const contradictions: RetrievedPage[] = [];

  // ---- entry points: ranked by provenance + confidence, deterministic tie-break by id ----
  // Pages excluded here record WHY. A page dropped silently at entry selection would make the
  // result read as "nothing matched" when the truth is "something matched and was withheld".
  const candidates: { p: Page; v: PageVersion; score: number }[] = [];
  for (const p of view.allPages()) {
    const v = currentOf(p);
    if (!v) { truncated.add('retired'); continue; }
    if (!matches(p, v, q)) continue;                 // simply not a match — not a truncation
    const s = servable(p);
    if (!s.ok) { if (s.why) truncated.add(s.why); continue; }
    candidates.push({ p, v, score: entryScore(p, v) });
  }
  const entries = candidates.sort((a, b) => (b.score - a.score) || a.p.id.localeCompare(b.p.id));

  // The general node budget leaves room for the reserved contradiction slots, so a full result set
  // can never crowd out the contradictions (correction #6).
  const generalBudget = Math.max(1, budget.maxNodes - budget.reservedContradictionNodes);

  interface Hop { page: Page; depth: number; via?: Link }
  const queue: Hop[] = entries.map((e) => ({ page: e.p, depth: 0 }));

  const admit = (page: Page, v: PageVersion, depth: number, via: Link | undefined, isContradiction: boolean): boolean => {
    const bucket = isContradiction ? contradictions : out;
    const cap = isContradiction ? budget.reservedContradictionNodes : generalBudget;
    if (bucket.length >= cap) { truncated.add('maxNodes'); return false; }

    const served = serve(page, v, req);
    if (served.withheld) { withheld += 1; truncated.add('clearance'); return false; }

    const cost = estimateTokens(served.body);
    // Contradictions are exempt from the token cap for the same reason they are exempt from node
    // ranking: budget pressure must never be the mechanism that hides a conflict.
    if (!isContradiction && tokensReturned + cost > budget.maxTokens) { truncated.add('maxTokens'); return false; }

    tokensReturned += cost;
    bucket.push({
      pageId: page.id, name: page.name, entityType: page.entityType, body: served.body,
      confidentiality: v.confidentiality, confidence: v.confidence, version: v.version,
      depth, via: via?.kind, redacted: served.redacted, redactionReasons: served.reasons,
      contradiction: isContradiction,
    });
    return true;
  };

  while (queue.length > 0) {
    const hop = queue.shift()!;
    const { page, depth } = hop;

    if (visited.has(page.id)) { cyclesAvoided += 1; continue; }   // T15 — cycle-safe by visited set
    visited.add(page.id);
    if (depth > maxDepthReached) maxDepthReached = depth;

    const s = servable(page);
    if (!s.ok) { if (s.why) truncated.add(s.why); continue; }
    const v = currentOf(page)!;

    const isContradiction = hop.via?.kind === 'contradicts';
    admit(page, v, depth, hop.via, isContradiction);

    if (depth >= budget.maxDepth) { truncated.add('maxDepth'); continue; }
    if (out.length >= generalBudget && contradictions.length >= budget.reservedContradictionNodes) break;

    // ---- rank neighbours by edge confidence x target confidence; contradictions go FIRST so they
    // are enqueued before any ranked truncation can bite ----
    const edges = view.linksFrom(page.id);
    const scored = edges.map((l) => {
      const target = view.getPage(l.to);
      const tv = target && currentOf(target);
      const rank = Math.round(Math.max(0, Math.min(1, l.confidence)) * 100)
        + Math.round(Math.max(0, Math.min(1, tv?.confidence ?? 0)) * 100);
      return { l, target, rank, contradiction: l.kind === 'contradicts' };
    }).sort((a, b) =>
      (Number(b.contradiction) - Number(a.contradiction)) ||
      (b.rank - a.rank) ||
      a.l.id.localeCompare(b.l.id));

    for (const e of scored) {
      if (edgesWalked >= budget.maxEdges) { truncated.add('maxEdges'); break; }
      edgesWalked += 1;
      if (!e.target) continue;
      if (visited.has(e.target.id)) { cyclesAvoided += 1; continue; }
      queue.push({ page: e.target, depth: depth + 1, via: e.l });
    }
  }

  const pages = [...out, ...contradictions];
  const result: RetrievalResult = {
    pages,
    truncated: [...truncated].sort(),
    stats: { nodesVisited: visited.size, edgesWalked, maxDepthReached, tokensReturned, cyclesAvoided },
    withheld,
  };

  // Invariant: every read is audited under the requester, served by Thucydides.
  opts.audit?.append({
    actor: req.requester, domain: 'memory', action: 'wiki:read', decision: 'allow',
    reason: `served ${pages.length} page(s)`,
    detail: {
      servedBy: 'thucydides', query: req.query, clearance: req.clearance,
      withheld, truncated: result.truncated, tokens: tokensReturned, edges: edgesWalked,
    },
  });

  return result;
}

/** Convenience wrapper binding a view and an audit log — the shape a host actually holds. */
export class ThucydidesGate {
  constructor(private view: WikiView, private audit?: AuditLog) {}
  retrieve(req: RetrievalRequest): RetrievalResult {
    return retrieve(this.view, req, { audit: this.audit });
  }
}
