// Behavioural + structural detector inputs (TIF-1) — the "does this look right for where it came
// from" checks the proposal's §3 calls the behavioural and structural detector classes. Both are pure
// and deterministic, and both are INPUTS to the one risk scorer (score.ts), never a second scoring
// path — the same way secrets.ts / boundary.ts already hand category evidence to a caller who folds
// it into assessRisk()'s CategoryScores. Deterministic and semantic detectors are already covered by
// the existing vetting.ts (SIGNALS/INJECTION) and taint.ts (INGRESS_EXTRA); a constrained semantic
// classifier is deliberately not implemented here — it would need a model call, and governance-core
// stays network-free and off the PDP's synchronous hot path by design (see the plan's §4 constraint).
import type { CategoryId } from './riskmatrix';
import {
  STRUCTURAL_FEATURES, UNEXPECTED_CATEGORIES_FOR_SOURCE,
  type SourceKindForBehaviour, type StructuralFeature,
} from './evidencetypes';

export interface BehaviouralCheck {
  sourceKind: SourceKindForBehaviour;
  requestedCategories: CategoryId[];   // the risk categories the proposed action touches, from the tool's own risk evidence
}

export interface BehaviouralFinding {
  violates: boolean;
  unexpected: CategoryId[];            // the subset that should never come from this source kind
  reason: string;
}

/** "Reading a permit should not cause credential access" (the proposal's own example) — a request
 *  from an external source touching a category that source kind should never legitimately need is
 *  itself a signal, independent of anything in the request's wording. An unrecognised source kind
 *  fails closed to the strictest table entry (http's) rather than being treated as internal/trusted. */
export function classifyBehaviour(check: BehaviouralCheck): BehaviouralFinding {
  const forbidden = UNEXPECTED_CATEGORIES_FOR_SOURCE[check.sourceKind] ?? UNEXPECTED_CATEGORIES_FOR_SOURCE.http;
  const unexpected = check.requestedCategories.filter((c) => forbidden.includes(c));
  if (unexpected.length === 0) {
    return { violates: false, unexpected: [], reason: 'no unexpected-category request for this source kind' };
  }
  return {
    violates: true,
    unexpected,
    reason: `${check.sourceKind} source requested categor${unexpected.length === 1 ? 'y' : 'ies'} ${unexpected.join(', ')}, never expected from this source kind`,
  };
}

/** Normalize a caller-reported document/content location into the known structural-feature
 *  vocabulary. governance-core stays parser-free by design (the actual PDF/image/HTML parsing lives
 *  outside this package, per the File Arena design) — this function only classifies what a parser
 *  already reported. An unrecognised value fails closed to 'suspicious-unclassified' rather than
 *  being silently dropped, so a caller can never make a hazard disappear by reporting a made-up tag. */
export function classifyStructuralFeature(reported: string): StructuralFeature {
  const norm = reported.trim().toLowerCase();
  const hit = STRUCTURAL_FEATURES.find((f) => f === norm);
  return hit ?? 'suspicious-unclassified';
}

/** Dedupe + classify a batch, preserving classifyStructuralFeature's fail-closed behaviour. */
export function classifyStructuralFeatures(reported: readonly string[]): StructuralFeature[] {
  const out = new Set<StructuralFeature>();
  for (const r of reported) out.add(classifyStructuralFeature(r));
  return [...out];
}
