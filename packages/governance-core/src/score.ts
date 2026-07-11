// The single, deterministic risk scorer — the ONE place risk is computed (Scott: "two systems for
// similar tasks is not governance"). Every producer routes through assessRisk(); no producer keeps its
// own tier logic. Pure functions only: no I/O, time, locale, or randomness, so the result is a
// deterministic function of its inputs (mitigates the non-determinism / replay attack class).
//
// Adversarial mitigations baked in (see docs/RISK_MODEL_ADVERSARIAL_ANALYSIS.md):
//  - clamp every category to [1..10]; a NaN / missing / out-of-range value fails SAFE to 10, never 1 (A#22, A#23)
//  - composite is MAX-driven, not averaged, so one dangerous dimension is never diluted (A#1)
//  - integer math with defined rounding; no floats reach the band comparison (A#21)
//  - category FLOORS are evaluated BEFORE the tolerance ceiling, so tolerance can never lift them (A#17)
//  - unknown / malformed assessment fails CLOSED to the stricter decision, never open (A#23, A#43)
import {
  CATEGORIES, CATEGORY_COUNT, FLOOR_TRIGGER, FLOOR_IDS, HARD_DENY_IDS, RISK_BANDS,
  type CategoryId,
} from './riskmatrix';
import type { RiskTier } from './types';

export type CategoryScores = Partial<Record<CategoryId, number>>;

export interface RiskAssessment {
  score: number;            // 0..100 composite
  tier: RiskTier;           // derived band (backward-compatible view)
  descriptor: string;       // human label (Clear..Forbidden, or Injection)
  categories: Record<CategoryId, number>;  // the full, clamped 1..10 vector
  floors: CategoryId[];     // floor categories that tripped (score >= FLOOR_TRIGGER)
  hardDeny: boolean;        // a hard-deny floor tripped (or injection)
  injection: boolean;       // off-scale prompt-injection → hard reject
  top: { id: CategoryId; score: number }[]; // top contributors (audited)
}

const SAFE_MIN = 1;
const FAILSAFE = 10; // a bad value fails to the WORST score, never the safest

// Clamp one category value to an integer in [1,10]; anything not a finite number → FAILSAFE (10).
function clampCat(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return FAILSAFE;
  const r = Math.round(v);
  if (r < SAFE_MIN) return SAFE_MIN;
  if (r > FAILSAFE) return FAILSAFE;
  return r;
}

// Build the full, clamped 50-length vector. Missing categories default to the SAFE minimum (1) — the
// documented "not yet scored from evidence" state; consequential-but-unscored gaps are the producer's
// responsibility (RM-1), not the scorer's.
function normalize(input: CategoryScores): Record<CategoryId, number> {
  const out = {} as Record<CategoryId, number>;
  for (const c of CATEGORIES) {
    const raw = input[c.id];
    out[c.id] = raw === undefined ? SAFE_MIN : clampCat(raw);
  }
  return out;
}

// composite = min(100, max*10 + 2 * min(10, count of OTHER categories >= 7))
export function composite(cats: Record<CategoryId, number>): number {
  let max = SAFE_MIN;
  let atLeast7 = 0;
  for (const c of CATEGORIES) {
    const v = cats[c.id];
    if (v > max) max = v;
    if (v >= 7) atLeast7 += 1;
  }
  const others = max >= 7 ? atLeast7 - 1 : atLeast7; // the max itself doesn't count toward its own bump
  const bump = 2 * Math.min(10, others);
  return Math.min(100, max * 10 + bump);
}

export function bandOf(score: number): { descriptor: string; tier: RiskTier } {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  for (const b of RISK_BANDS) if (s >= b.min && s <= b.max) return { descriptor: b.descriptor, tier: b.tier };
  return { descriptor: RISK_BANDS[RISK_BANDS.length - 1].descriptor, tier: 'critical' }; // fail-safe high
}

export function tierOf(score: number): RiskTier { return bandOf(score).tier; }
export function descriptorOf(score: number): string { return bandOf(score).descriptor; }

/** The single risk assessment. `injection: true` is an off-scale hard reject. */
export function assessRisk(input: CategoryScores, opts: { injection?: boolean } = {}): RiskAssessment {
  const categories = normalize(input);
  const floors = FLOOR_IDS.filter((id) => categories[id] >= FLOOR_TRIGGER);
  const hardDenyFloor = HARD_DENY_IDS.some((id) => categories[id] >= FLOOR_TRIGGER);
  const top = CATEGORIES.map((c) => ({ id: c.id, score: categories[c.id] }))
    .filter((t) => t.score > SAFE_MIN)
    .sort((a, b) => (b.score - a.score) || (a.id - b.id)) // deterministic tie-break by id
    .slice(0, 3);

  if (opts.injection) {
    return { score: 100, tier: 'injection', descriptor: 'Injection', categories, floors, hardDeny: true, injection: true, top };
  }
  const score = composite(categories);
  const { descriptor, tier } = bandOf(score);
  return { score, tier, descriptor, categories, floors, hardDeny: hardDenyFloor, injection: false, top };
}

// ---- Decision under Risk Tolerance ----
export type RiskTolerance = 'low' | 'medium';
export type Verdict = 'allow' | 'ask' | 'deny';
const CEILING: Record<RiskTolerance, number> = { low: 30, medium: 70 };

/** Fold the assessment + operator policy + Risk Tolerance into a verdict.
 *  Order is load-bearing: injection and floors are resolved BEFORE the tolerance ceiling, so no value
 *  of `tolerance` can ever auto-run a floor or a critical action. Fails CLOSED. */
export function verdictFor(a: RiskAssessment, policy: 'allow' | 'deny' | 'nomatch', tolerance: RiskTolerance): { verdict: Verdict; reason: string } {
  if (a.injection) return { verdict: 'deny', reason: 'prompt-injection — hard reject' };
  if (a.hardDeny) return { verdict: 'deny', reason: `hard-floor category tripped (${a.floors.join(', ')})` };
  if (a.floors.length) return { verdict: 'ask', reason: `floor category requires a human (${a.floors.join(', ')})` };
  if (policy === 'deny') return { verdict: 'deny', reason: 'policy-deny' };
  const ceiling = CEILING[tolerance] ?? CEILING.low; // unknown tolerance → strict (fail-safe to Low)
  if (a.score <= ceiling) return { verdict: 'allow', reason: `${a.descriptor} (${a.score}) ≤ ${tolerance} ceiling ${ceiling}` };
  return { verdict: 'ask', reason: `${a.descriptor} (${a.score}) exceeds ${tolerance} ceiling ${ceiling} — human required` };
}

// RM-3 unification bridge: any producer that already computes a 4-tier RiskTier can emit a full
// RiskAssessment through THIS one scorer, so there is a single assessment type + floor logic
// system-wide. `extra` lets a producer add its real category evidence (e.g. secrets → {11: 9});
// the tier carrier (#9 decision-authority) keeps the composite in the tier's band by construction.
const TIER_CARRIER: Record<Exclude<RiskTier, 'injection'>, number> = { low: 2, medium: 4, high: 6, critical: 9 };
export function assessmentFromTier(tier: RiskTier, extra: CategoryScores = {}): RiskAssessment {
  if (tier === 'injection') return assessRisk(extra, { injection: true });
  return assessRisk({ 9: TIER_CARRIER[tier], ...extra });
}

export { CATEGORY_COUNT };
