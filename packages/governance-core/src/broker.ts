// Decision Broker (ring 1) — the single place a governance "ask" parks until a human resolves it.
// A PDP `ask`, a quarantined capability, or (later) a tool the agent loop proposes all become a
// PendingDecision here. The waiting caller `await`s the verdict; the operator resolves it from the
// Bridge. proposer != approver is enforced: the resolver may not be the proposing actor. Pending
// decisions persist fail-closed — a restart re-offers them; nothing is ever auto-approved.
import type { AuditLog } from './audit';
import type { RiskTier } from './types';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DecisionVerdict = 'approve' | 'deny';
export type PendingKind = 'capability' | 'tool' | 'task';

export interface PendingDecision {
  id: string; ts: string;
  actor: string;            // the PROPOSER (an agent / subsystem) — never the approver
  kind: PendingKind;
  tool: string;             // human label: tool id, "capability:vet", etc.
  target?: string;
  refId?: string;           // capabilityId / taskId for the side-effect on approval
  riskTier?: RiskTier;
  reason: string;
}

interface Persisted { pending: PendingDecision[] }

export class DecisionBroker {
  private pending = new Map<string, PendingDecision>();
  private waiters = new Map<string, (v: DecisionVerdict) => void>();
  private n = 0;
  constructor(private audit: AuditLog, private persistPath?: string) { this.restore(); }

  /** Register a pending decision (no awaiter). Returns the created record. Idempotent on refId+kind. */
  file(d: Omit<PendingDecision, 'id' | 'ts'>): PendingDecision {
    const dup = [...this.pending.values()].find((p) => p.kind === d.kind && p.refId === d.refId && d.refId !== undefined);
    if (dup) return dup;
    const id = `dec_${Date.now().toString(36)}_${this.n++}`;
    const rec: PendingDecision = { ...d, id, ts: new Date().toISOString() };
    this.pending.set(id, rec);
    this.audit.append({ actor: d.actor, domain: 'governance', action: 'decision:filed', target: d.target ?? d.refId, decision: 'deny', riskTier: d.riskTier, reason: `awaiting operator go/no-go — ${d.reason}` });
    this.save();
    return rec;
  }

  /** File AND wait. The promise resolves when an operator resolves this decision. */
  await(d: Omit<PendingDecision, 'id' | 'ts'>): Promise<DecisionVerdict> {
    const rec = this.file(d);
    return new Promise<DecisionVerdict>((resolve) => { this.waiters.set(rec.id, resolve); });
  }

  list(): PendingDecision[] { return [...this.pending.values()]; }
  has(id: string): boolean { return this.pending.has(id); }
  get(id: string): PendingDecision | undefined { return this.pending.get(id); }

  /** Operator resolution. Enforces proposer != approver. Audits, resolves any awaiter, persists. */
  resolve(id: string, verdict: DecisionVerdict, by: string): { ok: boolean; reason: string; decision?: PendingDecision } {
    const d = this.pending.get(id);
    if (!d) return { ok: false, reason: 'no such pending decision (already resolved?)' };
    if (by === d.actor) return { ok: false, reason: 'proposer != approver — the proposing actor cannot self-approve' };
    this.pending.delete(id);
    const w = this.waiters.get(id); if (w) { this.waiters.delete(id); w(verdict); }
    this.audit.append({ actor: by, domain: 'governance', action: verdict === 'approve' ? 'decision:approved' : 'decision:denied', target: d.target ?? d.refId, decision: verdict === 'approve' ? 'allow' : 'deny', riskTier: d.riskTier, reason: `operator ${verdict} — ${d.reason}` });
    this.save();
    return { ok: true, reason: `operator ${verdict}`, decision: d };
  }

  private save(): void {
    if (!this.persistPath) return;
    try { mkdirSync(dirname(this.persistPath), { recursive: true }); writeFileSync(this.persistPath, JSON.stringify({ pending: [...this.pending.values()] } as Persisted, null, 2)); }
    catch { /* best-effort; in-memory remains authoritative this session */ }
  }
  private restore(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const p = JSON.parse(readFileSync(this.persistPath, 'utf8')) as Persisted;
      for (const d of p.pending ?? []) this.pending.set(d.id, d);   // re-offered, still pending (fail-closed)
    } catch { /* corrupt persist => start empty; nothing auto-approved */ }
  }
}
