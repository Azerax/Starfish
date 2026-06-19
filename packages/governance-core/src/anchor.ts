// Anchoring — OPTIONAL external notarization of the audit trail. OFF by default (NoopAnchor = zero
// overhead) for personal users; institutions turn it on. It periodically commits a MERKLE ROOT of the
// audit (a single hash that fingerprints the whole history to date) to an outside witness — a local
// append-only anchor file, a timestamp authority, or a permissioned/public ledger — so the record
// becomes tamper-evident even against the operator who holds the signing key (the 17a-4 / "designated
// third party" gap). Only ROOTS leave the machine, never audit content (privacy/egress). Anchoring is
// BEST-EFFORT: a failed commit is recorded and execution continues — it can never block a decision or
// halt boot (fail-closed stays a property of the PDP, not of the notary).
import { sha256 } from './hash';
import type { AuditLog } from './audit';
import type { AuditEvent } from './types';

/** Deterministic Merkle root over an ordered list of leaf hashes. Empty -> 'EMPTY'. */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return 'EMPTY';
  let level = leaves.slice();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i], b = i + 1 < level.length ? level[i + 1] : level[i]; // duplicate last if odd
      next.push(sha256(a + b));
    }
    level = next;
  }
  return level[0];
}

export interface AnchorRecord { root: string; count: number; headSeq: number; headHash: string; ts: string; prevAnchor?: string; }
export interface AnchorReceipt { ok: boolean; backend: string; ref?: string; record: AnchorRecord; reason?: string; }
/** A notarization backend. `commit` publishes a root somewhere durable/independent and returns a ref. */
export interface AnchorAdapter { readonly id: string; commit(record: AnchorRecord): Promise<AnchorReceipt> | AnchorReceipt; }

/** Build the Merkle root + head pointer over a turn/range of audit events. */
export function auditRoot(events: AuditEvent[]): AnchorRecord {
  const hashes = events.map((e) => e.hash);
  const last = events[events.length - 1];
  return { root: merkleRoot(hashes), count: events.length, headSeq: last ? last.seq : -1, headHash: last ? last.hash : 'GENESIS', ts: new Date().toISOString() };
}

/** Default: notarize nothing (personal use). Zero overhead, no egress. */
export const NoopAnchor: AnchorAdapter = { id: 'noop', commit: (record) => ({ ok: true, backend: 'noop', record }) };

/** Local append-only anchor chain — a separate artifact, each anchor chained to the previous. Not a
 *  true third party, but a tamper-evident, separately-stored notarization (a step toward 17a-4 WORM). */
export function fileAnchor(filePath: string): AnchorAdapter {
  return {
    id: 'file',
    commit: (record) => {
      const line = JSON.stringify({ ...record, anchorHash: sha256((record.prevAnchor ?? 'GENESIS') + record.root + record.headHash) });
      const { appendFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs');
      const { dirname } = require('node:path') as typeof import('node:path');
      mkdirSync(dirname(filePath), { recursive: true });
      appendFileSync(filePath, line + '\n');
      const ref = (JSON.parse(line) as { anchorHash: string }).anchorHash;
      return { ok: true, backend: 'file', ref, record };
    },
  };
}

/** Wrap any publish function (TSA token, ledger tx, transparency log) as an adapter. Host supplies it. */
export function customAnchor(id: string, publish: (record: AnchorRecord) => Promise<string> | string): AnchorAdapter {
  return { id, commit: async (record) => ({ ok: true, backend: id, ref: await publish(record), record }) };
}

export interface AnchorConfig { enabled: boolean; everyNEvents?: number; }

/** Drives anchoring per policy. Best-effort: a commit failure is audited and swallowed (never throws). */
export class Anchorer {
  private lastRef?: string;
  private lastCount = 0;
  constructor(private adapter: AnchorAdapter = NoopAnchor, private opts: AnchorConfig = { enabled: false }, private audit?: AuditLog) {}

  get enabled(): boolean { return this.opts.enabled && this.adapter.id !== 'noop'; }

  /** True when enough new events have accrued since the last anchor (or no threshold set). */
  due(currentEventCount: number): boolean {
    if (!this.enabled) return false;
    const n = this.opts.everyNEvents ?? 1;
    return currentEventCount - this.lastCount >= n;
  }

  /** Commit a root over `events`. Returns a receipt; never throws (notary is not on the fail-closed path). */
  async anchor(events: AuditEvent[]): Promise<AnchorReceipt> {
    const record = auditRoot(events);
    record.prevAnchor = this.lastRef;
    if (!this.enabled) return { ok: true, backend: 'noop', record };
    try {
      const r = await this.adapter.commit(record);
      this.lastRef = r.ref; this.lastCount = record.count;
      this.audit?.append({ actor: 'system', domain: 'system', action: 'anchor-committed', target: record.root, reason: `backend=${r.backend} ref=${r.ref ?? '-'} count=${record.count} head=${record.headSeq}` });
      return r;
    } catch (e) {
      this.audit?.append({ actor: 'system', domain: 'failure', action: 'anchor-failed', target: record.root, decision: 'deny', reason: `notary error (best-effort, execution continues): ${(e as Error).message}` });
      return { ok: false, backend: this.adapter.id, record, reason: (e as Error).message };
    }
  }
}

/** Factory from config (host wiring). 'file' needs filePath; 'custom' supply the adapter directly. */
export function makeAnchorAdapter(cfg: { backend: 'noop' | 'file'; filePath?: string }): AnchorAdapter {
  if (cfg.backend === 'file' && cfg.filePath) return fileAnchor(cfg.filePath);
  return NoopAnchor;
}
