// Golden vectors for the governed-memory confidence aggregation.
//
// Same discipline as score.determinism: the aggregation is a PURE function of its input set, so every
// number below is pinned. If an arithmetic constant moves, these fail loudly rather than silently
// re-tuning what is allowed to become knowledge without a human.
import { describe, it, expect } from 'vitest';
import { aggregateConfidence, pointsOf, type EvidenceItem } from './confidence';
import { AUTO_APPROVE_POINTS } from './wikitypes';

const ev = (
  id: string,
  sourceId: string,
  trust: EvidenceItem['trust'],
  confidence: number,
  contentHash = `h-${id}`,
): EvidenceItem => ({ id, sourceId, trust, confidence, contentHash });

/** n distinct sources, each with one distinct item, all at the same confidence. */
const spread = (n: number, trust: EvidenceItem['trust'], confidence: number): EvidenceItem[] =>
  Array.from({ length: n }, (_, i) => ev(`e${i}`, `src${i}`, trust, confidence));

describe('confidence — golden vectors (the auto-approve arithmetic is pinned)', () => {
  it('THREE independent trusted sources is exactly the auto-approve bar', () => {
    const r = aggregateConfidence(spread(3, 'trusted', 0.96));
    expect(r.base).toBe(60);              // best single source, capped
    expect(r.independentSources).toBe(3);
    expect(r.diversityBonus).toBe(30);    // 15 x 2 sources beyond the first
    expect(r.ceiling).toBe(100);
    expect(r.conflictPenalty).toBe(0);
    expect(r.points).toBe(90);
    expect(r.points).toBe(AUTO_APPROVE_POINTS);
    expect(r.autoEligible).toBe(true);
  });

  it('ONE source tops out at 60 however certain it claims to be', () => {
    const r = aggregateConfidence([ev('a', 'src', 'trusted', 1.0)]);
    expect(r.base).toBe(60);
    expect(r.diversityBonus).toBe(0);
    expect(r.points).toBe(60);
    expect(r.autoEligible).toBe(false);
  });

  it('TWO sources reach 75 — still short of the bar', () => {
    const r = aggregateConfidence(spread(2, 'trusted', 0.99));
    expect(r.points).toBe(75);
    expect(r.autoEligible).toBe(false);
  });

  it('FOUR sources reach 100 and the diversity bonus then stops', () => {
    expect(aggregateConfidence(spread(4, 'trusted', 1.0)).points).toBe(100);
    expect(aggregateConfidence(spread(9, 'trusted', 1.0)).diversityBonus).toBe(40); // capped
    expect(aggregateConfidence(spread(9, 'trusted', 1.0)).points).toBe(100);
  });

  it('the `observed` trust ceiling of 85 binds below the auto-approve bar', () => {
    const r = aggregateConfidence(spread(3, 'observed', 0.99));
    expect(r.base + r.diversityBonus).toBe(90);   // would have qualified...
    expect(r.ceiling).toBe(85);
    expect(r.points).toBe(85);                    // ...but the ceiling holds it down
    expect(r.autoEligible).toBe(false);
  });

  it('the conflict penalty is capped at 40', () => {
    const support = spread(4, 'trusted', 1.0);                      // 100 points unconflicted
    const one = aggregateConfidence(support, [ev('c', 'cs', 'trusted', 0.9)]);
    const twenty = aggregateConfidence(support, Array.from({ length: 20 },
      (_, i) => ev(`c${i}`, `cs${i}`, 'trusted', 0.9)));
    expect(one.conflictPenalty).toBe(40);
    expect(twenty.conflictPenalty).toBe(40);      // twenty conflicts weigh exactly what one does
    expect(one.points).toBe(60);
    expect(twenty.points).toBe(60);
  });

  it('pointsOf clamps and fails SAFE-LOW on malformed input (high confidence is the dangerous pole)', () => {
    expect(pointsOf(0.5)).toBe(50);
    expect(pointsOf(1)).toBe(100);
    expect(pointsOf(0)).toBe(0);
    expect(pointsOf(NaN)).toBe(0);
    expect(pointsOf(Infinity)).toBe(0);
    expect(pointsOf(undefined)).toBe(0);
    expect(pointsOf('0.99' as unknown as number)).toBe(0);
    expect(pointsOf(-5)).toBe(0);
    expect(pointsOf(999)).toBe(100);              // over-range clamps down, never wraps
  });

  it('empty and malformed evidence sets yield zero, never a default-high', () => {
    expect(aggregateConfidence([]).points).toBe(0);
    expect(aggregateConfidence([]).autoEligible).toBe(false);
    const junk = [null, undefined, {}] as unknown as EvidenceItem[];
    const r = aggregateConfidence(junk);
    expect(r.points).toBe(0);
    expect(r.autoEligible).toBe(false);
  });
});

describe('confidence — determinism (a pure function of the evidence SET, 1000x)', () => {
  it('is stable across 1000 identical calls', () => {
    const items = [
      ev('a', 's1', 'trusted', 0.9), ev('b', 's2', 'observed', 0.7),
      ev('c', 's3', 'external', 0.8), ev('d', 's1', 'trusted', 0.95),
    ];
    const first = JSON.stringify(aggregateConfidence(items));
    for (let i = 0; i < 1000; i++) expect(JSON.stringify(aggregateConfidence(items))).toBe(first);
  });

  it('is invariant to the ORDER the caller passes evidence in', () => {
    const items = [
      ev('a', 's1', 'trusted', 0.9), ev('b', 's2', 'trusted', 0.95),
      ev('c', 's3', 'observed', 0.7), ev('d', 's4', 'external', 0.99),
    ];
    const forward = JSON.stringify(aggregateConfidence(items));
    const reversed = JSON.stringify(aggregateConfidence([...items].reverse()));
    const rotated = JSON.stringify(aggregateConfidence([items[2], items[0], items[3], items[1]]));
    expect(reversed).toBe(forward);
    expect(rotated).toBe(forward);
  });
});
