// The Linked Evidence Wiki — Layer 4+ of governed memory: canonical pages, immutable versions, and
// typed governed links. Long-term knowledge lives here; GovernedMemory (Layers 1-3) remains the
// evidence -> claim -> gate pipeline that feeds it.
//
// This class COMPOSES GovernedMemory rather than extending it. Subclassing would need the four
// private stores widened to protected — growing the TCB surface of an existing Ring-1 class for no
// gain — and would let a wiki bug corrupt claim state through inherited methods. Wrapping would
// double the API surface, and two systems for similar tasks is not governance.
//
// Structural guarantees this file is responsible for:
//   T12 — nothing is ever hard-removed. Links are tombstoned, pages are retired, evidence is
//         untouched. A "forget" is a governed tombstone with provenance, not a chain break.
//   T13 — pages are versioned with immutable history. Supersede APPENDS a version and keeps the old
//         one readable, with the reason. There is no destructive in-place edit anywhere below.
//   T14 — merge and split are governed, dual-controlled, and reversible.
//   T2  — content is injection-screened on write. Screened-positive revisions are recorded but
//         flagged `quarantined` and never served (correction #4: quarantine is NOT deletion, or
//         T12's append-only guarantee breaks).
//   invariant 8 — only the configured sole writer may mutate anything here.
import { randomUUID } from 'node:crypto';
import type { AuditLog } from './audit';
import type { PolicyEngine } from './policy';
import { sha256 } from './hash';
import { screenIngress } from './taint';
import { GovernanceError } from './types';
import type { GovernedMemory } from './memory';
import { aggregateConfidence, type ConfidenceResult } from './confidence';
import { WikiGate, type GateVerdict, type WikiGateOptions } from './wikigate';
import {
  WIKI_SCHEMA, WIKI_SCHEMA_VERSION, type Confidentiality, type Link, type LinkKind,
  type MergeRecord, type Page, type PageVersion, type RestoreResult, type SplitRecord,
  type WikiSnapshot, type WikiView,
} from './wikitypes';

const sid = (p: string) => `${p}_${randomUUID().slice(0, 8)}`;

export interface PageContent {
  title: string;
  body: string;
  properties?: Record<string, unknown>;
  confidentiality?: Confidentiality;
}

export interface CreatePageInput extends PageContent {
  entityType: string;
  name: string;
  claimId: string;
}

export interface WikiWriteResult<T> {
  ok: boolean;
  verdict: GateVerdict;
  value?: T;
}

export interface EvidenceWikiOptions extends WikiGateOptions {
  soleWriter?: string;
}

/** Canonical, order-independent content hash for a page revision (T9 binds approvals to this). */
function contentHashOf(entityType: string, name: string, c: PageContent): string {
  return sha256(JSON.stringify({
    entityType, name,
    title: c.title,
    body: c.body,
    confidentiality: c.confidentiality ?? 'internal',
    properties: Object.fromEntries(Object.entries(c.properties ?? {}).sort(([a], [b]) => a.localeCompare(b))),
  }));
}

function canonicalHash(rows: { id: string }[][]): string {
  return sha256(rows.map((set) => [...set].sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => JSON.stringify(r)).join('\0')).join('\0\0'));
}

/** The envelope hash for a wiki snapshot, as a pure function of its contents. Exported so an
 *  operator (or a test) can verify a persisted store out of band without instantiating the wiki. */
export function wikiSnapshotHash(s: Pick<WikiSnapshot, 'pages' | 'links' | 'merges' | 'splits'>): string {
  return canonicalHash([s.pages, s.links, s.merges, s.splits]);
}

function frozenCopy<T>(v: T): T {
  const copy = JSON.parse(JSON.stringify(v)) as T;
  const freeze = (o: unknown): void => {
    if (o && typeof o === 'object') {
      Object.freeze(o);
      for (const k of Object.keys(o as Record<string, unknown>)) freeze((o as Record<string, unknown>)[k]);
    }
  };
  freeze(copy);
  return copy;
}

export class EvidenceWiki implements WikiView {
  private pages = new Map<string, Page>();
  private links = new Map<string, Link>();
  private merges = new Map<string, MergeRecord>();
  private splits = new Map<string, SplitRecord>();
  private readonly gate: WikiGate;
  private readonly soleWriter?: string;

  constructor(
    private audit: AuditLog,
    policy: PolicyEngine,
    private memory: GovernedMemory,
    opts: EvidenceWikiOptions = {},
  ) {
    this.gate = new WikiGate(audit, policy, opts);
    this.soleWriter = opts.soleWriter;
  }

