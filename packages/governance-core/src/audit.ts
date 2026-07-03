// Append-only, hash-chained audit log (R&C S-12; framework §4 "no silent execution").
import { appendFileSync, readFileSync, existsSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { sha256 } from './hash';
import { redactSecrets } from './secrets';
import type { AuditDomain, AuditEvent, RiskTier } from './types';

type NewEvent = {
  actor: string; domain: AuditDomain; action: string;
  target?: string; decision?: 'allow' | 'deny'; reason?: string;
  riskTier?: RiskTier; detail?: Record<string, unknown>;
};

export class AuditLog {
  private seq = 0;
  private prevHash = 'GENESIS';
  constructor(private path: string) { if (existsSync(path)) this.recover(); }

  private recover(): void {
    const lines = readFileSync(this.path, 'utf8').split('\n').filter(Boolean);
    for (const ln of lines) {
      const ev = JSON.parse(ln) as AuditEvent;
      this.seq = ev.seq + 1; this.prevHash = ev.hash;
    }
  }

  /** Append an event. Throws on write failure so callers can fail closed. */
  append(e: NewEvent): AuditEvent {
    const safe: NewEvent = { ...e };   // risk 37: never write secret material into the audit
    if (typeof safe.reason === 'string') safe.reason = redactSecrets(safe.reason).redacted;
    if (typeof safe.target === 'string') safe.target = redactSecrets(safe.target).redacted;
    const base = { ts: new Date().toISOString(), seq: this.seq, prevHash: this.prevHash, ...safe };
    const hash = sha256(this.prevHash + JSON.stringify(base));
    const ev = { ...base, hash } as AuditEvent;
    const fd = openSync(this.path, 'a');
    try { appendFileSync(fd, JSON.stringify(ev) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    this.seq++; this.prevHash = hash;
    return ev;
  }

  /** Recompute the chain; returns false if any line was edited/removed (tamper-evident). */
  verify(): boolean {
    if (!existsSync(this.path)) return true;
    const lines = readFileSync(this.path, 'utf8').split('\n').filter(Boolean);
    let prev = 'GENESIS';
    for (const ln of lines) {
      const ev = JSON.parse(ln) as AuditEvent;
      const { hash, ...rest } = ev;
      if (ev.prevHash !== prev) return false;
      const expect = sha256(prev + JSON.stringify(rest));
      if (expect !== hash) return false;
      prev = hash;
    }
    return true;
  }

  count(): number { return this.seq; }

  /** Current chain head: the last written event's seq + hash (GENESIS/-1 when empty). Used to
   *  ANCHOR the log against tail truncation / rollback (a hash chain alone can't detect those). */
  head(): { seq: number; headHash: string } { return { seq: this.seq - 1, headHash: this.prevHash }; }

  /** Read-only tail of the chain (newest last). `sinceSeq` returns events with seq >= sinceSeq;
   *  `limit` caps to the most recent N. Reads from disk; never mutates. */
  recent(limit?: number, sinceSeq?: number): AuditEvent[] {
    if (!existsSync(this.path)) return [];
    let evs = readFileSync(this.path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as AuditEvent);
    if (sinceSeq !== undefined) evs = evs.filter((e) => e.seq >= sinceSeq);
    if (limit !== undefined && evs.length > limit) evs = evs.slice(evs.length - limit);
    return evs;
  }
}
