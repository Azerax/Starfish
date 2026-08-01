// Threat Evidence — types and constant tables for the Threat Immunity Fabric (TIF). Ring 1 (TCB).
//
// Pure DATA LEAF: types, unions, and frozen constant tables, zero logic, imports only from ./types
// and ./riskmatrix — the same reason wikitypes.ts / riskmatrix.ts exist as leaves next to their gate
// (evidence.ts consumes this, exactly the way wikigate.ts consumes wikitypes.ts).
//
// Design: docs/design/THREAT_IMMUNITY_FABRIC_PLAN.md, increment TIF-0. This is the additive schema
// slice — nothing here is wired into pdp.ts / score.ts.combine() yet. A `FabricAction` is ADVISORY
// input a future local adoption engine (TIF-7, not built) would feed into the ONE risk model
// (score.ts's assessRisk/verdictFor); it is never itself an authorization, and no module in this
// increment calls pdp.decide(). High confidence that something is malicious does not automatically
// authorize a high-impact response (proposal §9) — that separation is structural here, not a promise.
import type { RiskTier } from './types';
import type { CategoryId } from './riskmatrix';

// ---------------------------------------------------------------------------
// Threat taxonomy
// ---------------------------------------------------------------------------

export type ThreatFamily =
  | 'instruction_override' | 'data_exfiltration' | 'memory_poisoning' | 'credential_exfiltration'
  | 'privilege_escalation' | 'persistence' | 'impersonation' | 'denial_of_service' | 'other';

export const THREAT_FAMILIES: readonly ThreatFamily[] = Object.freeze([
  'instruction_override', 'data_exfiltration', 'memory_poisoning', 'credential_exfiltration',
  'privilege_escalation', 'persistence', 'impersonation', 'denial_of_service', 'other',
]);

/** Severity reuses RiskTier — the repo's one severity vocabulary (score.ts) — instead of a second
 *  scale. 'injection' is excluded: that value means "off-scale hard reject" in score.ts, not a graded
 *  severity a validator assigns to a threat family. */
export type ThreatSeverity = Exclude<RiskTier, 'injection'>;

// ---------------------------------------------------------------------------
// Detector classes (proposal §3) — a label on a finding, not a scoring axis of its own. A detector's
// result is category evidence a caller folds into score.ts's assessRisk(); this module never scores.
// ---------------------------------------------------------------------------

export type DetectorClass = 'deterministic' | 'structural' | 'semantic' | 'behavioural' | 'canary';
export const DETECTOR_CLASSES: readonly DetectorClass[] = Object.freeze([
  'deterministic', 'structural', 'semantic', 'behavioural', 'canary',
]);

export interface DetectorFinding {
  detectorId: string;
  class: DetectorClass;
  result: 'positive' | 'negative' | 'inconclusive';
  confidence?: number;    // 0..1, only meaningful for semantic/behavioural findings
  detail?: string;
}

// ---------------------------------------------------------------------------
// Fabric action (proposal §4) — advisory only. See file-top note.
// ---------------------------------------------------------------------------

export type FabricAction =
  | 'observe' | 'warn' | 'restrict' | 'quarantine' | 'block-local' | 'block-tenant' | 'block-domain';

export const FABRIC_ACTIONS: readonly FabricAction[] = Object.freeze([
  'observe', 'warn', 'restrict', 'quarantine', 'block-local', 'block-tenant', 'block-domain',
]);

export type PublicationScope = 'local' | 'tenant' | 'trust-domain' | 'global';
export const PUBLICATION_SCOPES: readonly PublicationScope[] = Object.freeze([
  'local', 'tenant', 'trust-domain', 'global',
]);

// ---------------------------------------------------------------------------
// Validation lifecycle (proposal §8) — OBSERVED -> ... -> RETIRED | REVOKED.
// ---------------------------------------------------------------------------

export type EvidenceStage =
  | 'observed' | 'reproduced' | 'corroborated' | 'approved' | 'published' | 'deployed' | 'retired' | 'revoked';

export const EVIDENCE_STAGES: readonly EvidenceStage[] = Object.freeze([
  'observed', 'reproduced', 'corroborated', 'approved', 'published', 'deployed', 'retired', 'revoked',
]);

