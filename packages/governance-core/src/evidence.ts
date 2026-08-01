// Threat Evidence Envelope + validation lifecycle (TIF-0 / TIF-3 / TIF-4). A detected attack becomes
// a governed evidence object that moves through a controlled lifecycle instead of an immediate
// network-wide block: OBSERVED -> REPRODUCED -> CORROBORATED -> APPROVED -> PUBLISHED -> (DEPLOYED)
// -> RETIRED | REVOKED. Design: docs/design/THREAT_IMMUNITY_FABRIC_PLAN.md.
//
// What this module is NOT: it is not a second decision engine. `publication.recommendedAction` is
// advisory (evidencetypes.ts's file-top note); this class never calls pdp.decide() and never performs
// network I/O (publish() only marks a local record ready — governance-core stays network-free, the
// same discipline gateway.ts holds for external sources). TIF-6 (a real broker) and TIF-7 (a local
// adoption engine that actually folds a recommendation into score.ts's CategoryScores) are separate,
// not-yet-built increments.
//
// Ledger wiring (TIF-4): every transition is audit.append()-ed under the 'threat' domain — no new
// ledger infrastructure. audit.ts + anchor.ts already give this hash-chained, tamper-evident, and
// (optionally) externally notarized for free.
//
// Tamper-evidence (mirrors scope.ts's seal() / wikigate.ts's sealApproval()): the fields fixed at
// OBSERVE time are sealed; every later transition re-verifies the seal before acting, so an
// out-of-band edit to a stored envelope is caught the next time anyone tries to move it forward.
import { randomUUID } from 'node:crypto';
import { sha256 } from './hash';
import { GovernanceError } from './types';
import type { AuditLog } from './audit';
import type { RiskAssessment } from './score';
import {
  ALLOWED_TRANSITIONS, CORROBORATION_MIN_VALIDATORS, TERMINAL_STAGES,
  type DetectorFinding, type EvidenceStage, type FabricAction, type PublicationScope,
  type StructuralFeature, type ThreatFamily, type ThreatSeverity,
} from './evidencetypes';

export interface DecisionReceipt {
  decision: FabricAction;
  riskScore: number;
  policyVersion: string;
  detectors: DetectorFinding[];
  contentCommitment: string;
  agentId: string;
  at: string;
}

export interface ThreatIndicators {
  exactHashes: string[];
  normalizedFragments: string[];
  fuzzyFingerprints: string[];
  semanticIntents: string[];
  structuralFeatures: StructuralFeature[];
  behaviouralIndicators: string[];
}

const EMPTY_INDICATORS: ThreatIndicators = Object.freeze({
  exactHashes: [], normalizedFragments: [], fuzzyFingerprints: [],
  semanticIntents: [], structuralFeatures: [], behaviouralIndicators: [],
}) as ThreatIndicators;

export interface ThreatEvidenceEnvelope {
  schema: 'starfish.threat-evidence.v1';
  evidenceId: string;
  publisher: string;             // local actor id today; cross-org publisher identity is TIF-5
  detectedAt: string;
  threat: { family: ThreatFamily; vector: string; target: string; severity: ThreatSeverity; techniques: string[] };
  scope: { tenant?: string; agentTypes?: string[]; tools?: string[]; expiresAt?: string };
  indicators: ThreatIndicators;
  evidence: {
    contentCommitment: string;   // sha256 over the raw candidate content — the raw content itself never travels in the envelope
    decisionReceipt: DecisionReceipt;
    runtimeSnapshotRef?: string;
    reproductionCaseRef?: string;
  };
  validation: { stage: EvidenceStage; requiredQuorum: number; validators: string[] };
  publication: { recommendedAction: FabricAction; maximumScope: PublicationScope; automaticBlockingAllowed: boolean };
  seal: string;
}

type SealedFields = Pick<ThreatEvidenceEnvelope, 'evidenceId' | 'publisher' | 'detectedAt' | 'threat' | 'scope' | 'indicators' | 'evidence' | 'publication'>;