  /** Invariant 8 — only Herodotus writes. The PDP is the outer enforcement point (herodotus is the
   *  only agent holding memory.write); this is the in-process backstop that makes it testable. */
  private guardWriter(actor: string, action: string): void {
    if (this.soleWriter && actor !== this.soleWriter) {
      this.audit.append({
        actor, domain: 'memory', action, decision: 'deny',
        reason: `only ${this.soleWriter} may write the wiki`,
      });
      throw new GovernanceError(`the wiki is write-restricted to ${this.soleWriter}; ${actor} refused`);
    }
  }

  /** Pull the governed confidence for a claim. An unknown claim has NO evidence, so it aggregates to
   *  zero and can never auto-approve — provenance is mandatory, not optional (invariant 2). */
  private confidenceFor(claimId: string): { confidence: ConfidenceResult; evidence: string[] } {
    const claim = this.memory.getClaim(claimId);
    if (!claim) return { confidence: aggregateConfidence([]), evidence: [] };
    return { confidence: claim.robust, evidence: [...claim.supportedBy] };
  }

  /** T2 — screen on write. Positive content is still stored (evidence and history are append-only)
   *  but flagged, and the read gate never serves a quarantined revision. */
  private screen(c: PageContent, actor: string): { quarantined: boolean; reasons: string[] } {
    const probe = `${c.title}\n${c.body}`;
    const s = screenIngress(probe, { audit: this.audit, actor });
    return { quarantined: !s.ok, reasons: s.ok ? [] : s.reasons };
  }

  // ---------------------------------------------------------------- pages

  createPage(input: CreatePageInput, proposer: string, approvers: string[] = []): WikiWriteResult<Page> {
    this.guardWriter(proposer, 'page:create');
    const { confidence, evidence } = this.confidenceFor(input.claimId);
    const contentHash = contentHashOf(input.entityType, input.name, input);

    const verdict = this.gate.evaluate({
      op: 'page:create', proposer, contentHash, confidence, entityType: input.entityType, approvers,
    });
    if (verdict.outcome !== 'approved') return { ok: false, verdict };

    const q = this.screen(input, proposer);
    const page: Page = {
      id: sid('page'), entityType: input.entityType, name: input.name, current: 1,
      versions: [this.version(1, input, contentHash, input.claimId, evidence, confidence, verdict, proposer, 'initial revision', q)],
    };
    this.pages.set(page.id, page);
    this.audit.append({
      actor: proposer, domain: 'memory', action: 'wiki:page-created', target: page.id, decision: 'allow',
      reason: input.name, detail: { entityType: input.entityType, quarantined: q.quarantined, contentHash },
    });
    return { ok: true, verdict, value: frozenCopy(page) };
  }

  /** T13 — supersede APPENDS a revision. The previous one stays readable, with the reason recorded.
   *  There is no code path in this class that edits a stored version in place. */
  supersedePage(pageId: string, content: PageContent, proposer: string, approvers: string[], reason: string, claimId?: string): WikiWriteResult<Page> {
    this.guardWriter(proposer, 'page:supersede');
    const page = this.pages.get(pageId);
    if (!page) throw new GovernanceError(`unknown page ${pageId}`);
    if (page.retired) throw new GovernanceError('cannot supersede a retired page');

    const boundClaim = claimId ?? page.versions[page.current - 1].claimId;
    const { confidence, evidence } = this.confidenceFor(boundClaim);
    const contentHash = contentHashOf(page.entityType, page.name, content);

    const verdict = this.gate.evaluate({ op: 'page:supersede', proposer, contentHash, confidence, entityType: page.entityType, approvers });
    if (verdict.outcome !== 'approved') return { ok: false, verdict };

    const q = this.screen(content, proposer);
    const next = page.versions.length + 1;
    page.versions.push(this.version(next, content, contentHash, boundClaim, evidence, confidence, verdict, proposer, reason, q));
    page.current = next;
    this.audit.append({
      actor: proposer, domain: 'memory', action: 'wiki:page-superseded', target: pageId, decision: 'allow',
      reason, detail: { version: next, previous: next - 1, contentHash },
    });
    return { ok: true, verdict, value: frozenCopy(page) };
  }

