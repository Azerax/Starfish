// Robust confidence aggregation for governed memory — the T3 (Sybil) / T8 (score-gaming) mitigation.
//
// This replaces the arithmetic mean at the heart of the old memory model. A mean is trivially gamed:
// flood N near-identical "corroborating" items and the average rises to whatever you want. The whole
// point of this module is that VOLUME buys nothing and only independent, trusted BREADTH does.
//
// Discipline copied from score.ts, the repo's single risk scorer:
//  - pure functions only: no I/O, no time, no locale, no randomness — a deterministic function of input
//  - integer points math end to end; no float ever reaches a threshold comparison
//  - every input clamped; NaN / missing / out-of-range fails SAFE
//  - unknown / malformed input fails CLOSED to the stricter outcome
//
// One deliberate inversion from score.ts: there, a bad value fails safe to the WORST risk (10),
// because high risk is the cautious direction. Here, high confidence is the DANGEROUS direction — it
// is what unlocks auto-promotion — so a bad value fails safe to ZERO. Same principle, opposite pole.
import {
  AUTO_APPROVE_POINTS, COUNTS_TOWARD_INDEPENDENCE, DIVERSITY_BONUS_PER_SOURCE,
  MAX_CONFLICT_PENALTY_POINTS, MAX_DIVERSITY_BONUS, MIN_INDEPENDENT_SOURCES,
  PER_SOURCE_CAP_POINTS, POINTS_MAX, POINTS_MIN, TRUST_CEILING, UNKNOWN_TRUST,
  type TrustClass,
} from './wikitypes';

/** One piece of supporting or conflicting evidence, reduced to what aggregation needs.
 *  `trust` and `sourceId` are system-stamped from the source registry, never proposer-declared. */
export interface EvidenceItem {
  id: string;
  sourceId: string;        // the independent origin identity — the unit of "independence"
  trust: TrustClass;
  confidence: number;      // 0..1 as supplied; clamped here
  contentHash: string;     // T3 — copies of the same content count ONCE
}

export interface ConfidenceResult {
  points: number;                 // 0..100 integer — the authoritative value
  value: number;                  // points / 100, the 0..1 view for Claim.confidence
  base: number;                   // best single-source contribution, after the per-source cap
  diversityBonus: number;
  ceiling: number;                // trust ceiling applied
  conflictPenalty: number;
  independentSources: number;     // distinct trusted/observed sources after dedup
  distinctSources: number;        // distinct sources of any trust, after dedup
  duplicatesDropped: number;
  taintedPresent: boolean;
  autoEligible: boolean;          // may this auto-approve at low stakes, without a human?
  reasons: string[];              // deterministic, ordered explanation
}

/** Convert a supplied 0..1 confidence to integer points. Anything not a finite number in range fails
 *  SAFE to zero — a malformed value must never buy confidence. */
export function pointsOf(confidence: unknown): number {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return POINTS_MIN;
  const p = Math.round(confidence * 100);
  if (p < POINTS_MIN) return POINTS_MIN;
  if (p > POINTS_MAX) return POINTS_MAX;
  return p;
}

/** An unrecognised trust class is treated as tainted (fail-safe low). */
function trustOf(t: unknown): TrustClass {
  return (typeof t === 'string' && t in TRUST_CEILING) ? (t as TrustClass) : UNKNOWN_TRUST;
}

/** A missing/blank source id cannot be trusted to be independent of anything, so all such items
 *  collapse into ONE synthetic anonymous source rather than counting as many. */
function sourceOf(s: unknown): string {
  return (typeof s === 'string' && s.trim() !== '') ? s : '\u0000anonymous';
}

/** A missing content hash must not defeat dedup by making every item look unique. Items without a
 *  usable hash collapse to a single bucket per source. */
function hashOf(h: unknown, sourceId: string): string {
  return (typeof h === 'string' && h.trim() !== '') ? h : `\u0000nohash:${sourceId}`;
}

interface Normalized { sourceId: string; trust: TrustClass; points: number; contentHash: string; id: string }

function normalize(items: readonly EvidenceItem[]): Normalized[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((e): e is EvidenceItem => !!e && typeof e === 'object')
    .map((e) => {
      const sourceId = sourceOf(e.sourceId);
      return {
        sourceId,
        trust: trustOf(e.trust),
        points: pointsOf(e.confidence),
        contentHash: hashOf(e.contentHash, sourceId),
        id: typeof e.id === 'string' ? e.id : '',
      };
    });
}

/** T3 — deduplicate by content hash so N copies of the same statement count once, no matter how many
 *  identities submitted them. Sorted first so the survivor is a deterministic function of the SET,
 *  not of the order the caller happened to pass them in. */