// Sealed over the facts fixed AT OBSERVE TIME only. `evidence.runtimeSnapshotRef` and
// `evidence.reproductionCaseRef` are deliberately EXCLUDED: reproductionCaseRef by definition isn't
// known until reproduce() runs, so sealing it at observe time would make every reproduction look like
// tamper on the very next transition. `contentCommitment` and `decisionReceipt` — the two fields that
// ARE fixed by what was observed — stay sealed.
function sealFields(f: SealedFields): string {
  return sha256(JSON.stringify({
    evidenceId: f.evidenceId, publisher: f.publisher, detectedAt: f.detectedAt,
    threat: f.threat, scope: f.scope, indicators: f.indicators,
    evidence: { contentCommitment: f.evidence.contentCommitment, decisionReceipt: f.evidence.decisionReceipt },
    publication: f.publication,
  }));
}

/** Recompute the seal over an envelope's observe-time fields (exposed for callers that build an
 *  envelope's fields by hand, e.g. importing one received from a broker in a later increment). */
export function sealEnvelope(e: ThreatEvidenceEnvelope): string { return sealFields(e); }

/** T9-style re-verification (wikigate.ts's verifyBinding): does the envelope's current content still
 *  match the seal computed at observe time? A mismatch means an out-of-band edit, not a lifecycle
 *  transition — the lifecycle methods below only ever touch `validation`, never the sealed fields. */
export function verifyEnvelopeSeal(e: ThreatEvidenceEnvelope): { ok: boolean; reason: string } {
  return sealFields(e) === e.seal
    ? { ok: true, reason: 'seal verified' }
    : { ok: false, reason: 'threat evidence envelope tampered — seal mismatch' };
}

/** sha256 helper under the proposal's own vocabulary — never send the raw candidate content itself. */
export function contentCommitment(raw: string): string { return sha256(raw); }

/** Wrap an existing RiskAssessment (score.ts — the ONE risk model) into a DecisionReceipt. This
 *  module does not compute risk itself; it only records what the one scorer already decided. */
export function buildDecisionReceipt(input: {
  action: FabricAction; assessment: RiskAssessment; policyVersion: string;
  detectors: DetectorFinding[]; contentCommitment: string; agentId: string; at: string;
}): DecisionReceipt {
  return {
    decision: input.action, riskScore: input.assessment.score, policyVersion: input.policyVersion,
    detectors: [...input.detectors], contentCommitment: input.contentCommitment,
    agentId: input.agentId, at: input.at,
  };
}

export interface ObserveInput {
  publisher: string;
  threat: ThreatEvidenceEnvelope['threat'];
  scope: ThreatEvidenceEnvelope['scope'];
  indicators?: Partial<ThreatIndicators>;
  decisionReceipt: DecisionReceipt;
  recommendedAction: FabricAction;
  maximumScope?: PublicationScope;
  automaticBlockingAllowed?: boolean;
  runtimeSnapshotRef?: string;
  reproductionCaseRef?: string;
  requiredQuorum?: number;
}

export class EvidenceLifecycle {
  private envelopes = new Map<string, ThreatEvidenceEnvelope>();
  constructor(private audit: AuditLog, private approvers: Set<string> = new Set(['god', 'human'])) {}

  get(evidenceId: string): ThreatEvidenceEnvelope | undefined { return this.envelopes.get(evidenceId); }
  list(): ThreatEvidenceEnvelope[] { return [...this.envelopes.values()]; }

  private require(evidenceId: string): ThreatEvidenceEnvelope {
    const e = this.envelopes.get(evidenceId);
    if (!e) throw new GovernanceError(`no threat evidence for ${evidenceId}`);
    const v = verifyEnvelopeSeal(e);
    if (!v.ok) throw new GovernanceError(v.reason);
    return e;
  }

  private assertTransition(evidenceId: string, to: EvidenceStage): ThreatEvidenceEnvelope {
    const e = this.require(evidenceId);
    if (!ALLOWED_TRANSITIONS[e.validation.stage].includes(to)) {
      throw new GovernanceError(`illegal transition ${e.validation.stage} -> ${to}`);
    }
    return e;
  }

