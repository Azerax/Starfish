// Governed memory (framework §9; Scott's evidence→knowledge model). Layers 1-3 of the memory stack:
// evidence → claim → governance gate. Layer 4+ (canonical pages, typed links, retrieval) lives in
// wiki.ts / retrieval.ts, which COMPOSE this class rather than extending it.
//
// Core principle: nothing is remembered because an LLM said it — everything traces to evidence,
// passes governance, and exists as a versioned object with provenance.
//
// Nine defects found in the 2026-07-20 audit are fixed here (see wiki/memorywiki.md for the full
// record). The load-bearing ones:
//   D1 — the store had NO persistence: all memory was lost on every restart.
//   D2 — proposer != approver was NOT enforced (only `approver !== 'system'`), so a proposer could
//        approve their own claim. Ported from the reference implementation in scope.ts.
//   D3 — the gate failed OPEN: PolicyEngine returns 'nomatch' when no rule matches, and
//        'nomatch' !== 'ask', so the ABSENCE of policy permitted auto-approval. Now fails closed.
//   D4 — the policy call used bare names, violating the agent:<id> / tool:<name> convention that
//        seed.ts documents, so per-agent memory policy could never match.
//   D5 — confidence was an arithmetic mean, trivially gamed by flooding. Now routed through the
//        robust aggregation in confidence.ts.
//   D6 — getters returned live Map references, so callers could mutate "immutable" evidence.
//   D7 — no injection screening on the write path: external text could become knowledge unscreened.
import { randomUUID } from 'node:crypto';
import type { AuditLog } from './audit';
import type { PolicyEngine } from './policy';
import { sha256 } from './hash';
import { screenIngress } from './taint';
import { aggregateConfidence, type ConfidenceResult, type EvidenceItem } from './confidence';
import {
  MEMORY_SCHEMA, MEMORY_SCHEMA_VERSION, type RestoreResult, type TrustClass,
} from './wikitypes';
import { GovernanceError } from './types';

const sid = (p: string) => `${p}_${randomUUID().slice(0, 8)}`;

export interface Evidence {
  id: string;
  source: string;
  author: string;
  statement: string;
  confidence: number;
  at: string;
  /** System-stamped, never proposer-declared. Defaults to 'observed' — a caller must explicitly
   *  declare 'trusted' for evidence to be able to carry a claim to auto-approval. */
  trust: TrustClass;
  /** The independent-origin identity used by the aggregation. Defaults to `source:author`. */
  sourceId: string;
  /** sha256 of the statement — the dedup key that makes copies count once (T3). */
  contentHash: string;
  /** T2 / correction #4 — screened-positive content is written IMMUTABLY but flagged, and is never
   *  eligible to support a promotion. Quarantine must never be implemented as deletion (T12). */
  quarantined: boolean;
  quarantineReasons: string[];
}

export interface Claim {
  id: string;
  statement: string;
  confidence: number;                  // 0..1 view of `robust.points`, kept for compatibility
  supportedBy: string[];
  status: 'candidate' | 'approved' | 'rejected';
  /** Who proposed it — required to enforce proposer != approver (D2). */
  proposer: string;
  conflictedBy: string[];
  robust: ConfidenceResult;
  /** T9 — set when the claim is approved: binds the exact evidence set that was approved, so a
   *  post-approval swap is detected at promotion time rather than silently promoted. */
  approvalBinding?: { hash: string; approver: string; at: string };
}

export interface Entity {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  provenance: { claimId: string; evidence: string[] };
}

export interface DecisionRecord {
  id: string;
  decision: string;
  reason: string;
  alternatives: string[];
  status: 'accepted' | 'rejected' | 'superseded';
  provenance: { evidence: string[] };
}

export interface MemorySnapshot {
  schema: typeof MEMORY_SCHEMA;
  version: typeof MEMORY_SCHEMA_VERSION;
  evidence: Evidence[];
  claims: Claim[];
  knowledge: Entity[];
  decisions: DecisionRecord[];
  hash: string;
  writtenAt: string;
}

export interface GovernedMemoryOptions {
  /** Defence in depth for "only Herodotus writes". The PDP is the real enforcement point (via the
   *  tool registry's allowedAgents), but an in-process guard makes the invariant testable and stops
   *  a library caller bypassing it entirely. */
  soleWriter?: string;
  /** Identities permitted to approve a queued claim. Mirrors ScopeContractLedger's approver set. */
  approvers?: Set<string>;
}

/** Deep-freeze a structured copy, so a getter can never hand out a live store reference (D6). */
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

/** Order-independent canonical hash over a keyed collection — same idea as vetting.hashFiles, so a
 *  re-serialization in a different Map order still verifies. */
