// Governed memory (framework §9; Scott's evidence→knowledge model). v1 slice; relationship graph
// and vector recall are deferred. Core principle: nothing is remembered because an LLM said it —
// everything traces to evidence, passes governance, and exists as a versioned object with provenance.
import { randomUUID } from 'node:crypto';
import type { AuditLog } from './audit';
import type { PolicyEngine } from './policy';

const sid = (p: string) => `${p}_${randomUUID().slice(0, 8)}`;

export interface Evidence { id: string; source: string; author: string; statement: string; confidence: number; at: string; }
export interface Claim { id: string; statement: string; confidence: number; supportedBy: string[]; status: 'candidate' | 'approved' | 'rejected'; }
export interface Entity { id: string; type: string; name: string; properties: Record<string, unknown>; provenance: { claimId: string; evidence: string[] }; }
export interface Decision { id: string; decision: string; reason: string; alternatives: string[]; status: 'accepted' | 'rejected' | 'superseded'; provenance: { evidence: string[] }; }

export class GovernedMemory {
  private evidence = new Map<string, Evidence>();
  private claims = new Map<string, Claim>();
  private knowledge = new Map<string, Entity>();
  private decisions = new Map<string, Decision>();
  constructor(private audit: AuditLog, private policy: PolicyEngine, private autoApproveConfidence = 0.9) {}

  /** Layer 1 — evidence: immutable, append-only, provenance-stamped. */
  addEvidence(e: Omit<Evidence, 'id' | 'at'>): Evidence {
    const ev: Evidence = { ...e, id: sid('ev'), at: new Date().toISOString() };
    this.evidence.set(ev.id, ev);
    this.audit.append({ actor: e.author, domain: 'memory', action: 'evidence:add', target: ev.id, reason: e.source });
    return ev;
  }

  /** Layer 2 — claim proposed FROM evidence (never asserted). Confidence = mean of supporting evidence. */
  proposeClaim(statement: string, supportedBy: string[], proposer: string): Claim {
    const evs = supportedBy.map((id) => this.evidence.get(id)).filter((x): x is Evidence => !!x);
    const conf = evs.length ? evs.reduce((a, e) => a + e.confidence, 0) / evs.length : 0;
    const c: Claim = { id: sid('claim'), statement, confidence: conf, supportedBy, status: 'candidate' };
    this.claims.set(c.id, c);
    this.audit.append({ actor: proposer, domain: 'memory', action: 'claim:propose', target: c.id, reason: `confidence=${conf.toFixed(2)}` });
    return c;
  }

  /** Conflicting evidence weakens a candidate claim (defeasible). */
  addConflictingEvidence(claimId: string, evidenceId: string): void {
    const c = this.claims.get(claimId); const e = this.evidence.get(evidenceId);
    if (!c || !e) return;
    c.confidence = Math.max(0, c.confidence - e.confidence * 0.5);
    this.audit.append({ actor: 'system', domain: 'memory', action: 'claim:conflict', target: claimId, reason: `confidence->${c.confidence.toFixed(2)}` });
  }

  /** Layer 3 — deterministic governance gate. Low-stakes + high-confidence auto-approves (audited);
   *  otherwise an approver is required. Policy may deny outright. */
  evaluateClaim(claimId: string, stakes: 'low' | 'high', approver?: string): 'approved' | 'queued' | 'rejected' {
    const c = this.claims.get(claimId);
    if (!c) return 'rejected';
    const pol = this.policy.evaluate('memory', 'memory:promote', c.id);
    if (pol === 'deny') { c.status = 'rejected'; this.audit.append({ actor: 'governance', domain: 'memory', action: 'claim:reject', target: c.id, decision: 'deny', reason: 'policy-deny' }); return 'rejected'; }
    if (stakes === 'low' && c.confidence >= this.autoApproveConfidence && pol !== 'ask') {
      c.status = 'approved';
      this.audit.append({ actor: 'governance', domain: 'memory', action: 'claim:approve', target: c.id, decision: 'allow', reason: `auto (conf=${c.confidence.toFixed(2)})` });
      return 'approved';
    }
    if (approver && approver !== 'system') {
      c.status = 'approved';
      this.audit.append({ actor: approver, domain: 'memory', action: 'claim:approve', target: c.id, decision: 'allow', reason: 'approver' });
      return 'approved';
    }
    this.audit.append({ actor: 'governance', domain: 'memory', action: 'claim:queue', target: c.id, reason: `needs approval (conf=${c.confidence.toFixed(2)}, stakes=${stakes})` });
    return 'queued';
  }

  /** Layer 4 — only an APPROVED claim becomes canonical knowledge, carrying provenance. */
  promote(claimId: string, entity: { type: string; name: string; properties: Record<string, unknown> }): Entity {
    const c = this.claims.get(claimId);
    if (!c || c.status !== 'approved') throw new Error('cannot promote a non-approved claim');
    const ent: Entity = { id: sid('ent'), ...entity, provenance: { claimId, evidence: c.supportedBy } };
    this.knowledge.set(ent.id, ent);
    this.audit.append({ actor: 'governance', domain: 'memory', action: 'knowledge:promote', target: ent.id, decision: 'allow', reason: `from ${claimId}` });
    return ent;
  }

  /** Layer 7 — Decision Registry: governed decisions with rationale + provenance ("why X?"). */
  recordDecision(d: Omit<Decision, 'id'>): Decision {
    const dec: Decision = { ...d, id: sid('dec') };
    this.decisions.set(dec.id, dec);
    this.audit.append({ actor: 'governance', domain: 'memory', action: 'decision:record', target: dec.id, reason: d.decision });
    return dec;
  }

  getEvidence(id: string): Evidence | undefined { return this.evidence.get(id); }
  getClaim(id: string): Claim | undefined { return this.claims.get(id); }
  getEntity(id: string): Entity | undefined { return this.knowledge.get(id); }
  getDecision(id: string): Decision | undefined { return this.decisions.get(id); }
  /** Embeddings (deferred) must be built from approved knowledge ONLY — never raw evidence/chat. */
  approvedKnowledge(): Entity[] { return [...this.knowledge.values()]; }
}
