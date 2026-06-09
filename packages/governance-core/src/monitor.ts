// Runtime security monitor (Hank) — Phase 6. READ-ONLY: it surfaces findings and escalates,
// but never acts on agents (no pause/kill/block). It supplements the deterministic Layer-2
// enforcement with a semantic sweep; crucially, its conclusions are reconciled against the
// deterministic audit counters, so a compromised/injected watcher that reports "all clear"
// while real governance events exist trips its own alarm (S-11 — injection fails safe).
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { AuditLog } from './audit';
import type { AuditEvent } from './types';

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export interface Finding { id: string; severity: Severity; kind: string; detail: string; at: string; }
export interface SweepCounters { denials: number; boundaryEscapes: number; hashMismatches: number; budgetHard: number; orphanPosts: number; casualties: number; concerning: number; }

export class SecurityMonitor {
  private cursor = 0;
  constructor(private auditPath: string, private audit: AuditLog) {}

  private window(): AuditEvent[] {
    if (!existsSync(this.auditPath)) return [];
    const all = readFileSync(this.auditPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as AuditEvent);
    const since = all.filter((e) => e.seq >= this.cursor);
    if (all.length) this.cursor = all[all.length - 1].seq + 1;
    return since;
  }

  /** Deterministic ground truth over the current window. */
  private count(events: AuditEvent[]): SweepCounters {
    const has = (e: AuditEvent, s: string) => (e.action ?? '').includes(s) || (e.reason ?? '').includes(s);
    let denials = 0, boundaryEscapes = 0, hashMismatches = 0, budgetHard = 0, orphanPosts = 0, casualties = 0;
    for (const e of events) {
      if (e.decision === 'deny') denials++;
      if (has(e, 'boundary') || has(e, 'symlink')) boundaryEscapes++;
      if (has(e, 'hash-mismatch')) hashMismatches++;
      if (has(e, 'budget-hard')) { budgetHard++; casualties++; }
      if (has(e, 'orphan-post')) orphanPosts++;
      if (has(e, 'kill') || (e.domain === 'task' && has(e, '->failed'))) casualties++;
    }
    const concerning = denials + boundaryEscapes + hashMismatches + budgetHard + orphanPosts;
    return { denials, boundaryEscapes, hashMismatches, budgetHard, orphanPosts, casualties, concerning };
  }

  /** A sweep returns deterministic counters + rule-based findings (the semantic LLM layer adds to,
   *  never replaces, these). Read-only — produces findings, changes nothing. */
  sweep(): { counters: SweepCounters; findings: Finding[] } {
    const events = this.window();
    const c = this.count(events);
    const f: Finding[] = [];
    const mk = (severity: Severity, kind: string, detail: string): Finding => ({ id: 'find_' + randomUUID().slice(0, 8), severity, kind, detail, at: new Date().toISOString() });
    if (c.hashMismatches > 0) f.push(mk('high', 'capability-tampering', `${c.hashMismatches} hash mismatch(es) since last sweep`));
    if (c.boundaryEscapes > 0) f.push(mk('high', 'boundary-escape-attempt', `${c.boundaryEscapes} boundary denial(s)`));
    if (c.orphanPosts > 0) f.push(mk('high', 'possible-silent-execution', `${c.orphanPosts} orphan PostToolUse`));
    if (c.budgetHard > 0) f.push(mk('medium', 'budget-breach', `${c.budgetHard} hard-limit pause(s)`));
    // repeated denials by the same actor => probing
    const byActor = new Map<string, number>();
    for (const e of events) if (e.decision === 'deny') byActor.set(e.actor, (byActor.get(e.actor) ?? 0) + 1);
    for (const [actor, n] of byActor) if (n >= 3) f.push(mk('medium', 'repeated-denials', `${actor}: ${n} denials (possible probing)`));
    for (const finding of f) this.file(finding);
    return { counters: c, findings: f };
  }

  /** File a finding to the audit; High/Critical are flagged for escalation to the human. Report-only. */
  file(finding: Finding): { escalated: boolean } {
    const escalate = finding.severity === 'high' || finding.severity === 'critical';
    this.audit.append({ actor: 'hank', domain: 'failure', action: `finding:${finding.kind}`, decision: escalate ? 'deny' : undefined, reason: `${finding.severity} — ${finding.detail}`, riskTier: finding.severity });
    return { escalated: escalate };
  }

  /** Reconcile a (possibly compromised) semantic report against deterministic counters.
   *  Reported "all clear" while concerning events exist => Critical discrepancy alarm. */
  reconcile(report: { allClear: boolean }): { ok: boolean; alarm?: Finding } {
    const c = this.count(this.peek());
    if (report.allClear && c.concerning > 0) {
      const alarm: Finding = { id: 'find_' + randomUUID().slice(0, 8), severity: 'critical', kind: 'watcher-discrepancy', detail: `reported all-clear but ${c.concerning} governance event(s) present in audit`, at: new Date().toISOString() };
      this.file(alarm);
      return { ok: false, alarm };
    }
    return { ok: true };
  }

  /** Read the full audit (not cursor-advancing) — used by reconcile so it sees the same ground truth. */
  private peek(): AuditEvent[] {
    if (!existsSync(this.auditPath)) return [];
    return readFileSync(this.auditPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as AuditEvent);
  }
}