function canonicalHash(parts: Record<string, { id: string }[]>): string {
  const chunks: string[] = [];
  for (const key of Object.keys(parts).sort()) {
    const rows = [...parts[key]].sort((a, b) => a.id.localeCompare(b.id));
    chunks.push(`${key}\n${rows.map((r) => JSON.stringify(r)).join('\0')}`);
  }
  return sha256(chunks.join('\0\0'));
}

export class GovernedMemory {
  private evidence = new Map<string, Evidence>();
  private claims = new Map<string, Claim>();
  private knowledge = new Map<string, Entity>();
  private decisions = new Map<string, DecisionRecord>();
  private readonly soleWriter?: string;
  private readonly approvers: Set<string>;

  constructor(
    private audit: AuditLog,
    private policy: PolicyEngine,
    opts: GovernedMemoryOptions = {},
  ) {
    this.soleWriter = opts.soleWriter;
    this.approvers = opts.approvers ?? new Set(['god', 'human', 'scott']);
  }

  /** D8 (in-process half) — reject a write from anyone but the designated sole writer. */
  private guardWriter(actor: string, action: string): void {
    if (this.soleWriter && actor !== this.soleWriter) {
      this.audit.append({
        actor, domain: 'memory', action, decision: 'deny',
        reason: `only ${this.soleWriter} may write memory`,
      });
      throw new GovernanceError(`memory is write-restricted to ${this.soleWriter}; ${actor} refused`);
    }
  }

  /** Layer 1 — evidence: immutable, append-only, provenance-stamped, injection-screened (D7). */
  addEvidence(
    e: Omit<Evidence, 'id' | 'at' | 'trust' | 'sourceId' | 'contentHash' | 'quarantined' | 'quarantineReasons'>
      & Partial<Pick<Evidence, 'trust' | 'sourceId'>>,
  ): Evidence {
    this.guardWriter(e.author, 'evidence:add');

    // T2 — screen on the way IN. Screened-positive content is still recorded (evidence is
    // append-only and must stay auditable) but is flagged and downgraded to tainted, which the
    // aggregation then refuses to let auto-promote.
    const screen = screenIngress(e.statement, { audit: this.audit, actor: e.author });
    const quarantined = !screen.ok;

    const ev: Evidence = {
      ...e,
      id: sid('ev'),
      at: new Date().toISOString(),
      trust: quarantined ? 'tainted' : (e.trust ?? 'observed'),
      sourceId: e.sourceId ?? `${e.source}:${e.author}`,
      contentHash: sha256(e.statement),
      quarantined,
      quarantineReasons: quarantined ? screen.reasons : [],
    };
    this.evidence.set(ev.id, ev);
    this.audit.append({
      actor: e.author, domain: 'memory', action: 'evidence:add', target: ev.id, reason: e.source,
      ...(quarantined ? { decision: 'deny' as const, riskTier: 'injection' as const } : {}),
      detail: { trust: ev.trust, contentHash: ev.contentHash, quarantined },
    });
    return frozenCopy(ev);
  }

  /** Map stored evidence into the aggregation's input shape. Quarantined evidence is excluded from
   *  support entirely — it exists and is auditable, but it can never carry a claim (correction #4). */
  private itemsFor(ids: string[]): EvidenceItem[] {
    const out: EvidenceItem[] = [];
    for (const id of ids) {
      const e = this.evidence.get(id);
      if (!e || e.quarantined) continue;
      out.push({ id: e.id, sourceId: e.sourceId, trust: e.trust, confidence: e.confidence, contentHash: e.contentHash });
    }
    return out;
  }

  private recompute(c: Claim): void {
    c.robust = aggregateConfidence(this.itemsFor(c.supportedBy), this.itemsFor(c.conflictedBy));
    c.confidence = c.robust.value;
  }

  /** Layer 2 — claim proposed FROM evidence (never asserted). Confidence comes from the robust,
   *  diversity-weighted aggregation in confidence.ts, NOT a mean (D5 / T3 / T8). */
  proposeClaim(statement: string, supportedBy: string[], proposer: string): Claim {
    this.guardWriter(proposer, 'claim:propose');
    const c: Claim = {
      id: sid('claim'), statement, confidence: 0, supportedBy, status: 'candidate',
      proposer, conflictedBy: [], robust: aggregateConfidence([]),
    };
    this.recompute(c);
    this.claims.set(c.id, c);
    this.audit.append({
      actor: proposer, domain: 'memory', action: 'claim:propose', target: c.id,
      reason: `confidence=${c.confidence.toFixed(2)}`,
      detail: { points: c.robust.points, independentSources: c.robust.independentSources, autoEligible: c.robust.autoEligible },
    });
    return frozenCopy(c);
  }