/** Terminal stages — no further transition is ever valid from these. Mirrors T12's "nothing is ever
 *  hard-removed": a revoked/retired record stays in the ledger, it just cannot move again. */
export const TERMINAL_STAGES: readonly EvidenceStage[] = Object.freeze(['retired', 'revoked']);

/** The ONLY forward edges the lifecycle gate accepts, keyed by current stage. `revoked` is reachable
 *  from every non-terminal stage (proposal §15 — revocation is first-class and must be faster than
 *  the ordinary path, never gated behind reaching a particular stage first). */
function edges(to: EvidenceStage[]): readonly EvidenceStage[] { return Object.freeze(to); }
export const ALLOWED_TRANSITIONS: Readonly<Record<EvidenceStage, readonly EvidenceStage[]>> = Object.freeze({
  observed: edges(['reproduced', 'revoked']),
  reproduced: edges(['corroborated', 'revoked']),
  corroborated: edges(['approved', 'revoked']),
  approved: edges(['published', 'revoked']),
  published: edges(['deployed', 'retired', 'revoked']),
  deployed: edges(['retired', 'revoked']),
  retired: edges([]),
  revoked: edges([]),
});

// ---------------------------------------------------------------------------
// Independent validation quorum (proposal §8's CORROBORATED / APPROVED). Mirrors wikitypes.ts's
// DUAL_CONTROL_N — the repo's existing precedent for "N distinct identities, not N submissions".
// ---------------------------------------------------------------------------

/** How many DISTINCT validator identities (excluding the publisher) must corroborate a candidate
 *  before it may advance past REPRODUCED. Corroboration from a single validator is not corroboration
 *  (same principle as confidence.ts's MIN_INDEPENDENT_SOURCES). */
export const CORROBORATION_MIN_VALIDATORS = 2;

/** APPROVED always needs an approver distinct from the publisher — proposer != approver, the same
 *  invariant scope.ts (amend) and wikigate.ts (evaluate) already enforce. A validator becoming the
 *  approver is fine; what must never happen is the publisher approving its own evidence. */
export const APPROVAL_REQUIRES_DISTINCT_FROM_PUBLISHER = true;

// ---------------------------------------------------------------------------
// Structural indicator vocabulary (proposal §7) — location/placement features a caller (a parser
// living outside governance-core, per the File Arena design) can report. An unrecognised value fails
// closed to 'suspicious-unclassified' rather than being silently dropped.
// ---------------------------------------------------------------------------

export type StructuralFeature =
  | 'pdf-footer' | 'image-metadata' | 'hidden-text' | 'html-comment' | 'data-column'
  | 'system-role-in-user-content' | 'zip-nested-archive' | 'suspicious-unclassified';

export const STRUCTURAL_FEATURES: readonly StructuralFeature[] = Object.freeze([
  'pdf-footer', 'image-metadata', 'hidden-text', 'html-comment', 'data-column',
  'system-role-in-user-content', 'zip-nested-archive', 'suspicious-unclassified',
]);

// ---------------------------------------------------------------------------
// Behavioural "expected relationship" table (proposal §3's behavioural detector / §4's risk input).
// Maps an external-source kind to the risk categories a request FROM that kind of source is never
// expected to touch. Reuses riskmatrix.ts's CategoryId — this is an INPUT to the one scorer, not a
// second one (score.ts stays the only place a composite is computed).
// ---------------------------------------------------------------------------

export type SourceKindForBehaviour = 'mcp' | 'http' | 'site' | 'upload' | 'internal';

/** Category ids that a request originating from this source kind should never legitimately need.
 *  #11 secrets, #29 self-governance and #8 arbitrary exec are the three hard-deny floors
 *  (riskmatrix.ts) that no external content should ever be the REASON a call touches — "reading a
 *  permit should not cause credential access" (the proposal's own example). `internal`
 *  (operator-originated) is exempt by construction. */
export const UNEXPECTED_CATEGORIES_FOR_SOURCE: Readonly<Record<SourceKindForBehaviour, readonly CategoryId[]>> = Object.freeze({
  mcp: Object.freeze([11, 29]),
  http: Object.freeze([8, 11, 29]),
  site: Object.freeze([8, 11, 29]),
  upload: Object.freeze([8, 29]),
  internal: Object.freeze([]),
});
