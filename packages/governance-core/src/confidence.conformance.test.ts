// Adversarial vectors for the governed-memory confidence aggregation.
//
// Each test is named for the attack it refuses, from docs/design/MEMORY_WIKI_THREATS.md. The old
// arithmetic mean in memory.ts failed every one of these; that is why it was replaced.
import { describe, it, expect } from 'vitest';
import { aggregateConfidence, type EvidenceItem } from './confidence';
import { AUTO_APPROVE_POINTS } from './wikitypes';

const ev = (
  id: string,
  sourceId: string,
  trust: EvidenceItem['trust'],
  confidence: number,
  contentHash = `h-${id}`,
): EvidenceItem => ({ id, sourceId, trust, confidence, contentHash });

describe('T3 — Sybil corroboration cannot buy auto-approval', () => {
  it('500 identical copies from one source count ONCE and never auto-approve', () => {
    const flood = Array.from({ length: 500 },
      (_, i) => ev(`e${i}`, 'attacker', 'trusted', 0.99, 'same-content-hash'));
    const r = aggregateConfidence(flood);
    expect(r.duplicatesDropped).toBe(499);
    expect(r.distinctSources).toBe(1);
    expect(r.independentSources).toBe(1);
    expect(r.points).toBe(60);
    expect(r.autoEligible).toBe(false);
  });

  it('500 DISTINCT statements from one source still count as one source', () => {
    const flood = Array.from({ length: 500 }, (_, i) => ev(`e${i}`, 'attacker', 'trusted', 0.99));
    const r = aggregateConfidence(flood);
    expect(r.duplicatesDropped).toBe(0);      // genuinely distinct content
    expect(r.independentSources).toBe(1);     // but one voice, however talkative
    expect(r.points).toBe(60);
    expect(r.autoEligible).toBe(false);
  });

  it('100 distinct EXTERNAL identities gain no independence at all (correction #5)', () => {
    const sybil = Array.from({ length: 100 }, (_, i) => ev(`e${i}`, `sock${i}`, 'external', 1.0));
    const r = aggregateConfidence(sybil);
    expect(r.distinctSources).toBe(100);
    expect(r.independentSources).toBe(0);     // external never counts toward N
    expect(r.diversityBonus).toBe(0);
    expect(r.points).toBeLessThan(AUTO_APPROVE_POINTS);
    expect(r.autoEligible).toBe(false);
  });

  it('evidence with no source id collapses into one anonymous source, not many', () => {
    const anon = Array.from({ length: 20 },
      (_, i) => ({ id: `e${i}`, sourceId: '', trust: 'trusted' as const, confidence: 0.99, contentHash: `h${i}` }));
    const r = aggregateConfidence(anon);
    expect(r.distinctSources).toBe(1);
    expect(r.autoEligible).toBe(false);
  });

  it('evidence with no content hash cannot defeat dedup by looking unique', () => {
    const nohash = Array.from({ length: 50 },
      (_, i) => ({ id: `e${i}`, sourceId: 'attacker', trust: 'trusted' as const, confidence: 0.99, contentHash: '' }));
    const r = aggregateConfidence(nohash);
    expect(r.duplicatesDropped).toBe(49);
    expect(r.autoEligible).toBe(false);
  });
});

describe('T1 — untrusted sources can never auto-promote', () => {
  it('a tainted source is ceiling-capped far below the bar', () => {
    const r = aggregateConfidence([ev('a', 's', 'tainted', 1.0)]);
    expect(r.ceiling).toBe(40);
    expect(r.points).toBe(40);
    expect(r.autoEligible).toBe(false);
  });

  it('ONE tainted item poisons auto-eligibility even amid strong trusted corroboration', () => {
    const clean = [ev('a', 's1', 'trusted', 1.0), ev('b', 's2', 'trusted', 1.0), ev('c', 's3', 'trusted', 1.0)];
    expect(aggregateConfidence(clean).autoEligible).toBe(true);

    const spiked = [...clean, ev('x', 's4', 'tainted', 0.1)];
    const r = aggregateConfidence(spiked);
    expect(r.taintedPresent).toBe(true);
    expect(r.autoEligible).toBe(false);
    expect(r.reasons).toContain('tainted evidence can never auto-promote');
  });

  it('an unrecognised trust class is treated as tainted, not as trusted', () => {
    const r = aggregateConfidence([
      { id: 'a', sourceId: 's', trust: 'super-trusted' as unknown as EvidenceItem['trust'], confidence: 1.0, contentHash: 'h' },
    ]);
    expect(r.ceiling).toBe(40);
    expect(r.autoEligible).toBe(false);
  });
});