  /** T19 — retirement is a governed tombstone. The page and every revision remain readable through
   *  history; only the read gate stops serving it. Nothing is deleted. */
  retirePage(pageId: string, proposer: string, approvers: string[], reason: string): WikiWriteResult<Page> {
    this.guardWriter(proposer, 'page:retire');
    const page = this.pages.get(pageId);
    if (!page) throw new GovernanceError(`unknown page ${pageId}`);

    const cur = page.versions[page.current - 1];
    const verdict = this.gate.evaluate({
      op: 'page:retire', proposer, contentHash: cur.contentHash,
      confidence: aggregateConfidence([]), entityType: page.entityType, approvers,
    });
    if (verdict.outcome !== 'approved') return { ok: false, verdict };

    page.retired = { at: new Date().toISOString(), by: approvers.join(','), reason };
    this.audit.append({ actor: proposer, domain: 'memory', action: 'wiki:page-retired', target: pageId, decision: 'allow', reason });
    return { ok: true, verdict, value: frozenCopy(page) };
  }

  private version(
    version: number, c: PageContent, contentHash: string, claimId: string, evidence: string[],
    confidence: ConfidenceResult, verdict: GateVerdict, proposedBy: string, reason: string,
    q: { quarantined: boolean; reasons: string[] },
  ): PageVersion {
    return {
      version, title: c.title, body: c.body,
      properties: c.properties ?? {},
      confidentiality: c.confidentiality ?? 'internal',
      claimId, evidence, confidence: confidence.value, contentHash,
      approvedBy: (verdict.binding?.approvers ?? ['policy']).join(','),
      proposedBy, at: new Date().toISOString(), reason,
      quarantined: q.quarantined, quarantineReasons: q.reasons,
    };
  }

  // ---------------------------------------------------------------- links

  /** T11 — a link is itself an evidence-backed claim and goes through the same gate, so the graph
   *  cannot be poisoned by an LLM asserting an edge. */
  createLink(
    input: { from: string; to: string; kind: LinkKind; claimId: string; reason: string },
    proposer: string,
    approvers: string[] = [],
  ): WikiWriteResult<Link> {
    this.guardWriter(proposer, 'link:create');
    if (!this.pages.has(input.from)) throw new GovernanceError(`unknown link source ${input.from}`);
    if (!this.pages.has(input.to)) throw new GovernanceError(`unknown link target ${input.to}`);

    const { confidence, evidence } = this.confidenceFor(input.claimId);
    const contentHash = sha256(JSON.stringify({ from: input.from, to: input.to, kind: input.kind }));
    const verdict = this.gate.evaluate({ op: 'link:create', proposer, contentHash, confidence, linkKind: input.kind, approvers });
    if (verdict.outcome !== 'approved') return { ok: false, verdict };

    const link: Link = {
      id: sid('link'), from: input.from, to: input.to, kind: input.kind,
      confidence: confidence.value, claimId: input.claimId, evidence,
      approvedBy: (verdict.binding?.approvers ?? ['policy']).join(','),
      proposedBy: proposer, at: new Date().toISOString(), reason: input.reason,
    };
    this.links.set(link.id, link);
    this.audit.append({
      actor: proposer, domain: 'memory', action: 'wiki:link-created', target: link.id, decision: 'allow',
      reason: `${input.from} -${input.kind}-> ${input.to}`,
    });
    return { ok: true, verdict, value: frozenCopy(link) };
  }

  /** T12 — links are SUPERSEDED, never silently removed. Deleting a `contradicts` edge would make a
   *  falsehood look uncontested, so retirement leaves a tombstone and an audit record. */
  retireLink(linkId: string, proposer: string, approvers: string[], reason: string, supersededBy?: string): WikiWriteResult<Link> {
    this.guardWriter(proposer, 'link:retire');
    const link = this.links.get(linkId);
    if (!link) throw new GovernanceError(`unknown link ${linkId}`);

    const verdict = this.gate.evaluate({
      op: 'link:retire', proposer, contentHash: sha256(linkId),
      confidence: aggregateConfidence([]), linkKind: link.kind, approvers,
    });
    if (verdict.outcome !== 'approved') return { ok: false, verdict };

    link.retired = { at: new Date().toISOString(), by: approvers.join(','), reason, supersededBy };
    this.audit.append({ actor: proposer, domain: 'memory', action: 'wiki:link-retired', target: linkId, decision: 'allow', reason });
    return { ok: true, verdict, value: frozenCopy(link) };
  }

  // ---------------------------------------------------------------- merge / split (T14)