  /** Conflicting evidence weakens a candidate claim (defeasible). The penalty is capped inside the
   *  aggregation so a flood of conflicts cannot assassinate a true claim (T8). */
  addConflictingEvidence(claimId: string, evidenceId: string): void {
    const c = this.claims.get(claimId);
    const e = this.evidence.get(evidenceId);
    if (!c || !e) return;
    if (!c.conflictedBy.includes(evidenceId)) c.conflictedBy.push(evidenceId);
    this.recompute(c);
    this.audit.append({
      actor: 'system', domain: 'memory', action: 'claim:conflict', target: claimId,
      reason: `confidence->${c.confidence.toFixed(2)}`,
    });
  }

  /** T9 — the exact content an approval binds to. Promotion re-derives this and refuses on drift. */
  private bindingHash(c: Claim): string {
    return canonicalHash({
      claim: [{ id: c.id, statement: c.statement } as { id: string }],
      evidence: [...c.supportedBy]
        .map((id) => this.evidence.get(id))
        .filter((e): e is Evidence => !!e)
        .map((e) => ({ id: e.id, contentHash: e.contentHash, trust: e.trust, confidence: e.confidence })),
    });
  }

  /**
   * Layer 3 — the deterministic governance gate.
   *
   * Auto-approval now requires ALL of: low stakes, an explicit policy `allow`, and the aggregation's
   * own `autoEligible` (enough points, enough independent trusted sources, no conflicts, no taint).
   *
   * D3: a policy result of 'nomatch' no longer auto-approves. The absence of a rule is not consent.
   * D4: the policy triple follows the mandatory agent:<id> / tool:<name> convention.
   * D2: an approver may not be the proposer.
   */
  evaluateClaim(claimId: string, stakes: 'low' | 'high', approver?: string): 'approved' | 'queued' | 'rejected' {
    const c = this.claims.get(claimId);
    if (!c) return 'rejected';

    const pol = this.policy.evaluate(`agent:${c.proposer}`, 'tool:memory.promote', c.id);
    if (pol === 'deny') {
      c.status = 'rejected';
      this.audit.append({ actor: 'governance', domain: 'memory', action: 'claim:reject', target: c.id, decision: 'deny', reason: 'policy-deny' });
      return 'rejected';
    }

    if (stakes === 'low' && pol === 'allow' && c.robust.autoEligible) {
      c.status = 'approved';
      c.approvalBinding = { hash: this.bindingHash(c), approver: 'policy', at: new Date().toISOString() };
      this.audit.append({
        actor: 'governance', domain: 'memory', action: 'claim:approve', target: c.id, decision: 'allow',
        reason: `auto (conf=${c.confidence.toFixed(2)})`,
        detail: { points: c.robust.points, sources: c.robust.independentSources, binding: c.approvalBinding.hash },
      });
      return 'approved';
    }

    if (approver && approver !== 'system') {
      // D2 / T7 — ported from ScopeContractLedger.amend. A proposer approving their own claim is
      // the proposer=approver collapse, not an approval.
      if (approver === c.proposer) {
        this.audit.append({
          actor: approver, domain: 'memory', action: 'claim:approve', target: c.id, decision: 'deny',
          reason: 'proposer-cannot-approve-own-claim',
        });
        throw new GovernanceError('proposer cannot approve their own claim');
      }
      if (!this.approvers.has(approver)) {
        this.audit.append({
          actor: approver, domain: 'memory', action: 'claim:approve', target: c.id, decision: 'deny',
          reason: 'not-an-approver',
        });
        throw new GovernanceError('only an approver may approve a memory claim');
      }
      c.status = 'approved';
      c.approvalBinding = { hash: this.bindingHash(c), approver, at: new Date().toISOString() };
      this.audit.append({
        actor: approver, domain: 'memory', action: 'claim:approve', target: c.id, decision: 'allow',
        reason: 'approver', detail: { binding: c.approvalBinding.hash },
      });
      return 'approved';
    }

    this.audit.append({
      actor: 'governance', domain: 'memory', action: 'claim:queue', target: c.id,
      reason: `needs approval (conf=${c.confidence.toFixed(2)}, stakes=${stakes})`,
      detail: { policy: pol, reasons: c.robust.reasons },
    });
    return 'queued';
  }

