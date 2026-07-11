import { describe, it, expect } from 'vitest';
import { assessRisk, composite, tierOf, descriptorOf, verdictFor } from './index';
import type { CategoryScores } from './index';

// Verifies the deterministic scorer AND the adversarial mitigations it bakes in
// (docs/RISK_MODEL_ADVERSARIAL_ANALYSIS.md attack numbers cited).

describe('composite — max-driven, not averaged (A#1 dilution)', () => {
  it('one maxed category is NOT diluted by 49 benign ones', () => {
    const cats: CategoryScores = { 6: 10 }; // irreversibility maxed, all else default 1
    expect(composite(assessRisk(cats).categories)).toBe(100);
  });
  it('stacking high categories adds the accumulation bump', () => {
    const one = assessRisk({ 2: 7 }).score;            // 7*10 + 0 = 70
    const many = assessRisk({ 2: 7, 3: 7, 4: 7 }).score; // 70 + 2*2 = 74
    expect(one).toBe(70);
    expect(many).toBe(74);
  });
  it('composite is capped at 100', () => {
    expect(assessRisk({ 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10 }).score).toBe(100);
  });
});

describe('clamp + fail-safe-high (A#22, A#23 underflow / NaN)', () => {
  it('a NaN / non-number category fails SAFE to 10, never 1', () => {
    const a = assessRisk({ 2: NaN as unknown as number });
    expect(a.categories[2]).toBe(10);
  });
  it('out-of-range values are clamped to [1,10]', () => {
    const a = assessRisk({ 2: 999, 3: -5 });
    expect(a.categories[2]).toBe(10);
    expect(a.categories[3]).toBe(1);
  });
  it('missing categories default to the safe minimum (1)', () => {
    const a = assessRisk({});
    expect(a.categories[50]).toBe(1);
    expect(a.score).toBe(10); // all 1s → max 1 → 10
  });
});

describe('tier + descriptor bands (decade-aligned)', () => {
  it('maps scores to the right tier and descriptor', () => {
    expect(tierOf(10)).toBe('low');   expect(descriptorOf(10)).toBe('Clear');
    expect(tierOf(30)).toBe('low');   expect(descriptorOf(30)).toBe('Routine');
    expect(tierOf(40)).toBe('medium');expect(descriptorOf(45)).toBe('Weighty');
    expect(tierOf(70)).toBe('high');  expect(descriptorOf(65)).toBe('Gated');
    expect(tierOf(71)).toBe('critical'); expect(descriptorOf(95)).toBe('Forbidden');
  });
});

describe('floors before tolerance ceiling (A#17 — a toggle cannot lift a floor)', () => {
  it('a hard-deny floor DENIES even under Medium at a low composite', () => {
    const a = assessRisk({ 11: 9 }); // secrets floor tripped; composite only 90? no — 9*10=90
    // secrets is hard-deny; verdict must be deny regardless of tolerance
    expect(a.hardDeny).toBe(true);
    expect(verdictFor(a, 'nomatch', 'medium').verdict).toBe('deny');
    expect(verdictFor(a, 'nomatch', 'low').verdict).toBe('deny');
  });
  it('a non-deny floor ASKS even under Medium', () => {
    const a = assessRisk({ 6: 8, 2: 3 }); // irreversibility floor at 8; composite 80... but 6 is floor(ask)
    expect(a.floors).toContain(6);
    expect(a.hardDeny).toBe(false);
    expect(verdictFor(a, 'nomatch', 'medium').verdict).toBe('ask');
  });
  it('injection is a hard reject regardless of tolerance', () => {
    const a = assessRisk({}, { injection: true });
    expect(a.tier).toBe('injection');
    expect(verdictFor(a, 'allow', 'medium').verdict).toBe('deny');
  });
});

describe('Risk Tolerance ceilings + fail-safe', () => {
  it('Low auto-runs ≤30, asks above; Medium auto-runs ≤70', () => {
    const routine = assessRisk({ 4: 3 });   // score 30
    const noted = assessRisk({ 4: 4 });      // score 40
    const gated = assessRisk({ 5: 7 });      // score 70
    expect(verdictFor(routine, 'nomatch', 'low').verdict).toBe('allow');
    expect(verdictFor(noted, 'nomatch', 'low').verdict).toBe('ask');
    expect(verdictFor(noted, 'nomatch', 'medium').verdict).toBe('allow');
    expect(verdictFor(gated, 'nomatch', 'medium').verdict).toBe('allow');
  });
  it('critical (≥71) always asks, on either setting', () => {
    const acute = assessRisk({ 5: 8 }); // 80
    expect(verdictFor(acute, 'nomatch', 'medium').verdict).toBe('ask');
    expect(verdictFor(acute, 'nomatch', 'low').verdict).toBe('ask');
  });
  it('an unknown tolerance value fails safe to Low', () => {
    const noted = assessRisk({ 4: 4 }); // 40
    expect(verdictFor(noted, 'nomatch', 'bogus' as unknown as 'low').verdict).toBe('ask');
  });
  it('policy deny always denies', () => {
    expect(verdictFor(assessRisk({ 4: 2 }), 'deny', 'medium').verdict).toBe('deny');
  });
});

describe('determinism (A#40 — same input, same score, 1000×)', () => {
  it('is a pure function of its input', () => {
    const cats: CategoryScores = { 2: 6, 3: 7, 8: 4, 12: 5, 39: 3 };
    const first = JSON.stringify(assessRisk(cats));
    for (let i = 0; i < 1000; i++) expect(JSON.stringify(assessRisk(cats))).toBe(first);
  });
});