  mergeEntities(fromPageId: string, intoPageId: string, rationale: string, evidence: string[], proposer: string, approvers: string[]): WikiWriteResult<MergeRecord> {
    this.guardWriter(proposer, 'entity:merge');
    const from = this.pages.get(fromPageId);
    const into = this.pages.get(intoPageId);
    if (!from || !into) throw new GovernanceError('merge requires two known pages');
    if (fromPageId === intoPageId) throw new GovernanceError('cannot merge a page into itself');
    if (from.mergedInto) throw new GovernanceError('page is already merged');

    const contentHash = sha256(JSON.stringify({ from: fromPageId, into: intoPageId }));
    const verdict = this.gate.evaluate({ op: 'entity:merge', proposer, contentHash, confidence: aggregateConfidence([]), approvers });
    if (verdict.outcome !== 'approved') return { ok: false, verdict };

    const rec: MergeRecord = { id: sid('merge'), fromPageId, intoPageId, rationale, evidence, approvers: [...new Set(approvers)], at: new Date().toISOString() };
    this.merges.set(rec.id, rec);
    from.mergedInto = intoPageId;                      // the page survives; it is redirected, not destroyed
    this.audit.append({ actor: proposer, domain: 'memory', action: 'wiki:entity-merged', target: rec.id, decision: 'allow', reason: rationale });
    return { ok: true, verdict, value: frozenCopy(rec) };
  }

  splitEntity(sourcePageId: string, parts: CreatePageInput[], rationale: string, evidence: string[], proposer: string, approvers: string[]): WikiWriteResult<SplitRecord> {
    this.guardWriter(proposer, 'entity:split');
    const src = this.pages.get(sourcePageId);
    if (!src) throw new GovernanceError(`unknown page ${sourcePageId}`);
    if (parts.length < 2) throw new GovernanceError('a split must produce at least two pages');

    const contentHash = sha256(JSON.stringify({ source: sourcePageId, parts: parts.map((p) => p.name).sort() }));
    const verdict = this.gate.evaluate({ op: 'entity:split', proposer, contentHash, confidence: aggregateConfidence([]), approvers });
    if (verdict.outcome !== 'approved') return { ok: false, verdict };

    const intoPageIds: string[] = [];
    for (const part of parts) {
      const ch = contentHashOf(part.entityType, part.name, part);
      const { confidence, evidence: ev } = this.confidenceFor(part.claimId);
      const q = this.screen(part, proposer);
      const page: Page = {
        id: sid('page'), entityType: part.entityType, name: part.name, current: 1, splitFrom: sourcePageId,
        versions: [this.version(1, part, ch, part.claimId, ev, confidence, verdict, proposer, `split from ${sourcePageId}`, q)],
      };
      this.pages.set(page.id, page);
      intoPageIds.push(page.id);
    }
    const rec: SplitRecord = { id: sid('split'), sourcePageId, intoPageIds, rationale, evidence, approvers: [...new Set(approvers)], at: new Date().toISOString() };
    this.splits.set(rec.id, rec);
    this.audit.append({ actor: proposer, domain: 'memory', action: 'wiki:entity-split', target: rec.id, decision: 'allow', reason: rationale });
    return { ok: true, verdict, value: frozenCopy(rec) };
  }

  /** T14 — merges are reversible. Conflation must not be a one-way door. */
  reverseMerge(mergeId: string, by: string): MergeRecord {
    this.guardWriter(by, 'entity:merge-reverse');
    const rec = this.merges.get(mergeId);
    if (!rec) throw new GovernanceError(`unknown merge ${mergeId}`);
    if (rec.reversedAt) throw new GovernanceError('merge already reversed');
    const from = this.pages.get(rec.fromPageId);
    if (from) from.mergedInto = undefined;
    rec.reversedAt = new Date().toISOString();
    rec.reversedBy = by;
    this.audit.append({ actor: by, domain: 'memory', action: 'wiki:merge-reversed', target: mergeId, decision: 'allow', reason: 'reversed' });
    return frozenCopy(rec);
  }

  reverseSplit(splitId: string, by: string): SplitRecord {
    this.guardWriter(by, 'entity:split-reverse');
    const rec = this.splits.get(splitId);
    if (!rec) throw new GovernanceError(`unknown split ${splitId}`);
    if (rec.reversedAt) throw new GovernanceError('split already reversed');
    // The produced pages are RETIRED, never deleted — reversal must not become a deletion primitive.
    for (const id of rec.intoPageIds) {
      const p = this.pages.get(id);
      if (p && !p.retired) p.retired = { at: new Date().toISOString(), by, reason: `split ${splitId} reversed` };
    }
    rec.reversedAt = new Date().toISOString();
    rec.reversedBy = by;
    this.audit.append({ actor: by, domain: 'memory', action: 'wiki:split-reversed', target: splitId, decision: 'allow', reason: 'reversed' });
    return frozenCopy(rec);
  }