  /** Layer 4 — only an APPROVED claim becomes canonical knowledge, carrying provenance.
   *  T9 — the approval binding is re-verified here: if the evidence changed between approval and
   *  promotion, the approval is void and the claim returns to candidate for re-gating. */
  promote(claimId: string, entity: { type: string; name: string; properties: Record<string, unknown> }): Entity {
    const c = this.claims.get(claimId);
    if (!c || c.status !== 'approved') throw new Error('cannot promote a non-approved claim');

    const now = this.bindingHash(c);
    if (!c.approvalBinding || c.approvalBinding.hash !== now) {
      c.status = 'candidate';
      c.approvalBinding = undefined;
      this.recompute(c);
      this.audit.append({
        actor: 'governance', domain: 'memory', action: 'claim:binding-drift', target: c.id,
        decision: 'deny', riskTier: 'high', reason: 'evidence changed since approval — re-gated',
      });
      throw new GovernanceError('claim content changed since approval; re-gate required');
    }

    const ent: Entity = { id: sid('ent'), ...entity, provenance: { claimId, evidence: c.supportedBy } };
    this.knowledge.set(ent.id, ent);
    this.audit.append({ actor: 'governance', domain: 'memory', action: 'knowledge:promote', target: ent.id, decision: 'allow', reason: `from ${claimId}` });
    return frozenCopy(ent);
  }

  /** Layer 7 — Decision Registry: governed decisions with rationale + provenance ("why X?"). */
  recordDecision(d: Omit<DecisionRecord, 'id'>): DecisionRecord {
    const dec: DecisionRecord = { ...d, id: sid('dec') };
    this.decisions.set(dec.id, dec);
    this.audit.append({ actor: 'governance', domain: 'memory', action: 'decision:record', target: dec.id, reason: d.decision });
    return frozenCopy(dec);
  }

  // Getters hand out frozen deep copies, never live store references (D6 / invariant 1).
  getEvidence(id: string): Evidence | undefined { const v = this.evidence.get(id); return v && frozenCopy(v); }
  getClaim(id: string): Claim | undefined { const v = this.claims.get(id); return v && frozenCopy(v); }
  getEntity(id: string): Entity | undefined { const v = this.knowledge.get(id); return v && frozenCopy(v); }
  getDecision(id: string): DecisionRecord | undefined { const v = this.decisions.get(id); return v && frozenCopy(v); }

  /** Embeddings (deferred to Phase 2) must be built from approved knowledge ONLY — never raw
   *  evidence or chat (T18). */
  approvedKnowledge(): Entity[] { return [...this.knowledge.values()].map(frozenCopy); }

  // ---- Persistence (D1) ----

  snapshot(): MemorySnapshot {
    const evidence = [...this.evidence.values()];
    const claims = [...this.claims.values()];
    const knowledge = [...this.knowledge.values()];
    const decisions = [...this.decisions.values()];
    return {
      schema: MEMORY_SCHEMA, version: MEMORY_SCHEMA_VERSION,
      evidence, claims, knowledge, decisions,
      hash: canonicalHash({ evidence, claims, knowledge, decisions }),
      writtenAt: new Date().toISOString(),
    };
  }

  /**
   * Three-state restore (D9). `loadJson` collapses "absent" and "corrupt" into the same fallback,
   * which for memory is a censorship / tamper-DoS primitive (T19): corrupt the file and memory comes
   * back silently empty. Absent is normal; corrupt is NOT restored and reports `degraded` so the
   * caller can enter safe mode.
   */
  restore(snap: unknown): RestoreResult {
    if (snap === null || snap === undefined) {
      return { ok: true, degraded: false, reason: 'no snapshot (fresh install)', restored: 0 };
    }
    if (typeof snap === 'symbol') {
      // The caller found the file but could not parse it. Absent and corrupt must never collapse
      // into the same outcome, or truncating the store becomes a silent way to erase knowledge.
      return { ok: false, degraded: true, reason: 'memory snapshot present but unparseable', restored: 0 };
    }
    const s = snap as Partial<MemorySnapshot>;
    if (typeof s !== 'object' || s.schema !== MEMORY_SCHEMA) {
      return { ok: false, degraded: true, reason: 'memory snapshot unreadable or wrong schema', restored: 0 };
    }
    if (s.version !== MEMORY_SCHEMA_VERSION) {
      return { ok: false, degraded: true, reason: `unknown memory snapshot version ${String(s.version)}`, restored: 0 };
    }
    const { evidence, claims, knowledge, decisions } = s;
    if (!Array.isArray(evidence) || !Array.isArray(claims) || !Array.isArray(knowledge) || !Array.isArray(decisions)) {
      return { ok: false, degraded: true, reason: 'memory snapshot missing collections', restored: 0 };
    }
    if (canonicalHash({ evidence, claims, knowledge, decisions }) !== s.hash) {
      return { ok: false, degraded: true, reason: 'memory snapshot hash mismatch — tampered or truncated', restored: 0 };
    }
    this.evidence = new Map(evidence.map((e) => [e.id, e]));
    this.claims = new Map(claims.map((c) => [c.id, c]));
    this.knowledge = new Map(knowledge.map((k) => [k.id, k]));
    this.decisions = new Map(decisions.map((d) => [d.id, d]));
    const restored = evidence.length + claims.length + knowledge.length + decisions.length;
    return { ok: true, degraded: false, reason: 'restored', restored };
  }
}