describe('T8 — the aggregation cannot be gamed in either direction', () => {
  it('a flood of conflicts cannot assassinate a true claim (penalty capped)', () => {
    const support = Array.from({ length: 4 }, (_, i) => ev(`s${i}`, `src${i}`, 'trusted', 1.0));
    const assassination = Array.from({ length: 200 }, (_, i) => ev(`c${i}`, `bot${i}`, 'trusted', 1.0));
    const r = aggregateConfidence(support, assassination);
    expect(r.conflictPenalty).toBe(40);      // not 200 x anything
    expect(r.points).toBe(60);               // weakened, but nowhere near zero
  });

  it('any conflict at all blocks auto-approval and routes to a human', () => {
    const support = Array.from({ length: 4 }, (_, i) => ev(`s${i}`, `src${i}`, 'trusted', 1.0));
    expect(aggregateConfidence(support).autoEligible).toBe(true);
    const r = aggregateConfidence(support, [ev('c', 'cs', 'observed', 0.01)]);
    expect(r.autoEligible).toBe(false);
  });

  it('out-of-range confidence cannot be used to inflate a claim', () => {
    const r = aggregateConfidence([
      ev('a', 's1', 'trusted', 999), ev('b', 's2', 'trusted', 50), ev('c', 's3', 'trusted', 1e9),
    ]);
    expect(r.points).toBe(90);               // clamped to 100 each, then the normal caps apply
    expect(r.base).toBe(60);
  });

  // Found by the NaN vector below during development: an earlier draft awarded the diversity bonus
  // per distinct source regardless of whether that source contributed anything, so N worthless
  // sources bought 15(N-1) free points. A source must now score > 0 to count as corroborating.
  it('sources that corroborated NOTHING earn no diversity bonus', () => {
    const empty = Array.from({ length: 8 }, (_, i) => ev(`e${i}`, `src${i}`, 'trusted', 0));
    const r = aggregateConfidence(empty);
    expect(r.distinctSources).toBe(8);
    expect(r.independentSources).toBe(0);
    expect(r.diversityBonus).toBe(0);
    expect(r.points).toBe(0);
  });

  it('one real source plus seven empty ones is still one source', () => {
    const items = [
      ev('real', 'src-real', 'trusted', 1.0),
      ...Array.from({ length: 7 }, (_, i) => ev(`e${i}`, `src${i}`, 'trusted', 0)),
    ];
    const r = aggregateConfidence(items);
    expect(r.independentSources).toBe(1);
    expect(r.points).toBe(60);
    expect(r.autoEligible).toBe(false);
  });

  it('NaN confidence contributes nothing rather than defaulting high', () => {
    const r = aggregateConfidence([
      ev('a', 's1', 'trusted', NaN), ev('b', 's2', 'trusted', NaN), ev('c', 's3', 'trusted', NaN),
    ]);
    expect(r.base).toBe(0);
    expect(r.points).toBe(0);
    expect(r.autoEligible).toBe(false);
  });
});

describe('confidence — the result explains itself', () => {
  it('states every reason auto-approval was refused', () => {
    const r = aggregateConfidence([ev('a', 's', 'tainted', 0.2)], [ev('c', 'cs', 'trusted', 0.9)]);
    expect(r.autoEligible).toBe(false);
    expect(r.reasons.some((x) => x.includes('below auto-approve bar'))).toBe(true);
    expect(r.reasons.some((x) => x.includes('independent trusted source'))).toBe(true);
    expect(r.reasons.some((x) => x.includes('conflicting evidence present'))).toBe(true);
    expect(r.reasons).toContain('tainted evidence can never auto-promote');
  });
});