  // ---------------------------------------------------------------- reads (WikiView)

  getPage(id: string): Page | undefined { const p = this.pages.get(id); return p && frozenCopy(p); }
  allPages(): Page[] { return [...this.pages.values()].map(frozenCopy); }
  linksFrom(pageId: string): Link[] { return [...this.links.values()].filter((l) => l.from === pageId && !l.retired).map(frozenCopy); }
  linksTo(pageId: string): Link[] { return [...this.links.values()].filter((l) => l.to === pageId && !l.retired).map(frozenCopy); }
  /** Includes tombstoned edges — for history and audit views, never for retrieval. */
  allLinks(includeRetired = false): Link[] { return [...this.links.values()].filter((l) => includeRetired || !l.retired).map(frozenCopy); }
  currentVersion(pageId: string): PageVersion | undefined {
    const p = this.pages.get(pageId);
    return p && frozenCopy(p.versions[p.current - 1]);
  }
  getMerge(id: string): MergeRecord | undefined { const m = this.merges.get(id); return m && frozenCopy(m); }
  getSplit(id: string): SplitRecord | undefined { const s = this.splits.get(id); return s && frozenCopy(s); }

  /** T13 — re-derive every revision's content hash and compare it to what was recorded at approval.
   *  Catches an out-of-band edit to the persisted store: rewriting a page's body changes the derived
   *  hash but not the stored one, so the drift is detectable rather than silently canonical. */
  verifyPage(pageId: string): { ok: boolean; reason: string } {
    const p = this.pages.get(pageId);
    if (!p) return { ok: false, reason: 'unknown page' };
    for (const v of p.versions) {
      if (contentHashOf(p.entityType, p.name, v) !== v.contentHash) {
        return { ok: false, reason: `version ${v.version} does not match its approved content hash — tampered` };
      }
    }
    return { ok: true, reason: `all ${p.versions.length} revision(s) verified` };
  }

  // ---------------------------------------------------------------- persistence

  snapshot(): WikiSnapshot {
    const pages = [...this.pages.values()];
    const links = [...this.links.values()];
    const merges = [...this.merges.values()];
    const splits = [...this.splits.values()];
    return {
      schema: WIKI_SCHEMA, version: WIKI_SCHEMA_VERSION, pages, links, merges, splits,
      hash: canonicalHash([pages, links, merges, splits]),
      writtenAt: new Date().toISOString(),
    };
  }

  restore(snap: unknown): RestoreResult {
    if (snap === null || snap === undefined) return { ok: true, degraded: false, reason: 'no snapshot (fresh install)', restored: 0 };
    if (typeof snap === 'symbol') return { ok: false, degraded: true, reason: 'wiki snapshot present but unparseable', restored: 0 };
    const s = snap as Partial<WikiSnapshot>;
    if (typeof s !== 'object' || s.schema !== WIKI_SCHEMA) return { ok: false, degraded: true, reason: 'wiki snapshot unreadable or wrong schema', restored: 0 };
    if (s.version !== WIKI_SCHEMA_VERSION) return { ok: false, degraded: true, reason: `unknown wiki snapshot version ${String(s.version)}`, restored: 0 };
    const { pages, links, merges, splits } = s;
    if (!Array.isArray(pages) || !Array.isArray(links) || !Array.isArray(merges) || !Array.isArray(splits)) {
      return { ok: false, degraded: true, reason: 'wiki snapshot missing collections', restored: 0 };
    }
    if (canonicalHash([pages, links, merges, splits]) !== s.hash) {
      return { ok: false, degraded: true, reason: 'wiki snapshot hash mismatch — tampered or truncated', restored: 0 };
    }
    this.pages = new Map(pages.map((p) => [p.id, p]));
    this.links = new Map(links.map((l) => [l.id, l]));
    this.merges = new Map(merges.map((m) => [m.id, m]));
    this.splits = new Map(splits.map((x) => [x.id, x]));
    return { ok: true, degraded: false, reason: 'restored', restored: pages.length + links.length + merges.length + splits.length };
  }
}
