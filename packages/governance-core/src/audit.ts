// Append-only, hash-chained audit log (R&C S-12; framework §4 "no silent execution").
import { appendFileSync, readFileSync, existsSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { sha256 } from './hash';
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
    const base = { ts: new Date().toISOString(), seq: this.seq, prevHash: this.prevHash, ...e };
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
}
