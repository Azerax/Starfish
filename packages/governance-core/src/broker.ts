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
/** Where a decision is answered. 'starfish' (the default): an operator resolves it here, and any
 *  waiter gets the verdict. 'claude-code': a hook ask MIRRORED here so the queue shows every ask in
 *  one place; the person answers in Claude Code's own permission prompt, so Starfish cannot resolve
 *  it and only records the outcome it observes (`settle`). */
export type DecisionChannel = 'starfish' | 'claude-code';

export interface PendingDecision {
  id: string; ts: string;
  actor: string;            // the PROPOSER (an agent / subsystem) — never the approver
  kind: PendingKind;
  tool: string;             // human label: tool id, "capability:vet", etc.
  target?: string;
  refId?: string;           // capabilityId / taskId for the side-effect on approval
  riskTier?: RiskTier;
  reason: string;
  channel?: DecisionChannel;   // absent = 'starfish'
  sessionId?: string;          // the agent session that raised it, when known
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
    const where = d.channel === 'claude-code' ? "awaiting an answer in Claude Code's prompt (mirrored, observe-only)" : 'awaiting operator go/no-go';
    this.audit.append({ actor: d.actor, domain: 'governance', action: 'decision:filed', target: d.target ?? d.refId, decision: 'deny', riskTier: d.riskTier, reason: `${where} — ${d.reason}`, sessionId: d.sessionId });
    this.save();
    return rec;
  }

  /** File AND wait. The promise resolves when an operator resolves this decision. Only a Starfish-
   *  channel decision can be awaited: nobody here can answer a Claude Code prompt. */
  await(d: Omit<PendingDecision, 'id' | 'ts'>): Promise<DecisionVerdict> {
    if (d.channel === 'claude-code') return Promise.reject(new Error('a claude-code channel decision is answered in Claude Code and cannot be awaited here'));
    const rec = this.file(d);
    return new Promise<DecisionVerdict>((resolve) => { this.waiters.set(rec.id, resolve); });
  }

  list(): PendingDecision[] { return [...this.pending.values()]; }
  has(id: string): boolean { return this.pending.has(id); }
  get(id: string): PendingDecision | undefined { return this.pending.get(id); }

  /** Operator resolution. Enforces proposer != approver, and — when an operator principal set is supplied
   *  (audit A20) — that the approver is a designated operator (not merely some other agent). Audits,
   *  resolves any awaiter, persists. */
  resolve(id: string, verdict: DecisionVerdict, by: string, operators?: ReadonlySet<string> | readonly string[]): { ok: boolean; reason: string; decision?: PendingDecision } {
    const d = this.pending.get(id);
    if (!d) return { ok: false, reason: 'no such pending decision (already resolved?)' };
    // A mirrored ask is answered in Claude Code's own prompt. An "approve" here would be audited as an
    // operator approval while changing nothing in Claude Code, so it is refused outright.
    if (d.channel === 'claude-code') return { ok: false, reason: "answered in Claude Code's prompt — Starfish only observes this ask" };
    if (by === d.actor) return { ok: false, reason: 'proposer != approver — the proposing actor cannot self-approve' };
    if (operators !== undefined) {
      const ok = Array.isArray(operators) ? operators.includes(by) : (operators as ReadonlySet<string>).has(by);
      if (!ok) return { ok: false, reason: 'approver is not a designated operator (agent-vs-agent approval blocked)' };
    }
    this.pending.delete(id);
    const w = this.waiters.get(id); if (w) { this.waiters.delete(id); w(verdict); }
    this.audit.append({ actor: by, domain: 'governance', action: verdict === 'approve' ? 'decision:approved' : 'decision:denied', target: d.target ?? d.refId, decision: verdict === 'approve' ? 'allow' : 'deny', riskTier: d.riskTier, reason: `operator ${verdict} — ${d.reason}`, sessionId: d.sessionId });
    this.save();
    return { ok: true, reason: `operator ${verdict}`, decision: d };
  }

  /** Close a MIRRORED (claude-code channel) decision with the outcome observed after it: the tool ran,
   *  or it did not. This approves nothing — the person already answered in Claude Code — it records what
   *  happened so the queue empties and the audit shows the result. Refused for any other channel, so it
   *  can never stand in for an operator resolution. */
  settle(id: string, outcome: 'ran' | 'not-run' | 'superseded'): { ok: boolean; reason: string; decision?: PendingDecision } {
    const d = this.pending.get(id);
    if (!d) return { ok: false, reason: 'no such pending decision (already settled?)' };
    if (d.channel !== 'claude-code') return { ok: false, reason: 'only a claude-code channel decision can be settled by observation' };
    this.pending.delete(id);
    const what = outcome === 'ran' ? 'approved in Claude Code (the tool ran)'
      : outcome === 'not-run' ? 'not run (refused in Claude Code, or the turn ended first)'
      : 'no result seen before the next call (refused, or the tool failed)';
    this.audit.append({ actor: 'system', domain: 'governance', action: 'decision:settled', target: d.target ?? d.refId, decision: outcome === 'ran' ? 'allow' : 'deny', riskTier: d.riskTier, reason: `${what} — ${d.reason}`, sessionId: d.sessionId, detail: { decisionId: id, channel: 'claude-code', outcome } });
    this.save();
    return { ok: true, reason: what, decision: d };
  }

  /** Q9: "best-effort" persistence hid a real failure mode. The class docs promise "pending decisions
   *  persist fail-closed — a restart re-offers them". If the write silently fails, a restart instead
   *  makes a pending high-risk decision VANISH: the awaiting caller is gone and nothing is re-offered,
   *  which reads as "no decisions pending" rather than "decisions lost". Now audited as a failure. */
  private save(): void {
    if (!this.persistPath) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify({ pending: [...this.pending.values()] } as Persisted, null, 2));
    } catch (e) {
      try {
        this.audit.append({
          actor: 'system', domain: 'failure', action: 'broker-persist-failed', decision: 'deny', riskTier: 'high',
          reason: `pending decisions are NOT durable (${(e as Error).message}) — a restart will lose them instead of re-offering`,
        });
      } catch { /* the audit itself is down; the PDP fails closed on that independently */ }
    }
  }
  private restore(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const p = JSON.parse(readFileSync(this.persistPath, 'utf8')) as Persisted;
      for (const d of p.pending ?? []) this.pending.set(d.id, d);   // re-offered, still pending (fail-closed)
    } catch { /* corrupt persist => start empty; nothing auto-approved */ }
  }
}
