// Retrieval must be a deterministic function of (view, request). Non-determinism here would be a
// governance hole, not just a nuisance: if the same query can return different subgraphs, an
// attacker can retry until a poisoned page surfaces, and an audit record of "what was served"
// stops being reproducible.
import { describe, it, expect } from 'vitest';
import { retrieve } from './retrieval';
import type { Confidentiality, Link, LinkKind, Page, WikiView } from './wikitypes';

function mkPage(id: string, name: string, confidence: number, evidence: number, confidentiality: Confidentiality = 'internal'): Page {
  return {
    id, entityType: 'note', name, current: 1,
    versions: [{
      version: 1, title: name, body: `body of ${name}`, properties: {}, confidentiality,
      claimId: 'c', evidence: Array.from({ length: evidence }, (_, i) => `ev${i}`),
      confidence, contentHash: `h_${id}`, approvedBy: 'policy', proposedBy: 'herodotus',
      at: '2026-07-20T00:00:00.000Z', reason: 'test', quarantined: false, quarantineReasons: [],
    }],
  };
}

function mkLink(from: string, to: string, kind: LinkKind, confidence: number): Link {
  return {
    id: `l_${from}_${to}_${kind}`, from, to, kind, confidence, claimId: 'c', evidence: ['e'],
    approvedBy: 'human', proposedBy: 'herodotus', at: '2026-07-20T00:00:00.000Z', reason: 'test',
  };
}

function view(pages: Page[], links: Link[]): WikiView {
  const byId = new Map(pages.map((p) => [p.id, p]));
  return {
    getPage: (id) => byId.get(id),
    allPages: () => [...pages],
    linksFrom: (id) => links.filter((l) => l.from === id),
    linksTo: (id) => links.filter((l) => l.to === id),
  };
}

// A graph with ties, a cycle, and a contradiction — every branch where an arbitrary ordering could
// leak in.
const PAGES = [
  mkPage('A', 'alpha', 0.9, 3),
  mkPage('B', 'alpha-beta', 0.9, 3),      // exact tie with A on score -> id tie-break
  mkPage('C', 'alpha-gamma', 0.7, 2),
  mkPage('D', 'alpha-delta', 0.7, 2),     // exact tie with C
  mkPage('E', 'alpha-epsilon', 0.4, 1),
];
const LINKS = [
  mkLink('A', 'C', 'part-of', 0.8),
  mkLink('A', 'D', 'depends-on', 0.8),    // tie with the edge above
  mkLink('C', 'E', 'contradicts', 0.2),
  mkLink('E', 'A', 'part-of', 0.5),       // cycle back to the entry
];

const REQ = { query: 'alpha', requester: 'agent.reader', clearance: 'internal' as Confidentiality };

describe('retrieval — determinism (same view + request, same subgraph, 1000x)', () => {
  it('is stable across 1000 identical calls', () => {
    const v = view(PAGES, LINKS);
    const first = JSON.stringify(retrieve(v, REQ));
    for (let i = 0; i < 1000; i++) expect(JSON.stringify(retrieve(v, REQ))).toBe(first);
  });

  it('is invariant to the order pages are stored in', () => {
    const forward = JSON.stringify(retrieve(view(PAGES, LINKS), REQ));
    const reversed = JSON.stringify(retrieve(view([...PAGES].reverse(), LINKS), REQ));
    expect(reversed).toBe(forward);
  });

  it('is invariant to the order links are stored in', () => {
    const forward = JSON.stringify(retrieve(view(PAGES, LINKS), REQ));
    const reversed = JSON.stringify(retrieve(view(PAGES, [...LINKS].reverse()), REQ));
    expect(reversed).toBe(forward);
  });

  it('ties are broken deterministically by id, not by insertion order', () => {
    const a = retrieve(view(PAGES, LINKS), REQ).pages.map((p) => p.pageId);
    const b = retrieve(view([PAGES[1], PAGES[0], ...PAGES.slice(2)], LINKS), REQ).pages.map((p) => p.pageId);
    expect(b).toEqual(a);
    expect(a.indexOf('A')).toBeLessThan(a.indexOf('B'));   // equal score -> lower id first
  });

  it('budget clamping is deterministic for the same malformed input', () => {
    const v = view(PAGES, LINKS);
    const bad = { ...REQ, budget: { maxNodes: NaN, maxDepth: -1, maxEdges: 1e12, maxTokens: 0.5 } };
    const first = JSON.stringify(retrieve(v, bad));
    for (let i = 0; i < 100; i++) expect(JSON.stringify(retrieve(v, bad))).toBe(first);
  });
});