  /** Stage 1 — a detected attack becomes a governed evidence object. NOT an authorization: see
   *  file-top note. Contain-locally-first (proposal §5) is the caller's job, before this is called —
   *  this method only records what was observed and contained. */
  observe(input: ObserveInput): ThreatEvidenceEnvelope {
    const evidenceId = 'te-' + randomUUID().slice(0, 12);
    const detectedAt = new Date().toISOString();
    const sealed: SealedFields = {
      evidenceId, publisher: input.publisher, detectedAt,
      threat: input.threat, scope: { ...input.scope },
      indicators: { ...EMPTY_INDICATORS, ...(input.indicators ?? {}) },
      evidence: {
        contentCommitment: input.decisionReceipt.contentCommitment,
        decisionReceipt: input.decisionReceipt,
        runtimeSnapshotRef: input.runtimeSnapshotRef,
        reproductionCaseRef: input.reproductionCaseRef,
      },
      publication: {
        recommendedAction: input.recommendedAction,
        maximumScope: input.maximumScope ?? 'local',
        automaticBlockingAllowed: input.automaticBlockingAllowed ?? false,
      },
    };
    const envelope: ThreatEvidenceEnvelope = {
      schema: 'starfish.threat-evidence.v1',
      ...sealed,
      validation: { stage: 'observed', requiredQuorum: input.requiredQuorum ?? CORROBORATION_MIN_VALIDATORS, validators: [] },
      seal: sealFields(sealed),
    };
    this.envelopes.set(evidenceId, envelope);
    this.audit.append({
      actor: input.publisher, domain: 'threat', action: 'evidence:observe', target: evidenceId,
      decision: 'allow', riskTier: envelope.threat.severity,
      reason: `${envelope.threat.family} via ${envelope.threat.vector} — recommended:${input.recommendedAction}`,
    });
    return envelope;
  }

  /** Stage 2 — replay the candidate in isolation. TIF-2's reproduction sandbox (not built in this
   *  increment) supplies `outcome`; this module only records the verdict, it never runs anything
   *  itself. A failed reproduction does NOT advance the stage — claims.ts's "no unbacked word" applies
   *  to evidence exactly as it applies to an agent's claims. */
  reproduce(evidenceId: string, actor: string, outcome: { ok: boolean; detail: string }): ThreatEvidenceEnvelope {
    const e = this.assertTransition(evidenceId, 'reproduced');
    if (!outcome.ok) {
      this.audit.append({ actor, domain: 'threat', action: 'evidence:reproduce', target: evidenceId, decision: 'deny', reason: `reproduction failed — stage unchanged: ${outcome.detail}` });
      return e;
    }
    e.validation.stage = 'reproduced';
    e.evidence.reproductionCaseRef = e.evidence.reproductionCaseRef ?? outcome.detail;
    this.audit.append({ actor, domain: 'threat', action: 'evidence:reproduce', target: evidenceId, decision: 'allow', reason: outcome.detail });
    return e;
  }

  /** Stage 3 — independent validators, distinct from the publisher and from each other, must agree
   *  before a human is asked to approve. One validator is not corroboration (confidence.ts's
   *  MIN_INDEPENDENT_SOURCES, same principle). Idempotent re-corroboration by the same validator is a
   *  no-op, not double-counted. */
  corroborate(evidenceId: string, validatorId: string): ThreatEvidenceEnvelope {
    const e = this.require(evidenceId);
    if (e.validation.stage !== 'reproduced' && e.validation.stage !== 'corroborated') {
      throw new GovernanceError(`cannot corroborate from stage '${e.validation.stage}' — must be reproduced first`);
    }
    if (validatorId === e.publisher) {
      this.audit.append({ actor: validatorId, domain: 'threat', action: 'evidence:corroborate', target: evidenceId, decision: 'deny', reason: 'publisher cannot corroborate their own evidence' });
      throw new GovernanceError('publisher cannot corroborate their own evidence');
    }
    if (!e.validation.validators.includes(validatorId)) e.validation.validators.push(validatorId);
    const distinct = e.validation.validators.length;
    this.audit.append({ actor: validatorId, domain: 'threat', action: 'evidence:corroborate', target: evidenceId, reason: `${distinct}/${e.validation.requiredQuorum} distinct validator(s)` });
    if (e.validation.stage === 'reproduced' && distinct >= e.validation.requiredQuorum) {
      e.validation.stage = 'corroborated';
      this.audit.append({ actor: 'governance', domain: 'threat', action: 'evidence:corroborated', target: evidenceId, decision: 'allow', reason: `quorum reached (${distinct}/${e.validation.requiredQuorum})` });
    }
    return e;
  }

