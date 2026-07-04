// Append-only, hash-chained audit log (R&C S-12; framework §4 "no silent execution").
// Durability (audit A16/A17): a torn final line (partial append before crash/fsync) is healed on
// recover() and flagged (deliberate safe-mode, never an uncaught throw); any earlier unparseable line
// is treated as mid-file corruption. A persisted head anchor {seq,headHash} is ON BY DEFAULT so tail
// truncation/rollback — which a hash chain alone cannot see — is detected at boot. Optional size-based
// rotation moves sealed lines into chained segment files; verify() walks segments then the live tail.
import { appendFileSync, readFileSync, existsSync, openSync, fsyncSync, closeSync, renameSync, statSync } from 'node:fs';
import { sha256 } from './hash';
import { redactSecrets } from './secrets';
import type { AuditDomain, AuditEvent, RiskTier } from './types';

type NewEvent = {
  actor: string; domain: AuditDomain; action: string;
  target?: string; decision?: 'allow' | 'deny'; reason?: string;
  riskTier?: RiskTier; detail?: Record<string, unknown>;
};

export interface AuditAnchor { seq: number; headHash: string; }
export interface SegmentRoot { fromSeq: number; toSeq: number; firstPrevHash: string; lastHash: string; segHash: string; file: string; }
export interface AuditOptions { anchor?: boolean; rotateBytes?: number; }
export interface AuditParse { events: AuditEvent[]; tornTail: boolean; corrupt: boolean; }

/** Parse a chain file. A single unparseable FINAL line is a torn tail (tolerated); an unparseable
 *  earlier line is corruption. Never throws — callers decide how to fail closed. */
export function parseAuditLines(raw: string): AuditParse {
  const lines = raw.split('\n').filter(Boolean);
  const events: AuditEvent[] = [];
  let tornTail = false, corrupt = false;
  for (let i = 0; i < lines.length; i++) {
    try { events.push(JSON.parse(lines[i]) as AuditEvent); }
    catch { if (i === lines.length - 1) tornTail = true; else corrupt = true; }
  }
  return { events, tornTail, corrupt };
}

export class AuditLog {
  private seq = 0;
  private prevHash = 'GENESIS';
  private anchorEnabled: boolean;
  private rotateBytes: number;
  /** Integrity verdict established at construction. `ok:false` => boot should enter safe mode. */
  readonly integrity: { ok: boolean; reason: string } = { ok: true, reason: 'clean' };

  constructor(private path: string, opts: AuditOptions = {}) {
    this.anchorEnabled = opts.anchor ?? true;   // A17: anchoring ON by default
    this.rotateBytes = opts.rotateBytes ?? 0;   // 0 = rotation disabled
    if (existsSync(path) || existsSync(this.segIndexPath())) this.recover();
  }

  private anchorPath(): string { return this.path + '.anchor'; }
  private segIndexPath(): string { return this.path + '.segments'; }