function dedupe(items: Normalized[]): { kept: Normalized[]; dropped: number } {
  const sorted = [...items].sort((a, b) =>
    a.contentHash.localeCompare(b.contentHash) ||
    a.sourceId.localeCompare(b.sourceId) ||
    a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const kept: Normalized[] = [];
  for (const it of sorted) {
    if (seen.has(it.contentHash)) continue;
    seen.add(it.contentHash);
    kept.push(it);
  }
  return { kept, dropped: items.length - kept.length };
}

/** Per source, the contribution is the source's BEST item, capped. Deliberately max-not-sum: a single
 *  source submitting a thousand items contributes exactly what its strongest one does. */
function perSourceContributions(items: Normalized[]): Map<string, { points: number; trust: TrustClass }> {
  const out = new Map<string, { points: number; trust: TrustClass }>();
  for (const it of items) {
    const prev = out.get(it.sourceId);
    // Keep the best points seen for this source, and the most trusted class seen for it.
    const bestPoints = prev ? Math.max(prev.points, it.points) : it.points;
    const bestTrust = prev && TRUST_CEILING[prev.trust] >= TRUST_CEILING[it.trust] ? prev.trust : it.trust;
    out.set(it.sourceId, { points: Math.min(bestPoints, PER_SOURCE_CAP_POINTS), trust: bestTrust });
  }
  return out;
}

/**
 * Aggregate supporting (and optionally conflicting) evidence into a governed confidence.
 *
 * Shape of the result, in order:
 *   base    = the best single-source contribution, capped at PER_SOURCE_CAP_POINTS (60)
 *   bonus   = DIVERSITY_BONUS_PER_SOURCE per INDEPENDENT source beyond the first, capped
 *   ceiling = the best trust class present; external/tainted ceilings sit below the auto-approve bar
 *   penalty = conflict weakening, capped so a flood of conflicts cannot assassinate a true claim
 *
 * Auto-eligibility is deliberately conjunctive — points alone are never sufficient.
 */
export function aggregateConfidence(
  supporting: readonly EvidenceItem[],
  conflicting: readonly EvidenceItem[] = [],
): ConfidenceResult {
  const reasons: string[] = [];

  const { kept: support, dropped } = dedupe(normalize(supporting));
  if (dropped > 0) reasons.push(`deduped ${dropped} duplicate item(s) by content hash`);

  if (support.length === 0) {
    return {
      points: 0, value: 0, base: 0, diversityBonus: 0, ceiling: 0, conflictPenalty: 0,
      independentSources: 0, distinctSources: 0, duplicatesDropped: dropped, taintedPresent: false,
      autoEligible: false, reasons: [...reasons, 'no usable supporting evidence'],
    };
  }

  const contributions = perSourceContributions(support);
  const distinctSources = contributions.size;

  // T3 + correction #5: only trusted/observed sources count toward independence. An attacker holding
  // a hundred distinct EXTERNAL identities gains no independence at all.
  //
  // A source must also have contributed NON-ZERO points to count. Without this, submitting N sources
  // whose evidence is malformed or worthless (NaN, 0.0) would still buy the full diversity bonus —
  // corroboration by parties who corroborated nothing.
  let independentSources = 0;
  for (const c of contributions.values()) {
    if (c.points > 0 && COUNTS_TOWARD_INDEPENDENCE.includes(c.trust)) independentSources += 1;
  }

  let base = 0;
  let ceiling = 0;
  for (const c of contributions.values()) {
    if (c.points > base) base = c.points;
    const cap = TRUST_CEILING[c.trust];
    if (cap > ceiling) ceiling = cap;
  }

  const diversityBonus = Math.min(
    MAX_DIVERSITY_BONUS,
    DIVERSITY_BONUS_PER_SOURCE * Math.max(0, independentSources - 1),
  );

  // T8 — conflict weakening is capped. One devastating conflict and twenty mediocre ones weigh the
  // same, so flooding conflicts is not a way to destroy an inconvenient true claim.
  const { kept: conflicts } = dedupe(normalize(conflicting));
  let worstConflict = 0;
  for (const c of conflicts) if (c.points > worstConflict) worstConflict = c.points;
  const conflictPenalty = Math.min(MAX_CONFLICT_PENALTY_POINTS, worstConflict);

  const raw = Math.min(base + diversityBonus, ceiling, POINTS_MAX);
  const points = Math.max(POINTS_MIN, raw - conflictPenalty);

  const taintedPresent = support.some((s) => s.trust === 'tainted');

  // Auto-eligibility is conjunctive. Every clause is a distinct attack being refused.
  const enoughPoints = points >= AUTO_APPROVE_POINTS;
  const enoughSources = independentSources >= MIN_INDEPENDENT_SOURCES;
  const unconflicted = conflictPenalty === 0;
  const untainted = !taintedPresent;
  const autoEligible = enoughPoints && enoughSources && unconflicted && untainted;

  if (!enoughPoints) reasons.push(`points ${points} below auto-approve bar ${AUTO_APPROVE_POINTS}`);
  if (!enoughSources) reasons.push(`only ${independentSources} independent trusted source(s); need ${MIN_INDEPENDENT_SOURCES}`);
  if (!unconflicted) reasons.push(`conflicting evidence present (penalty ${conflictPenalty})`);
  if (!untainted) reasons.push('tainted evidence can never auto-promote');
  if (autoEligible) reasons.push(`auto-eligible: ${points} points from ${independentSources} independent sources`);

  return {
    points, value: points / 100, base, diversityBonus, ceiling, conflictPenalty,
    independentSources, distinctSources, duplicatesDropped: dropped, taintedPresent,
    autoEligible, reasons,
  };
}