  /** Stage 4 — a human distinct from the publisher approves. Proposer != approver, ported from
   *  scope.ts (amend) / wikigate.ts (evaluate). */
  approve(evidenceId: string, approverId: string): ThreatEvidenceEnvelope {
    const e = this.assertTransition(evidenceId, 'approved');
    if (approverId === e.publisher) {
      this.audit.append({ actor: approverId, domain: 'threat', action: 'evidence:approve', target: evidenceId, decision: 'deny', reason: 'publisher cannot approve their own evidence' });
      throw new GovernanceError('publisher cannot approve their own evidence');
    }
    if (!this.approvers.has(approverId)) {
      this.audit.append({ actor: approverId, domain: 'threat', action: 'evidence:approve', target: evidenceId, decision: 'deny', reason: 'not-an-approver' });
      throw new GovernanceError(`${approverId} is not an approver`);
    }
    e.validation.stage = 'approved';
    this.audit.append({ actor: approverId, domain: 'threat', action: 'evidence:approve', target: evidenceId, decision: 'allow', reason: `approved by ${approverId}` });
    return e;
  }

  /** Stage 5 — marks the record ready for a broker (TIF-6, not built) to distribute. Publishing from
   *  this module never performs network I/O itself (governance-core stays network-free). */
  publish(evidenceId: string, actor: string): ThreatEvidenceEnvelope {
    const e = this.assertTransition(evidenceId, 'published');
    e.validation.stage = 'published';
    this.audit.append({ actor, domain: 'threat', action: 'evidence:publish', target: evidenceId, decision: 'allow', reason: `scope=${e.publication.maximumScope}` });
    return e;
  }

  /** Stage 6 — records that a receiving org turned the recommendation into a running local action.
   *  The actual enforcement wiring (TIF-7's local adoption engine) is a separate, not-yet-built
   *  increment; this call only records the fact, with the caller's own detail of what it did. */
  deploy(evidenceId: string, actor: string, detail: string): ThreatEvidenceEnvelope {
    const e = this.assertTransition(evidenceId, 'deployed');
    e.validation.stage = 'deployed';
    this.audit.append({ actor, domain: 'threat', action: 'evidence:deploy', target: evidenceId, decision: 'allow', reason: detail });
    return e;
  }

  /** Natural end of life, from 'published' or 'deployed' only — never skips validation. */
  retire(evidenceId: string, actor: string, reason: string): ThreatEvidenceEnvelope {
    const e = this.assertTransition(evidenceId, 'retired');
    e.validation.stage = 'retired';
    this.audit.append({ actor, domain: 'threat', action: 'evidence:retire', target: evidenceId, decision: 'allow', reason });
    return e;
  }

  /** §15 — revocation is first-class and reachable from every non-terminal stage; it must never be
   *  gated behind reaching a particular stage first. Always audited under its own action name so a
   *  receiver polling the ledger can prioritize revocations ahead of ordinary lifecycle events. */
  revoke(evidenceId: string, actor: string, reason: string): ThreatEvidenceEnvelope {
    const e = this.require(evidenceId);
    if (TERMINAL_STAGES.includes(e.validation.stage)) throw new GovernanceError(`cannot revoke from terminal stage '${e.validation.stage}'`);
    const from = e.validation.stage;
    e.validation.stage = 'revoked';
    this.audit.append({ actor, domain: 'threat', action: 'evidence:revoke', target: evidenceId, decision: 'deny', riskTier: 'critical', reason: `${reason} (was: ${from})` });
    return e;
  }

  /** §15 — TTL-driven expiry, distinct from an operator revocation. `nowIso` is caller-supplied (not
   *  read from the wall clock inside) so the decision stays a deterministic function of its inputs. A
   *  no-op if there's no expiry set, it hasn't passed, or the record is already terminal. */
  expire(evidenceId: string, nowIso: string): ThreatEvidenceEnvelope {
    const e = this.require(evidenceId);
    if (TERMINAL_STAGES.includes(e.validation.stage)) return e;
    if (!e.scope.expiresAt || nowIso < e.scope.expiresAt) return e;
    e.validation.stage = 'retired';
    this.audit.append({ actor: 'system', domain: 'threat', action: 'evidence:expire', target: evidenceId, reason: `expired at ${e.scope.expiresAt}` });
    return e;
  }

  snapshot(): ThreatEvidenceEnvelope[] { return this.list(); }
  restore(arr: ThreatEvidenceEnvelope[]): void { this.envelopes = new Map(arr.map((e) => [e.evidenceId, e])); }
}