  private writeFileSynced(file: string, data: string): void {
    const fd = openSync(file, 'w');
    try { appendFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  }
  private readAnchor(): AuditAnchor | null {
    if (!existsSync(this.anchorPath())) return null;
    try { return JSON.parse(readFileSync(this.anchorPath(), 'utf8')) as AuditAnchor; } catch { return null; }
  }
  private writeAnchor(): void {
    if (!this.anchorEnabled) return;
    try { this.writeFileSynced(this.anchorPath(), JSON.stringify({ seq: this.seq - 1, headHash: this.prevHash })); } catch { /* best effort */ }
  }
  private readSegments(): SegmentRoot[] {
    if (!existsSync(this.segIndexPath())) return [];
    try { return JSON.parse(readFileSync(this.segIndexPath(), 'utf8')) as SegmentRoot[]; } catch { return []; }
  }

  private recover(): void {
    const segs = this.readSegments();
    const cur = existsSync(this.path)
      ? parseAuditLines(readFileSync(this.path, 'utf8'))
      : { events: [] as AuditEvent[], tornTail: false, corrupt: false };
    // Restore chain head from the live tail, else from the last sealed segment.
    if (cur.events.length) { const last = cur.events[cur.events.length - 1]; this.seq = last.seq + 1; this.prevHash = last.hash; }
    else if (segs.length) { const s = segs[segs.length - 1]; this.seq = s.toSeq + 1; this.prevHash = s.lastHash; }
    // A16: mid-file corruption => safe mode; a torn tail is HEALED (physically truncated) + flagged so
    // the next append starts on a clean line instead of concatenating onto a partial record.
    if (cur.corrupt) { this.integrity.ok = false; this.integrity.reason = 'audit-corrupt-midfile'; }
    else if (cur.tornTail) {
      this.integrity.ok = false; this.integrity.reason = 'audit-torn-tail-healed';
      try { this.writeFileSynced(this.path, cur.events.map((e) => JSON.stringify(e)).join('\n') + (cur.events.length ? '\n' : '')); } catch { /* best effort */ }
    }
    // A17: a head anchor ahead of the recovered log proves tail truncation/rollback.
    const anchor = this.readAnchor();
    if (anchor && this.seq - 1 < anchor.seq) { this.integrity.ok = false; this.integrity.reason = 'audit-truncated (anchor ahead of log)'; }
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
    this.writeAnchor();
    if (this.rotateBytes > 0) this.maybeRotate();
    return ev;
  }

  private maybeRotate(): void {
    try { if (statSync(this.path).size >= this.rotateBytes) this.rotate(); } catch { /* ignore */ }
  }

  /** Seal the current live file into a chained segment and reset the tail. The chain continues (seq +
   *  prevHash are kept in memory), so a full verify() still links segments end to end. */
  rotate(): SegmentRoot | null {
    if (!existsSync(this.path)) return null;
    const raw = readFileSync(this.path, 'utf8');
    const { events, tornTail, corrupt } = parseAuditLines(raw);
    if (!events.length || tornTail || corrupt) return null;   // never rotate an unhealthy tail
    const first = events[0], last = events[events.length - 1];
    const segFile = `${this.path}.${first.seq}-${last.seq}.seg`;
    renameSync(this.path, segFile);
    const seg: SegmentRoot = { fromSeq: first.seq, toSeq: last.seq, firstPrevHash: first.prevHash, lastHash: last.hash, segHash: sha256(raw), file: segFile };
    const idx = this.readSegments(); idx.push(seg);
    this.writeFileSynced(this.segIndexPath(), JSON.stringify(idx));
    return seg;
  }

  private verifyChain(events: AuditEvent[], startPrev: string): { ok: boolean; head: string } {
    let prev = startPrev;
    for (const ev of events) {
      const { hash, ...rest } = ev;
      if (ev.prevHash !== prev) return { ok: false, head: prev };
      if (sha256(prev + JSON.stringify(rest)) !== hash) return { ok: false, head: prev };
      prev = hash;
    }
    return { ok: true, head: prev };
  }

  /** Recompute the whole chain (sealed segments then live tail); false if anything was edited, removed,
   *  reordered, or if construction already found corruption/truncation. */
  verify(): boolean {
    if (!this.integrity.ok) return false;
    let prev = 'GENESIS';
    for (const s of this.readSegments()) {
      if (!existsSync(s.file)) return false;
      const p = parseAuditLines(readFileSync(s.file, 'utf8'));
      if (p.tornTail || p.corrupt) return false;
      const r = this.verifyChain(p.events, prev);
      if (!r.ok || r.head !== s.lastHash) return false;
      prev = r.head;
    }
    if (existsSync(this.path)) {
      const p = parseAuditLines(readFileSync(this.path, 'utf8'));
      if (p.tornTail || p.corrupt) return false;
      if (!this.verifyChain(p.events, prev).ok) return false;
    }
    return true;
  }

  count(): number { return this.seq; }

  /** Current chain head: the last written event's seq + hash (GENESIS/-1 when empty). Anchors the log
   *  against tail truncation / rollback (a hash chain alone can't detect those). */
  head(): { seq: number; headHash: string } { return { seq: this.seq - 1, headHash: this.prevHash }; }

  /** Read-only tail of the chain (newest last). `sinceSeq` returns events with seq >= sinceSeq;
   *  `limit` caps to the most recent N. Reads from disk; never mutates; tolerant of a torn tail. */
  recent(limit?: number, sinceSeq?: number): AuditEvent[] {
    if (!existsSync(this.path)) return [];
    let evs = parseAuditLines(readFileSync(this.path, 'utf8')).events;
    if (sinceSeq !== undefined) evs = evs.filter((e) => e.seq >= sinceSeq);
    if (limit !== undefined && evs.length > limit) evs = evs.slice(evs.length - limit);
    return evs;
  }
}
