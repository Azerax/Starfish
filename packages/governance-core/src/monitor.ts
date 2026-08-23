// Runtime security monitor (Hank) — Phase 6. READ-ONLY: it surfaces findings and escalates,
// but never acts on agents (no pause/kill/block). It supplements the deterministic Layer-2
// enforcement with a semantic sweep; crucially, its conclusions are reconciled against the
// deterministic audit counters, so a compromised/injected watcher that reports "all clear"
// while real governance events exist trips its own alarm (S-11 — injection fails safe).
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseAuditLines, type AuditLog } from './audit';
import type { AuditEvent } from './types';

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export interface Finding { id: string; severity: Severity; kind: string; detail: string; at: string; }
export interface SweepCounters { denials: number; boundaryEscapes: number; hashMismatches: number; budgetHard: number; orphanPosts: number; casualties: number; concerning: number; }

export class SecurityMonitor {
  private cursor = 0;
  constructor(private auditPath: string, private audit: AuditLog) {
    // The governor appends a boot event before the monitor is built, so in a healthy install the log
    // exists right now. Remember that, so a later disappearance is provably destruction and not a
    // never-configured path (F-2).
    this.sawAudit = existsSync(auditPath);
  }

  /** F-2: has the audit VANISHED beneath us? An absent file used to yield an empty window, which the
   *  counters then reported as zero concerning events — i.e. deleting the log disarmed the watcher
   *  whose whole job is to notice tampering. A log that existed and no longer does is a critical
   *  finding, and (below) it also makes reconcile() refuse an "all clear". */
  private auditVanished(): boolean { return this.sawAudit && !existsSync(this.auditPath); }
  private sawAudit = false;

  private window(): AuditEvent[] {
    if (!existsSync(this.auditPath)) return [];
    this.sawAudit = true;
    const all = parseAuditLines(readFileSync(this.auditPath, 'utf8')).events;
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
    // F-2: the log we were watching is GONE. Report it before anything else — every other counter in
    // this sweep is zero precisely because there is nothing left to count, and a zero must never be
    // allowed to read as "clean".
    if (this.auditVanished()) {
      const vanished = mk('critical', 'audit-vanished', `audit log ${this.auditPath} existed and is now absent — counters below are meaningless`);
      this.file(vanished);
      f.push(vanished);
    }
    if (c.hashMismatches > 0) f.push(mk('high', 'capability-tampering', `${c.hashMismatches} hash mismatch(es) since last sweep`));
    if (c.boundaryEscapes > 0) f.push(mk('high', 'boundary-escape-attempt', `${c.boundaryEscapes} boundary denial(s)`));
    if (c.orphanPosts > 0) f.push(mk('high', 'possible-silent-execution', `${c.orphanPosts} orphan PostToolUse`));
    if (c.budgetHard > 0) f.push(mk('medium', 'budget-breach', `${c.budgetHard} hard-limit pause(s)`));
    // repeated denials by the same actor => probing
    const byActor = new Map<string, number>();
    for (const e of events) if (e.decision === 'deny') byActor.set(e.actor, (byActor.get(e.actor) ?? 0) + 1);
    for (const [actor, n] of byActor) if (n >= 3) f.push(mk('medium', 'repeated-denials', `${actor}: ${n} denials (possible probing)`));
    // directory-listing probing/enumeration (fs.list): denied lists => boundary probing; many lists => enumeration
    const listByActor = new Map<string, { total: number; denied: number }>();
    for (const e of events) if ((e.action ?? '').includes('fs.list')) { const a = listByActor.get(e.actor) ?? { total: 0, denied: 0 }; a.total++; if (e.decision === 'deny') a.denied++; listByActor.set(e.actor, a); }
    for (const [actor, st] of listByActor) {
      if (st.denied >= 2) f.push(mk('high', 'listing-probing', `${actor}: ${st.denied} denied directory listing(s) — boundary probing`));
      else if (st.total >= 8) f.push(mk('medium', 'listing-enumeration', `${actor}: ${st.total} directory listings in window — possible enumeration`));
    }
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
    // F-2: if the ground truth itself is missing, an "all clear" cannot be corroborated and must be
    // refused. Previously the deterministic counters came back all-zero and AGREED with the watcher —
    // so deleting the audit was the single move that defeated both the watcher and its invigilator.
    if (this.auditVanished()) {
      const alarm: Finding = { id: 'find_' + randomUUID().slice(0, 8), severity: 'critical', kind: 'audit-vanished', detail: 'cannot corroborate any report — the audit log existed and is now absent', at: new Date().toISOString() };
      this.file(alarm);
      return { ok: false, alarm };
    }
    const c = this.count(this.peek());
    if (report.allClear && c.concerning > 0) {
      const alarm: Finding = { id: 'find_' + randomUUID().slice(0, 8), severity: 'critical', kind: 'watcher-discrepancy', detail: `reported all-clear but ${c.concerning} governance event(s) present in audit`, at: new Date().toISOString() };
      this.file(alarm);
      return { ok: false, alarm };
    }
    return { ok: true };
  }

  /** Read-only deterministic counters over the full audit. Does not advance the cursor or file
   *  findings — safe to call on every Bridge refresh. */
  counters(): SweepCounters { return this.count(this.peek()); }

  /** Read the full audit (not cursor-advancing) — used by reconcile so it sees the same ground truth. */
  private peek(): AuditEvent[] {
    if (!existsSync(this.auditPath)) return [];
    return parseAuditLines(readFileSync(this.auditPath, 'utf8')).events;
  }
}
